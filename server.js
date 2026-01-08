const http = require('http');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('edge-tts');

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
  
  // Handle TTS API request
  if (req.url === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text, voice, rate } = JSON.parse(body);
        if (!text) throw new Error('Text erforderlich');
        
        const tts = new EdgeTTS({
          voice: voice || 'de-DE-ConradNeural',
          rate: rate || 1.0
        });
        
        res.setHeader('Content-Type', 'audio/mpeg');
        const audioStream = tts.toStream(text);
        audioStream.pipe(res);
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('TTS Error: ' + err.message);
      }
    });
    return;
  }
  
  // Handle voices list API
  if (req.url === '/api/tts-voices' && req.method === 'GET') {
    const voicesData = {
      de: [
        { name: 'Conrad (männlich)', value: 'de-DE-ConradNeural' },
        { name: 'Katja (weiblich)', value: 'de-DE-KatjaNeural' }
      ],
      'de-AT': [
        { name: 'Michael (männlich)', value: 'de-AT-IngridNeural' }
      ],
      'de-CH': [
        { name: 'Karsten (männlich)', value: 'de-CH-JanNeural' }
      ],
      en: [
        { name: 'Ryan (englisch, US)', value: 'en-US-RyanNeural' },
        { name: 'Aria (englisch, weiblich)', value: 'en-US-AriaNeural' }
      ]
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(voicesData));
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
