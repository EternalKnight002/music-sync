const os = require('os');
const crypto = require('crypto');
const fs = require('fs');

/**
 * Get LAN IP address of the machine
 * @returns {string} LAN IP address or 'localhost'
 */
function getLanIp() {
  const interfaces = os.networkInterfaces();
  
  // Priority order: en0 (Mac), eth0 (Linux), Ethernet/Wi-Fi (Windows)
  const priorityNames = ['en0', 'eth0', 'Ethernet', 'Wi-Fi'];
  
  // First try priority interfaces
  for (const name of priorityNames) {
    if (interfaces[name]) {
      const iface = interfaces[name].find(
        (details) => details.family === 'IPv4' && !details.internal
      );
      if (iface) {
        return iface.address;
      }
    }
  }
  
  // Fallback: find any non-internal IPv4 address
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name].find(
      (details) => details.family === 'IPv4' && !details.internal
    );
    if (iface) {
      return iface.address;
    }
  }
  
  console.warn('Could not determine LAN IP, using localhost');
  return 'localhost';
}

/**
 * Calculate SHA-256 checksum of a file
 * @param {string} filePath - Path to file
 * @returns {Promise<string>} Hex checksum
 */
function calculateChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = {
  getLanIp,
  calculateChecksum
};