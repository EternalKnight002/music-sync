# Music Sync - Synchronized Audio Playback

A real-time synchronized audio playback system that allows multiple clients to play audio files in perfect sync over a network. One device acts as the host (serving the audio file), while others stream and synchronize playback using WebRTC-style time synchronization.

## Features

- **Perfect Synchronization**: Uses NTP-style clock synchronization to keep all clients within ~50ms
- **Host/Client Architecture**: One device hosts the audio file, others stream it
- **Adaptive Playback**: Automatically adjusts playback rate to maintain sync
- **LAN & Internet Support**: Works on local networks or over the internet with tunneling
- **Easy Deployment**: Signaling server deploys to Railway in minutes

## Quick Start

### 1. Clone and Install

```bash
git clone <your-repo>
cd music-sync

# Install server dependencies
cd server
npm install
cd ..

# Install Electron app dependencies
cd electron-app
npm install
cd ..
```

### 2. Start the Signaling Server (Locally)

```bash
cd server
npm start
```

Server runs on `http://localhost:8080` (WebSocket on `ws://localhost:8080`)

### 3. Start the Host Application

```bash
cd electron-app
npm run dev
```

In the Electron app:
1. Enter signaling server URL: `ws://localhost:8080`
2. Enter room ID: `myroom`
3. Enter your name: `Host`
4. Click "Connect"
5. Click "Select Audio File" and choose an MP3/WAV file
6. Click "Start Serving File" - note the URL displayed
7. Click "Become Host" to register as room host
8. Click "Ready" when file is loaded

### 4. Start Client Applications

Open another instance of the app (or run on another computer):

1. Connect with same room ID
2. Paste the host's file URL when prompted
3. Click "Ready" when loaded
4. Wait for host to press "Play"

### 5. Control Playback

From the host:
- **Play**: Start synchronized playback
- **Pause**: Pause all clients
- **Seek**: Jump to a specific time
- **Force Sync**: Manually resynchronize all clients

## Architecture

### Components

1. **Signaling Server** (`/server`): WebSocket server handling room management, message relay, and time authority
2. **Electron App** (`/electron-app`): Cross-platform desktop app that can be host or client
3. **File Server**: Embedded HTTP server in host app for streaming audio with range request support

### How It Works

1. **Clock Sync**: Each client performs NTP-style time synchronization with the server (5 samples, median offset)
2. **Time Authority**: Server timestamps all play/pause/seek commands
3. **Scheduled Playback**: Clients convert server timestamps to local time and schedule playback
4. **Drift Correction**: Continuous monitoring and micro-adjustments to playback rate maintain sync
5. **Force Sync**: Manual resync broadcasts current position and corrects any accumulated drift

## Environment Variables

### Server (.env)

```
PORT=8080
NODE_ENV=production
```

### Electron App (.env)

```
DEFAULT_WS_URL=ws://localhost:8080
DEFAULT_ROOM_ID=myroom
```

## Deployment to Railway

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed Railway deployment instructions.

Quick version:
```bash
cd server
# Push to GitHub, then connect Railway to your repo
# Or use Railway CLI:
railway login
railway init
railway up
```

Set environment variable `PORT` (Railway provides this automatically).

## Development

### Server Development

```bash
cd server
npm install
npm start  # or: node server.js
```

### Electron App Development

```bash
cd electron-app
npm install
npm run dev  # Development mode with hot reload
```

### Building Electron App

```bash
npm run build  # Creates distributable in /dist
```

Builds for your current platform. For cross-platform builds, see `package.json` scripts.

## Testing

See [TESTING.md](TESTING.md) for comprehensive testing guide.

Quick LAN test:
1. Start server on one machine
2. Find host machine's LAN IP: `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
3. Start host app, select file, note the serving URL
4. Start client app on another device, use `ws://<host-ip>:8080` for signaling
5. Press Play from host and observe sync

## Troubleshooting

### Common Issues

**Audio won't play (browser shows policy error)**
- Some browsers block autoplay. Click in the window first, then press Play.

**Client can't connect to host file server**
- Check firewall allows connections on port 3000
- Verify you're using the correct LAN IP (not 127.0.0.1)
- Windows: Run `netsh advfirewall firewall add rule name="Music Sync" dir=in action=allow protocol=TCP localport=3000`

**Sync drifts over time**
- Normal drift is <50ms. If larger, check network stability
- Use "Force Sync" to manually resynchronize
- High CPU load on client can cause audio stutter

**Host disconnected error**
- Host app must stay running for clients to stream
- If host closes, another client can click "Become Host" (after selecting a file)

**Railway deployment issues**
- Ensure `PORT` environment variable is set (Railway auto-provides this)
- Check logs: `railway logs`
- Server only handles signaling—audio files must be served from host device

### Getting LAN IP Address

- **Windows**: `ipconfig` → look for IPv4 Address (192.168.x.x or 10.x.x.x)
- **macOS**: `ifconfig | grep inet` → look for en0 or en1
- **Linux**: `ip addr show` → look for inet on your network interface

## Performance & Tuning

Default parameters provide good balance:
- **Clock Sync Samples**: 5 (takes ~500ms to sync)
- **Lead Time**: RTT + 50ms buffer
- **Drift Threshold**: 50ms (triggers correction)
- **Jump Threshold**: 500ms (triggers immediate seek)
- **Playback Rate Adjustment**: 2% max, for 2 seconds

See [TESTING.md](TESTING.md) for tuning guide.

## Security & Legal

⚠️ **Copyright Notice**: This tool is for personal use with content you own or have permission to share. DO NOT use this to distribute copyrighted material without authorization.

### Security Considerations

- Audio files are served over HTTP (not HTTPS) for simplicity
- No authentication on signaling server or file server
- Recommended for trusted networks only
- For production use, add:
  - HTTPS/WSS with proper certificates
  - Token-based authentication
  - Signed URLs with expiration
  - Rate limiting

## Extending the App

### Future Enhancements (marked in code)

- **S3 Upload Support**: Look for `// TODO: Add S3 upload` in `fileServer.js`
- **Admin UI**: Server has `// TODO: Add admin endpoint` markers
- **Playlist Support**: Extend protocol with `playlist` message type
- **Voice Chat**: Add WebRTC peer connections for audio chat

### Protocol Extension

See [protocol.md](protocol.md) for message format specification. Add new message types by:
1. Adding handler in `server.js`
2. Adding sender in `app.js` (renderer)
3. Updating protocol documentation

## License

GNU General Public License v3.0 - See LICENSE file

## Support

For issues, questions, or contributions, please open an issue on GitHub.

## Acknowledgments

- Clock synchronization algorithm inspired by NTP (Network Time Protocol)
- Electron framework by OpenJS Foundation
- WebSocket library by ws

---

**Version**: 1.0.0  
**Node Version**: 18+  
**Electron Version**: 26+
