const { Ollama } = require("ollama");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ollama = new Ollama();

/** Backend: "ollama" (default) or "cursor" (Cursor CLI) */
const DEFAULT_BACKEND = "ollama";


/**
 * Default model to use
 */
const DEFAULT_MODEL = "llama3.2";

/**
 * Check if a rubric is structured (JSON object with max_points per criterion)
 */
function isStructuredRubric(rubric) {
  if (typeof rubric !== "object" || rubric === null || Array.isArray(rubric)) return false;
  // Check if at least one key has a max_points property
  return Object.values(rubric).some(
    (v) => typeof v === "object" && v !== null && typeof v.max_points === "number"
  );
}

/**
 * Build the grading prompt from inputs.
 * Adapts automatically based on whether the rubric is structured JSON or freeform text.
 */
const LENIENCY_INSTRUCTIONS = {
  strict: `
- Award full points ONLY if a criterion is fully met
- Do NOT infer intent or missing details
- Penalize inaccuracies, omissions, or unclear explanations
- Partial correctness receives partial credit`,

  normal: `
- Apply the rubric/criteria as written
- Allow reasonable interpretation when the submission is clearly correct
- Penalize clear errors and missing required elements
- Partial correctness receives proportional credit`,

  lenient: `
- Favor the student when intent is reasonably clear
- Focus on major requirements and core concepts
- Minor issues should cause small deductions only
- Partial correctness receives generous partial credit`,

  very_lenient: `
- Reward effort and basic understanding
- Deduct only for major conceptual misunderstandings
- Ignore minor errors unless explicitly required
- Give generous partial credit for relevant attempts`,
};

