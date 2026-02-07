# Checker — AI Grading API

An Express.js API that uses Ollama to grade student submissions against a rubric. Accepts **PDF, Word (.docx), spreadsheets (.xlsx), plain text, Markdown, CSV, and JSON** files — or raw text directly.

## Prerequisites

- **Node.js** 18+
- **Ollama** installed and running ([https://ollama.ai](https://ollama.ai))

```bash
# Install Ollama (Linux/macOS)
curl -fsSL https://ollama.ai/install.sh | sh

# Pull a model
ollama pull llama3.2
```

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# Or with auto-reload during development
npm run dev
```

The API starts on `http://localhost:3000` by default. Set the `PORT` environment variable to change it.

---

## API Endpoints

### `GET /`

Returns general API information and a summary of all available endpoints.

**Request:**

```
GET http://localhost:3000/
```

**Response:**

```json
{
  "name": "Checker — AI Grading API",
  "version": "1.0.0",
  "description": "AI-powered student grading API using Ollama",
  "endpoints": {
    "POST /api/grade": "Grade a single submission (files, text, or JSON body)",
    "POST /api/grade/batch": "Grade multiple submissions (file upload)",
    "GET  /api/rubric/sample": "Get a sample rubric template",
    "GET  /api/supported-formats": "List supported file formats",
    "GET  /api/health": "Health check (Ollama connection)"
  },
  "supportedFiles": [".txt", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ods", ".md", ".csv", ".json"]
}
```

---

### `GET /api/health`

Checks whether Ollama is reachable and lists all installed models.

**Request:**

```
GET http://localhost:3000/api/health
```

**Success Response (200):**

```json
{
  "success": true,
  "status": "healthy",
  "ollama": {
    "connected": true,
    "models": ["llama3.2:latest", "mistral:latest"]
  }
}
```

**Failure Response (503):**

```json
{
  "success": false,
  "status": "unhealthy",
  "ollama": {
    "connected": false,
    "error": "connect ECONNREFUSED 127.0.0.1:11434"
  }
}
```

---

### `GET /api/supported-formats`

Returns all file extensions accepted by the upload endpoints.

**Request:**

```
GET http://localhost:3000/api/supported-formats
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "submission": [".txt", ".md", ".csv", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ods", ".json"],
    "rubric": [".txt", ".md", ".csv", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ods", ".json"],
    "instructions": [".txt", ".md", ".csv", ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ods", ".json"]
  }
}
```

---

### `GET /api/rubric/sample`

Returns a ready-to-use sample rubric in structured JSON format. Use this as a template for creating your own rubrics.

**Request:**

```
GET http://localhost:3000/api/rubric/sample
```

**Response (200):**

```json
{
  "success": true,
  "data": {
    "Content Quality": {
      "max_points": 30,
      "description": "Depth and accuracy of content",
      "criteria": [
        "Demonstrates thorough understanding of the topic",
        "Uses relevant evidence and examples",
        "Addresses all key aspects of the assignment",
        "Shows critical thinking and analysis"
      ]
    },
    "Organization": {
      "max_points": 20,
      "description": "Structure and flow of the work",
      "criteria": [
        "Clear introduction with thesis/purpose statement",
        "Logical paragraph organization",
        "Smooth transitions between ideas",
        "Strong conclusion that ties everything together"
      ]
    },
    "Writing Quality": {
      "max_points": 20,
      "description": "Grammar, style, and clarity",
      "criteria": ["..."]
    },
    "Requirements Met": {
      "max_points": 20,
      "description": "Following assignment requirements",
      "criteria": ["..."]
    },
    "Sources & Citations": {
      "max_points": 10,
      "description": "Use and citation of sources",
      "criteria": ["..."]
    }
  }
}
```

---

### `POST /api/grade`

Grade a single student submission. This is the main endpoint and is very flexible — every input field (`submission`, `rubric`, `instructions`, `studentName`) accepts **either a file upload or plain text**. You can also mix and match (e.g. upload a PDF submission but pass the rubric as text).

#### Content Types

| Content-Type | Description |
|---|---|
| `multipart/form-data` | File uploads, text fields, or a mix of both |
| `application/json` | All fields as text/JSON in the request body |

#### Parameters

| Field | Input | Required | Description |
|---|---|---|---|
| `submission` | file **or** text | **Yes** | The student's work. Supported file types: `.txt`, `.md`, `.csv`, `.pdf`, `.docx`, `.doc`, `.xlsx`, `.xls`, `.ods`, `.json`. Or pass the text content directly as a string. |
| `rubric` | file **or** text | **Yes** | The grading rubric. Can be a structured JSON file (`.json` with `max_points` per criterion), **or** any freeform format — a `.txt`, `.pdf`, `.docx` file, or a plain text string describing the criteria. The AI adapts its grading approach based on the format. |
| `instructions` | file **or** text | **Yes** | The assignment instructions / prompt. Any supported file type or a plain text string. |
| `studentName` | text | No | Student's name. Appears in the report. Defaults to `"Anonymous"`. |
| `maxScore` | text (number) | No | Maximum possible score. Defaults to `100`. |
| `model` | text | No | Ollama model to use. Defaults to `llama3.2`. |

> **Priority:** If the same field is provided as both a file and a text value, the **file takes priority**.

#### Example 1 — All files (multipart)

```bash
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@samples/sample_submission.txt" \
  -F "rubric=@samples/sample_rubric.json" \
  -F "instructions=@samples/sample_instructions.txt" \
  -F "maxScore=100" \
  -F "studentName=John Doe"
```

#### Example 2 — PDF submission with text rubric

```bash
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@student_essay.pdf" \
  -F "rubric=Grade based on clarity of argument, use of evidence, grammar, and whether the student followed the prompt. Be strict on citations." \
  -F "instructions=Write a 500-word analytical essay about climate change solutions." \
  -F "maxScore=50" \
  -F "studentName=Jane Smith"
```

#### Example 3 — All text via JSON body

```bash
curl -X POST http://localhost:3000/api/grade \
  -H "Content-Type: application/json" \
  -d '{
    "submission": "Climate change is one of the most pressing issues...",
    "rubric": {
      "Content Quality": {
        "max_points": 30,
        "description": "Depth and accuracy",
        "criteria": ["Understanding of topic", "Use of evidence", "Critical analysis"]
      },
      "Writing Quality": {
        "max_points": 20,
        "description": "Grammar, style, clarity",
        "criteria": ["Clear writing", "Proper grammar", "Academic tone"]
      }
    },
    "instructions": "Write an analytical essay about climate change solutions.",
    "maxScore": 50,
    "studentName": "John Doe",
    "model": "llama3.2"
  }'
```

#### Example 4 — Freeform text rubric via JSON body

```bash
curl -X POST http://localhost:3000/api/grade \
  -H "Content-Type: application/json" \
  -d '{
    "submission": "Climate change is one of the most pressing issues...",
    "rubric": "Grade on: argument clarity (most important), evidence quality, grammar/spelling, and adherence to the prompt. Deduct points for missing citations.",
    "instructions": "Write a 500-word essay about climate change.",
    "maxScore": 100,
    "studentName": "Alex Lee"
  }'
```

#### Success Response (200)

```json
{
  "success": true,
  "data": {
    "results": {
      "student_name": "John Doe",
      "total_score": 85,
      "max_score": 100,
      "percentage": 85,
      "rubric_breakdown": {
        "Content Quality": {
          "score": 25,
          "max_points": 30,
          "feedback": "Strong analysis with good use of evidence. Could expand on the comparison between strategies."
        },
        "Organization": {
          "score": 18,
          "max_points": 20,
          "feedback": "Clear structure with logical flow. Transitions between paragraphs are smooth."
        },
        "Writing Quality": {
          "score": 17,
          "max_points": 20,
          "feedback": "Generally clear and well-written. A few minor grammatical issues."
        },
        "Requirements Met": {
          "score": 18,
          "max_points": 20,
          "feedback": "Meets length requirements and addresses the prompt fully."
        },
        "Sources & Citations": {
          "score": 7,
          "max_points": 10,
          "feedback": "Good sources but some citations are incomplete."
        }
      },
      "strengths": [
        "Clear thesis statement with well-defined scope",
        "Effective use of credible sources to support arguments"
      ],
      "improvements": [
        "Expand the comparative analysis between mitigation strategies",
        "Ensure all citations follow consistent APA formatting"
      ],
      "overall_feedback": "A solid, well-organized essay that demonstrates good understanding of the topic. Strengthening the comparative analysis and cleaning up citation formatting would push this into the A range."
    },
    "textReport": "════════════════════════════════════════════════════════════\n          GRADING REPORT\n════════════════════════════════════════════════════════════\n\nStudent: John Doe\nScore: 85/100 (85%)\n\n────────────────────────────────────────────────────────────\nRUBRIC BREAKDOWN:\n────────────────────────────────────────────────────────────\n  Content Quality: 25/30\n    → Strong analysis with good use of evidence...\n  ...\n════════════════════════════════════════════════════════════",
    "model": "llama3.2",
    "gradedAt": "2026-02-07T12:00:00.000Z"
  }
}
```

#### Error Responses

| Status | Condition | Body |
|---|---|---|
| `400` | Missing a required field | `{ "error": "Missing required field: submission (provide a file or text)" }` |
| `400` | Unsupported file type uploaded | `{ "success": false, "error": "Unsupported file type: .zip. Supported: .txt, .md, ..." }` |
| `413` | File exceeds 20 MB limit | `{ "success": false, "error": "File too large. Max size is 20 MB." }` |
| `500` | Ollama unreachable or model error | `{ "success": false, "error": "connect ECONNREFUSED 127.0.0.1:11434" }` |

---

### `POST /api/grade/batch`

Grade multiple student submissions at once against a single rubric and set of instructions. Submissions must be uploaded as files. Rubric and instructions can be files or text.

Student names are **automatically inferred from filenames** (filename without extension).

#### Content Type

`multipart/form-data` (required — submissions must be file uploads)

#### Parameters

| Field | Input | Required | Description |
|---|---|---|---|
| `submissions` | files | **Yes** | One or more student submission files (up to 50). Each file = one student. Student name is derived from the filename (e.g. `alice_smith.pdf` → `alice_smith`). |
| `rubric` | file **or** text | **Yes** | Grading rubric — structured JSON file, freeform text file, or plain text string. |
| `instructions` | file **or** text | **Yes** | Assignment instructions — any supported file type or plain text string. |
| `maxScore` | text (number) | No | Maximum possible score. Defaults to `100`. |
| `model` | text | No | Ollama model to use. Defaults to `llama3.2`. |

> Submissions are graded **sequentially** (one at a time) to avoid overwhelming Ollama. If one submission fails, the rest continue — the failed one gets an `error` field in the results.

#### Example — File uploads for everything

```bash
curl -X POST http://localhost:3000/api/grade/batch \
  -F "submissions=@alice_smith.pdf" \
  -F "submissions=@bob_jones.docx" \
  -F "submissions=@carol_white.txt" \
  -F "rubric=@rubric.json" \
  -F "instructions=@instructions.txt" \
  -F "maxScore=100"
```

#### Example — File submissions with text rubric and instructions

```bash
curl -X POST http://localhost:3000/api/grade/batch \
  -F "submissions=@alice_smith.pdf" \
  -F "submissions=@bob_jones.docx" \
  -F "rubric=Grade on argument clarity, evidence, grammar, and prompt adherence." \
  -F "instructions=Write a 500-word essay about climate change." \
  -F "maxScore=50" \
  -F "model=mistral"
```

#### Success Response (200)

```json
{
  "success": true,
  "totalSubmissions": 3,
  "data": [
    {
      "studentName": "alice_smith",
      "filename": "alice_smith.pdf",
      "results": {
        "student_name": "alice_smith",
        "total_score": 92,
        "max_score": 100,
        "percentage": 92,
        "rubric_breakdown": { "...": "..." },
        "strengths": ["..."],
        "improvements": ["..."],
        "overall_feedback": "..."
      },
      "textReport": "═══...",
      "model": "llama3.2",
      "gradedAt": "2026-02-07T12:01:00.000Z"
    },
    {
      "studentName": "bob_jones",
      "filename": "bob_jones.docx",
      "results": { "...": "..." },
      "textReport": "═══...",
      "model": "llama3.2",
      "gradedAt": "2026-02-07T12:02:30.000Z"
    },
    {
      "studentName": "carol_white",
      "filename": "carol_white.txt",
      "error": "Some parsing or grading error message"
    }
  ]
}
```

#### Error Responses

| Status | Condition | Body |
|---|---|---|
| `400` | No submission files provided | `{ "error": "Missing required files: submissions" }` |
| `400` | Missing rubric and instructions | `{ "error": "Missing required field: rubric (provide a file or text)" }` |
| `413` | Any file exceeds 20 MB | `{ "success": false, "error": "File too large. Max size is 20 MB." }` |
| `500` | Server / Ollama error | `{ "success": false, "error": "..." }` |

---

## Rubric Formats

The rubric field is flexible. Here are the formats you can use:

### Structured JSON (recommended for precise grading)

Each criterion has explicit point values. The AI scores against these exactly.

```json
{
  "Content Quality": {
    "max_points": 30,
    "description": "Depth and accuracy of content",
    "criteria": [
      "Demonstrates thorough understanding of the topic",
      "Uses relevant evidence and examples"
    ]
  },
  "Organization": {
    "max_points": 20,
    "description": "Structure and flow",
    "criteria": [
      "Clear introduction",
      "Logical paragraph order"
    ]
  }
}
```

### Plain text (quick and flexible)

Describe your criteria in natural language. The AI will identify the criteria and create its own point breakdown that adds up to `maxScore`.

```
Grade based on:
- Argument clarity and strength (most important)
- Quality and relevance of evidence
- Grammar, spelling, and writing style
- Whether the student addressed all parts of the prompt
Be strict on proper citations.
```

### Any document file

Upload a `.pdf`, `.docx`, `.xlsx`, `.txt`, or `.md` file containing your rubric in whatever format your institution uses. The text is extracted and the AI interprets the criteria from it.

---

## Supported File Types

| Extension | Type | Used For |
|---|---|---|
| `.txt` | Plain text | Submissions, instructions, rubrics |
| `.md` | Markdown | Submissions, instructions, rubrics |
| `.csv` | CSV | Submissions, rubrics |
| `.pdf` | PDF | Submissions, instructions, rubrics |
| `.docx` | Word | Submissions, instructions, rubrics |
| `.doc` | Word (legacy) | Submissions, instructions, rubrics |
| `.xlsx` | Excel | Submissions, rubrics |
| `.xls` | Excel (legacy) | Submissions, rubrics |
| `.ods` | OpenDocument | Submissions, rubrics |
| `.json` | JSON | Rubrics |

**Max file size:** 20 MB per file.

---

## Using a Different Model

Pass the `model` field in your request:

```bash
# Faster — Mistral
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@essay.txt" \
  -F "rubric=@rubric.json" \
  -F "instructions=@instructions.txt" \
  -F "model=mistral"

# More powerful — Llama 3.1
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@essay.txt" \
  -F "rubric=@rubric.json" \
  -F "instructions=@instructions.txt" \
  -F "model=llama3.1"
```

Make sure the model is pulled in Ollama first: `ollama pull <model-name>`

---

## Project Structure

```
checker/
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   └── grading.js         # API route handlers
│   ├── services/
│   │   └── grader.js          # Ollama grading logic & prompt building
│   └── utils/
│       └── fileParsers.js     # PDF / Word / Excel / text file parsers
├── samples/
│   ├── sample_rubric.json     # Example structured rubric
│   ├── sample_instructions.txt # Example assignment instructions
│   └── sample_submission.txt  # Example student submission
├── uploads/                   # Temp upload directory (gitignored)
├── package.json
├── .gitignore
└── README.md
```

---

## Troubleshooting

**Ollama not running?**

```bash
ollama serve        # Start Ollama
ollama list         # Verify models are installed
```

**Model not found?**

```bash
ollama pull llama3.2
```

**File parsing error?**

Check that the file extension matches the actual file format. A `.txt` file renamed to `.pdf` will fail to parse.

**Request too slow?**

Grading speed depends on the Ollama model and your hardware. Use a smaller/faster model:

```bash
ollama pull mistral
# Then pass model=mistral in your request
```

**JSON body not being read?**

Make sure you set the `Content-Type: application/json` header when sending a JSON body.
