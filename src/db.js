const mysql = require("mysql2/promise");

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
};

const DB_NAME = process.env.DB_NAME || "checker";

let pool = null;

/**
 * Initialize the database: create the database and table if they don't exist,
 * then create a connection pool bound to the database.
 */
async function initDb() {
  // Connect without a database to create it if needed
  const conn = await mysql.createConnection(DB_CONFIG);

  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await conn.end();

  // Create the pool bound to the database
  pool = mysql.createPool({
    ...DB_CONFIG,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Create the table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS grading_results (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      student_name     VARCHAR(255),
      total_score      DECIMAL(6,2),
      max_score        DECIMAL(6,2),
      percentage       DECIMAL(5,2),
      model            VARCHAR(100),
      rubric_breakdown JSON,
      strengths        JSON,
      improvements     JSON,
      overall_feedback TEXT,
      text_report      LONGTEXT,
      full_result      JSON,
      graded_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(`  Database ready:      mysql://${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_NAME}`);
}

/**
 * Check if the database is available.
 */
function isDbAvailable() {
  return pool !== null;
}

/**
 * Get the connection pool. Must call initDb() first.
 */
function getPool() {
  if (!pool) {
    throw new Error("Database not available. Check MySQL connection settings in .env");
  }
  return pool;
}

/**
 * Save a grading result to the database. Returns the inserted row ID.
 */
async function saveResult(gradingData) {
  const db = getPool();
  const r = gradingData.results || {};

  const [result] = await db.execute(
    `INSERT INTO grading_results
      (student_name, total_score, max_score, percentage, model,
       rubric_breakdown, strengths, improvements, overall_feedback,
       text_report, full_result, graded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      r.student_name || null,
      r.total_score ?? null,
      r.max_score ?? null,
      r.percentage ?? null,
      gradingData.model || null,
      JSON.stringify(r.rubric_breakdown || null),
      JSON.stringify(r.strengths || null),
      JSON.stringify(r.improvements || null),
      r.overall_feedback || null,
      gradingData.textReport || null,
      JSON.stringify(r),
      new Date(gradingData.gradedAt || Date.now()).toISOString().slice(0, 19).replace("T", " "),
    ]
  );

  return result.insertId;
}

/**
 * Get all results, newest first. Supports limit/offset pagination.
 */
async function getResults({ limit = 50, offset = 0 } = {}) {
  const db = getPool();
  const [rows] = await db.execute(
    `SELECT id, student_name, total_score, max_score, percentage, model, graded_at
     FROM grading_results
     ORDER BY graded_at DESC
     LIMIT ? OFFSET ?`,
    [String(limit), String(offset)]
  );

  const [[{ total }]] = await db.execute(
    `SELECT COUNT(*) as total FROM grading_results`
  );

  return { rows, total };
}

/**
 * Get a single result by ID (full data).
 */
async function getResultById(id) {
  const db = getPool();
  const [rows] = await db.execute(
    `SELECT * FROM grading_results WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Delete a result by ID.
 */
async function deleteResult(id) {
  const db = getPool();
  const [result] = await db.execute(
    `DELETE FROM grading_results WHERE id = ?`,
    [id]
  );
  return result.affectedRows > 0;
}

module.exports = {
  initDb,
  getPool,
  isDbAvailable,
  saveResult,
  getResults,
  getResultById,
  deleteResult,
};
