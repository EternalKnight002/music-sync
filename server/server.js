const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 8080;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/', (req, res) => {
  res.send('Music Sync Signaling Server is running');
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Room state: { roomId: { host: wsId, clients: Map<wsId, {ws, name}>, trackId, lastPosition, lastServerTs } }
const rooms = new Map();

// Generate unique ID for each connection
let connectionIdCounter = 0;
function generateId() {
  return `conn_${++connectionIdCounter}_${Date.now()}`;
}

// Broadcast to all clients in a room except sender
function broadcastToRoom(roomId, message, excludeWsId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const messageStr = JSON.stringify(message);
  room.clients.forEach((clientInfo, wsId) => {
    if (wsId !== excludeWsId && clientInfo.ws.readyState === WebSocket.OPEN) {
      clientInfo.ws.send(messageStr);
    }
  });
}

// Send to specific client
function sendToClient(roomId, wsId, message) {
  const room = rooms.get(roomId);
  if (!room) return;
  
  const clientInfo = room.clients.get(wsId);
  if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
    clientInfo.ws.send(JSON.stringify(message));
  }
}

// Elect new host if current host disconnects
function electNewHost(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.clients.size === 0) return null;
  
  // Pick first available client as new host
  const newHostId = Array.from(room.clients.keys())[0];
  room.host = newHostId;
  
  console.log(`[Room ${roomId}] New host elected: ${newHostId}`);
  
  // Notify all clients about new host
  broadcastToRoom(roomId, {
    type: 'host_changed',
    hostId: newHostId,
    timestamp: Date.now()
  });
  
  return newHostId;
}

