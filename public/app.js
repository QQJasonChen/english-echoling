// ==========================================
// English Echoling - Advanced Shadowing App
// ==========================================

// State
let player = null;
let results = [];
let currentIndex = -1;
let isPlayerReady = false;
let searchTimeout = null;
let clipEndTime = null;
let clipStartTime = null;
let isLooping = localStorage.getItem('english-loop') === 'true';
let autoPlayMode = localStorage.getItem('english-autoplay') === 'true';
let autoPlayDelay = 3;
let autoPlayInterval = null;
let favorites = JSON.parse(localStorage.getItem('english-favorites') || '[]');
let stats = JSON.parse(localStorage.getItem('english-stats') || '{"watched":0,"searches":0,"favorites":0,"shadowed":0}');
let searchHistory = JSON.parse(localStorage.getItem('english-history') || '[]');
let currentStyle = localStorage.getItem('english-style') || 'natural';
let playbackSpeed = parseFloat(localStorage.getItem('english-speed') || '1');
let timeOffset = parseFloat(localStorage.getItem('english-time-offset') || '-0.3'); // Start earlier for better sync

// Shadowing Mode State
let isShadowingMode = false;
let mediaRecorder = null;
let audioChunks = [];
let recordedAudioBlob = null;
let recordedAudioUrl = null;
let isRecording = false;
let shadowingPhase = 'idle'; // idle, listening, countdown, recording, review

// DOM Elements
const searchInput = document.getElementById('searchInput');
const resultsList = document.getElementById('resultsList');
const resultCount = document.getElementById('resultCount');
const clipCounter = document.getElementById('clipCounter');
const currentSubtitle = document.getElementById('currentSubtitle');
const playerContainer = document.getElementById('playerContainer');
const statsEl = document.getElementById('stats');
const shadowingPanel = document.getElementById('shadowingPanel');
const shadowingModeBtn = document.getElementById('shadowingModeBtn');

// ==========================================
// YouTube Player Functions
// ==========================================

function onYouTubeIframeAPIReady() {
  console.log('YouTube API Ready');
  isPlayerReady = true;
}

function createPlayer(videoId, startTime) {
  clipStartTime = startTime;

  playerContainer.innerHTML = `
    <div class="flex items-center justify-center h-full bg-gray-900">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
        <p class="text-gray-400 text-sm">Loading...</p>
      </div>
    </div>
  `;

  const playerDiv = document.createElement('div');
  playerDiv.id = 'ytPlayer';
  playerContainer.innerHTML = '';
  playerContainer.appendChild(playerDiv);

  player = new YT.Player('ytPlayer', {
    height: '100%',
    width: '100%',
    videoId: videoId,
    playerVars: {
      autoplay: 1,
      controls: 1,
      rel: 0,
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

// Handle YouTube player errors (private/deleted videos)
function onPlayerError(event) {
  const errorCodes = {
    2: 'Invalid video ID',
    5: 'HTML5 player error',
    100: 'Video not found (deleted)',
    101: 'Video cannot be embedded',
    150: 'Video cannot be embedded (private)'
  };

  const errorMsg = errorCodes[event.data] || `Playback error (${event.data})`;
  console.warn('YouTube Error:', errorMsg);

  // Show error message briefly
  currentSubtitle.innerHTML = `<span class="text-red-400">⚠️ ${errorMsg} - Skipping to next...</span>`;

  // Auto-skip to next clip after 1.5 seconds
  setTimeout(() => {
    if (currentIndex < results.length - 1) {
      nextClip();
    } else {
      currentSubtitle.innerHTML = '<span class="text-gray-400">Reached last clip</span>';
    }
  }, 1500);
}

function onPlayerReady(event) {
  event.target.setPlaybackRate(playbackSpeed);

  // Apply time offset for better sync (negative = start earlier)
  const adjustedStartTime = Math.max(0, clipStartTime + timeOffset);

  event.target.seekTo(adjustedStartTime, true);

  setTimeout(() => {
    if (player && player.seekTo) {
      player.seekTo(adjustedStartTime, true);
      player.setPlaybackRate(playbackSpeed);
      player.playVideo();
    }
  }, 300);
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    stats.watched++;
    saveStats();
    updateStatsDisplay();
    checkClipEnd();
  }

  // Shadowing mode: detect when clip finishes
  if (event.data === YT.PlayerState.PAUSED && isShadowingMode && shadowingPhase === 'listening') {
    startEchoCountdown();
  }
}

function checkClipEnd() {
  if (!player || !clipEndTime) return;

  const currentTime = player.getCurrentTime();
  if (currentTime >= clipEndTime) {
    if (isLooping && !isShadowingMode) {
      player.seekTo(clipStartTime, true);
      player.playVideo();
    } else if (autoPlayMode && !isShadowingMode) {
      player.pauseVideo();
      startAutoPlayCountdown();
      return;
    } else {
      player.pauseVideo();
      return;
    }
  }

  requestAnimationFrame(checkClipEnd);
}

// Auto-play functions
function startAutoPlayCountdown() {
  if (currentIndex >= results.length - 1) return;

  if (autoPlayInterval) clearInterval(autoPlayInterval);

  let remaining = autoPlayDelay;
  updateAutoPlayDisplay(remaining);

  autoPlayInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(autoPlayInterval);
      autoPlayInterval = null;
      nextClip();
    } else {
      updateAutoPlayDisplay(remaining);
    }
  }, 1000);
}

function updateAutoPlayDisplay(seconds) {
  const overlayEl = document.getElementById('autoPlayOverlay');
  const countdownEl = document.getElementById('autoPlayCountdown');
  if (overlayEl && countdownEl) {
    countdownEl.textContent = seconds;
    overlayEl.classList.remove('hidden');
  }
}

