# Checker — AI Grading API

An Express.js API that uses Ollama to grade student submissions against a rubric. Accepts **PDF, Word (.docx), spreadsheets (.xlsx), plain text, Markdown, CSV, and JSON** files.

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

## API Endpoints

### `GET /`

Returns API info and available endpoints.

### `GET /api/health`

Health check — verifies Ollama is connected and lists available models.

### `GET /api/supported-formats`

Returns all supported file extensions.

### `GET /api/rubric/sample`

Returns a sample rubric template you can use as a starting point.

---

### `POST /api/grade` — Grade a Single Submission (File Upload)

Upload three files via `multipart/form-data`:

| Field          | Type   | Required | Description                              |
|----------------|--------|----------|------------------------------------------|
| `submission`   | file   | Yes      | Student's work (.txt, .pdf, .docx, .xlsx, etc.) |
| `rubric`       | file   | Yes      | Grading rubric (.json, .txt, .pdf, etc.) |
| `instructions` | file   | Yes      | Assignment instructions                  |
| `maxScore`     | text   | No       | Maximum score (default: 100)             |
| `studentName`  | text   | No       | Student's name                           |
| `model`        | text   | No       | Ollama model (default: llama3.2)         |

**Example with curl:**

```bash
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@samples/sample_submission.txt" \
  -F "rubric=@samples/sample_rubric.json" \
  -F "instructions=@samples/sample_instructions.txt" \
  -F "maxScore=100" \
  -F "studentName=John Doe"
```

**Example with a PDF submission:**

```bash
curl -X POST http://localhost:3000/api/grade \
  -F "submission=@student_essay.pdf" \
  -F "rubric=@rubric.json" \
  -F "instructions=@instructions.docx" \
  -F "maxScore=100" \
  -F "studentName=Jane Smith"
```

---

### `POST /api/grade/text` — Grade via JSON Body

Send everything as JSON (no file uploads):

```bash
curl -X POST http://localhost:3000/api/grade/text \
  -H "Content-Type: application/json" \
  -d '{
    "submission": "The student essay text goes here...",
    "rubric": {
      "Content Quality": {
        "max_points": 30,
        "description": "Depth and accuracy",
        "criteria": ["Understanding", "Evidence", "Analysis"]
      }
    },
    "instructions": "Write an analytical essay about...",
    "maxScore": 100,
    "studentName": "John Doe",
    "model": "llama3.2"
  }'
```

---

### `POST /api/grade/batch` — Batch Grade Multiple Submissions

Upload multiple student files at once. Student names are inferred from filenames.

| Field          | Type   | Required | Description                           |
|----------------|--------|----------|---------------------------------------|
| `submissions`  | files  | Yes      | Multiple student files (up to 50)     |
| `rubric`       | file   | Yes      | Single grading rubric                 |
| `instructions` | file   | Yes      | Single set of instructions            |
| `maxScore`     | text   | No       | Maximum score (default: 100)          |
| `model`        | text   | No       | Ollama model (default: llama3.2)      |

```bash
curl -X POST http://localhost:3000/api/grade/batch \
  -F "submissions=@alice_smith.pdf" \
  -F "submissions=@bob_jones.docx" \
  -F "submissions=@carol_white.txt" \
  -F "rubric=@rubric.json" \
  -F "instructions=@instructions.txt" \
  -F "maxScore=100"
```

---

## Response Format

All grading endpoints return:

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
          "feedback": "Strong analysis with good evidence..."
        }
      },
      "strengths": ["Clear thesis statement", "Well-organized"],
      "improvements": ["Expand source variety", "Deeper analysis in section 3"],
      "overall_feedback": "A solid essay that demonstrates..."
    },
    "textReport": "═══════════════\n  GRADING REPORT\n...",
    "model": "llama3.2",
    "gradedAt": "2026-02-07T12:00:00.000Z"
  }
}
```

## Supported File Types

| Extension   | Type        | Used For                        |
|-------------|-------------|---------------------------------|
| `.txt`      | Plain text  | Submissions, instructions       |
| `.md`       | Markdown    | Submissions, instructions       |
| `.csv`      | CSV         | Submissions, rubrics            |
| `.pdf`      | PDF         | Submissions, instructions       |
| `.docx`     | Word        | Submissions, instructions       |
| `.doc`      | Word (old)  | Submissions, instructions       |
| `.xlsx`     | Excel       | Rubrics, submissions            |
| `.xls`      | Excel (old) | Rubrics, submissions            |
| `.ods`      | OpenDoc     | Rubrics, submissions            |
| `.json`     | JSON        | Rubrics                         |

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

## Project Structure

```
checker/
├── src/
│   ├── server.js              # Express app entry point
│   ├── routes/
│   │   └── grading.js         # API route handlers
│   ├── services/
│   │   └── grader.js          # Ollama grading logic
│   └── utils/
│       └── fileParsers.js     # PDF/Word/Excel/text parsers
├── samples/
│   ├── sample_rubric.json     # Example rubric
│   ├── sample_instructions.txt # Example assignment
│   └── sample_submission.txt  # Example student work
├── uploads/                   # Temp upload directory (gitignored)
├── package.json
├── .gitignore
└── README.md
```

## Troubleshooting

**Ollama not running?**
```bash
ollama serve        # Start Ollama
ollama list         # Verify models
```

**Model not found?**
```bash
ollama pull llama3.2
```

**File parsing error?**
Check that the file extension matches the actual format. Renamed files (e.g. a `.txt` file renamed to `.pdf`) will fail to parse.
