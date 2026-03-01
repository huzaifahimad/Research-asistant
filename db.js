// ── ScholarAI Database (SQLite via better-sqlite3) ──
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'scholarai.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Researcher',
      plan TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT 'default',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS formatted_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      input_text TEXT,
      output_text TEXT,
      settings_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      input_text TEXT,
      results_json TEXT,
      style TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS literature_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      sources_json TEXT,
      output_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS thesis_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      input_text TEXT,
      output_text TEXT,
      conversion_type TEXT,
      target_journal TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS usage_stats (
      user_id TEXT PRIMARY KEY,
      formatted_count INTEGER NOT NULL DEFAULT 0,
      citations_count INTEGER NOT NULL DEFAULT 0,
      chats_count INTEGER NOT NULL DEFAULT 0,
      reviews_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}

function ensureStats(userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM usage_stats WHERE user_id = ?').get(userId);
  if (!row) {
    db.prepare('INSERT INTO usage_stats (user_id) VALUES (?)').run(userId);
  }
}

function incrementStat(userId, field) {
  const db = getDb();
  ensureStats(userId);
  db.prepare(`UPDATE usage_stats SET ${field} = ${field} + 1 WHERE user_id = ?`).run(userId);
}

function getStats(userId) {
  const db = getDb();
  ensureStats(userId);
  return db.prepare('SELECT * FROM usage_stats WHERE user_id = ?').get(userId);
}

module.exports = { getDb, ensureStats, incrementStat, getStats };
