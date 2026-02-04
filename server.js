require('dotenv').config(); // Load .env file (local only)

const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const multer = require('multer');
const Groq = require('groq-sdk');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// Groq client for Whisper transcription
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: '/tmp',
    filename: (req, file, cb) => cb(null, `audio-${Date.now()}.webm`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Database connection
const dbPath = path.join(__dirname, 'db', 'english.db');
let db;

try {
  db = new Database(dbPath, { readonly: true });
} catch (error) {
  console.log('Database not found. Run "npm run init-db" and "npm run collect" first.');
  console.log('Starting in demo mode...');
  db = null;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Search API endpoint
app.get('/api/search', (req, res) => {
  if (!db) {
    return res.json({ results: [], total: 0, message: 'Database not initialized' });
  }

  const { q, limit = 50, offset = 0, unique = 'true', style = 'all' } = req.query;

  if (!q || q.trim().length < 1) {
    return res.json({ results: [], total: 0 });
  }

  try {
    const searchQuery = q.trim();
    const likePattern = `%${searchQuery}%`;

    // Build style filter
    let styleFilter = '';
    if (style === 'instructional') {
      styleFilter = "AND v.content_style = 'instructional'";
    } else if (style === 'natural') {
      styleFilter = "AND v.content_style = 'natural'";
    } else if (style === 'formal') {
      styleFilter = "AND v.content_style = 'formal'";
    }

    let results;

    if (unique === 'true') {
      // Get best match per video (no duplicates from same video)
      results = db.prepare(`
        SELECT
          sc.id,
          sc.video_id,
          sc.start_time,
          sc.end_time,
          sc.text,
          v.title as video_title,
          v.channel,
          v.channel_type,
          v.content_style,
          CASE
            WHEN v.content_style = 'natural' THEN 0
            WHEN v.content_style = 'instructional' THEN 1
            ELSE 2
          END as style_priority
        FROM subtitles_content sc
        JOIN videos v ON sc.video_id = v.id
        WHERE sc.text LIKE ? COLLATE NOCASE
        ${styleFilter}
        GROUP BY sc.video_id
        ORDER BY style_priority, sc.start_time
        LIMIT ? OFFSET ?
      `).all(likePattern, parseInt(limit), parseInt(offset));
    } else {
      results = db.prepare(`
        SELECT
          sc.id,
          sc.video_id,
          sc.start_time,
          sc.end_time,
          sc.text,
          v.title as video_title,
          v.channel,
          v.channel_type,
          v.content_style
        FROM subtitles_content sc
        JOIN videos v ON sc.video_id = v.id
        WHERE sc.text LIKE ? COLLATE NOCASE
        ${styleFilter}
        ORDER BY sc.start_time
        LIMIT ? OFFSET ?
      `).all(likePattern, parseInt(limit), parseInt(offset));
    }

    // Expand context: get surrounding subtitles for each result
    const expandedResults = results.map(r => {
      const context = db.prepare(`
        SELECT text, start_time
        FROM subtitles_content
        WHERE video_id = ?
          AND start_time >= ? - 2
          AND start_time <= ? + 2
        ORDER BY start_time
      `).all(r.video_id, r.start_time, r.start_time);

      // Combine nearby subtitles, removing duplicates
      let lastText = '';
      const uniqueTexts = [];
      for (const c of context) {
        const cleanText = c.text.trim();
        if (!cleanText) continue;

        const isDuplicate = lastText && (
          cleanText === lastText ||
          lastText.includes(cleanText) ||
          cleanText.includes(lastText)
        );

        if (!isDuplicate) {
          uniqueTexts.push(cleanText);
          lastText = cleanText;
        }
      }

      const fullText = uniqueTexts.join(' ').replace(/\s+/g, ' ').trim();
      const contextStart = context.length > 0 ? context[0].start_time : r.start_time;

      const displayText = fullText || r.text;

      return {
        ...r,
        text: displayText.length > 150 ? displayText.substring(0, 150) + '...' : displayText,
        original_text: r.text,
        context_start: contextStart
      };
    });

    // Get total unique videos count
    const countResult = db.prepare(`
      SELECT COUNT(DISTINCT sc.video_id) as total
      FROM subtitles_content sc
      JOIN videos v ON sc.video_id = v.id
      WHERE sc.text LIKE ? COLLATE NOCASE
      ${styleFilter}
    `).get(likePattern);

    res.json({
      results: expandedResults,
      total: countResult.total,
      query: q
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

// Get random phrases (for discovery)
app.get('/api/random', (req, res) => {
  if (!db) {
    return res.json({ results: [], message: 'Database not initialized' });
  }

  const { limit = 10, style = 'all' } = req.query;

  let styleFilter = '';
  if (style === 'instructional') {
    styleFilter = "AND v.content_style = 'instructional'";
  } else if (style === 'natural') {
    styleFilter = "AND v.content_style = 'natural'";
  } else if (style === 'formal') {
    styleFilter = "AND v.content_style = 'formal'";
  }

  try {
    const results = db.prepare(`
      SELECT
        sc.id,
        sc.video_id,
        sc.start_time,
        sc.end_time,
        sc.text,
        v.title as video_title,
        v.channel,
        v.channel_type,
        v.content_style
      FROM subtitles_content sc
      JOIN videos v ON sc.video_id = v.id
      WHERE length(sc.text) > 15
      ${styleFilter}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(parseInt(limit));

    if (parseInt(limit) === 1 && results.length > 0) {
      res.json({ clip: results[0] });
    } else {
      res.json({ results });
    }
  } catch (error) {
    console.error('Random fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch random phrases' });
  }
});

// Pronunciation evaluation endpoint
app.post('/api/evaluate', upload.single('audio'), async (req, res) => {
  const { expectedText } = req.body;
  const audioFile = req.file;

  if (!audioFile || !expectedText) {
    return res.status(400).json({ error: 'Missing audio file or expected text' });
  }

  try {
    // 1. Transcribe with Whisper via Groq
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioFile.path),
      model: 'whisper-large-v3',
      language: 'en',
      response_format: 'verbose_json'
    });

    const userText = transcription.text.trim();

    // 2. Compare and score
    const result = evaluatePronunciation(userText, expectedText);

    // Cleanup temp file
    fs.unlink(audioFile.path, () => {});

    res.json({
      success: true,
      userText,
      expectedText,
      ...result
    });
  } catch (error) {
    console.error('Evaluation error:', error);
    fs.unlink(audioFile.path, () => {});
    res.status(500).json({ error: 'Evaluation failed', message: error.message });
  }
});

// Pronunciation evaluation algorithm
function evaluatePronunciation(userText, expectedText) {
  // Normalize texts
  const normalize = (text) => text.toLowerCase()
    .replace(/[^\w\s']/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const user = normalize(userText);
  const expected = normalize(expectedText);

  const userWords = user.split(' ').filter(w => w.length > 0);
  const expectedWords = expected.split(' ').filter(w => w.length > 0);

  // Word-level matching
  let correctWords = 0;
  let missedWords = [];
  let extraWords = [];
  let mispronounced = [];

  const userSet = new Set(userWords);
  const expectedSet = new Set(expectedWords);

  // Check each expected word
  for (const word of expectedWords) {
    if (userSet.has(word)) {
      correctWords++;
    } else {
      // Check for similar words (possible mispronunciation)
      const similar = userWords.find(w => levenshteinDistance(w, word) <= Math.max(1, Math.floor(word.length / 3)));
      if (similar) {
        mispronounced.push({ expected: word, heard: similar });
        correctWords += 0.5; // Partial credit
      } else {
        missedWords.push(word);
      }
    }
  }

  // Check for extra words user said
  for (const word of userWords) {
    if (!expectedSet.has(word) && !mispronounced.find(m => m.heard === word)) {
      extraWords.push(word);
    }
  }

  // Calculate score (0-100)
  const score = Math.round((correctWords / expectedWords.length) * 100);

  // Generate feedback
  const feedback = generateFeedback(score, missedWords, mispronounced, extraWords);

  return {
    score,
    correctWords: Math.floor(correctWords),
    totalWords: expectedWords.length,
    missedWords,
    mispronounced,
    extraWords,
    feedback
  };
}

function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  return matrix[b.length][a.length];
}

function generateFeedback(score, missedWords, mispronounced, extraWords) {
  const feedback = [];

  if (score >= 90) {
    feedback.push('🎉 Excellent! Almost perfect pronunciation!');
  } else if (score >= 70) {
    feedback.push('👍 Good job! A few areas to improve.');
  } else if (score >= 50) {
    feedback.push('📚 Keep practicing! Focus on the highlighted words.');
  } else {
    feedback.push('💪 Try listening again and speak more slowly.');
  }

  if (missedWords.length > 0) {
    feedback.push(`❌ Missed words: ${missedWords.slice(0, 5).join(', ')}`);
  }

  if (mispronounced.length > 0) {
    const examples = mispronounced.slice(0, 3).map(m => `"${m.expected}" → heard "${m.heard}"`);
    feedback.push(`🔄 Check pronunciation: ${examples.join(', ')}`);
  }

  return feedback;
}

// Stats endpoint
app.get('/api/stats', (req, res) => {
  if (!db) {
    return res.json({ videos: 0, subtitles: 0, byType: [] });
  }

  try {
    const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos').get();
    const subtitleCount = db.prepare('SELECT COUNT(*) as count FROM subtitles_content').get();
    const channelStats = db.prepare(`
      SELECT channel_type, COUNT(*) as count
      FROM videos
      GROUP BY channel_type
    `).all();

    res.json({
      videos: videoCount.count,
      subtitles: subtitleCount.count,
      byType: channelStats
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ==========================================
// Gemini AI Translation & Explanation APIs
// ==========================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Free translation using MyMemory API (fallback)
async function translateWithMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-TW`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('MyMemory API error');
  const data = await response.json();
  if (data.responseStatus === 200 && data.responseData?.translatedText) {
    return data.responseData.translatedText;
  }
  throw new Error('MyMemory translation failed');
}

// Translation with Gemini (higher quality)
async function translateWithGemini(text) {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key');

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Translate this English text to Traditional Chinese (繁體中文, Taiwan style). Return ONLY the translation, nothing else:\n\n${text}`
        }]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 256
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini API error: ${response.status}`);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

app.post('/api/translate', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    return res.json({ translation: '' });
  }

  try {
    // Try Gemini first (better quality), fallback to MyMemory
    let translation;
    if (GEMINI_API_KEY) {
      try {
        translation = await translateWithGemini(text);
      } catch (e) {
        console.log('Gemini failed, trying MyMemory:', e.message);
        translation = await translateWithMyMemory(text);
      }
    } else {
      translation = await translateWithMyMemory(text);
    }

    res.json({ translation });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: 'Translation failed' });
  }
});

// AI Word Explanation endpoint
app.post('/api/explain', async (req, res) => {
  const { word } = req.body;

  if (!word || word.trim().length === 0) {
    return res.json({ explanation: '' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are an English teacher. Explain the word/phrase "${word}" for someone learning English (intermediate level).

Use this format:
📝 ${word}
🔤 Part of speech: [noun/verb/adjective/adverb/phrase/etc.]
📖 Meaning: [explain in simple English, max 20 words]
✏️ Example: [a simple sentence using this word]
🔗 Related: [2-3 related words or phrases]
🎯 Usage tip: [when/how to use this naturally]

Answer in English only!`
          }]
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 300
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const explanation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    res.json({ explanation });
  } catch (error) {
    console.error('Gemini explanation error:', error);
    res.status(500).json({ error: 'Explanation failed' });
  }
});

// AI Pronunciation Assessment endpoint (Gemini-based)
app.post('/api/assess-pronunciation', async (req, res) => {
  const { original, spoken } = req.body;

  if (!original || !spoken) {
    return res.json({ error: 'Missing original or spoken text' });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `You are an English pronunciation coach. Evaluate the student's pronunciation.

Original (correct): "${original}"
Student said: "${spoken}"

Please respond in this format (Traditional Chinese):
📊 分數: [0-100]
${spoken.toLowerCase() === original.toLowerCase() ? '🎉 完美！發音正確！' : `
🎯 問題: [Point out pronunciation errors]
💡 建議: [How to improve, in simple words]
🔊 正確發音提示: [IPA or phonetic hint for the difficult parts]`}

Notes:
- If both are identical (case-insensitive), give 100
- Focus on word accuracy
- Minor punctuation differences don't count`
          }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const assessment = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Extract score from response
    const scoreMatch = assessment.match(/分數[：:]\s*(\d+)/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 50;

    res.json({ assessment, score });
  } catch (error) {
    console.error('Pronunciation assessment error:', error);
    res.status(500).json({ error: 'Assessment failed' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════╗
  ║     🎯 English Echoling                       ║
  ║     Advanced Shadowing Practice               ║
  ║     Running at http://localhost:${PORT}          ║
  ╚═══════════════════════════════════════════════╝
  `);

  if (!db) {
    console.log('  ⚠️  Database not found!');
    console.log('  Run these commands to set up:');
    console.log('    npm run init-db');
    console.log('    npm run collect');
    console.log('');
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  if (db) db.close();
  process.exit(0);
});