function cancelAutoPlay() {
  if (autoPlayInterval) {
    clearInterval(autoPlayInterval);
    autoPlayInterval = null;
  }
  const overlayEl = document.getElementById('autoPlayOverlay');
  if (overlayEl) {
    overlayEl.classList.add('hidden');
  }
}

function toggleAutoPlay() {
  autoPlayMode = !autoPlayMode;
  localStorage.setItem('english-autoplay', autoPlayMode);
  updateAutoPlayButton();
  if (!autoPlayMode) cancelAutoPlay();
}

function updateAutoPlayButton() {
  const btn = document.getElementById('autoPlayBtn');
  if (btn) {
    if (autoPlayMode) {
      btn.classList.remove('bg-gray-700');
      btn.classList.add('bg-green-600', 'text-white');
      btn.innerHTML = '▶▶ Auto';
    } else {
      btn.classList.remove('bg-green-600', 'text-white');
      btn.classList.add('bg-gray-700');
      btn.innerHTML = '▶▶';
    }
  }
}

// ==========================================
// Shadowing Mode Functions
// ==========================================

function toggleShadowingMode() {
  isShadowingMode = !isShadowingMode;

  if (isShadowingMode) {
    shadowingPanel.classList.remove('hidden');
    shadowingModeBtn.classList.add('bg-purple-500', 'ring-2', 'ring-purple-300');
    shadowingModeBtn.innerHTML = '<span>🎙️</span><span>Exit Shadowing</span>';
    shadowingPhase = 'idle';
    updateShadowingUI();

    // Request microphone permission
    requestMicrophoneAccess();
  } else {
    shadowingPanel.classList.add('hidden');
    shadowingModeBtn.classList.remove('bg-purple-500', 'ring-2', 'ring-purple-300');
    shadowingModeBtn.innerHTML = '<span>🎙️</span><span>Shadowing Mode</span>';
    stopRecording();
    shadowingPhase = 'idle';
  }
}

async function requestMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop()); // Release immediately
    console.log('Microphone access granted');
  } catch (error) {
    console.error('Microphone access denied:', error);
    alert('Please allow microphone access for shadowing practice');
  }
}

function startListening() {
  if (!player) return;

  shadowingPhase = 'listening';
  updateShadowingUI();

  // Replay the clip
  player.seekTo(clipStartTime, true);
  player.playVideo();
}

function startEchoCountdown() {
  shadowingPhase = 'countdown';
  updateShadowingUI();

  let countdown = 3;
  const countdownNumber = document.getElementById('countdownNumber');
  const countdownRing = document.getElementById('countdownRing');

  const countdownInterval = setInterval(() => {
    countdown--;
    if (countdownNumber) countdownNumber.textContent = countdown;

    // Update ring progress
    const circumference = 125.6;
    const offset = circumference * (1 - countdown / 3);
    if (countdownRing) countdownRing.style.strokeDashoffset = offset;

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      startRecording();
    }
  }, 1000);
}

async function startRecording() {
  shadowingPhase = 'recording';
  updateShadowingUI();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      recordedAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      recordedAudioUrl = URL.createObjectURL(recordedAudioBlob);
      stream.getTracks().forEach(track => track.stop());

      shadowingPhase = 'review';
      updateShadowingUI();

      stats.shadowed++;
      saveStats();
      updateStatsDisplay();

      // Send to AI for evaluation
      const clip = results[currentIndex];
      if (clip) {
        await evaluatePronunciation(recordedAudioBlob, clip.original_text || clip.text);
      }
    };

    mediaRecorder.start();
    isRecording = true;

    // Show waveform
    showWaveform(stream);

    // Auto-stop after clip duration + 1 second
    const clipDuration = (clipEndTime - clipStartTime) * 1000 + 1000;
    setTimeout(() => {
      if (isRecording) {
        stopRecording();
      }
    }, Math.min(clipDuration, 15000)); // Max 15 seconds

  } catch (error) {
    console.error('Recording failed:', error);
    shadowingPhase = 'idle';
    updateShadowingUI();
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    isRecording = false;
  }
}

function showWaveform(stream) {
  const waveformContainer = document.getElementById('waveformContainer');
  if (!waveformContainer) return;

  waveformContainer.classList.remove('hidden');
  waveformContainer.innerHTML = '';

  // Create bars
  for (let i = 0; i < 20; i++) {
    const bar = document.createElement('div');
    bar.className = 'waveform-bar w-1 bg-purple-500 rounded';
    bar.style.height = '4px';
    waveformContainer.appendChild(bar);
  }

  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  analyser.fftSize = 64;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function updateWaveform() {
    if (!isRecording) {
      waveformContainer.classList.add('hidden');
      return;
    }

    analyser.getByteFrequencyData(dataArray);
    const bars = waveformContainer.querySelectorAll('.waveform-bar');

    bars.forEach((bar, i) => {
      const value = dataArray[i] || 0;
      const height = Math.max(4, (value / 255) * 32);
      bar.style.height = `${height}px`;
    });

    requestAnimationFrame(updateWaveform);
  }

  updateWaveform();
}

function playRecordedEcho() {
  if (recordedAudioUrl) {
    const audio = new Audio(recordedAudioUrl);
    audio.play();
  }
}

function playOriginalClip() {
  if (player) {
    player.seekTo(clipStartTime, true);
    player.playVideo();
  }
}

