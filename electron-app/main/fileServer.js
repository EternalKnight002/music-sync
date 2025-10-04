const express = require('express');
const fs = require('fs');
const path = require('path');

let server = null;
let currentFilePath = null;

/**
 * Start HTTP server to serve audio file with range request support
 * @param {string} filePath - Full path to audio file
 * @param {number} port - Port to listen on
 */
function startFileServer(filePath, port = 3000) {
  return new Promise((resolve, reject) => {
    // Stop existing server if running
    if (server) {
      stopFileServer();
    }

    currentFilePath = filePath;
    const app = express();

    // Enable CORS for all origins (needed for cross-origin audio requests)
    app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', file: path.basename(currentFilePath) });
    });

    // Serve the audio file with range request support
    app.get('/audio', (req, res) => {
      if (!currentFilePath || !fs.existsSync(currentFilePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const stat = fs.statSync(currentFilePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        // Parse range header (e.g., "bytes=0-1023")
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).send('Requested range not satisfiable');
          return;
        }

        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(currentFilePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/mpeg'
        });

        fileStream.pipe(res);
      } else {
        // No range request, send entire file
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': 'audio/mpeg',
          'Accept-Ranges': 'bytes'
        });

        fs.createReadStream(currentFilePath).pipe(res);
      }
    });

    // TODO: Add S3 upload endpoint here
    // app.post('/upload', async (req, res) => {
    //   // Handle multipart upload
    //   // Upload to S3 with signed URL
    //   // Return S3 URL to client
    // });

    server = app.listen(port, '0.0.0.0', (err) => {
      if (err) {
        reject(err);
      } else {
        console.log(`File server started on port ${port}`);
        resolve();
      }
    });

    server.on('error', (err) => {
      console.error('File server error:', err);
      reject(err);
    });
  });
}

/**
 * Stop the file server
 */
function stopFileServer() {
  if (server) {
    server.close(() => {
      console.log('File server stopped');
    });
    server = null;
    currentFilePath = null;
  }
}

/**
 * Get the full server URL
 * @param {string} ip - IP address
 * @param {number} port - Port number
 * @returns {string} Full URL
 */
function getServerUrl(ip, port) {
  return `http://${ip}:${port}/audio`;
}

module.exports = {
  startFileServer,
  stopFileServer,
  getServerUrl
};