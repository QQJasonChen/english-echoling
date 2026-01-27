const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'db');
const dbPath = path.join(dbDir, 'english.db');

// Create db directory if it doesn't exist
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Remove existing database
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('Removed existing database');
}

const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Videos table
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT,
    channel TEXT,
    channel_type TEXT,
    content_style TEXT,
    duration INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Subtitles content table (main storage)
  CREATE TABLE IF NOT EXISTS subtitles_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    start_time REAL NOT NULL,
    end_time REAL NOT NULL,
    text TEXT NOT NULL,
    FOREIGN KEY (video_id) REFERENCES videos(id)
  );

  -- Index for faster video-based queries
  CREATE INDEX IF NOT EXISTS idx_subtitles_video ON subtitles_content(video_id);

  -- Index for text search
  CREATE INDEX IF NOT EXISTS idx_subtitles_text ON subtitles_content(text);

  -- FTS5 virtual table for full-text search (English works well with default tokenizer)
  CREATE VIRTUAL TABLE IF NOT EXISTS subtitles_fts USING fts5(
    text,
    content='subtitles_content',
    content_rowid='id'
  );

  -- Triggers to keep FTS in sync
  CREATE TRIGGER IF NOT EXISTS subtitles_ai AFTER INSERT ON subtitles_content BEGIN
    INSERT INTO subtitles_fts(rowid, text) VALUES (new.id, new.text);
  END;

  CREATE TRIGGER IF NOT EXISTS subtitles_ad AFTER DELETE ON subtitles_content BEGIN
    INSERT INTO subtitles_fts(subtitles_fts, rowid, text) VALUES('delete', old.id, old.text);
  END;

  CREATE TRIGGER IF NOT EXISTS subtitles_au AFTER UPDATE ON subtitles_content BEGIN
    INSERT INTO subtitles_fts(subtitles_fts, rowid, text) VALUES('delete', old.id, old.text);
    INSERT INTO subtitles_fts(rowid, text) VALUES (new.id, new.text);
  END;
`);

console.log('✅ Database initialized successfully at:', dbPath);
console.log('');
console.log('Tables created:');
console.log('  - videos');
console.log('  - subtitles_content');
console.log('  - subtitles_fts (FTS5)');
console.log('');
console.log('Next step: Run "npm run collect" to download subtitles');

db.close();
