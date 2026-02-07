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
const LENIENCY_INSTRUCTIONS = {
  strict: "Grade STRICTLY. Apply the rubric rigorously with no benefit of the doubt. Deduct points for any deviation, even minor ones. Expect near-perfect work for full marks.",
  normal: "Grade FAIRLY and OBJECTIVELY. Apply the rubric as written. Give credit where due but deduct for clear shortcomings.",
  lenient: "Grade LENIENTLY. Give the student the benefit of the doubt where reasonable. Focus more on what the student did well. Minor issues should result in only small deductions.",
  very_lenient: "Grade VERY LENIENTLY. Be generous with scoring. Focus primarily on effort and understanding shown. Only deduct for major, fundamental issues. Minor errors and formatting issues should be overlooked.",
};

function buildGradingPrompt({ submission, rubric, instructions, note, maxScore, studentName, leniency = "normal" }) {
  let rubricSection;
  let rubricResponseInstruction;

  if (!rubric) {
    // No rubric provided — AI creates its own criteria from the instructions
    rubricSection = "";
    rubricResponseInstruction = `
No rubric was provided. Based on the assignment instructions above, create your own reasonable grading criteria (3-7 categories) with point values that add up to ${maxScore}. Evaluate the submission against those criteria.`;
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

GRADING LENIENCY: ${leniency.toUpperCase()}
${leniencyInstruction}

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

IMPORTANT RULES:
- The "rubric_breakdown" must have only 3-7 TOP-LEVEL criteria (e.g. "Functionality", "Code Quality"). Do NOT list every sub-item as its own key.
- Each criterion MUST have "score" (number), "max_points" (number), and "feedback" (string).
- The sum of all "score" values must equal "total_score".
- The sum of all "max_points" values must equal ${maxScore}.
- "percentage" must equal round(total_score / max_score * 100).

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
      "feedback": "<specific feedback>"
    }
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "overall_feedback": "<2-3 sentence summary>"
}`;
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
 * Grade a submission using Ollama.
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

  const messages = [{ role: "user", content: prompt }];

  // First attempt
  const response = await ollama.chat({
    model,
    messages,
    options: {
      temperature: 0.3,
      num_predict: 4096,
    },
  });

  const responseText = response.message.content;
  let results = parseGradingResponse(responseText);

  // If parsing failed, retry with a correction prompt
  if (results.parse_error) {
    console.log("First grading response was not valid JSON, retrying...");

    messages.push({ role: "assistant", content: responseText });
    messages.push({
      role: "user",
      content: `Your response was not valid JSON. Please respond with ONLY a valid JSON object, no other text. Use this exact structure:

{
  "student_name": "${studentName || "Anonymous"}",
  "total_score": <number>,
  "max_score": ${maxScore},
  "percentage": <number>,
  "rubric_breakdown": {
    "<criterion_name>": {
      "score": <number>,
      "max_points": <number>,
      "feedback": "<feedback string>"
    }
  },
  "strengths": ["<strength>"],
  "improvements": ["<improvement>"],
  "overall_feedback": "<summary>"
}`,
    });

    const retry = await ollama.chat({
      model,
      messages,
      options: { temperature: 0.1, num_predict: 4096 },
    });

    const retryText = retry.message.content;
    const retryResults = parseGradingResponse(retryText);

    if (!retryResults.parse_error) {
      results = retryResults;
    } else {
      // Both attempts failed — include raw text so the UI can show something
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
