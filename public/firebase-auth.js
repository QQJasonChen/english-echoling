// ============ Firebase Authentication & Cloud Sync ============
// Google Login + Firestore Data Sync

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyAiEmeG1Hd6kp8T-lHLj-Yp6_m7G5VlmXg",
  authDomain: "dutch-learning-70fca.firebaseapp.com",
  projectId: "dutch-learning-70fca",
  storageBucket: "dutch-learning-70fca.firebasestorage.app",
  messagingSenderId: "164476250792",
  appId: "1:164476250792:web:f0b9bc816946ea71e6309d",
  measurementId: "G-7TJ7TKVX48"
};

// State
let app = null;
let auth = null;
let db = null;
let currentUser = null;
let syncInProgress = false;

// Initialize Firebase
async function initFirebase() {
  try {
    // Dynamic import for Firebase modules
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
    const { getAuth, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
    const { getFirestore, doc, setDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');

    // Initialize
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // Store references globally for other functions
    window.firebaseAuth = { auth, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged };
    window.firebaseDb = { db, doc, setDoc, getDoc };

    // Listen for auth state changes
    onAuthStateChanged(auth, handleAuthStateChange);

    console.log('Firebase initialized successfully');
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    return false;
  }
}

// Handle auth state changes
async function handleAuthStateChange(user) {
  currentUser = user;
  updateAuthUI();

  if (user) {
    console.log('User signed in:', user.email);
    // Load data from cloud
    await loadFromCloud();
  } else {
    console.log('User signed out');
  }
}

// Update UI based on auth state
function updateAuthUI() {
  const loginBtn = document.getElementById('loginBtn');
  const userInfo = document.getElementById('userInfo');
  const userName = document.getElementById('userName');
  const userAvatar = document.getElementById('userAvatar');
  const syncStatus = document.getElementById('syncStatus');

  if (currentUser) {
    // User is signed in
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.remove('hidden');
    if (userName) userName.textContent = currentUser.displayName || currentUser.email;
    if (userAvatar) {
      userAvatar.src = currentUser.photoURL || '';
      userAvatar.classList.toggle('hidden', !currentUser.photoURL);
    }
    if (syncStatus) syncStatus.textContent = '已同步';
  } else {
    // User is signed out
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (syncStatus) syncStatus.textContent = '本地模式';
  }
}

// Google Sign In
async function googleSignIn() {
  if (!window.firebaseAuth) {
    alert('Firebase 尚未載入，請稍後再試');
    return;
  }

  const { auth, signInWithPopup, GoogleAuthProvider } = window.firebaseAuth;
  const provider = new GoogleAuthProvider();

  try {
    const result = await signInWithPopup(auth, provider);
    console.log('Sign in successful:', result.user.email);
  } catch (error) {
    console.error('Sign in error:', error);
    if (error.code === 'auth/popup-closed-by-user') {
      // User closed popup, no need to show error
    } else {
      alert('登入失敗: ' + error.message);
    }
  }
}

// Sign Out
async function googleSignOut() {
  if (!window.firebaseAuth) return;

  const { auth, signOut } = window.firebaseAuth;

  try {
    await signOut(auth);
    console.log('Sign out successful');
  } catch (error) {
    console.error('Sign out error:', error);
  }
}

// ==========================================
// Cloud Sync Functions
// ==========================================

// Get all learning data from localStorage
function getLocalData() {
  return {
    favorites: JSON.parse(localStorage.getItem('english-favorites') || '[]'),
    stats: JSON.parse(localStorage.getItem('english-stats') || '{}'),
    history: JSON.parse(localStorage.getItem('english-history') || '[]'),
    style: localStorage.getItem('english-style') || 'natural',
    speed: localStorage.getItem('english-speed') || '1',
    loop: localStorage.getItem('english-loop') || 'false',
    autoplay: localStorage.getItem('english-autoplay') || 'false',
    lastSync: new Date().toISOString()
  };
}

// Save data to localStorage
function saveLocalData(data) {
  if (data.favorites) localStorage.setItem('english-favorites', JSON.stringify(data.favorites));
  if (data.stats) localStorage.setItem('english-stats', JSON.stringify(data.stats));
  if (data.history) localStorage.setItem('english-history', JSON.stringify(data.history));
  if (data.style) localStorage.setItem('english-style', data.style);
  if (data.speed) localStorage.setItem('english-speed', data.speed);
  if (data.loop) localStorage.setItem('english-loop', data.loop);
  if (data.autoplay) localStorage.setItem('english-autoplay', data.autoplay);
}

// Save to Cloud (Firestore)
async function saveToCloud() {
  if (!currentUser || !window.firebaseDb || syncInProgress) return;

  syncInProgress = true;
  updateSyncStatus('同步中...');

  try {
    const { db, doc, setDoc } = window.firebaseDb;
    const data = getLocalData();

    await setDoc(doc(db, 'users', currentUser.uid), {
      ...data,
      email: currentUser.email,
      updatedAt: new Date().toISOString()
    });

    console.log('Data saved to cloud');
    updateSyncStatus('已同步');
  } catch (error) {
    console.error('Save to cloud error:', error);
    updateSyncStatus('同步失敗');
  } finally {
    syncInProgress = false;
  }
}

// Load from Cloud (Firestore)
async function loadFromCloud() {
  if (!currentUser || !window.firebaseDb) return;

  updateSyncStatus('載入中...');

  try {
    const { db, doc, getDoc } = window.firebaseDb;
    const docRef = doc(db, 'users', currentUser.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const cloudData = docSnap.data();
      const localData = getLocalData();

      // Merge strategy: use cloud data if newer, otherwise keep local
      // For arrays, merge unique items
      const mergedData = mergeData(localData, cloudData);
      saveLocalData(mergedData);

      // Refresh UI
      if (typeof updateVocab625Progress === 'function') updateVocab625Progress();
      if (typeof updateDailyProgressUI === 'function') updateDailyProgressUI();
      if (typeof updateQuickStats === 'function') updateQuickStats();
      if (typeof renderCategoryGrid === 'function') renderCategoryGrid();

      // Reload learned words into memory
      if (typeof window !== 'undefined') {
        window.learnedWords = mergedData.learnedWords || [];
        window.difficultWords = mergedData.difficultWords || [];
      }

      console.log('Data loaded from cloud');
      updateSyncStatus('已同步');
    } else {
      // No cloud data, save local data to cloud
      console.log('No cloud data found, uploading local data');
      await saveToCloud();
    }
  } catch (error) {
    console.error('Load from cloud error:', error);
    updateSyncStatus('載入失敗');
  }
}

// Merge local and cloud data
function mergeData(local, cloud) {
  // For arrays, combine unique items
  const mergeArrays = (arr1, arr2) => {
    return [...new Set([...(arr1 || []), ...(arr2 || [])])];
  };

  // For objects, merge keys
  const mergeObjects = (obj1, obj2) => {
    return { ...(obj1 || {}), ...(obj2 || {}) };
  };

  return {
    favorites: mergeArrays(local.favorites, cloud.favorites),
    stats: mergeObjects(local.stats, cloud.stats),
    history: mergeArrays(local.history, cloud.history),
    style: cloud.style || local.style || 'natural',
    speed: cloud.speed || local.speed || '1',
    loop: cloud.loop || local.loop || 'false',
    autoplay: cloud.autoplay || local.autoplay || 'false'
  };
}

// Update sync status in UI
function updateSyncStatus(status) {
  const syncStatus = document.getElementById('syncStatus');
  if (syncStatus) {
    syncStatus.textContent = status;
  }
}

// Auto-sync when data changes (debounced)
let syncTimeout = null;
function scheduleSyncToCloud() {
  if (!currentUser) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    saveToCloud();
  }, 3000); // Sync 3 seconds after last change
}

// ==========================================
// Initialize
// ==========================================

// Initialize Firebase when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();

  // Bind login button
  document.getElementById('loginBtn')?.addEventListener('click', googleSignIn);
  document.getElementById('logoutBtn')?.addEventListener('click', googleSignOut);
});

// Hook into localStorage changes to trigger sync
const originalSetItem = localStorage.setItem;
localStorage.setItem = function(key, value) {
  originalSetItem.apply(this, arguments);

  // Only sync English learning data
  if (key.startsWith('english-')) {
    scheduleSyncToCloud();
  }
};

// Export for use in other modules
window.firebaseSync = {
  saveToCloud,
  loadFromCloud,
  googleSignIn,
  googleSignOut,
  get currentUser() { return currentUser; }
};