// AI Pronunciation Evaluation
async function evaluatePronunciation(audioBlob, expectedText) {
  const scoreDisplay = document.getElementById('pronunciationScore');
  const feedbackDisplay = document.getElementById('pronunciationFeedback');

  if (scoreDisplay) {
    scoreDisplay.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="animate-spin h-4 w-4 border-2 border-purple-400 border-t-transparent rounded-full"></div>
        <span class="text-gray-400">Analyzing pronunciation...</span>
      </div>
    `;
  }

  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    formData.append('expectedText', expectedText);

    const response = await fetch('/api/evaluate', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      displayEvaluationResult(result);
    } else {
      if (scoreDisplay) {
        scoreDisplay.innerHTML = '<span class="text-red-400">Evaluation failed</span>';
      }
    }
  } catch (error) {
    console.error('Evaluation error:', error);
    if (scoreDisplay) {
      scoreDisplay.innerHTML = '<span class="text-red-400">Evaluation error</span>';
    }
  }
}

function displayEvaluationResult(result) {
  const scoreDisplay = document.getElementById('pronunciationScore');
  const feedbackDisplay = document.getElementById('pronunciationFeedback');

  if (!scoreDisplay) return;

  // Determine score color
  let scoreColor = 'text-red-400';
  let bgColor = 'bg-red-500/20';
  let emoji = '💪';

  if (result.score >= 90) {
    scoreColor = 'text-green-400';
    bgColor = 'bg-green-500/20';
    emoji = '🎉';
  } else if (result.score >= 70) {
    scoreColor = 'text-yellow-400';
    bgColor = 'bg-yellow-500/20';
    emoji = '👍';
  } else if (result.score >= 50) {
    scoreColor = 'text-orange-400';
    bgColor = 'bg-orange-500/20';
    emoji = '📚';
  }

  scoreDisplay.innerHTML = `
    <div class="${bgColor} rounded-lg p-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-lg font-bold ${scoreColor}">${emoji} ${result.score}%</span>
        <span class="text-xs text-gray-400">${result.correctWords}/${result.totalWords} words</span>
      </div>
      <div class="text-xs text-gray-300 mb-2">
        <span class="text-gray-500">You said:</span> "${result.userText}"
      </div>
    </div>
  `;

  if (feedbackDisplay && result.feedback) {
    feedbackDisplay.innerHTML = result.feedback.map(f => `
      <div class="text-xs text-gray-300 py-1">${f}</div>
    `).join('');
  }
}

function updateShadowingUI() {
  const listenBtn = document.getElementById('listenBtn');
  const echoBtn = document.getElementById('echoBtn');
  const compareBtn = document.getElementById('compareBtn');
  const recordingIndicator = document.getElementById('recordingIndicator');
  const echoPlaybackSection = document.getElementById('echoPlaybackSection');
  const shadowingStatus = document.getElementById('shadowingStatus');
  const countdownNumber = document.getElementById('countdownNumber');

  // Reset
  if (recordingIndicator) recordingIndicator.classList.add('hidden');
  if (echoPlaybackSection) echoPlaybackSection.classList.add('hidden');

  switch (shadowingPhase) {
    case 'idle':
      if (listenBtn) listenBtn.disabled = false;
      if (echoBtn) echoBtn.disabled = true;
      if (compareBtn) compareBtn.disabled = true;
      if (shadowingStatus) shadowingStatus.textContent = 'Click "Listen" to start';
      if (countdownNumber) countdownNumber.textContent = '3';
      break;

    case 'listening':
      if (listenBtn) listenBtn.disabled = true;
      if (shadowingStatus) shadowingStatus.textContent = '👂 Listening to the clip...';
      break;

    case 'countdown':
      if (shadowingStatus) shadowingStatus.textContent = '🎯 Get ready to echo!';
      break;

    case 'recording':
      if (recordingIndicator) recordingIndicator.classList.remove('hidden');
      if (shadowingStatus) shadowingStatus.textContent = '🎙️ Recording your echo...';
      if (echoBtn) echoBtn.disabled = true;
      break;

    case 'review':
      if (echoPlaybackSection) echoPlaybackSection.classList.remove('hidden');
      if (listenBtn) listenBtn.disabled = false;
      if (echoBtn) echoBtn.disabled = false;
      if (compareBtn) compareBtn.disabled = false;
      if (shadowingStatus) shadowingStatus.textContent = '✅ Compare your echo with the original';
      break;
  }
}

// ==========================================
// Search Functions
// ==========================================

async function search(query) {
  if (!query || query.length < 1) {
    showEmptyState();
    return;
  }

  addToHistory(query);
  stats.searches++;
  saveStats();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=50&style=${currentStyle}`);
    const data = await response.json();

    results = data.results;
    currentIndex = -1;

    renderResults();
    resultCount.textContent = `${data.total} videos`;

    if (results.length > 0) {
      playClip(0);
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsList.innerHTML = '<div class="p-4 text-red-400">Search failed, please try again</div>';
  }
}

function showEmptyState() {
  results = [];
  currentIndex = -1;
  resultCount.textContent = '0 results';

  let html = '<div class="p-4">';

  if (searchHistory.length > 0) {
    html += '<h3 class="text-sm font-semibold text-gray-400 mb-2">🕐 Recent Searches</h3>';
    html += '<div class="flex flex-wrap gap-2 mb-4">';
    searchHistory.slice(0, 10).forEach(h => {
      html += `<button class="history-btn px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm">${h.query}</button>`;
    });
    html += '</div>';
  }

  html += '<h3 class="text-sm font-semibold text-gray-400 mb-2">💡 Try these</h3>';
  html += '<div class="flex flex-wrap gap-2">';
  ['actually', 'you know', 'I think', 'basically', 'kind of', 'sort of', 'gonna', 'wanna'].forEach(word => {
    html += `<button class="suggest-btn px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm">${word}</button>`;
  });
  html += '</div>';

  html += '</div>';

  resultsList.innerHTML = html;
  bindSuggestButtons();
  bindHistoryButtons();
}

