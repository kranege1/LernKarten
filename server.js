const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

const server = http.createServer((req, res) => {
  // Add CORS headers to allow fetch from file:// protocol
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle OPTIONS requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Handle Google Cloud TTS API endpoint
  if (req.url === '/api/tts-google' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { text, languageCode, voiceName, rate, apiKey } = JSON.parse(body);
        
        if (!apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API key required' }));
          return;
        }
        
        const googleUrl = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(apiKey);
        const payload = JSON.stringify({
          input: { text },
          voice: {
            languageCode: languageCode || 'de-DE',
            name: voiceName || 'de-DE-Standard-A'
          },
          audioConfig: {
            audioEncoding: 'MP3',
            pitch: 0,
            speakingRate: rate || 1.0
          }
        });
        
        const googleReq = https.request(googleUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (googleRes) => {
          let googleBody = '';
          googleRes.on('data', chunk => { googleBody += chunk; });
          googleRes.on('end', () => {
            res.writeHead(googleRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(googleBody);
          });
        });
        
        googleReq.on('error', (e) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });
        
        googleReq.write(payload);
        googleReq.end();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.csv': 'text/csv'
    };
    
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  LernKarten Server läuft              ║
║  http://localhost:${PORT}              ║
╚═══════════════════════════════════════╝
  
  Test-Suite:  http://localhost:${PORT}/test.html
  App:         http://localhost:${PORT}
  
  Drücke Ctrl+C zum Beenden
  `);
});
