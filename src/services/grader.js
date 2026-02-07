const { Ollama } = require("ollama");

const ollama = new Ollama();

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
function buildGradingPrompt({ submission, rubric, instructions, maxScore, studentName }) {
  let rubricText;
  let rubricResponseInstruction;

  if (isStructuredRubric(rubric)) {
    // Structured rubric with explicit criteria and point values
    rubricText = JSON.stringify(rubric, null, 2);
    rubricResponseInstruction = `
The rubric above has specific criteria with point values. For each criterion in the rubric, provide a score (out of its max_points) and feedback in the "rubric_breakdown" field.`;
  } else {
    // Freeform rubric — plain text, a description, a table, etc.
    rubricText = typeof rubric === "object" ? JSON.stringify(rubric, null, 2) : String(rubric);
    rubricResponseInstruction = `
The rubric above is in freeform/text format. Read it carefully, identify the grading criteria described, and create your own reasonable point breakdown that adds up to the maximum score of ${maxScore}. For each criterion you identify, provide a score and feedback in the "rubric_breakdown" field.`;
  }

  return `You are an expert academic grader. Grade the following student submission carefully and objectively.

ASSIGNMENT INSTRUCTIONS:
${instructions}

GRADING RUBRIC:
${rubricText}

MAXIMUM SCORE: ${maxScore}
${studentName ? `STUDENT: ${studentName}` : ""}

STUDENT SUBMISSION:
${submission}

---
${rubricResponseInstruction}

Please grade this submission and respond with ONLY a valid JSON object (no markdown, no explanation outside the JSON) using this exact structure:

{
  "student_name": "${studentName || "Anonymous"}",
  "total_score": <number>,
  "max_score": ${maxScore},
  "percentage": <number>,
  "rubric_breakdown": {
    "<criterion_name>": {
      "score": <number>,
      "max_points": <number>,
      "feedback": "<specific feedback for this criterion>"
    }
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "overall_feedback": "<2-3 sentence summary>"
}

Be fair, specific, and constructive in your feedback. Base scores strictly on the rubric criteria.`;
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

  // Try to find JSON object boundaries
  const startIdx = jsonStr.indexOf("{");
  const endIdx = jsonStr.lastIndexOf("}");
  if (startIdx !== -1 && endIdx !== -1) {
    jsonStr = jsonStr.substring(startIdx, endIdx + 1);
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    return {
      raw_response: responseText,
      parse_error: "Could not parse model response as JSON. Raw response included.",
    };
  }
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
 * Grade a submission using Ollama
 */
async function gradeSubmission({
  submission,
  rubric,
  instructions,
  maxScore = 100,
  studentName = "",
  model = DEFAULT_MODEL,
}) {
  const prompt = buildGradingPrompt({
    submission,
    rubric,
    instructions,
    maxScore,
    studentName,
  });

  const response = await ollama.chat({
    model,
    messages: [{ role: "user", content: prompt }],
    options: {
      temperature: 0.3,
      num_predict: 2048,
    },
  });

  const responseText = response.message.content;
  const results = parseGradingResponse(responseText);
  const textReport = results.parse_error ? responseText : formatTextReport(results);

  return {
    results,
    textReport,
    model,
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
  generateSampleRubric,
  formatTextReport,
  DEFAULT_MODEL,
};
