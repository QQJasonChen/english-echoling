const { execSync, spawn } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Load channel configuration
const channelsConfig = require('../channels.json');
const channels = channelsConfig.channels;
const settings = channelsConfig.settings;

const dbPath = path.join(__dirname, '..', 'db', 'english.db');
const subtitlesDir = path.join(__dirname, '..', 'subtitles');

// Create subtitles directory
if (!fs.existsSync(subtitlesDir)) {
  fs.mkdirSync(subtitlesDir, { recursive: true });
}

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error('❌ Database not found. Run "npm run init-db" first.');
  process.exit(1);
}

const db = new Database(dbPath);

// Prepared statements
const insertVideo = db.prepare(`
  INSERT OR IGNORE INTO videos (id, title, channel, channel_type, content_style, duration)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertSubtitle = db.prepare(`
  INSERT INTO subtitles_content (video_id, start_time, end_time, text)
  VALUES (?, ?, ?, ?)
`);

const checkVideo = db.prepare('SELECT id FROM videos WHERE id = ?');

// Parse VTT file
function parseVTT(content) {
  const subtitles = [];
  let currentSub = null;

  for (const line of content.split('\n')) {
    // Match timestamp line
    const timestampMatch = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);

    if (timestampMatch) {
      // Save previous subtitle if exists
      if (currentSub && currentSub.text) {
        subtitles.push(currentSub);
      }

      // Parse timestamps
      const startTime = parseInt(timestampMatch[1]) * 3600 +
                       parseInt(timestampMatch[2]) * 60 +
                       parseInt(timestampMatch[3]) +
                       parseInt(timestampMatch[4]) / 1000;

      const endTime = parseInt(timestampMatch[5]) * 3600 +
                     parseInt(timestampMatch[6]) * 60 +
                     parseInt(timestampMatch[7]) +
                     parseInt(timestampMatch[8]) / 1000;

      currentSub = { start_time: startTime, end_time: endTime, text: '' };
    } else if (currentSub && line.trim() && !line.startsWith('WEBVTT') && !line.match(/^\d+$/)) {
      // Add text, removing HTML tags
      const cleanText = line.replace(/<[^>]+>/g, '').trim();
      if (cleanText && !cleanText.includes('-->')) {
        currentSub.text += (currentSub.text ? ' ' : '') + cleanText;
      }
    }
  }

  // Don't forget last subtitle
  if (currentSub && currentSub.text) {
    subtitles.push(currentSub);
  }

  return subtitles;
}

// Get video list from channel
function getVideoList(channelHandle, maxVideos) {
  try {
    const result = execSync(
      `yt-dlp --flat-playlist --print id "https://www.youtube.com/${channelHandle}/videos" --playlist-end ${maxVideos}`,
      { encoding: 'utf-8', timeout: 60000 }
    );
    return result.trim().split('\n').filter(id => id.length === 11);
  } catch (error) {
    console.error(`  ⚠️ Failed to get videos for ${channelHandle}`);
    return [];
  }
}

// Download subtitles for a video
function downloadSubtitles(videoId) {
  const outputPath = path.join(subtitlesDir, videoId);

  try {
    // Try to download manual English subtitles first, then auto-generated
    execSync(
      `yt-dlp --write-sub --write-auto-sub --sub-lang en --sub-format vtt --skip-download -o "${outputPath}" "https://www.youtube.com/watch?v=${videoId}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }
    );

    // Check if subtitle file exists
    const vttFile = `${outputPath}.en.vtt`;
    if (fs.existsSync(vttFile)) {
      return vttFile;
    }

    return null;
  } catch (error) {
    return null;
  }
}

// Get video metadata
function getVideoMetadata(videoId) {
  try {
    const result = execSync(
      `yt-dlp --print title --print duration "https://www.youtube.com/watch?v=${videoId}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: 'pipe' }
    );
    const lines = result.trim().split('\n');
    return {
      title: lines[0] || 'Unknown',
      duration: parseInt(lines[1]) || 0
    };
  } catch (error) {
    return { title: 'Unknown', duration: 0 };
  }
}

// Process a single channel
async function processChannel(channel) {
  console.log(`\n📺 Processing: ${channel.name} (${channel.handle})`);

  const videoIds = getVideoList(channel.handle, settings.maxVideosPerChannel);
  console.log(`  Found ${videoIds.length} videos`);

  let processed = 0;
  let skipped = 0;

  for (const videoId of videoIds) {
    // Skip if already in database
    if (checkVideo.get(videoId)) {
      skipped++;
      continue;
    }

    // Download subtitles
    const vttFile = downloadSubtitles(videoId);
    if (!vttFile) {
      continue;
    }

    // Parse subtitles
    const content = fs.readFileSync(vttFile, 'utf-8');
    const subtitles = parseVTT(content);

    // Skip if too few subtitles
    if (subtitles.length < 10) {
      fs.unlinkSync(vttFile);
      continue;
    }

    // Get video metadata
    const metadata = getVideoMetadata(videoId);

    // Insert video
    insertVideo.run(
      videoId,
      metadata.title,
      channel.name,
      channel.type,
      channel.content_style,
      metadata.duration
    );

    // Insert subtitles
    let subtitleCount = 0;
    for (const sub of subtitles) {
      // Skip very short subtitles
      if (sub.text.length < settings.minSubtitleLength) continue;

      // Skip music notation like [Music] or ♪
      if (sub.text.match(/^\[.*\]$/) || sub.text.match(/^♪/)) continue;

      insertSubtitle.run(videoId, sub.start_time, sub.end_time, sub.text);
      subtitleCount++;
    }

    processed++;
    console.log(`  ✅ ${metadata.title.substring(0, 50)}... (${subtitleCount} subs)`);

    // Clean up subtitle file
    fs.unlinkSync(vttFile);

    // Small delay to be nice to YouTube
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`  Processed: ${processed}, Skipped: ${skipped}`);
  return processed;
}

// Main function
async function main() {
  console.log('🎯 English Echoling - Subtitle Collector');
  console.log('=========================================');
  console.log(`Channels to process: ${channels.length}`);
  console.log(`Max videos per channel: ${settings.maxVideosPerChannel}`);
  console.log('');

  let totalProcessed = 0;

  for (const channel of channels) {
    try {
      const processed = await processChannel(channel);
      totalProcessed += processed;
    } catch (error) {
      console.error(`  ❌ Error processing ${channel.name}:`, error.message);
    }
  }

  // Final stats
  const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos').get();
  const subtitleCount = db.prepare('SELECT COUNT(*) as count FROM subtitles_content').get();

  console.log('\n=========================================');
  console.log('✅ Collection complete!');
  console.log(`Total videos: ${videoCount.count}`);
  console.log(`Total subtitles: ${subtitleCount.count}`);
  console.log('');
  console.log('Start the server with: npm start');

  db.close();
}

main().catch(console.error);