function buildGradingPrompt({ submission, rubric, instructions, note, maxScore, studentName, leniency = "normal" }) {
  let rubricSection;
  let rubricResponseInstruction;

  if (!rubric) {
    // No rubric provided — derive criteria from the assignment instructions
    rubricSection = "";
    rubricResponseInstruction = `
No formal rubric was provided. Derive grading criteria from the assignment instructions.

STEP 1 — EXTRACT CRITERIA:
- Break instructions into explicit requirements (what students were told to do).
- Identify implied expectations (what a competent response would include).
- Turn each into a checkable criterion (3–7 total).

STEP 2 — ASSIGN WEIGHTS (must sum to ${maxScore}):
Use this default split, adjusting if the instructions emphasize certain areas:
  Task Completion (followed instructions): ~40%
  Accuracy / Correctness:                  ~30%
  Clarity & Organization:                  ~20%
  Effort / Completeness:                   ~10%
You may merge or split categories to fit the assignment.

STEP 3 — SCORE EACH CRITERION:
For each criterion:
  1. Binary check — Was the requirement met? (Yes / No)
  2. Quality modifier — If met: Weak / Acceptable / Strong
  3. Assign points:
     Not met        → 0 or minimal
     Met (Weak)     → 40–60% of max_points
     Met (Acceptable) → 60–80% of max_points
     Met (Strong)   → 80–100% of max_points

STEP 4 — GRADE INTENT, NOT STYLE:
- If the student follows instructions and shows understanding, do not give a low grade for imperfect execution.`;
  } else if (isStructuredRubric(rubric)) {
    // Structured rubric with explicit criteria and point values
    rubricSection = `\nGRADING RUBRIC:\n${JSON.stringify(rubric, null, 2)}`;
    rubricResponseInstruction = `
The rubric above has specific criteria with point values. For each criterion in the rubric, provide a score (out of its max_points) and feedback in the "rubric_breakdown" field.`;
  } else {
    // Freeform rubric — plain text, a description, a table, etc.
    const rubricText = typeof rubric === "object" ? JSON.stringify(rubric, null, 2) : String(rubric);
    rubricSection = `\nGRADING RUBRIC:\n${rubricText}`;
    rubricResponseInstruction = `
The rubric above is in freeform/text format. Read it carefully, identify the grading criteria described, and create your own reasonable point breakdown that adds up to the maximum score of ${maxScore}. For each criterion you identify, provide a score and feedback in the "rubric_breakdown" field.`;
  }

  const leniencyInstruction = LENIENCY_INSTRUCTIONS[leniency] || LENIENCY_INSTRUCTIONS.normal;

  return `You are an expert academic grader. Grade the following student submission carefully and objectively.

ASSIGNMENT INSTRUCTIONS:
${instructions}
${rubricSection}
MAXIMUM SCORE: ${maxScore}
${studentName ? `STUDENT: ${studentName}` : ""}

STUDENT SUBMISSION:
${submission}
${note ? `\nADDITIONAL NOTES FROM GRADER:\n${note}` : ""}
---
${rubricResponseInstruction}

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

{
  "student_name": "${studentName || "Anonymous"}",
  "total_score": <number>,
  "max_score": ${maxScore},
  "percentage": <number>,
  "rubric_breakdown": {
    "<CriterionName>": {
      "score": <number>,
      "max_points": <number>,
      "feedback": "<3-6 sentence detailed paragraph: list what was addressed with specific values, identify errors/gaps, note missing items>"
    }
  },
  "strengths": ["<detailed strength citing specific content/values from submission>", "<another detailed strength>", "<another detailed strength>"],
  "improvements": ["<name exact section/field to fix and explain what to add or correct>", "<another specific improvement>", "<another specific improvement>"],
  "overall_feedback": "<3-5 sentence summary: what was done well, what is missing, what to do next>"
}

IMPORTANT RULES:
- The "rubric_breakdown" must have only 3-7 TOP-LEVEL criteria (e.g. "Functionality", "Code Quality"). Do NOT list every sub-item as its own key.
- Each criterion MUST have "score" (number), "max_points" (number), and "feedback" (string).
- The sum of all "score" values must equal "total_score".
- The sum of all "max_points" values must equal ${maxScore}.
- "percentage" must equal round(total_score / max_score * 100).

FEEDBACK–SCORE ALIGNMENT (MANDATORY):
Step 1: Write honest, detailed feedback FIRST — describe all strengths AND all problems you find.
Step 2: Set the score to MATCH the feedback.

- If feedback mentions ANY problem, gap, or missing item → score MUST be less than max_points.
- If feedback is entirely positive with no issues → score MAY be full marks.
- Partial marks feedback MUST state (1) what was done well AND (2) what caused the point loss.
- Zero marks feedback MUST state what was expected and what was missing.

CONTENT OVER FORMATTING (MANDATORY):
- Grade based on the CONTENT and SUBSTANCE of the submission as described in the assignment instructions.
- Do NOT penalize for formatting, layout, styling, or presentation issues (e.g. missing headers, inconsistent bullet styles, font choices, spacing, capitalization style).
- What matters is whether the student addressed the required topics, provided correct and complete information, and met the learning objectives outlined in the instructions.
- If the content is accurate and complete but poorly formatted, it should still receive full or near-full marks.

FEEDBACK QUALITY RULES (MANDATORY — apply to ALL feedback, strengths, improvements, overall_feedback):

Each criterion feedback MUST be a DETAILED paragraph (3–6 sentences) that does ALL of the following:
1. LIST what the student addressed, citing specific sections, values, or content from the submission in parentheses.
   Example: "The submission addresses all three requirements: (1) Performance Metrics examines latency (15-100ms), CPU (98%), and uptime (2%). (2) Capacity Limitations assesses scalability with thresholds (bandwidth at 75-85% of 100 Mbps). (3) Security Analysis reviews vulnerabilities (disabled encryption, inactive IDS)."
2. INCLUDE actual data, numbers, or quotes from the submission to support your evaluation.
   Example: "Performance metrics are realistic for legacy infrastructure (98% bandwidth utilization, 1.5% packet loss, 100ms jitter)."
3. IDENTIFY specific errors, contradictions, or gaps.
   Example: "However, the 2% uptime value contradicts all devices showing 'Active' status — this appears to be an error and should likely be 98% uptime."
4. NOTE specific missing items or incomplete entries.
   Example: "The Capacity Limitations section omits the recommended monitoring interval; Security Analysis does not list mitigation steps for the identified vulnerabilities."

strengths MUST be 3–4 items. Each item MUST be a detailed sentence citing specific content, values, or sections from the submission.
improvements MUST be 3–4 items. Each item MUST name the exact section/field to fix and explain what to add or correct.
overall_feedback MUST be 3–5 sentences summarizing what was done well, what is missing, and what to do next.

Tone: Constructive and educational. Explain what is missing, not just that it is wrong. Be strict but fair.

Respond with ONLY a valid JSON object. No markdown fences, no explanation outside the JSON.

{
  "student_name": "${studentName || "Anonymous"}",
  "total_score": <number>,
  "max_score": ${maxScore},
  "percentage": <number>,
  "rubric_breakdown": {
    "<CriterionName>": {
      "score": <number>,
      "max_points": <number>,
      "feedback": "<3-6 sentence detailed paragraph: list what was addressed with specific values, identify errors/gaps, note missing items>"
    }
  },
  "strengths": ["<detailed strength citing specific content/values from submission>", "<another detailed strength>", "<another detailed strength>"],
  "improvements": ["<name exact section/field to fix and explain what to add or correct>", "<another specific improvement>", "<another specific improvement>"],
  "overall_feedback": "<3-5 sentence summary: what was done well, what is missing, what to do next>"
}

FINAL STEP — APPLY LENIENCY (adjust scores AFTER grading):
LENIENCY MODE: ${leniency.toUpperCase()}
${leniencyInstruction}
Review your scores above and adjust them according to this leniency mode before outputting the final JSON.`;
}