wss.on('connection', (ws) => {
  const wsId = generateId();
  let currentRoom = null;
  
  console.log(`[${wsId}] Client connected`);
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const serverTimestamp = Date.now();
      
      console.log(`[${wsId}] Received:`, message.type, message);
      
      switch (message.type) {
        case 'time_request':
          // Respond with server time for clock synchronization
          ws.send(JSON.stringify({
            type: 'time_response',
            clientTimestamp: message.clientTimestamp,
            serverTimestamp: serverTimestamp
          }));
          break;
          
        case 'join':
          const { roomId, name } = message;
          currentRoom = roomId;
          
          // Create room if doesn't exist
          if (!rooms.has(roomId)) {
            rooms.set(roomId, {
              host: null,
              clients: new Map(),
              trackId: null,
              lastPosition: 0,
              lastServerTs: serverTimestamp
            });
            console.log(`[Room ${roomId}] Created`);
          }
          
          const room = rooms.get(roomId);
          room.clients.set(wsId, { ws, name: name || 'Anonymous' });
          
          // Send joined confirmation
          ws.send(JSON.stringify({
            type: 'joined',
            roomId,
            wsId,
            isHost: room.host === wsId,
            currentHost: room.host,
            trackId: room.trackId,
            timestamp: serverTimestamp
          }));
          
          console.log(`[Room ${roomId}] ${name} joined (${wsId}). Total clients: ${room.clients.size}`);
          
          // Notify others about new client
          broadcastToRoom(roomId, {
            type: 'client_joined',
            wsId,
            name,
            timestamp: serverTimestamp
          }, wsId);
          
          break;
          
        case 'become_host':
          if (!currentRoom) {
            ws.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
            break;
          }
          
          const hostRoom = rooms.get(currentRoom);
          if (hostRoom) {
            hostRoom.host = wsId;
            console.log(`[Room ${currentRoom}] ${wsId} became host`);
            
            // Notify all clients
            broadcastToRoom(currentRoom, {
              type: 'host_changed',
              hostId: wsId,
              timestamp: serverTimestamp
            });
          }
          break;
          
        case 'load':
          // Host is loading a new track
          if (!currentRoom) break;
          
          const loadRoom = rooms.get(currentRoom);
          if (loadRoom && loadRoom.host === wsId) {
            loadRoom.trackId = message.trackId;
            loadRoom.lastPosition = 0;
            loadRoom.lastServerTs = serverTimestamp;
            
            console.log(`[Room ${currentRoom}] Host loading track: ${message.trackId}`);
            
            // Broadcast load command to all clients
            broadcastToRoom(currentRoom, {
              type: 'load',
              trackId: message.trackId,
              fileUrl: message.fileUrl,
              timestamp: serverTimestamp
            }, wsId);
          }
          break;
          
        case 'ready':
          // Client is ready (file loaded)
          if (!currentRoom) break;
          
          console.log(`[Room ${currentRoom}] ${wsId} is ready`);
          
          // Notify others
          broadcastToRoom(currentRoom, {
            type: 'client_ready',
            wsId,
            timestamp: serverTimestamp
          }, wsId);
          break;
          
        case 'play':
          // Host initiates playback
          if (!currentRoom) break;
          
          const playRoom = rooms.get(currentRoom);
          if (playRoom && playRoom.host === wsId) {
            const playAtTimestamp = serverTimestamp + (message.leadTime || 100);
            playRoom.lastPosition = message.position || 0;
            playRoom.lastServerTs = playAtTimestamp;
            
            console.log(`[Room ${currentRoom}] Play at ${playAtTimestamp} from position ${playRoom.lastPosition}`);
            
            // Broadcast play command with server timestamp
            broadcastToRoom(currentRoom, {
              type: 'play',
              position: playRoom.lastPosition,
              playAt: playAtTimestamp,
              timestamp: serverTimestamp
            });
          }
          break;
          
        case 'pause':
          // Host pauses playback
          if (!currentRoom) break;
          
          const pauseRoom = rooms.get(currentRoom);
          if (pauseRoom && pauseRoom.host === wsId) {
            pauseRoom.lastPosition = message.position || 0;
            pauseRoom.lastServerTs = serverTimestamp;
            
            console.log(`[Room ${currentRoom}] Pause at position ${pauseRoom.lastPosition}`);
            
            broadcastToRoom(currentRoom, {
              type: 'pause',
              position: pauseRoom.lastPosition,
              timestamp: serverTimestamp
            });
          }
          break;
          
        case 'seek':
          // Host seeks to new position
          if (!currentRoom) break;
          
          const seekRoom = rooms.get(currentRoom);
          if (seekRoom && seekRoom.host === wsId) {
            seekRoom.lastPosition = message.position;
            seekRoom.lastServerTs = serverTimestamp;
            
            console.log(`[Room ${currentRoom}] Seek to ${message.position}`);
            
            broadcastToRoom(currentRoom, {
              type: 'seek',
              position: message.position,
              timestamp: serverTimestamp
            });
          }
          break;
          
        case 'force_sync':
          // Host forces resynchronization
          if (!currentRoom) break;
          
          const syncRoom = rooms.get(currentRoom);
          if (syncRoom && syncRoom.host === wsId) {
            const syncAtTimestamp = serverTimestamp + (message.leadTime || 100);
            syncRoom.lastPosition = message.position;
            syncRoom.lastServerTs = syncAtTimestamp;
            
            console.log(`[Room ${currentRoom}] Force sync at ${syncAtTimestamp} to position ${message.position}`);
            
            broadcastToRoom(currentRoom, {
              type: 'force_sync',
              position: message.position,
              syncAt: syncAtTimestamp,
              timestamp: serverTimestamp
            });
          }
          break;
          
        default:
          console.log(`[${wsId}] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`[${wsId}] Error processing message:`, err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });
  
  ws.on('close', () => {
    console.log(`[${wsId}] Client disconnected`);
    
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.clients.delete(wsId);
        
        // If disconnected client was host, elect new one
        if (room.host === wsId && room.clients.size > 0) {
          electNewHost(currentRoom);
        }
        
        // Notify others about disconnection
        broadcastToRoom(currentRoom, {
          type: 'client_left',
          wsId,
          timestamp: Date.now()
        });
        
        // Clean up empty rooms
        if (room.clients.size === 0) {
          rooms.delete(currentRoom);
          console.log(`[Room ${currentRoom}] Deleted (empty)`);
        } else {
          console.log(`[Room ${currentRoom}] Client left. Remaining: ${room.clients.size}`);
        }
      }
    }
  });
  
  ws.on('error', (err) => {
    console.error(`[${wsId}] WebSocket error:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`Music Sync Server running on port ${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
