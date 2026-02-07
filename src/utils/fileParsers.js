const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");
const mammoth = require("mammoth");
const XLSX = require("xlsx");

/**
 * Supported file extensions grouped by type
 */
const SUPPORTED_EXTENSIONS = {
  text: [".txt", ".md", ".csv"],
  pdf: [".pdf"],
  word: [".docx", ".doc"],
  spreadsheet: [".xlsx", ".xls", ".ods"],
  json: [".json"],
};

/**
 * Get all supported extensions as a flat array
 */
function getSupportedExtensions() {
  return Object.values(SUPPORTED_EXTENSIONS).flat();
}

/**
 * Determine file type from extension
 */
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [type, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.includes(ext)) return type;
  }
  return null;
}

/**
 * Parse a plain text file
 */
async function parseTextFile(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Parse a JSON file and return its content as formatted text
 */
async function parseJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Parse a PDF file and extract text
 */
async function parsePdfFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const uint8 = new Uint8Array(buffer);
  const pdf = new PDFParse(uint8);
  await pdf.load();
  return pdf.getText();
}

/**
 * Parse a Word document (.docx) and extract text
 */
async function parseWordFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Parse a spreadsheet (.xlsx, .xls, .ods) and extract text
 * Converts each sheet into a readable text table
 */
async function parseSpreadsheetFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    if (jsonData.length === 0) continue;

    let text = `--- Sheet: ${sheetName} ---\n`;

    // Build a text table
    for (const row of jsonData) {
      text += row.map((cell) => (cell !== undefined ? String(cell) : "")).join("\t") + "\n";
    }

    sheets.push(text);
  }

  return sheets.join("\n");
}

/**
 * Parse any supported file and return its text content
 */
async function parseFile(filePath, originalName) {
  const fileType = getFileType(originalName || filePath);

  if (!fileType) {
    const ext = path.extname(originalName || filePath);
    throw new Error(
      `Unsupported file type: ${ext}. Supported types: ${getSupportedExtensions().join(", ")}`
    );
  }

  switch (fileType) {
    case "text":
      return await parseTextFile(filePath);
    case "pdf":
      return await parsePdfFile(filePath);
    case "word":
      return await parseWordFile(filePath);
    case "spreadsheet":
      return await parseSpreadsheetFile(filePath);
    case "json": {
      const parsed = await parseJsonFile(filePath);
      return typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
    }
    default:
      throw new Error(`No parser available for file type: ${fileType}`);
  }
}

/**
 * Parse a rubric file — returns a JS object for JSON, or plain text for everything else.
 * The grading service handles both structured and freeform rubrics.
 */
async function parseRubricFile(filePath, originalName) {
  const fileType = getFileType(originalName || filePath);

  if (fileType === "json") {
    return await parseJsonFile(filePath);
  }

  // For non-JSON rubrics (PDF, Word, text, spreadsheet, etc.), return raw text
  return await parseFile(filePath, originalName);
}

module.exports = {
  parseFile,
  parseRubricFile,
  getFileType,
  getSupportedExtensions,
  SUPPORTED_EXTENSIONS,
};