function renderResults() {
  if (results.length === 0) {
    resultsList.innerHTML = '<div class="p-4 text-gray-500 text-center">No results found</div>';
    return;
  }

  resultsList.innerHTML = results.map((r, i) => {
    const isFav = favorites.some(f => f.id === r.id);
    return `
    <div
      class="result-item p-3 cursor-pointer hover:bg-gray-700 transition border-l-4 ${getChannelClass(r.channel_type)} ${i === currentIndex ? 'bg-gray-700' : ''}"
      data-index="${i}"
    >
      <p class="text-sm font-medium leading-relaxed">${highlightQuery(r.text)}</p>
      <div class="mt-2 flex items-center justify-between">
        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span class="channel-tag">${r.channel}</span>
          <span>·</span>
          <span>${formatTime(r.context_start || r.start_time)}</span>
        </div>
        <button class="fav-btn text-lg ${isFav ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}" data-id="${r.id}" title="Favorite">
          ${isFav ? '★' : '☆'}
        </button>
      </div>
    </div>
  `}).join('');

  document.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-btn')) return;
      const index = parseInt(item.dataset.index);
      playClip(index);
    });
  });

  document.querySelectorAll('.fav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      toggleFavorite(id);
    });
  });
}

function getChannelClass(type) {
  switch (type) {
    case 'podcast': return 'channel-podcast';
    case 'educational': return 'channel-educational';
    case 'entertainment': return 'channel-entertainment';
    case 'news': return 'channel-news';
    case 'tech': return 'channel-tech';
    case 'learning': return 'channel-learning';
    default: return 'border-l-gray-500';
  }
}

