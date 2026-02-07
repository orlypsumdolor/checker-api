const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseFile, parseRubricFile, getSupportedExtensions } = require("../utils/fileParsers");
const { gradeSubmission, generateSampleRubric, DEFAULT_MODEL } = require("../services/grader");
const { saveResult, getResults, getResultById, deleteResult, isDbAvailable } = require("../db");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, "../../uploads"),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const supported = getSupportedExtensions();
    if (supported.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Supported: ${supported.join(", ")}`));
    }
  },
});

/**
 * Middleware wrapper: apply multer only for multipart requests,
 * skip gracefully for JSON bodies so the same route handles both.
 */
function optionalUpload(fields) {
  const multerMiddleware = upload.fields(fields);
  return (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.startsWith("multipart/form-data")) {
      return multerMiddleware(req, res, next);
    }
    next();
  };
}

/**
 * Helper to clean up uploaded files after processing
 */
function cleanupFiles(files) {
  if (!files) return;
  const allFiles = Object.values(files).flat();
  for (const file of allFiles) {
    try {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * POST /api/grade
 *
 * Grade a single submission.
 * Each field accepts EITHER a file upload OR a text value — file takes priority.
 *
 * Form fields (multipart/form-data):
 *   - submission (file OR text, required): Student's work
 *   - rubric (file OR text, required): Grading rubric (text can be JSON string or plain text)
 *   - instructions (file OR text, required): Assignment instructions
 *   - maxScore (text, optional): Maximum score (default 100)
 *   - studentName (text, optional): Student's name
 *   - model (text, optional): Ollama model name (default llama3.2)
 *
 * Also accepts JSON body (Content-Type: application/json) with the same field names.
 */
router.post(
  "/grade",
  optionalUpload([
    { name: "submission", maxCount: 1 },
    { name: "rubric", maxCount: 1 },
    { name: "instructions", maxCount: 1 },
    { name: "noteFiles", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      // Resolve submission: file first, then text field
      let submission;
      if (req.files?.submission?.[0]) {
        submission = await parseFile(req.files.submission[0].path, req.files.submission[0].originalname);
      } else if (req.body.submission) {
        submission = req.body.submission;
      } else {
        return res.status(400).json({ error: "Missing required field: submission (provide a file or text)" });
      }

      // Resolve rubric: file first, then text field, or null (AI will grade based on instructions alone)
      let rubric = null;
      if (req.files?.rubric?.[0]) {
        rubric = await parseRubricFile(req.files.rubric[0].path, req.files.rubric[0].originalname);
      } else if (req.body.rubric) {
        rubric = req.body.rubric;
        if (typeof rubric === "string") {
          try { rubric = JSON.parse(rubric); } catch { /* keep as string */ }
        }
      }

      // Resolve instructions: file first, then text field
      let instructions;
      if (req.files?.instructions?.[0]) {
        instructions = await parseFile(req.files.instructions[0].path, req.files.instructions[0].originalname);
      } else if (req.body.instructions) {
        instructions = req.body.instructions;
      } else {
        return res.status(400).json({ error: "Missing required field: instructions (provide a file or text)" });
      }

      // Resolve note: combine all note files + text (all optional, stacked together)
      const noteParts = [];
      if (req.files?.noteFiles) {
        for (const nf of req.files.noteFiles) {
          noteParts.push(await parseFile(nf.path, nf.originalname));
        }
      }
      if (req.body.note) {
        noteParts.push(req.body.note);
      }
      const note = noteParts.length > 0 ? noteParts.join("\n\n") : null;

      const maxScore = parseInt(req.body.maxScore) || 100;
      const studentName = req.body.studentName || "";
      const leniency = req.body.leniency || "normal";
      const model = req.body.model || DEFAULT_MODEL;

      // Grade the submission
      const result = await gradeSubmission({
        submission,
        rubric,
        instructions,
        note,
        maxScore,
        studentName,
        leniency,
        model,
      });

      // Save to database (if available)
      let dbId = null;
      if (isDbAvailable()) {
        try {
          dbId = await saveResult(result);
        } catch (dbErr) {
          console.error("Failed to save result to database:", dbErr.message);
        }
      }

      // Clean up temp files
      cleanupFiles(req.files);

      res.json({
        success: true,
        data: { ...result, id: dbId },
      });
    } catch (err) {
      cleanupFiles(req.files);
      console.error("Grading error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal server error during grading",
      });
    }
  }
);

/**
 * POST /api/grade/batch
 *
 * Grade multiple submissions at once.
 *
 * Form fields (multipart/form-data):
 *   - submissions (files, required): Multiple student submission files
 *   - rubric (file OR text, required): Grading rubric
 *   - instructions (file OR text, required): Assignment instructions
 *   - maxScore (text, optional)
 *   - model (text, optional)
 *
 * Student names are inferred from filenames (without extension).
 */
router.post(
  "/grade/batch",
  optionalUpload([
    { name: "submissions", maxCount: 50 },
    { name: "rubric", maxCount: 1 },
    { name: "instructions", maxCount: 1 },
    { name: "noteFiles", maxCount: 10 },
  ]),
  async (req, res) => {
    try {
      if (!req.files?.submissions || req.files.submissions.length === 0) {
        return res.status(400).json({ error: "Missing required files: submissions" });
      }

      // Resolve rubric: file first, then text field, or null
      let rubric = null;
      if (req.files?.rubric?.[0]) {
        rubric = await parseRubricFile(req.files.rubric[0].path, req.files.rubric[0].originalname);
      } else if (req.body.rubric) {
        rubric = req.body.rubric;
        if (typeof rubric === "string") {
          try { rubric = JSON.parse(rubric); } catch { /* keep as string */ }
        }
      }

      // Resolve instructions: file first, then text field
      let instructions;
      if (req.files?.instructions?.[0]) {
        instructions = await parseFile(req.files.instructions[0].path, req.files.instructions[0].originalname);
      } else if (req.body.instructions) {
        instructions = req.body.instructions;
      } else {
        return res.status(400).json({ error: "Missing required field: instructions (provide a file or text)" });
      }

      // Resolve note: combine all note files + text
      const noteParts = [];
      if (req.files?.noteFiles) {
        for (const nf of req.files.noteFiles) {
          noteParts.push(await parseFile(nf.path, nf.originalname));
        }
      }
      if (req.body.note) {
        noteParts.push(req.body.note);
      }
      const note = noteParts.length > 0 ? noteParts.join("\n\n") : null;

      const maxScore = parseInt(req.body.maxScore) || 100;
      const leniency = req.body.leniency || "normal";
      const model = req.body.model || DEFAULT_MODEL;

      const results = [];

      // Grade each submission sequentially to avoid overwhelming Ollama
      for (const submissionFile of req.files.submissions) {
        const studentName = path.basename(
          submissionFile.originalname,
          path.extname(submissionFile.originalname)
        );

        try {
          const submission = await parseFile(submissionFile.path, submissionFile.originalname);

          const result = await gradeSubmission({
            submission,
            rubric,
            instructions,
            note,
            maxScore,
            studentName,
            leniency,
            model,
          });

          // Save to database (if available)
          let dbId = null;
          if (isDbAvailable()) {
            try {
              dbId = await saveResult(result);
            } catch (dbErr) {
              console.error("Failed to save batch result to database:", dbErr.message);
            }
          }

          results.push({
            studentName,
            filename: submissionFile.originalname,
            id: dbId,
            ...result,
          });
        } catch (err) {
          results.push({
            studentName,
            filename: submissionFile.originalname,
            error: err.message,
          });
        }
      }

      cleanupFiles(req.files);

      res.json({
        success: true,
        totalSubmissions: req.files.submissions.length,
        data: results,
      });
    } catch (err) {
      cleanupFiles(req.files);
      console.error("Batch grading error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Internal server error during batch grading",
      });
    }
  }
);

/**
 * GET /api/rubric/sample
 *
 * Returns a sample rubric template
 */
router.get("/rubric/sample", (_req, res) => {
  res.json({
    success: true,
    data: generateSampleRubric(),
  });
});

/**
 * GET /api/supported-formats
 *
 * Returns the list of supported file formats
 */
router.get("/supported-formats", (_req, res) => {
  res.json({
    success: true,
    data: {
      submission: getSupportedExtensions(),
      rubric: getSupportedExtensions(),
      instructions: getSupportedExtensions(),
    },
  });
});

/**
 * GET /api/health
 *
 * Health check endpoint
 */
router.get("/health", async (_req, res) => {
  try {
    const { Ollama } = require("ollama");
    const client = new Ollama();
    const models = await client.list();
    res.json({
      success: true,
      status: "healthy",
      ollama: {
        connected: true,
        models: models.models.map((m) => m.name),
      },
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      ollama: {
        connected: false,
        error: err.message,
      },
    });
  }
});

/**
 * GET /api/results
 *
 * Returns all grading results (newest first).
 * Query params:
 *   - limit (number, default 50)
 *   - offset (number, default 0)
 */
router.get("/results", async (req, res) => {
  if (!isDbAvailable()) {
    return res.json({ success: true, data: [], total: 0, limit: 0, offset: 0, dbOffline: true });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const { rows, total } = await getResults({ limit, offset });
    res.json({ success: true, data: rows, total, limit, offset });
  } catch (err) {
    console.error("Failed to fetch results:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/results/:id
 *
 * Returns a single grading result by ID (full data).
 */
router.get("/results/:id", async (req, res) => {
  try {
    const row = await getResultById(req.params.id);
    if (!row) {
      return res.status(404).json({ success: false, error: "Result not found" });
    }
    res.json({ success: true, data: row });
  } catch (err) {
    console.error("Failed to fetch result:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/results/:id
 *
 * Deletes a grading result by ID.
 */
router.delete("/results/:id", async (req, res) => {
  try {
    const deleted = await deleteResult(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Result not found" });
    }
    res.json({ success: true, message: "Result deleted" });
  } catch (err) {
    console.error("Failed to delete result:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
