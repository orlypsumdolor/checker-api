const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const gradingRoutes = require("./routes/grading");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend
app.use(express.static(path.join(__dirname, "../public")));

// Routes
app.use("/api", gradingRoutes);

// API info endpoint
app.get("/api/info", (_req, res) => {
  res.json({
    name: "Checker — AI Grading API",
    version: "1.0.0",
    description: "AI-powered student grading API using Ollama",
    endpoints: {
      "POST /api/grade": "Grade a single submission (files, text, or JSON body)",
      "POST /api/grade/batch": "Grade multiple submissions (file upload)",
      "GET  /api/rubric/sample": "Get a sample rubric template",
      "GET  /api/supported-formats": "List supported file formats",
      "GET  /api/health": "Health check (Ollama connection)",
    },
    supportedFiles: [".txt", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ods", ".md", ".csv", ".json"],
  });
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);

  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ success: false, error: "File too large. Max size is 20 MB." });
  }

  if (err.message && err.message.startsWith("Unsupported file type")) {
    return res.status(400).json({ success: false, error: err.message });
  }

  res.status(500).json({ success: false, error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`\n  Checker API is running at http://localhost:${PORT}`);
  console.log(`  Web UI:              http://localhost:${PORT}`);
  console.log(`  Health check:        http://localhost:${PORT}/api/health`);
  console.log(`  Sample rubric:       http://localhost:${PORT}/api/rubric/sample`);
  console.log(`  Supported formats:   http://localhost:${PORT}/api/supported-formats\n`);
});
