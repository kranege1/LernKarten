// Einfache Proxy-API für KI-Requests (OpenAI, Grok, Custom)
const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit: '2mb'}));

// POST /proxy
app.post('/proxy', async (req, res) => {
  try {
    const { endpoint, apiKey, ...rest } = req.body;
    if (!endpoint || !apiKey) return res.status(400).json({ error: 'endpoint und apiKey erforderlich' });
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    };
    // Alles andere (z.B. model, messages, temperature) wird als body übernommen
    const body = JSON.stringify(rest);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });
    const text = await response.text();
    res.status(response.status).type('application/json').send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`KI-Proxy läuft auf http://localhost:${PORT}/proxy`);
});
