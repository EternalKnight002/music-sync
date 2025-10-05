// ========== Configuration ==========
const CONFIG = {
  CLOCK_SYNC_SAMPLES: 10,
  CLOCK_SYNC_INTERVAL: 200,
  LEAD_TIME_BUFFER: 600,
  DRIFT_THRESHOLD: 100,
  JUMP_THRESHOLD: 1000,
  MAX_PLAYBACK_RATE: 1.02,
  MIN_PLAYBACK_RATE: 0.98,
  CORRECTION_DURATION: 2000,
  RESYNC_INTERVAL: 5000,
  RTT_SMOOTHING_FACTOR: 0.3
};

// ========== State Management ==========
const state = {
  ws: null,
  connected: false,
  isHost: false,
  roomId: null,
  wsId: null,
  selectedFile: null,
  serverUrl: null,
  
  // Clock sync
  clockOffset: 0,
  rtt: 0,
  syncSamples: [],
  
  // Playback sync
  isPlaying: false,
  lastSyncTime: 0,
  lastSyncPosition: 0,
  correctionTimeout: null,
  resyncInterval: null
};

// ========== DOM Elements ==========
const elements = {
  wsUrl: document.getElementById('wsUrl'),
  roomId: document.getElementById('roomId'),
  peerName: document.getElementById('peerName'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  connectionStatus: document.getElementById('connectionStatus'),
  
  selectFileBtn: document.getElementById('selectFileBtn'),
  fileInfo: document.getElementById('fileInfo'),
  startServerBtn: document.getElementById('startServerBtn'),
  serverInfo: document.getElementById('serverInfo'),
  becomeHostBtn: document.getElementById('becomeHostBtn'),
  hostStatus: document.getElementById('hostStatus'),
  
  fileUrl: document.getElementById('fileUrl'),
  loadFileBtn: document.getElementById('loadFileBtn'),
  readyBtn: document.getElementById('readyBtn'),
  loadStatus: document.getElementById('loadStatus'),
  
  playBtn: document.getElementById('playBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  seekInput: document.getElementById('seekInput'),
  seekBtn: document.getElementById('seekBtn'),
  forceSyncBtn: document.getElementById('forceSyncBtn'),
  audioPlayer: document.getElementById('audioPlayer'),
  progressBar: document.getElementById('progressBar'),
  timeDisplay: document.getElementById('timeDisplay'),
  
  clockOffset: document.getElementById('clockOffset'),
  rtt: document.getElementById('rtt'),
  currentDrift: document.getElementById('currentDrift'),
  playbackRate: document.getElementById('playbackRate'),
  syncQuality: document.getElementById('syncQuality'),
  
  logContainer: document.getElementById('logContainer'),
  clearLogsBtn: document.getElementById('clearLogsBtn')
};

// ========== Logging ==========
function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span>${message}`;
  elements.logContainer.appendChild(entry);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
  console.log(`[${type.toUpperCase()}] ${message}`);
}

elements.clearLogsBtn.addEventListener('click', () => {
  elements.logContainer.innerHTML = '';
});

// ========== Clock Synchronization ==========
async function performClockSync() {
  log('Starting clock synchronization...', 'info');
  state.syncSamples = [];
  
  for (let i = 0; i < CONFIG.CLOCK_SYNC_SAMPLES; i++) {
    await new Promise(resolve => setTimeout(resolve, CONFIG.CLOCK_SYNC_INTERVAL));
    
    const t0 = Date.now();
    
    state.ws.send(JSON.stringify({
      type: 'time_request',
      clientTimestamp: t0
    }));
    
    await new Promise(resolve => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'time_response' && msg.clientTimestamp === t0) {
          const t3 = Date.now();
          const t1 = msg.serverTimestamp;
          
          const rtt = t3 - t0;
          const offset = t1 - (t0 + rtt / 2);
          
          state.syncSamples.push({ offset, rtt });
          state.ws.removeEventListener('message', handler);
          resolve();
        }
      };
      state.ws.addEventListener('message', handler);
    });
  }
  
  const sortedOffsets = state.syncSamples.map(s => s.offset).sort((a, b) => a - b);
  const medianOffset = sortedOffsets[Math.floor(sortedOffsets.length / 2)];
  
  const avgRtt = state.syncSamples.reduce((sum, s) => sum + s.rtt, 0) / state.syncSamples.length;
  state.rtt = state.rtt === 0 ? avgRtt : (state.rtt * (1 - CONFIG.RTT_SMOOTHING_FACTOR) + avgRtt * CONFIG.RTT_SMOOTHING_FACTOR);
  
  state.clockOffset = medianOffset;
  
  updateSyncDisplay();
  log(`Clock sync complete: offset=${medianOffset.toFixed(1)}ms, RTT=${state.rtt.toFixed(1)}ms`, 'success');
}

function serverTimeNow() {
  return Date.now() - state.clockOffset;
}

// ========== Sync Display ==========
function updateSyncDisplay() {
  elements.clockOffset.textContent = `${state.clockOffset.toFixed(1)} ms`;
  elements.rtt.textContent = `${state.rtt.toFixed(1)} ms`;
  elements.playbackRate.textContent = `${elements.audioPlayer.playbackRate.toFixed(2)}x`;
  
  const absDrift = Math.abs(parseFloat(elements.currentDrift.textContent) || 0);
  let quality, className;
  
  if (absDrift < 20) {
    quality = 'Excellent';
    className = 'badge-excellent';
  } else if (absDrift < 50) {
    quality = 'Good';
    className = 'badge-good';
  } else if (absDrift < 100) {
    quality = 'Fair';
    className = 'badge-fair';
  } else {
    quality = 'Poor';
    className = 'badge-poor';
  }
  
  elements.syncQuality.textContent = quality;
  elements.syncQuality.className = `value badge ${className}`;
}

// ========== Playback Sync Logic (Simplified Fixed-Delay Approach) ==========
function schedulePlay(position) {
  const SYNC_DELAY = 1000; // Fixed 1 second delay for all clients
  
  log(`Scheduling play at position ${position.toFixed(2)}s in ${SYNC_DELAY}ms`, 'info');
  
  // Set position immediately
  elements.audioPlayer.currentTime = position;
  
  // Schedule playback after fixed delay
  setTimeout(() => {
    elements.audioPlayer.play().catch(err => log(`Play error: ${err.message}`, 'error'));
    state.isPlaying = true;
    state.lastSyncTime = Date.now();
    state.lastSyncPosition = position;
    startDriftMonitoring();
    log('Playback started', 'success');
  }, SYNC_DELAY);
}

function startDriftMonitoring() {
  stopDriftMonitoring();
  
  state.resyncInterval = setInterval(() => {
    if (!state.isPlaying || state.isHost) {
      checkDrift();
    }
  }, CONFIG.RESYNC_INTERVAL);
}

function stopDriftMonitoring() {
  if (state.resyncInterval) {
    clearInterval(state.resyncInterval);
    state.resyncInterval = null;
  }
  if (state.correctionTimeout) {
    clearTimeout(state.correctionTimeout);
    state.correctionTimeout = null;
  }
}

function checkDrift() {
  if (!state.isPlaying) return;
  
  const timeSinceLastSync = (Date.now() - state.lastSyncTime) / 1000;
  const expectedPosition = state.lastSyncPosition + timeSinceLastSync;
  
  const actualPosition = elements.audioPlayer.currentTime;
  const drift = (actualPosition - expectedPosition) * 1000;
  
  elements.currentDrift.textContent = `${drift.toFixed(1)} ms`;
  updateSyncDisplay();
  
  if (Math.abs(drift) > CONFIG.JUMP_THRESHOLD) {
    log(`Large drift detected (${drift.toFixed(0)}ms), seeking to correct position`, 'warning');
    elements.audioPlayer.currentTime = expectedPosition;
    state.lastSyncPosition = expectedPosition;
    state.lastSyncTime = Date.now();
  } else if (Math.abs(drift) > CONFIG.DRIFT_THRESHOLD) {
    correctPlaybackRate(drift);
  }
}

function correctPlaybackRate(driftMs) {
  if (state.correctionTimeout) {
    clearTimeout(state.correctionTimeout);
  }
  
  const correctionFactor = -driftMs / CONFIG.CORRECTION_DURATION;
  let newRate = 1.0 + (correctionFactor / 1000);
  
  newRate = Math.max(CONFIG.MIN_PLAYBACK_RATE, Math.min(CONFIG.MAX_PLAYBACK_RATE, newRate));
  
  log(`Applying playback rate correction: ${newRate.toFixed(3)}x for ${CONFIG.CORRECTION_DURATION}ms`, 'info');
  elements.audioPlayer.playbackRate = newRate;
  
  state.correctionTimeout = setTimeout(() => {
    elements.audioPlayer.playbackRate = 1.0;
    log('Playback rate returned to normal', 'info');
    updateSyncDisplay();
  }, CONFIG.CORRECTION_DURATION);
  
  updateSyncDisplay();
}

// ========== WebSocket Connection ==========
elements.connectBtn.addEventListener('click', async () => {
  const wsUrl = elements.wsUrl.value.trim();
  const roomId = elements.roomId.value.trim();
  const name = elements.peerName.value.trim() || 'Anonymous';
  
  if (!wsUrl || !roomId) {
    log('Please enter WebSocket URL and Room ID', 'error');
    return;
  }
  
  try {
    state.ws = new WebSocket(wsUrl);
    
    state.ws.onopen = async () => {
      log('Connected to signaling server', 'success');
      elements.connectionStatus.textContent = 'Connected';
      elements.connectionStatus.style.background = '#d4edda';
      elements.connectionStatus.style.color = '#155724';
      
      elements.connectBtn.style.display = 'none';
      elements.disconnectBtn.style.display = 'inline-block';
      
      await performClockSync();
      
      state.roomId = roomId;
      state.ws.send(JSON.stringify({
        type: 'join',
        roomId: roomId,
        name: name
      }));
      
      elements.becomeHostBtn.disabled = false;
      elements.selectFileBtn.disabled = false;
      elements.loadFileBtn.disabled = false;
    };
    
    state.ws.onmessage = handleWebSocketMessage;
    
    state.ws.onerror = (error) => {
      log(`WebSocket error: ${error.message || 'Unknown error'}`, 'error');
    };
    
    state.ws.onclose = () => {
      log('Disconnected from signaling server', 'warning');
      elements.connectionStatus.textContent = 'Disconnected';
      elements.connectionStatus.style.background = '#f8d7da';
      elements.connectionStatus.style.color = '#721c24';
      
      elements.connectBtn.style.display = 'inline-block';
      elements.disconnectBtn.style.display = 'none';
      
      state.connected = false;
      state.isHost = false;
      stopDriftMonitoring();
    };
    
  } catch (err) {
    log(`Connection failed: ${err.message}`, 'error');
  }
});

elements.disconnectBtn.addEventListener('click', () => {
  if (state.ws) {
    state.ws.close();
  }
});

function handleWebSocketMessage(event) {
  try {
    const message = JSON.parse(event.data);
    
    switch (message.type) {
      case 'joined':
        state.wsId = message.wsId;
        state.isHost = message.isHost;
        log(`Joined room: ${message.roomId} (ID: ${message.wsId})`, 'success');
        
        if (state.isHost) {
          elements.hostStatus.textContent = 'You are the host';
          elements.hostStatus.style.background = '#d4edda';
          elements.hostStatus.style.color = '#155724';
        }
        break;
        
      case 'host_changed':
        state.isHost = (message.hostId === state.wsId);
        log(`Host changed: ${message.hostId}`, 'info');
        
        if (state.isHost) {
          elements.hostStatus.textContent = 'You are the host';
          elements.hostStatus.style.background = '#d4edda';
          elements.hostStatus.style.color = '#155724';
          
          elements.playBtn.disabled = false;
          elements.pauseBtn.disabled = false;
          elements.seekBtn.disabled = false;
          elements.forceSyncBtn.disabled = false;
        } else {
          elements.hostStatus.textContent = `Host: ${message.hostId}`;
          elements.hostStatus.style.background = '#d1ecf1';
          elements.hostStatus.style.color = '#0c5460';
          
          elements.playBtn.disabled = true;
          elements.pauseBtn.disabled = true;
          elements.seekBtn.disabled = true;
          elements.forceSyncBtn.disabled = true;
        }
        break;
        
      case 'load':
        log(`Loading track: ${message.trackId}`, 'info');
        elements.fileUrl.value = message.fileUrl;
        loadAudioFile(message.fileUrl);
        break;
        
      case 'play':
        log(`Received play command at position ${message.position}`, 'info');
        schedulePlay(message.position);
        break;
        
      case 'pause':
        log(`Received pause command at position ${message.position}`, 'info');
        elements.audioPlayer.pause();
        state.isPlaying = false;
        stopDriftMonitoring();
        break;
        
      case 'seek':
        log(`Received seek command to position ${message.position}`, 'info');
        elements.audioPlayer.currentTime = message.position;
        break;
        
      case 'force_sync':
        log(`Received force sync command`, 'warning');
        schedulePlay(message.position);
        break;
        
      case 'client_joined':
        log(`Client joined: ${message.name}`, 'info');
        break;
        
      case 'client_left':
        log(`Client left: ${message.wsId}`, 'info');
        break;
        
      case 'client_ready':
        log(`Client ready: ${message.wsId}`, 'success');
        break;
        
      case 'error':
        log(`Server error: ${message.message}`, 'error');
        break;
    }
  } catch (err) {
    log(`Error processing message: ${err.message}`, 'error');
  }
}

// ========== Host File Selection ==========
elements.selectFileBtn.addEventListener('click', async () => {
  try {
    const fileInfo = await window.electronAPI.selectFile();
    
    if (fileInfo) {
      state.selectedFile = fileInfo;
      elements.fileInfo.textContent = `Selected: ${fileInfo.name} (Checksum: ${fileInfo.checksum.substring(0, 8)}...)`;
      elements.fileInfo.style.display = 'block';
      elements.startServerBtn.disabled = false;
      log(`File selected: ${fileInfo.name}`, 'success');
    }
  } catch (err) {
    log(`File selection error: ${err.message}`, 'error');
  }
});

elements.startServerBtn.addEventListener('click', async () => {
  if (!state.selectedFile) {
    log('No file selected', 'error');
    return;
  }
  
  try {
    const result = await window.electronAPI.startFileServer(state.selectedFile.path);
    
    if (result.success) {
      state.serverUrl = result.url;
      elements.serverInfo.textContent = `Serving at: ${result.url}`;
      elements.serverInfo.style.display = 'block';
      elements.fileUrl.value = result.url;
      log(`File server started: ${result.url}`, 'success');
      log('Share this URL with clients to connect', 'info');
      
      elements.startServerBtn.disabled = true;
    } else {
      log(`Failed to start server: ${result.error}`, 'error');
    }
  } catch (err) {
    log(`Server start error: ${err.message}`, 'error');
  }
});

elements.becomeHostBtn.addEventListener('click', () => {
  if (!state.ws || !state.roomId) {
    log('Not connected to a room', 'error');
    return;
  }
  
  state.ws.send(JSON.stringify({
    type: 'become_host',
    roomId: state.roomId
  }));
  
  log('Requesting to become host...', 'info');
});

// ========== Client File Loading ==========
elements.loadFileBtn.addEventListener('click', () => {
  const fileUrl = elements.fileUrl.value.trim();
  
  if (!fileUrl) {
    log('Please enter audio file URL', 'error');
    return;
  }
  
  loadAudioFile(fileUrl);
});

function loadAudioFile(url) {
  log(`Loading audio from: ${url}`, 'info');
  elements.loadStatus.textContent = 'Loading...';
  elements.loadStatus.style.background = '#fff3cd';
  elements.loadStatus.style.color = '#856404';
  
  elements.audioPlayer.src = url;
  elements.audioPlayer.load();
}

elements.audioPlayer.addEventListener('canplay', () => {
  log('Audio file loaded and ready', 'success');
  elements.loadStatus.textContent = 'Loaded - Click Ready';
  elements.loadStatus.style.background = '#d4edda';
  elements.loadStatus.style.color = '#155724';
  elements.readyBtn.disabled = false;
});

elements.audioPlayer.addEventListener('error', (e) => {
  const error = elements.audioPlayer.error;
  let errorMsg = 'Unknown error';
  
  if (error) {
    switch (error.code) {
      case error.MEDIA_ERR_ABORTED:
        errorMsg = 'Loading aborted';
        break;
      case error.MEDIA_ERR_NETWORK:
        errorMsg = 'Network error - check host is reachable';
        break;
      case error.MEDIA_ERR_DECODE:
        errorMsg = 'Decode error - unsupported format';
        break;
      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        errorMsg = 'File not supported or not found';
        break;
    }
  }
  
  log(`Audio load error: ${errorMsg}`, 'error');
  elements.loadStatus.textContent = `Error: ${errorMsg}`;
  elements.loadStatus.style.background = '#f8d7da';
  elements.loadStatus.style.color = '#721c24';
});

elements.readyBtn.addEventListener('click', () => {
  if (!state.ws || !state.roomId) {
    log('Not connected to a room', 'error');
    return;
  }
  
  state.ws.send(JSON.stringify({
    type: 'ready',
    roomId: state.roomId
  }));
  
  log('Sent ready signal', 'success');
  elements.readyBtn.disabled = true;
  
  if (state.isHost) {
    elements.playBtn.disabled = false;
    elements.pauseBtn.disabled = false;
    elements.seekBtn.disabled = false;
    elements.forceSyncBtn.disabled = false;
    
    if (state.serverUrl && state.selectedFile) {
      state.ws.send(JSON.stringify({
        type: 'load',
        roomId: state.roomId,
        trackId: state.selectedFile.checksum,
        fileUrl: state.serverUrl
      }));
    }
  }
});

// ========== Playback Controls ==========
elements.playBtn.addEventListener('click', () => {
  if (!state.isHost) {
    log('Only host can control playback', 'error');
    return;
  }
  
  const position = elements.audioPlayer.currentTime;
  
  state.ws.send(JSON.stringify({
    type: 'play',
    roomId: state.roomId,
    position: position,
    leadTime: 1000
  }));
  
  log(`Sending play command (position: ${position.toFixed(2)}s, lead: 1000ms)`, 'info');
  
  // Host also schedules own playback
  schedulePlay(position);
});

elements.pauseBtn.addEventListener('click', () => {
  if (!state.isHost) {
    log('Only host can control playback', 'error');
    return;
  }
  
  const position = elements.audioPlayer.currentTime;
  
  state.ws.send(JSON.stringify({
    type: 'pause',
    roomId: state.roomId,
    position: position
  }));
  
  // Pause own playback
  elements.audioPlayer.pause();
  state.isPlaying = false;
  stopDriftMonitoring();
  
  log(`Sending pause command at position ${position.toFixed(2)}s`, 'info');
});

elements.seekBtn.addEventListener('click', () => {
  if (!state.isHost) {
    log('Only host can control playback', 'error');
    return;
  }
  
  const position = parseFloat(elements.seekInput.value);
  
  if (isNaN(position) || position < 0) {
    log('Invalid seek position', 'error');
    return;
  }
  
  state.ws.send(JSON.stringify({
    type: 'seek',
    roomId: state.roomId,
    position: position
  }));
  
  // Seek own playback
  elements.audioPlayer.currentTime = position;
  
  log(`Sending seek command to ${position.toFixed(2)}s`, 'info');
});

elements.forceSyncBtn.addEventListener('click', () => {
  if (!state.isHost) {
    log('Only host can force sync', 'error');
    return;
  }
  
  const position = elements.audioPlayer.currentTime;
  
  // Pause everyone first
  state.ws.send(JSON.stringify({
    type: 'pause',
    roomId: state.roomId,
    position: position
  }));
  
  elements.audioPlayer.pause();
  state.isPlaying = false;
  stopDriftMonitoring();
  
  // Schedule synchronized restart
  setTimeout(() => {
    state.ws.send(JSON.stringify({
      type: 'play',
      roomId: state.roomId,
      position: position,
      leadTime: 1000
    }));
    
    schedulePlay(position);
  }, 100);
  
  log(`Force sync at position ${position.toFixed(2)}s`, 'warning');
});

// ========== Progress Display ==========
elements.audioPlayer.addEventListener('timeupdate', () => {
  const current = elements.audioPlayer.currentTime;
  const duration = elements.audioPlayer.duration;
  
  if (!isNaN(duration)) {
    const progress = (current / duration) * 100;
    elements.progressBar.style.setProperty('--progress', `${progress}%`);
    
    const currentMin = Math.floor(current / 60);
    const currentSec = Math.floor(current % 60);
    const durationMin = Math.floor(duration / 60);
    const durationSec = Math.floor(duration % 60);
    
    elements.timeDisplay.textContent = 
      `${currentMin}:${currentSec.toString().padStart(2, '0')} / ${durationMin}:${durationSec.toString().padStart(2, '0')}`;
  }
});

// ========== Initialization ==========
log('Music Sync initialized', 'success');
log('Connect to a signaling server to begin', 'info');