/**
 * Try to repair truncated JSON by closing open braces/brackets/strings
 */
function repairTruncatedJson(jsonStr) {
  let str = jsonStr.trim();

  // Remove trailing comma if present
  str = str.replace(/,\s*$/, "");

  // If we're inside an unclosed string, close it
  // Count unescaped quotes
  let inString = false;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"' && (i === 0 || str[i - 1] !== '\\')) {
      inString = !inString;
    }
  }
  if (inString) {
    str += '"';
  }

  // Count open braces and brackets, close them
  let openBraces = 0;
  let openBrackets = 0;
  let inStr = false;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"' && (i === 0 || str[i - 1] !== '\\')) {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (str[i] === '{') openBraces++;
    if (str[i] === '}') openBraces--;
    if (str[i] === '[') openBrackets++;
    if (str[i] === ']') openBrackets--;
  }

  // Remove trailing comma again (closing a string may have revealed one)
  str = str.replace(/,\s*$/, "");

  while (openBrackets > 0) { str += ']'; openBrackets--; }
  while (openBraces > 0) { str += '}'; openBraces--; }

  return str;
}

/**
 * Parse the grading response from the model
 */
function parseGradingResponse(responseText) {
  // Try to extract JSON from the response
  let jsonStr = responseText.trim();

  // Remove markdown code fences if present
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  // Try to find JSON object start
  const startIdx = jsonStr.indexOf("{");
  if (startIdx !== -1) {
    jsonStr = jsonStr.substring(startIdx);
  }

  // Attempt 1: parse as-is (trim to last })
  const endIdx = jsonStr.lastIndexOf("}");
  if (endIdx !== -1) {
    try {
      return JSON.parse(jsonStr.substring(0, endIdx + 1));
    } catch {
      // fall through to repair
    }
  }

  // Attempt 2: repair truncated JSON (missing closing braces/brackets)
  try {
    const repaired = repairTruncatedJson(jsonStr);
    return JSON.parse(repaired);
  } catch {
    // fall through
  }

  return {
    raw_response: responseText,
    parse_error: "Could not parse model response as JSON. Raw response included.",
  };
}

/**
 * Validate and clamp grading results so no score exceeds its max_points,
 * totals are consistent, and required fields are always present.
 */