function highlightQuery(text) {
  const query = searchInput.value.trim();
  if (!query) return text;

  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return text.replace(regex, '<mark class="bg-blue-500/30 text-blue-300 px-0.5 rounded">$1</mark>');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================
// Playback Controls
// ==========================================

function playClip(index) {
  if (index < 0 || index >= results.length) return;

  cancelAutoPlay();

  currentIndex = index;
  const clip = results[index];

  clipCounter.textContent = `${index + 1} / ${results.length}`;
  currentSubtitle.innerHTML = `<span>${highlightQuery(clip.text)}</span>`;

  document.querySelectorAll('.result-item').forEach((item, i) => {
    item.classList.toggle('bg-gray-700', i === index);
  });

  const currentItem = document.querySelector(`.result-item[data-index="${index}"]`);
  if (currentItem) {
    currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const playStart = clip.context_start || clip.start_time;
  const clipDuration = 8;
  clipEndTime = playStart + clipDuration;

  translateText(clip.original_text || clip.text);
  createPlayer(clip.video_id, playStart);

  // Reset shadowing phase when new clip is played
  if (isShadowingMode) {
    shadowingPhase = 'idle';
    updateShadowingUI();
  }
}

function nextClip() {
  if (currentIndex < results.length - 1) {
    playClip(currentIndex + 1);
  }
}

function prevClip() {
  if (currentIndex > 0) {
    playClip(currentIndex - 1);
  }
}

function replayClip() {
  if (currentIndex >= 0) {
    playClip(currentIndex);
  }
}

async function playRandomClip() {
  try {
    const response = await fetch(`/api/random?style=${currentStyle}&limit=1`);
    const data = await response.json();

    if (data.clip) {
      results = [data.clip];
      currentIndex = -1;
      resultCount.textContent = '🎲 Random clip';
      renderResults();
      playClip(0);
    }
  } catch (error) {
    console.error('Random clip error:', error);
  }
}

function toggleLoop() {
  isLooping = !isLooping;
  localStorage.setItem('english-loop', isLooping);
  updateLoopButton();
}

function updateLoopButton() {
  const loopBtn = document.getElementById('loopBtn');
  if (loopBtn) {
    if (isLooping) {
      loopBtn.classList.remove('text-gray-400');
      loopBtn.classList.add('text-green-400');
      loopBtn.title = 'Loop ON (L)';
    } else {
      loopBtn.classList.remove('text-green-400');
      loopBtn.classList.add('text-gray-400');
      loopBtn.title = 'Loop OFF (L)';
    }
  }
}

// ==========================================
// Favorites
// ==========================================

function toggleFavorite(id) {
  const clip = results.find(r => r.id === id);
  if (!clip) return;

  const existingIndex = favorites.findIndex(f => f.id === id);
  if (existingIndex >= 0) {
    favorites.splice(existingIndex, 1);
  } else {
    favorites.push({
      id: clip.id,
      video_id: clip.video_id,
      text: clip.text,
      start_time: clip.start_time,
      video_title: clip.video_title,
      channel: clip.channel,
      added_at: new Date().toISOString()
    });
    stats.favorites++;
  }

  saveFavorites();
  saveStats();
  renderResults();
  updateStatsDisplay();
}

function saveFavorites() {
  localStorage.setItem('english-favorites', JSON.stringify(favorites));
}

function saveStats() {
  localStorage.setItem('english-stats', JSON.stringify(stats));
}

// ==========================================
// Search History
// ==========================================

function addToHistory(query) {
  const normalized = query.trim().toLowerCase();
  searchHistory = searchHistory.filter(h => h.query.toLowerCase() !== normalized);
  searchHistory.unshift({
    query: query.trim(),
    timestamp: new Date().toISOString()
  });
  searchHistory = searchHistory.slice(0, 20);
  localStorage.setItem('english-history', JSON.stringify(searchHistory));
}

function updateStatsDisplay() {
  const statsDisplay = document.getElementById('learningStats');
  if (statsDisplay) {
    statsDisplay.innerHTML = `
      <span title="Watched">👁 ${stats.watched}</span>
      <span title="Shadowed">🎙️ ${stats.shadowed || 0}</span>
      <span title="Favorites">⭐ ${favorites.length}</span>
    `;
  }
}

// ==========================================
// Translation
// ==========================================

async function translateText(text) {
  const translationEl = document.getElementById('translatedSubtitle');
  const contextEl = document.getElementById('clipContext');

  if (!translationEl) return;

  translationEl.innerHTML = '<span class="text-gray-400">Translating...</span>';

  try {
    const textToTranslate = text.length > 200 ? text.substring(0, 200) : text;

    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=en|zh-TW`
    );
    const data = await response.json();

    if (data.responseStatus === 200 && data.responseData.translatedText) {
      let translated = data.responseData.translatedText;
      translated = translated.replace(/MYMEMORY WARNING.*/gi, '').trim();
      if (translated) {
        translationEl.innerHTML = `<span class="text-green-300">${translated}</span>`;
      } else {
        translationEl.innerHTML = '<span class="text-gray-500">—</span>';
      }
    } else {
      translationEl.innerHTML = '<span class="text-gray-500">—</span>';
    }
  } catch (error) {
    console.error('Translation error:', error);
    translationEl.innerHTML = '<span class="text-gray-500">—</span>';
  }

  if (contextEl && currentIndex >= 0) {
    const clip = results[currentIndex];
    contextEl.innerHTML = `
      <span class="text-gray-400">📺 ${clip.video_title}</span>
      <span class="text-gray-500 mx-2">·</span>
      <span class="text-gray-400">${clip.channel}</span>
    `;
  }
}

// ==========================================
// Practice Topics
// ==========================================

const practiceVocabulary = {
  // Connected Speech
  reductions: ['gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'lemme', 'gimme', 'dunno', "ain't", "y'all"],
  linking: ['kind of', 'sort of', 'a lot of', 'out of', 'because of', 'instead of', 'in front of', 'all of'],
  fillers: ['you know', 'I mean', 'like', 'well', 'so', 'um', 'uh', 'basically', 'actually', 'literally'],

  // Expressions
  opinions: ['I think', 'in my opinion', 'honestly', 'to be honest', 'personally', 'if you ask me', 'the thing is'],
  reactions: ['really', 'no way', 'seriously', 'exactly', 'absolutely', 'totally', 'definitely', 'of course'],
  transitions: ['anyway', 'by the way', 'speaking of', 'moving on', 'that reminds me', 'on another note'],

  // Pronunciation
  th_sounds: ['the', 'this', 'that', 'think', 'through', 'though', 'thought', 'thanks', 'thing', 'them'],
  r_sounds: ['really', 'right', 'world', 'girl', 'work', 'word', 'heard', 'learn', 'first', 'every'],
  vowels: ['ship', 'sheep', 'full', 'fool', 'bed', 'bad', 'sit', 'seat', 'pull', 'pool'],

  // Intonation
  questions: ['what do you think', 'how are you', 'where are you going', 'can you help me', 'do you understand'],
  emphasis: ['I really like it', 'that was amazing', 'this is important', 'what a great idea', 'I can not believe']
};

let currentPracticeTopic = null;
let currentPracticeWords = [];
let currentPracticeIndex = 0;

function startPractice(topicName) {
  currentPracticeTopic = topicName;
  currentPracticeWords = practiceVocabulary[topicName] || [];
  currentPracticeIndex = 0;

  if (currentPracticeWords.length > 0) {
    document.getElementById('tabSearch').click();
    practiceNextWord();
  }
}

function practiceNextWord() {
  if (currentPracticeIndex >= currentPracticeWords.length) {
    alert('🎉 Great! You completed this topic!');
    currentPracticeTopic = null;
    updatePracticeModeUI();
    return;
  }

  const word = currentPracticeWords[currentPracticeIndex];
  searchInput.value = word;
  search(word);
  currentPracticeIndex++;

  resultCount.textContent = `Practice: ${currentPracticeIndex}/${currentPracticeWords.length} (Press J for next)`;
  updatePracticeModeUI();
}

function updatePracticeModeUI() {
  const practiceIndicator = document.getElementById('practiceIndicator');
  if (currentPracticeTopic && currentPracticeIndex < currentPracticeWords.length) {
    // Show practice mode indicator
    if (!practiceIndicator) {
      const indicator = document.createElement('div');
      indicator.id = 'practiceIndicator';
      indicator.className = 'fixed bottom-4 right-4 bg-purple-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
      indicator.innerHTML = `
        <div class="text-sm font-medium">📚 Practice Mode</div>
        <div class="text-xs mt-1">Press <kbd class="bg-purple-800 px-1 rounded">J</kbd> for next word</div>
        <div class="text-xs mt-1">${currentPracticeIndex}/${currentPracticeWords.length}</div>
      `;
      document.body.appendChild(indicator);
    } else {
      practiceIndicator.innerHTML = `
        <div class="text-sm font-medium">📚 Practice Mode</div>
        <div class="text-xs mt-1">Press <kbd class="bg-purple-800 px-1 rounded">J</kbd> for next word</div>
        <div class="text-xs mt-1">${currentPracticeIndex}/${currentPracticeWords.length}</div>
      `;
    }
  } else if (practiceIndicator) {
    practiceIndicator.remove();
  }
}

// ==========================================
// Event Listeners
// ==========================================

searchInput.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    search(e.target.value);
  }, 300);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    search(e.target.value);
    searchInput.blur();
  }
  if (e.key === 'Escape') {
    searchInput.blur();
  }
});

document.getElementById('nextBtn').addEventListener('click', nextClip);
document.getElementById('prevBtn').addEventListener('click', prevClip);
document.getElementById('replayBtn').addEventListener('click', replayClip);
document.getElementById('loopBtn').addEventListener('click', toggleLoop);
document.getElementById('autoPlayBtn')?.addEventListener('click', toggleAutoPlay);
updateAutoPlayButton();
document.getElementById('randomBtn').addEventListener('click', playRandomClip);
shadowingModeBtn.addEventListener('click', toggleShadowingMode);

// Shadowing controls
document.getElementById('listenBtn')?.addEventListener('click', startListening);
document.getElementById('echoBtn')?.addEventListener('click', () => {
  if (shadowingPhase === 'review') {
    shadowingPhase = 'idle';
    startListening();
  }
});
document.getElementById('compareBtn')?.addEventListener('click', () => {
  // Play original then echo
  playOriginalClip();
  setTimeout(() => {
    playRecordedEcho();
  }, (clipEndTime - clipStartTime) * 1000 + 500);
});
document.getElementById('playEchoBtn')?.addEventListener('click', playRecordedEcho);
document.getElementById('playOriginalBtn')?.addEventListener('click', playOriginalClip);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (document.activeElement === searchInput) return;

  switch (e.key.toLowerCase()) {
    case 'n':
      nextClip();
      break;
    case 'p':
      prevClip();
      break;
    case 'r':
      replayClip();
      break;
    case 'f':
      if (currentIndex >= 0 && results[currentIndex]) {
        toggleFavorite(results[currentIndex].id);
      }
      break;
    case 's':
      toggleShadowingMode();
      break;
    case ' ':
      e.preventDefault();
      if (player) {
        const state = player.getPlayerState();
        if (state === YT.PlayerState.PLAYING) {
          player.pauseVideo();
        } else {
          player.playVideo();
        }
      }
      break;
    case 'l':
      toggleLoop();
      break;
    case 'd':
      playRandomClip();
      break;
    case 'j':
      // Next practice word (if in practice mode)
      if (currentPracticeTopic) {
        practiceNextWord();
      }
      break;
  }
});

// ==========================================
// Tab Navigation
// ==========================================

function initTabs() {
  const tabSearch = document.getElementById('tabSearch');
  const tabFavorites = document.getElementById('tabFavorites');
  const tabPractice = document.getElementById('tabPractice');
  const searchTab = document.getElementById('searchTab');
  const favoritesTab = document.getElementById('favoritesTab');
  const practiceTab = document.getElementById('practiceTab');

  if (!tabSearch || !tabPractice) return;

  function setActiveTab(activeTab) {
    [tabSearch, tabFavorites, tabPractice].forEach(tab => {
      if (tab) {
        tab.classList.remove('text-blue-400', 'border-b-2', 'border-blue-400');
        tab.classList.add('text-gray-400');
      }
    });
    [searchTab, favoritesTab, practiceTab].forEach(panel => {
      if (panel) panel.classList.add('hidden');
    });

    activeTab.classList.add('text-blue-400', 'border-b-2', 'border-blue-400');
    activeTab.classList.remove('text-gray-400');
  }

  tabSearch.addEventListener('click', () => {
    setActiveTab(tabSearch);
    searchTab.classList.remove('hidden');
  });

  if (tabFavorites) {
    tabFavorites.addEventListener('click', () => {
      setActiveTab(tabFavorites);
      favoritesTab.classList.remove('hidden');
      renderFavorites();
    });
  }

  tabPractice.addEventListener('click', () => {
    setActiveTab(tabPractice);
    practiceTab.classList.remove('hidden');
  });

  // Bind practice topic clicks
  document.querySelectorAll('.practice-topic').forEach(topic => {
    topic.addEventListener('click', () => {
      const topicName = topic.dataset.topic;
      startPractice(topicName);
    });
  });
}

function renderFavorites() {
  const favoritesList = document.getElementById('favoritesList');
  const favCount = document.getElementById('favCount');

  if (!favoritesList) return;

  if (favorites.length === 0) {
    favoritesList.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <p>No favorites yet</p>
        <p class="text-sm mt-2">Press <kbd class="bg-gray-700 px-2 py-1 rounded">F</kbd> to favorite current clip</p>
      </div>
    `;
    if (favCount) favCount.textContent = '0 clips';
    return;
  }

  if (favCount) favCount.textContent = `${favorites.length} clips`;

  favoritesList.innerHTML = favorites.map((f, i) => `
    <div class="fav-list-item p-3 cursor-pointer hover:bg-gray-700 transition" data-fav-index="${i}">
      <p class="text-sm font-medium leading-relaxed text-blue-300">${f.text}</p>
      <div class="mt-2 flex items-center justify-between">
        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span>${f.channel}</span>
          <span>·</span>
          <span>${f.video_title ? f.video_title.substring(0, 30) + '...' : ''}</span>
        </div>
        <button class="remove-fav-btn text-xs text-red-400 hover:text-red-300" data-fav-index="${i}" title="Remove">
          ✕ Remove
        </button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.fav-list-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('remove-fav-btn')) return;
      const index = parseInt(item.dataset.favIndex);
      playFavorite(index);
    });
  });

  document.querySelectorAll('.remove-fav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(btn.dataset.favIndex);
      removeFavorite(index);
    });
  });
}

function playFavorite(index) {
  const fav = favorites[index];
  if (!fav) return;

  results = [fav];
  currentIndex = -1;
  document.getElementById('tabSearch').click();
  playClip(0);
}

function removeFavorite(index) {
  favorites.splice(index, 1);
  saveFavorites();
  updateStatsDisplay();
  renderFavorites();
}

// ==========================================
// Style & Speed Filters
// ==========================================

function initStyleFilter() {
  const filterButtons = document.querySelectorAll('.style-btn');

  filterButtons.forEach(btn => {
    const style = btn.dataset.style;
    if (style === currentStyle) {
      btn.classList.remove('bg-gray-700', 'text-gray-300');
      btn.classList.add('bg-blue-600', 'text-white');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white');
      btn.classList.add('bg-gray-700', 'text-gray-300');
    }
  });

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const newStyle = btn.dataset.style;
      currentStyle = newStyle;
      localStorage.setItem('english-style', newStyle);

      filterButtons.forEach(b => {
        if (b.dataset.style === newStyle) {
          b.classList.remove('bg-gray-700', 'text-gray-300');
          b.classList.add('bg-blue-600', 'text-white');
        } else {
          b.classList.remove('bg-blue-600', 'text-white');
          b.classList.add('bg-gray-700', 'text-gray-300');
        }
      });

      const query = searchInput.value.trim();
      if (query.length >= 1) {
        search(query);
      }
    });
  });
}

function initSpeedControl() {
  const speedButtons = document.querySelectorAll('.speed-btn');

  speedButtons.forEach(btn => {
    const speed = parseFloat(btn.dataset.speed);
    if (speed === playbackSpeed) {
      btn.classList.remove('bg-gray-700');
      btn.classList.add('bg-blue-600', 'text-white');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white');
      btn.classList.add('bg-gray-700');
    }
  });

  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const newSpeed = parseFloat(btn.dataset.speed);
      playbackSpeed = newSpeed;
      localStorage.setItem('english-speed', newSpeed.toString());

      speedButtons.forEach(b => {
        if (parseFloat(b.dataset.speed) === newSpeed) {
          b.classList.remove('bg-gray-700');
          b.classList.add('bg-blue-600', 'text-white');
        } else {
          b.classList.remove('bg-blue-600', 'text-white');
          b.classList.add('bg-gray-700');
        }
      });

      if (player && player.setPlaybackRate) {
        player.setPlaybackRate(newSpeed);
      }
    });
  });
}

// Time offset control for sync correction
function initTimeOffsetControl() {
  const slider = document.getElementById('timeOffsetSlider');
  const valueDisplay = document.getElementById('timeOffsetValue');

  if (!slider || !valueDisplay) return;

  // Set initial value from localStorage
  slider.value = timeOffset;
  valueDisplay.textContent = `${timeOffset >= 0 ? '+' : ''}${timeOffset.toFixed(1)}s`;

  slider.addEventListener('input', () => {
    const newOffset = parseFloat(slider.value);
    timeOffset = newOffset;
    localStorage.setItem('english-time-offset', newOffset.toString());
    valueDisplay.textContent = `${newOffset >= 0 ? '+' : ''}${newOffset.toFixed(1)}s`;
  });
}

// ==========================================
// Stats
// ==========================================

async function loadStats() {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    statsEl.textContent = `${data.videos} videos · ${data.subtitles} subtitles`;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function bindSuggestButtons() {
  document.querySelectorAll('.suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      searchInput.value = btn.textContent;
      search(btn.textContent);
    });
  });
}

function bindHistoryButtons() {
  document.querySelectorAll('.history-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      searchInput.value = btn.textContent;
      search(btn.textContent);
    });
  });
}

// ==========================================
// Anki-Style SRS System
// ==========================================

let ankiReviewQueue = [];
let ankiCurrentIndex = 0;
let ankiShowingAnswer = false;
let ankiSessionStats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };

function speakEnglish(text) {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
}

function startSRSReview() {
  if (typeof ankiSRS === 'undefined') {
    alert('SRS 系統尚未載入，請重新整理頁面');
    return;
  }

  ankiReviewQueue = ankiSRS.getReviewQueue();

  if (ankiReviewQueue.length === 0) {
    alert('🎉 太棒了！今天沒有需要複習的卡片了！');
    return;
  }

  ankiCurrentIndex = 0;
  ankiShowingAnswer = false;
  ankiSessionStats = { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };

  document.getElementById('ankiReviewModal')?.classList.remove('hidden');
  document.getElementById('ankiComplete')?.classList.add('hidden');
  document.getElementById('ankiCardFront')?.classList.remove('hidden');
  document.getElementById('ankiCardBack')?.classList.add('hidden');

  updateAnkiQueueCounts();
  showAnkiCard();
}

function updateAnkiQueueCounts() {
  const remaining = ankiReviewQueue.length - ankiCurrentIndex;

  let newCount = 0, learningCount = 0, reviewCount = 0;
  for (let i = ankiCurrentIndex; i < ankiReviewQueue.length; i++) {
    const card = ankiReviewQueue[i];
    if (card.state === 0) newCount++;
    else if (card.state === 1 || card.state === 3) learningCount++;
    else reviewCount++;
  }

  document.getElementById('ankiNewCount').textContent = newCount;
  document.getElementById('ankiLearningCount').textContent = learningCount;
  document.getElementById('ankiReviewCount').textContent = reviewCount;

  const progress = ankiCurrentIndex / ankiReviewQueue.length * 100;
  document.getElementById('ankiProgressBar').style.width = `${progress}%`;
}

function showAnkiCard() {
  if (ankiCurrentIndex >= ankiReviewQueue.length) {
    showAnkiComplete();
    return;
  }

  const card = ankiReviewQueue[ankiCurrentIndex];
  const wordData = card.data;

  if (!wordData) {
    ankiCurrentIndex++;
    showAnkiCard();
    return;
  }

  ankiShowingAnswer = false;
  document.getElementById('ankiCardFront')?.classList.remove('hidden');
  document.getElementById('ankiCardBack')?.classList.add('hidden');

  document.getElementById('ankiCardEmoji').textContent = wordData.emoji || '❓';
  document.getElementById('ankiCardQuestion').textContent = '這個英文是什麼意思？';

  document.getElementById('ankiCardEmojiBack').textContent = wordData.emoji || '';
  document.getElementById('ankiCardWord').textContent = wordData.en;
  document.getElementById('ankiCardTranslation').textContent = wordData.zh || wordData.en;
  document.getElementById('ankiCardCategory').textContent = wordData.category || '';

  const intervals = ankiSRS.getNextIntervals(card.id || card.word);
  if (intervals) {
    document.getElementById('ankiAgainInterval').textContent = intervals[1] || '1m';
    document.getElementById('ankiHardInterval').textContent = intervals[2] || '6m';
    document.getElementById('ankiGoodInterval').textContent = intervals[3] || '10m';
    document.getElementById('ankiEasyInterval').textContent = intervals[4] || '4d';
  }

  updateAnkiQueueCounts();
}

function showAnkiAnswer() {
  ankiShowingAnswer = true;
  document.getElementById('ankiCardFront')?.classList.add('hidden');
  document.getElementById('ankiCardBack')?.classList.remove('hidden');

  speakEnglish(ankiReviewQueue[ankiCurrentIndex]?.word);
}

function answerAnkiCard(quality) {
  if (!ankiShowingAnswer) return;

  const card = ankiReviewQueue[ankiCurrentIndex];
  ankiSRS.answerCard(card.id || card.word, quality);

  ankiSessionStats.reviewed++;
  if (quality === 1) ankiSessionStats.again++;
  else if (quality === 2) ankiSessionStats.hard++;
  else if (quality === 3) ankiSessionStats.good++;
  else if (quality === 4) ankiSessionStats.easy++;

  if (quality === 1) {
    const updatedCard = ankiSRS.getCard(card.id || card.word);
    ankiReviewQueue.push(updatedCard);
  }

  ankiCurrentIndex++;
  showAnkiCard();
}

function showAnkiComplete() {
  document.getElementById('ankiCardFront')?.classList.add('hidden');
  document.getElementById('ankiCardBack')?.classList.add('hidden');
  document.getElementById('ankiComplete')?.classList.remove('hidden');

  document.getElementById('ankiReviewedToday').textContent = ankiSessionStats.reviewed;

  const stats = ankiSRS.getOverallStats();
  document.getElementById('ankiStatRetention').textContent = `${stats.retention}%`;
  document.getElementById('ankiStatMature').textContent = stats.mature;
  document.getElementById('ankiStatTotal').textContent = stats.total;
}

function closeAnkiReview() {
  document.getElementById('ankiReviewModal')?.classList.add('hidden');
}

function showSRSStats() {
  if (typeof ankiSRS === 'undefined') return;

  const stats = ankiSRS.getOverallStats();
  document.getElementById('srsStatTotal').textContent = stats.total;
  document.getElementById('srsStatMature').textContent = stats.mature;
  document.getElementById('srsStatRetention').textContent = `${stats.retention}%`;
  document.getElementById('srsStatDue').textContent = stats.dueToday + stats.newRemaining;

  const dist = ankiSRS.getIntervalDistribution();
  const maxDist = Math.max(...Object.values(dist), 1);
  document.getElementById('dist1d').style.height = `${dist['1d'] / maxDist * 100}%`;
  document.getElementById('dist1w').style.height = `${dist['1w'] / maxDist * 100}%`;
  document.getElementById('dist1m').style.height = `${dist['1m'] / maxDist * 100}%`;
  document.getElementById('dist3m').style.height = `${dist['3m'] / maxDist * 100}%`;
  document.getElementById('dist6m').style.height = `${dist['6m+'] / maxDist * 100}%`;

  const forecast = ankiSRS.getForecast(7);
  const maxForecast = Math.max(...forecast.map(f => f.due), 1);
  const forecastEl = document.getElementById('srsForecast');
  forecastEl.innerHTML = forecast.map((f, i) => `
    <div class="flex-1 bg-gray-700 rounded relative overflow-hidden">
      <div class="absolute bottom-0 w-full bg-orange-500 transition-all" style="height: ${f.due / maxForecast * 100}%"></div>
      <div class="absolute bottom-1 w-full text-center text-xs">${i === 0 ? '今' : '+' + i}</div>
    </div>
  `).join('');

  document.getElementById('srsStatsModal')?.classList.remove('hidden');
}

function initAnkiReviewModal() {
  document.getElementById('closeAnkiReview')?.addEventListener('click', closeAnkiReview);
  document.getElementById('ankiCloseComplete')?.addEventListener('click', closeAnkiReview);
  document.getElementById('ankiShowAnswer')?.addEventListener('click', showAnkiAnswer);
  document.getElementById('closeSrsStats')?.addEventListener('click', () => {
    document.getElementById('srsStatsModal')?.classList.add('hidden');
  });

  document.querySelectorAll('.anki-rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const quality = parseInt(btn.dataset.quality);
      answerAnkiCard(quality);
    });
  });

  document.addEventListener('keydown', (e) => {
    const modal = document.getElementById('ankiReviewModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if (!ankiShowingAnswer) {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        showAnkiAnswer();
      }
    } else {
      if (e.key === '1') answerAnkiCard(1);
      else if (e.key === '2') answerAnkiCard(2);
      else if (e.key === '3') answerAnkiCard(3);
      else if (e.key === '4') answerAnkiCard(4);
      else if (e.code === 'Space') {
        e.preventDefault();
        speakEnglish(ankiReviewQueue[ankiCurrentIndex]?.word);
      }
    }
  });
}

// ==========================================
// Initialize
// ==========================================

bindSuggestButtons();
loadStats();
updateStatsDisplay();
initTabs();
initStyleFilter();
initSpeedControl();
initTimeOffsetControl();
updateLoopButton();
initAnkiReviewModal();