function validateAndClampResults(results, maxScore, studentName) {
  if (!results || results.parse_error) return results;

  // --- Ensure required top-level fields ---
  if (!results.student_name || results.student_name === "Anonymous") {
    results.student_name = studentName || "Anonymous";
  }

  if (!results.rubric_breakdown) return results;

  // --- Rescale max_points if they don't add up to maxScore ---
  const entries = Object.entries(results.rubric_breakdown);
  let rawMaxSum = 0;
  for (const [, details] of entries) {
    if (typeof details.max_points === "number") {
      rawMaxSum += details.max_points;
    }
  }

  if (rawMaxSum !== maxScore && rawMaxSum > 0) {
    for (const [, details] of entries) {
      if (typeof details.score === "number" && typeof details.max_points === "number") {
        const ratio = details.max_points / rawMaxSum;
        const newMax = Math.round(ratio * maxScore);
        const newScore = Math.round((details.score / details.max_points) * newMax);
        details.max_points = newMax;
        details.score = newScore;
      }
    }

    // Fix rounding: adjust the largest criterion so max_points sum exactly to maxScore
    let rescaledMaxSum = 0;
    let largestCriterion = null;
    let largestMax = 0;
    for (const [criterion, details] of entries) {
      rescaledMaxSum += details.max_points;
      if (details.max_points >= largestMax) {
        largestMax = details.max_points;
        largestCriterion = criterion;
      }
    }
    if (rescaledMaxSum !== maxScore && largestCriterion) {
      results.rubric_breakdown[largestCriterion].max_points += maxScore - rescaledMaxSum;
    }
  }

  // --- Detect feedback–score contradictions and fix them ---
  const DEFICIT_PATTERNS = /\b(but|however|missing|incomplete|lacking|incorrect|inaccuracies|inaccuracy|not fully|not adequately|did not|doesn't provide|does not provide|wasn't|weren't|failed to|fell short|weak|poorly|insufficient|absent|needs further|needs more|needs improvement|remains largely|lack of)\b/i;

  for (const [criterion, details] of Object.entries(results.rubric_breakdown)) {
    if (typeof details.score !== "number" || typeof details.max_points !== "number") continue;
    if (typeof details.feedback !== "string") continue;

    // Only check full-score criteria for contradictions
    if (details.score === details.max_points) {
      if (DEFICIT_PATTERNS.test(details.feedback)) {
        // Feedback describes real issues — always adjust the score down, not the feedback
        details.score = Math.max(0, details.score - 1);
      }
    }
  }

  // --- Clamp each score to [0, max_points] ---
  let totalClamped = 0;
  for (const [, details] of Object.entries(results.rubric_breakdown)) {
    if (typeof details.score === "number" && typeof details.max_points === "number") {
      if (details.score > details.max_points) {
        details.score = details.max_points;
      }
      if (details.score < 0) {
        details.score = 0;
      }
      totalClamped += details.score;
    }
  }

  // --- Recalculate totals ---
  results.total_score = totalClamped;
  results.max_score = maxScore;

  if (results.total_score > results.max_score) {
    results.total_score = results.max_score;
  }

  results.percentage = Math.round((results.total_score / results.max_score) * 100);
  if (results.percentage > 100) results.percentage = 100;

  return results;
}

/**
 * Format grading results into a human-readable text report
 */
function formatTextReport(results) {
  const lines = [];

  lines.push("═".repeat(60));
  lines.push("          GRADING REPORT");
  lines.push("═".repeat(60));
  lines.push("");

  if (results.student_name) {
    lines.push(`Student: ${results.student_name}`);
  }

  lines.push(
    `Score: ${results.total_score}/${results.max_score} (${results.percentage}%)`
  );
  lines.push("");
  lines.push("─".repeat(60));
  lines.push("RUBRIC BREAKDOWN:");
  lines.push("─".repeat(60));

  if (results.rubric_breakdown) {
    for (const [criterion, details] of Object.entries(results.rubric_breakdown)) {
      lines.push(`  ${criterion}: ${details.score}/${details.max_points}`);
      if (details.feedback) {
        lines.push(`    → ${details.feedback}`);
      }
    }
  }

  lines.push("");
  lines.push("─".repeat(60));
  lines.push("STRENGTHS:");
  lines.push("─".repeat(60));
  if (results.strengths && results.strengths.length > 0) {
    for (const s of results.strengths) {
      lines.push(`  • ${s}`);
    }
  }

  lines.push("");
  lines.push("─".repeat(60));
  lines.push("AREAS FOR IMPROVEMENT:");
  lines.push("─".repeat(60));
  if (results.improvements && results.improvements.length > 0) {
    for (const i of results.improvements) {
      lines.push(`  • ${i}`);
    }
  }

  if (results.overall_feedback) {
    lines.push("");
    lines.push("─".repeat(60));
    lines.push("OVERALL FEEDBACK:");
    lines.push("─".repeat(60));
    lines.push(`  ${results.overall_feedback}`);
  }

  lines.push("");
  lines.push("═".repeat(60));

  return lines.join("\n");
}

/**
 * Run Cursor CLI agent with a prompt via execSync (shell).
 * Command: cursor agent -p "<COMMAND/PROMPT>" --output-format text
 * Prompt is passed via a temp file so the shell sees the user's PATH and no escaping is needed.
 */
function getCompletionFromCursor(prompt) {
  const tempPath = path.join(os.tmpdir(), `cursor-prompt-${Date.now()}-${process.pid}.txt`);
  fs.writeFileSync(tempPath, prompt, "utf-8");

  const cmd = `agent -p "$(cat "$CURSOR_PROMPT_FILE")" --output-format text`;
  console.log("[Cursor CLI] agent -p " + JSON.stringify(prompt) + " --output-format text");

  const env = { ...process.env, CURSOR_PROMPT_FILE: tempPath };

  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      env,
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024, // 10 MB
      timeout: 300000, // 5 minutes
    });
    const response = (stdout || "").trim();
    console.log("[Cursor CLI] response:", response);
    return response;
  } catch (err) {
    const stderr = err.stderr != null ? String(err.stderr).trim() : "";
    const stdout = err.stdout != null ? String(err.stdout).trim() : "";
    const status = err.status ?? err.code ?? "";
    const parts = [
      status ? `exit ${status}` : null,
      stderr || null,
      stdout || null,
      err.message,
    ].filter(Boolean);
    const msg = parts.length ? parts.join(" — ") : String(err);
    console.error("[Cursor CLI] failed:", msg);
    if (stderr) console.error("[Cursor CLI] stderr:", stderr);
    if (stdout) console.error("[Cursor CLI] stdout:", stdout);
    throw new Error(`Cursor CLI error: ${msg}`);
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * Grade a submission using Ollama or Cursor CLI.
 * Retries once with a correction prompt if the first response can't be parsed.
 */
async function gradeSubmission({
  submission,
  rubric,
  instructions,
  note = null,
  maxScore = 100,
  studentName = "",
  leniency = "normal",
  model = DEFAULT_MODEL,
  backend = DEFAULT_BACKEND,
}) {
  const prompt = buildGradingPrompt({
    submission,
    rubric,
    instructions,
    note,
    maxScore,
    leniency,
    studentName,
  });

  console.log("\n📝 [Grader] Prompt sent to model:\n");
  console.log(prompt);
  console.log("\n" + "─".repeat(60) + "\n");

  let responseText;

  if (backend === "cursor") {
    responseText = getCompletionFromCursor(prompt);
  } else {
    const messages = [{ role: "user", content: prompt }];
    const response = await ollama.chat({
      model,
      messages,
      options: {
        temperature: 0.3,
        num_predict: 4096,
      },
    });
    responseText = response.message.content;
  }

  let results = parseGradingResponse(responseText);
  results = validateAndClampResults(results, maxScore, studentName);

  // If parsing failed, retry with a minimal correction prompt (avoids model echoing long instructions)
  if (results.parse_error) {
    console.log("First grading response was not valid JSON, retrying...");

    const correctionPrompt = `Reply with ONLY one valid JSON object (no other text). Use this shape—fill in real scores and feedback from the submission you already graded:
{"student_name":"${(studentName || "Anonymous").replace(/"/g, '\\"')}","total_score":0,"max_score":${maxScore},"percentage":0,"rubric_breakdown":{"Criterion 1":{"score":0,"max_points":${maxScore},"feedback":""}},"strengths":[],"improvements":[],"overall_feedback":""}`;

    let retryText;
    if (backend === "cursor") {
      retryText = getCompletionFromCursor(correctionPrompt);
    } else {
      const messages = [
        { role: "user", content: prompt },
        { role: "assistant", content: responseText },
        { role: "user", content: correctionPrompt },
      ];
      const retry = await ollama.chat({
        model,
        messages,
        options: { temperature: 0.1, num_predict: 4096 },
      });
      retryText = retry.message.content;
    }

    let retryResults = parseGradingResponse(retryText);
    retryResults = validateAndClampResults(retryResults, maxScore, studentName);

    if (!retryResults.parse_error) {
      results = retryResults;
    } else {
      results = {
        ...results,
        raw_response: responseText,
      };
    }
  }

  const textReport = results.parse_error ? responseText : formatTextReport(results);

  return {
    results,
    textReport,
    model: backend === "cursor" ? "cursor" : model,
    gradedAt: new Date().toISOString(),
  };
}

/**
 * Generate a sample rubric
 */
function generateSampleRubric() {
  return {
    "Content Quality": {
      max_points: 30,
      description: "Depth and accuracy of content",
      criteria: [
        "Demonstrates thorough understanding of the topic",
        "Uses relevant evidence and examples",
        "Addresses all key aspects of the assignment",
        "Shows critical thinking and analysis",
      ],
    },
    Organization: {
      max_points: 20,
      description: "Structure and flow of the work",
      criteria: [
        "Clear introduction with thesis/purpose statement",
        "Logical paragraph organization",
        "Smooth transitions between ideas",
        "Strong conclusion that ties everything together",
      ],
    },
    "Writing Quality": {
      max_points: 20,
      description: "Grammar, style, and clarity",
      criteria: [
        "Clear and concise writing style",
        "Proper grammar and punctuation",
        "Appropriate academic tone",
        "Varied sentence structure",
      ],
    },
    "Requirements Met": {
      max_points: 20,
      description: "Following assignment requirements",
      criteria: [
        "Meets minimum length requirements",
        "Addresses the specific prompt/question",
        "Follows formatting guidelines",
        "Submitted on time",
      ],
    },
    "Sources & Citations": {
      max_points: 10,
      description: "Use and citation of sources",
      criteria: [
        "Uses credible and relevant sources",
        "Proper citation format (APA/MLA/etc.)",
        "Adequate number of sources",
        "Sources support the arguments made",
      ],
    },
  };
}

module.exports = {
  gradeSubmission,
  buildGradingPrompt,
  generateSampleRubric,
  formatTextReport,
  DEFAULT_MODEL,
  DEFAULT_BACKEND,
};
