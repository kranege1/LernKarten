/* LernKarten – App Logic */
(function(){
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  const state = {
    data: { folders: [], topics: [], cards: [], settings: { tts: { lang: 'de-DE', voiceURI: '', rate: 0.7 }, ai: { provider: 'openai', keyOpenai: '', keyGrok: '', endpoint: '', apiKey: '' }, drive: { clientId: '' } } },
    session: { active: false, topicId: null, mode: 'beschreibung', answered: 0, correct: 0, current: null, multipleChoiceCorrect: null, maxCards: null, selectedCardCount: null },
    ui: { selectedFolderId: null, selectedTopicId: null, selectedStatsId: null, selectedStatsType: null, collapsedFolders: {} },
    voices: []
  };

  const Storage = {
    lastCardCount: 0,
    load(){
      const raw = localStorage.getItem('lernKarten');
      if(raw){
        try {
          const parsed = JSON.parse(raw);
          if(parsed.folders) state.data.folders = parsed.folders;
          if(parsed.topics) state.data.topics = parsed.topics;
          if(parsed.cards) state.data.cards = parsed.cards;
          if(parsed.settings) state.data.settings = { ...state.data.settings, ...parsed.settings };
          this.lastCardCount = state.data.cards.length;
        } catch(e){ console.error('Load error', e); }
      }
    },
    save(){
      localStorage.setItem('lernKarten', JSON.stringify(state.data));
      
      // Auto-Backup wenn neue Karten hinzugekommen sind
      const currentCount = state.data.cards.length;
      if(currentCount > this.lastCardCount){
        Drive.autoBackup();
        this.lastCardCount = currentCount;
      }
    },
    exportJSON(topicId){
      const data = topicId ? { topics: state.data.topics.filter(t=>t.id===topicId), cards: state.data.cards.filter(c=>c.topicId===topicId) } : { folders: state.data.folders, topics: state.data.topics, cards: state.data.cards };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const name = topicId ? `lernKarten_${getTopicName(topicId)}.json` : `lernKarten_export.json`;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const Drive = {
    accessToken: null,
    isSignedIn: false,
    fileName: 'lernkarten_backup.json',
    fileId: null,

    init(){
      // Google API wird asynchron geladen
      if(typeof gapi === 'undefined'){
        console.warn('Google API nicht geladen');
        return;
      }
    },

    auth(){
      const clientId = state.data.settings.drive.clientId;
      if(!clientId){
        $('#drive-status').textContent = 'Bitte OAuth Client ID eingeben';
        return;
      }

      // OAuth 2.0 Flow mit Google Identity Services
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (response) => {
          if (response.access_token) {
            this.accessToken = response.access_token;
            this.isSignedIn = true;
            $('#drive-status').textContent = '✓ Angemeldet bei Google Drive';
            this.findBackupFile();
          }
        },
      });
      client.requestAccessToken();
    },

    signout(){
      if(this.accessToken){
        google.accounts.oauth2.revoke(this.accessToken);
        this.accessToken = null;
        this.isSignedIn = false;
        this.fileId = null;
        $('#drive-status').textContent = 'Abgemeldet';
      }
    },

    async findBackupFile(){
      if(!this.accessToken) return null;
      try {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=name='${this.fileName}' and trashed=false&spaces=drive&fields=files(id,name)`,
          { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
        );
        const data = await response.json();
        if(data.files && data.files.length > 0){
          this.fileId = data.files[0].id;
          return this.fileId;
        }
        return null;
      } catch(e){
        console.error('Drive find error:', e);
        return null;
      }
    },

    async load(){
      if(!this.isSignedIn || !this.accessToken){
        $('#cloud-status').textContent = 'Bitte zuerst bei Google Drive anmelden';
        return;
      }

      try {
        // Datei suchen
        const fileId = this.fileId || await this.findBackupFile();
        if(!fileId){
          $('#cloud-status').textContent = 'Kein Backup in Drive gefunden';
          return;
        }

        // Datei laden
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
          { headers: { 'Authorization': `Bearer ${this.accessToken}` } }
        );
        
        if(!response.ok) throw new Error('Download fehlgeschlagen');
        
        const data = await response.json();
        
        // Daten importieren
        if(data.folders) state.data.folders = data.folders;
        if(data.topics) state.data.topics = data.topics;
        if(data.cards) state.data.cards = data.cards;
        if(data.settings) state.data.settings = { ...state.data.settings, ...data.settings };
        
        Storage.save();
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
        
        $('#cloud-status').textContent = `✓ ${data.cards?.length || 0} Karten aus Drive geladen`;
      } catch(e){
        console.error('Drive load error:', e);
        $('#cloud-status').textContent = 'Fehler beim Laden: ' + e.message;
      }
    },

    async save(){
      if(!this.isSignedIn || !this.accessToken){
        $('#cloud-status').textContent = 'Bitte zuerst bei Google Drive anmelden';
        return;
      }

      try {
        const data = { folders: state.data.folders, topics: state.data.topics, cards: state.data.cards, settings: state.data.settings };
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });

        // Datei suchen oder erstellen
        let fileId = this.fileId || await this.findBackupFile();
        
        if(fileId){
          // Update existing file
          const response = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
              },
              body: content
            }
          );
          if(!response.ok) throw new Error('Update fehlgeschlagen');
        } else {
          // Create new file
          const metadata = {
            name: this.fileName,
            mimeType: 'application/json'
          };
          
          const form = new FormData();
          form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          form.append('file', blob);

          const response = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
            {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${this.accessToken}` },
              body: form
            }
          );
          
          if(!response.ok) throw new Error('Upload fehlgeschlagen');
          const result = await response.json();
          this.fileId = result.id;
        }
        
        const timestamp = new Date().toLocaleString('de-DE');
        $('#cloud-status').textContent = `✓ Backup gespeichert (${timestamp})`;
      } catch(e){
        console.error('Drive save error:', e);
        $('#cloud-status').textContent = 'Fehler beim Speichern: ' + e.message;
      }
    },

    async autoBackup(){
      // Automatisches Backup nur wenn angemeldet
      if(!this.isSignedIn || !this.accessToken) return;
      
      try {
        await this.save();
        console.log('Auto-Backup durchgeführt');
      } catch(e){
        console.error('Auto-Backup Fehler:', e);
      }
    }
  };

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function toISODate(d){ return d.toISOString().slice(0,10); }
  function clamp(v, min, max){ return Math.min(Math.max(v, min), max); }

  function init(){
    Storage.load();
    TTS.initVoices();
    bindTabs();
    bindManage();
    bindLearn();
    bindImportExport();
    bindSettings();
    populateAllSelects();
    renderFolderTree();
    if(state.data.topics.length>0){
      state.ui.selectedTopicId = state.data.topics[0].id;
      renderCardsTable();
    }
    // Initialisiere UI-Werte für Settings
    $('#tts-rate').value = state.data.settings.tts.rate || 0.7;

    // Version im Footer anzeigen
    showDeployedVersion();
  }

  function baseStats(){
    return { box: 1, streak: 0, total: 0, correct: 0, lastReviewed: null, nextDue: todayISO() };
  }

  function getTopicName(id){
    return (state.data.topics.find(t=>t.id===id)||{name:'Unbekannt'}).name;
  }

  // Zeigt die aktuell deployte Commit-Version (gh-pages oder main) im Footer
  async function showDeployedVersion(){
    try{
      const el = document.getElementById('app-version');
      if(!el) return;
      const onPages = location.hostname.endsWith('github.io');
      const branch = onPages ? 'gh-pages' : 'main';
      const res = await fetch(`https://api.github.com/repos/kranege1/LernKarten/branches/${branch}`);
      if(!res.ok) return;
      const data = await res.json();
      const sha = (data.commit?.sha || '').slice(0,7);
      const dateISO = data.commit?.commit?.committer?.date;
      const dateStr = dateISO ? new Date(dateISO).toLocaleString() : '';
      if(sha){
        el.textContent = `· Version ${sha} (${dateStr})`;
      }
    } catch(e){
      // still fine without version
    }
  }

  // --- Scheduler (Leitner) ---
  const Scheduler = {
    nextForTopic(topicId){
      const cards = state.data.cards.filter(c=>c.topicId===topicId);
      if(cards.length===0) return null;
      const today = todayISO();
      const due = cards.filter(c => (c.stats?.nextDue||today) <= today);
      if (due.length) {
        // prioritize lowest box due first
        due.sort((a,b)=> (a.stats.box - b.stats.box) || ((a.stats.lastReviewed||'') > (b.stats.lastReviewed||'') ? 1 : -1));
        return due[0];
      }
      // if nothing due, sample weighted by 1/box
      const weighted = [];
      for(const c of cards){
        const w = Math.max(1, 6 - (c.stats?.box||1)); // box1->5 weight
        for(let i=0;i<w;i++) weighted.push(c);
      }
      return weighted[Math.floor(Math.random()*weighted.length)] || cards[0];
    },
    updateAfterAnswer(card, isCorrect){
      const s = card.stats || (card.stats = baseStats());
      s.total += 1;
      if(isCorrect){
        s.correct += 1;
        s.streak += 1;
        s.box = clamp((s.box||1)+1, 1, 5);
      } else {
        s.streak = 0;
        s.box = 1; // send to box 1 so it repeats more often
      }
      s.lastReviewed = new Date().toISOString();
      // schedule next due: box1: 0d, box2: 1d, box3: 3d, box4: 7d, box5: 14d
      const days = [0, 0, 1, 3, 7, 14][s.box] || 1;
      const next = new Date();
      next.setDate(next.getDate() + days);
      s.nextDue = toISODate(next);
    }
  };

  // --- TTS (ResponsiveVoice - funktioniert auf allen Geräten inkl. iPad + SSML Support) ---
  const TTS = {
    voices: [],
    
    initVoices(){
      // ResponsiveVoice stellt verfügbare Stimmen bereit
      if(typeof responsiveVoice !== 'undefined' && responsiveVoice.getVoices) {
        const rvVoices = responsiveVoice.getVoices();
        // Filter für Deutsche Stimmen
        this.voices = rvVoices.filter(v => v.lang && v.lang.startsWith('de'));
        if(this.voices.length === 0) {
          // Fallback: alle Stimmen wenn keine deutschen
          this.voices = rvVoices;
        }
      } else {
        // Fallback zur Web Speech API
        this.voices = window.speechSynthesis?.getVoices() || [];
      }
      refreshVoiceSelectors();
    },
    
    speak(text){
      const ttsMode = $('#tts-mode')?.value || 'none';
      if(ttsMode === 'none') return;
      this.speakDirect(text);
    },
    
    speakDirect(text){
      if(!text) return;
      
      const voiceURI = state.data.settings.tts.voiceURI || 'Deutsch Female';
      // clamp slider value to a safe range for ResponsiveVoice
      const rate = clamp(state.data.settings.tts.rate || 0.7, 0.5, 1.5);
      
      // Versuche ResponsiveVoice zu nutzen (unterstützt SSML)
      if(typeof responsiveVoice !== 'undefined' && responsiveVoice.voiceSupport && responsiveVoice.voiceSupport()) {
        try {
          responsiveVoice.cancel();
          // Nutze ausgewählte Stimme nur wenn vorhanden
          const available = (responsiveVoice.getVoices && responsiveVoice.getVoices()) || [];
          const hasVoice = available.some(v=>v && (v.name===voiceURI || v.voiceURI===voiceURI));
          const voiceName = hasVoice ? voiceURI : undefined;
          const ok = responsiveVoice.speak(text, voiceName, { rate });
          if(ok===false){
            // Fallback wenn abgelehnt oder fehlgeschlagen
            this.speakDirectFallback(text);
          }
        } catch(e){
          console.warn('ResponsiveVoice speak failed, fallback to WebSpeech', e);
          this.speakDirectFallback(text);
        }
      } else {
        // Fallback zur Web Speech API
        this.speakDirectFallback(text);
      }
    },
    
    speakDirectFallback(text){
      if(!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = state.data.settings.tts.lang || 'de-DE';
      u.rate = state.data.settings.tts.rate || 0.7;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    },
    
    // Hilfsfunktion: Text mit SSML Pausen formatieren
    addPauses(text, pauseMs = 300){
      // Teile Text in Sätze auf und füge Pausen ein
      const sentences = text.split(/([.!?]+)/);
      return sentences.map(s => {
        if(s.match(/[.!?]/)) return s + `<break time="${pauseMs}ms"/>`;
        return s;
      }).join('');
    },
    
    // Feedback mit Betonung
    speakFeedback(correct){
      const feedback = correct 
        ? '<speak>Das ist <emphasis level="strong">richtig</emphasis>!</speak>'
        : '<speak>Das ist <emphasis level="strong">falsch</emphasis>. Versuche es nochmal!</speak>';
      this.speakDirect(feedback);
    },
    
    // Frage mit Pausen zwischen Sätzen
    speakQuestion(text){
      const ssml = `<speak>${this.addPauses(text, 400)}</speak>`;
      this.speakDirect(ssml);
    },
    
    // Antwort mit etwas höherer Tonhöhe
    speakAnswer(text){
      const ssml = `<speak><prosody pitch="+10%">${this.addPauses(text, 300)}</prosody></speak>`;
      this.speakDirect(ssml);
    }
  };

  function refreshVoiceSelectors(){
    const langSel = $('#tts-lang');
    const voiceSel = $('#tts-voice');
    
    // Wenn ResponsiveVoice verfügbar ist
    if(typeof responsiveVoice !== 'undefined' && responsiveVoice.getVoices) {
      const rvVoices = responsiveVoice.getVoices();
      // Extrahiere eindeutige Sprachen
      const langs = [...new Set(rvVoices.map(v => {
        const lang = v.lang || 'de';
        return lang.split('-')[0]; // z.B. "de" aus "de-DE"
      }))].sort();
      
      langSel.innerHTML = langs.map(l=>`<option value="${l}">${l}</option>`).join('');
      langSel.value = state.data.settings.tts.lang || 'de';
      
      // Filter Stimmen nach Sprache
      const filteredVoices = rvVoices.filter(v => {
        const lang = v.lang || 'de';
        return lang.startsWith(langSel.value);
      });
      
      voiceSel.innerHTML = `<option value="">Standard</option>` + 
        filteredVoices.map(v=>`<option value="${v.name}">${v.name}</option>`).join('');
      voiceSel.value = state.data.settings.tts.voiceURI || '';
    } else {
      // Fallback zur Web Speech API
      const voices = state.voices || [];
      const langs = [...new Set(voices.map(v=>v.lang))].sort();
      langSel.innerHTML = langs.map(l=>`<option value="${l}">${l}</option>`).join('');
      langSel.value = state.data.settings.tts.lang || 'de-DE';
      
      const filteredVoices = voices.filter(v=>v.lang===langSel.value);
      voiceSel.innerHTML = `<option value="">Standard</option>` + 
        filteredVoices.map(v=>`<option value="${v.voiceURI}">${v.name}</option>`).join('');
      voiceSel.value = state.data.settings.tts.voiceURI || '';
    }
  }

  // --- Importer ---
  const Importer = {
    async fromFile(format, file, topicId){
      if(!file) throw new Error('Keine Datei gewählt');
      if(format==='json'){
        const txt = await file.text();
        const data = JSON.parse(txt);
        return this.fromJSON(data, topicId);
      } else if(format==='csv'){
        const text = await file.text();
        const delim = guessDelimiter(text);
        const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, delimiter: delim });
        let rows = parsed.data || [];
        const headers = (parsed.meta && parsed.meta.fields) || [];
        
        // Check if headerless 6-column MC format
        const normalizeKey = (k) => (k||'').toString().toLowerCase().replace(/\s+/g,'').replace(/_/g,'');
        const looksHeaderless = headers.length === 6 && headers.every(h => !h || !/^(topic|begriff|term|umschreibung|description|answer|option|antwort)/.test(normalizeKey(h)));
        
        if(looksHeaderless && rows.length > 0){
          // Re-parse without headers and map to MC structure
          const rawParsed = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: delim });
          rows = (rawParsed.data || []).map(r => {
            if(!Array.isArray(r) || r.length < 6) return null;
            return { 
              term: r[0], 
              description: r[1], 
              answer: r[2], 
              mcOptions: [r[2], r[3], r[4], r[5]] 
            };
          }).filter(Boolean);
        }
        
        return this.fromRows(rows, topicId);
      } else if(format==='text'){
        const txt = await file.text();
        const rows = txt.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(x=>({ term: x }));
        return this.fromRows(rows, topicId);
      }
      return 0;
    },
    fromJSON(data, topicId){
      // Accept our schema or list of cards
      const importedFolders = Array.isArray(data.folders) ? data.folders : [];
      const importedTopics = Array.isArray(data.topics) ? data.topics : [];
      const importedCards = Array.isArray(data.cards) ? data.cards : Array.isArray(data) ? data : [];
      const folderMap = new Map();
      const topicMap = new Map();
      let count = 0;
      
      // Import folders first
      for(const f of importedFolders){
        const id = uid();
        state.data.folders.push({ id, name: f.name || 'Import' });
        folderMap.set(f.id, id);
      }
      // If target topic specified, put all into that
      if(topicId){
        for(const c of importedCards){ 
          this.addCardToTopic(topicId, normalizeCard(c)); 
          count++;
        }
      } else {
        // create topics if new
        for(const t of importedTopics){
          const id = uid();
          const folderId = t.folderId && folderMap.get(t.folderId);
          state.data.topics.push({ id, name: t.name||'Import', folderId, answerMode: t.answerMode || 'type' });
          topicMap.set(t.id, id);
        }
        for(const c of importedCards){
          const tId = c.topicId && topicMap.get(c.topicId) || this.ensureTopic(c.topic || c.topicName || 'Import');
          this.addCardToTopic(tId, normalizeCard(c));
          count++;
        }
      }
      Storage.save();
      return count;
    },
    fromRows(rows, topicId){
      let count = 0;
      for(const r of rows){
        const tId = topicId || this.ensureTopic(r.topic || r.Topic || 'Import');
        const card = normalizeCard({
          term: r.term || r.begriff || r.name || r.Term || r.Begriff,
          description: r.description || r.umschreibung || r.beschreibung || r.Description,
          answer: r.answer || r.antwort || '',
          mcOptions: r.mcOptions
        });
        this.addCardToTopic(tId, card);
        count++;
      }
      Storage.save();
      return count;
    },
    ensureTopic(name){
      const existing = state.data.topics.find(t=>t.name===name);
      if(existing) return existing.id;
      const id = uid();
      state.data.topics.push({ id, name });
      return id;
    },
    addCardToTopic(topicId, card){
      card.id = uid();
      card.topicId = topicId;
      card.stats = baseStats();
      state.data.cards.push(card);
    }
  };

  function guessDelimiter(text){
    const comma = (text.match(/,/g)||[]).length;
    const semicolon = (text.match(/;/g)||[]).length;
    const tab = (text.match(/\t/g)||[]).length;
    return tab>comma && tab>semicolon ? '\t' : (semicolon>comma ? ';' : ',');
  }

  function normalizeCard(c){
    return {
      term: (c.term||'').toString().trim(),
      description: (c.description||'').toString().trim(),
      answer: (c.answer||'').toString().trim(),
      mcOptions: c.mcOptions
    };
  }

  // --- AI (optional) ---
  const AI = {
    describe: async function(term) {
      const ai = state.data.settings.ai;
      let endpoint = '', apiKey = '', body = {}, headers = {}, model = '';
      const useProxy = true; // Proxy verwenden für CORS
      
      if(ai.provider==='openai'){
        apiKey = ai.keyOpenai;
        if(!apiKey) throw new Error('OpenAI API-Key fehlt');
        
        if(useProxy){
          // Via Proxy
          endpoint = 'http://localhost:3000/proxy';
          body = {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: apiKey,
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: 'Du umschreibst prägnant Fachbegriffe ohne sie zu nennen. Antworte kurz, 1-2 Sätze, Deutsch.' },
              { role: 'user', content: `Umschreibe knapp den Begriff: ${term}` }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json' };
        } else {
          // Direkt (CORS-Problem!)
          endpoint = 'https://api.openai.com/v1/chat/completions';
          model = 'gpt-4o';
          body = {
            model,
            messages: [
              { role: 'system', content: 'Du umschreibst prägnant Fachbegriffe ohne sie zu nennen. Antworte kurz, 1-2 Sätze, Deutsch.' },
              { role: 'user', content: `Umschreibe knapp den Begriff: ${term}` }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='grok'){
        apiKey = ai.keyGrok;
        if(!apiKey) throw new Error('Grok API-Key fehlt');
        
        if(useProxy){
          // Via Proxy
          endpoint = 'http://localhost:3000/proxy';
          body = {
            endpoint: 'https://api.x.ai/v1/chat/completions',
            apiKey: apiKey,
            model: 'grok-3',
            messages: [
              { role: 'system', content: 'Du umschreibst prägnant Fachbegriffe ohne sie zu nennen. Antworte kurz, 1-2 Sätze, Deutsch.' },
              { role: 'user', content: `Umschreibe knapp den Begriff: ${term}` }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json' };
        } else {
          // Direkt (CORS-Problem!)
          endpoint = 'https://api.x.ai/v1/chat/completions';
          model = 'grok-3';
          body = {
            model,
            messages: [
              { role: 'system', content: 'Du umschreibst prägnant Fachbegriffe ohne sie zu nennen. Antworte kurz, 1-2 Sätze, Deutsch.' },
              { role: 'user', content: `Umschreibe knapp den Begriff: ${term}` }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='custom'){
        endpoint = ai.endpoint;
        apiKey = ai.apiKey;
        if(!endpoint || !apiKey) throw new Error('Custom Endpoint und API-Key erforderlich');
        
        body = {
          endpoint: endpoint,
          apiKey: apiKey,
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'Du umschreibst prägnant Fachbegriffe ohne sie zu nennen. Antworte kurz, 1-2 Sätze, Deutsch.' },
            { role: 'user', content: `Umschreibe knapp den Begriff: ${term}` }
          ],
          temperature: 0.7
        };
        headers = { 'Content-Type':'application/json' };
      }
      
      if(!endpoint) throw new Error('KI-Anbieter nicht konfiguriert');
      
      let res;
      try {
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (err) {
        if(useProxy && err.message.includes('Failed to fetch')){
          throw new Error('Proxy nicht erreichbar. Bitte starte "node proxy.js" im Terminal.');
        }
        throw new Error('Netzwerkfehler: ' + err.message);
      }
      if(!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch {}
        let errJson = null;
        try { errJson = JSON.parse(errText); } catch {}
        const error = new Error('KI Anfrage fehlgeschlagen');
        error.response = res;
        error.body = errJson || errText;
        throw error;
      }
      const json = await res.json();
      const msg = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content ? json.choices[0].message.content : '';
      return msg.trim();
    },
    
    // Generische KI-Anfrage mit benutzerdefiniertem Prompt
    generate: async function(systemPrompt, userPrompt) {
      const ai = state.data.settings.ai;
      let endpoint = '', apiKey = '', body = {}, headers = {};
      const useProxy = true;
      
      if(ai.provider==='openai'){
        apiKey = ai.keyOpenai;
        if(!apiKey) throw new Error('OpenAI API-Key fehlt');
        if(useProxy){
          endpoint = 'http://localhost:3000/proxy';
          body = {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: apiKey,
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json' };
        } else {
          endpoint = 'https://api.openai.com/v1/chat/completions';
          body = {
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='grok'){
        apiKey = ai.keyGrok;
        if(!apiKey) throw new Error('Grok API-Key fehlt');
        if(useProxy){
          endpoint = 'http://localhost:3000/proxy';
          body = {
            endpoint: 'https://api.x.ai/v1/chat/completions',
            apiKey: apiKey,
            model: 'grok-3',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json' };
        } else {
          endpoint = 'https://api.x.ai/v1/chat/completions';
          body = {
            model: 'grok-3',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7
          };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='custom'){
        endpoint = ai.endpoint;
        apiKey = ai.apiKey;
        if(!endpoint || !apiKey) throw new Error('Custom Endpoint und API-Key erforderlich');
        body = {
          endpoint: endpoint,
          apiKey: apiKey,
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7
        };
        headers = { 'Content-Type':'application/json' };
      }
      
      if(!endpoint) throw new Error('KI-Anbieter nicht konfiguriert');
      
      let res;
      try {
        res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (err) {
        if(useProxy && err.message.includes('Failed to fetch')){
          throw new Error('Proxy nicht erreichbar. Bitte starte "node proxy.js" im Terminal.');
        }
        throw new Error('Netzwerkfehler: ' + err.message);
      }
      if(!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch {}
        let errJson = null;
        try { errJson = JSON.parse(errText); } catch {}
        const error = new Error('KI Anfrage fehlgeschlagen');
        error.response = res;
        error.body = errJson || errText;
        throw error;
      }
      const json = await res.json();
      const msg = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content ? json.choices[0].message.content : '';
      return msg.trim();
    },
    
    classifyMode: async function(sampleRows){
      const ai = state.data.settings.ai;
      let endpoint = '', apiKey = '', body = {}, headers = {}, model = '';
      const useProxy = true;

      const sample = JSON.stringify(sampleRows.slice(0, 10).map(r=>({
        term: r.term || '',
        description: r.description || '',
        answer: r.answer || '',
        mcOptions: Array.isArray(r.mcOptions) ? r.mcOptions.slice(0,4) : undefined
      })), null, 0);
      const sys = 'Du klassifizierst Lernkarten-Daten in genau einen Modus: type, judge, multiple-choice. type: Nutzer tippt die Antwort (keine MC-Optionen, Antworten sind freie Texte). judge: Antworten sind typische Ja/Nein bzw. Richtig/Falsch (true/false, korrekt/inkorrekt). multiple-choice: Es gibt 3-4 Antwortoptionen (mcOptions oder option1..4/antwort1..4). Antworte NUR mit einem der drei Tokens.';
      const usr = `Beurteile folgenden Datenausschnitt und gib nur den Modus aus (type | judge | multiple-choice):\n${sample}`;

      if(ai.provider==='openai'){
        apiKey = ai.keyOpenai;
        if(!apiKey) throw new Error('OpenAI API-Key fehlt');
        if(useProxy){
          endpoint = 'http://localhost:3000/proxy';
          body = { endpoint: 'https://api.openai.com/v1/chat/completions', apiKey, model: 'gpt-4o', messages: [ {role:'system',content:sys}, {role:'user',content:usr} ], temperature: 0 };
          headers = { 'Content-Type':'application/json' };
        } else {
          endpoint = 'https://api.openai.com/v1/chat/completions';
          model = 'gpt-4o';
          body = { model, messages: [ {role:'system',content:sys}, {role:'user',content:usr} ], temperature: 0 };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='grok'){
        apiKey = ai.keyGrok;
        if(!apiKey) throw new Error('Grok API-Key fehlt');
        if(useProxy){
          endpoint = 'http://localhost:3000/proxy';
          body = { endpoint: 'https://api.x.ai/v1/chat/completions', apiKey, model: 'grok-3', messages: [ {role:'system',content:sys}, {role:'user',content:usr} ], temperature: 0 };
          headers = { 'Content-Type':'application/json' };
        } else {
          endpoint = 'https://api.x.ai/v1/chat/completions';
          model = 'grok-3';
          body = { model, messages: [ {role:'system',content:sys}, {role:'user',content:usr} ], temperature: 0 };
          headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${apiKey}` };
        }
      } else if(ai.provider==='custom'){
        const endpointCfg = ai.endpoint; apiKey = ai.apiKey;
        if(!endpointCfg || !apiKey) throw new Error('Custom Endpoint und API-Key erforderlich');
        endpoint = 'http://localhost:3000/proxy';
        body = { endpoint: endpointCfg, apiKey, model: 'gpt-4o', messages: [ {role:'system',content:sys}, {role:'user',content:usr} ], temperature: 0 };
        headers = { 'Content-Type':'application/json' };
      }

      if(!endpoint) throw new Error('KI-Anbieter nicht konfiguriert');
      const res = await fetch(endpoint, { method:'POST', headers, body: JSON.stringify(body) });
      if(!res.ok){ throw new Error('KI Anfrage fehlgeschlagen'); }
      const json = await res.json();
      const out = (json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || '').toString().trim().toLowerCase();
      if(out.includes('multiple')) return 'multiple-choice';
      if(out.includes('judge') || out.includes('richtig') || out.includes('falsch')) return 'judge';
      return 'type';
    }
  };

  function bindTabs(){
    $$('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const id = btn.getAttribute('data-tab');
        $$('.tab-panel').forEach(p=>p.classList.remove('active'));
        $(`#tab-${id}`).classList.add('active');
        if(id==='statistik') renderStats();
        if(id==='verwalten') renderCardsTable();
      });
    });
    
    // Stats-Topic Change
    const statsTopicSel = $('#stats-topic');
    if(statsTopicSel){
      statsTopicSel.addEventListener('change', (e) => {
        const val = e.target.value;
        if(!val){
          state.ui.selectedStatsId = null;
          state.ui.selectedStatsType = null;
        } else if(val.startsWith('folder:')){
          state.ui.selectedStatsId = val.substring(7);
          state.ui.selectedStatsType = 'folder';
        } else if(val.startsWith('topic:')){
          state.ui.selectedStatsId = val.substring(6);
          state.ui.selectedStatsType = 'topic';
        }
        renderStats();
      });
    }
    
    // Reset Stats Button
    const resetStatsBtn = $('#reset-stats');
    if(resetStatsBtn){
      resetStatsBtn.addEventListener('click', () => {
        const selectedId = state.ui.selectedStatsId;
        const selectedType = state.ui.selectedStatsType;
        
        if(!selectedId){
          if(!confirm('Alle Statistiken zurücksetzen? Dies betrifft ALLE Karten!')) return;
          for(const card of state.data.cards){
            card.stats = baseStats();
          }
          alert('Alle Statistiken wurden zurückgesetzt.');
        } else if(selectedType === 'folder'){
          const folder = state.data.folders.find(f => f.id === selectedId);
          const folderName = folder ? folder.name : 'Ordner';
          if(!confirm(`Statistiken für Ordner "${folderName}" zurücksetzen?`)) return;
          const topicIds = state.data.topics.filter(t => t.folderId === selectedId).map(t => t.id);
          let count = 0;
          for(const card of state.data.cards){
            if(topicIds.includes(card.topicId)){
              card.stats = baseStats();
              count++;
            }
          }
          alert(`Statistiken für ${count} Karte(n) im Ordner "${folderName}" zurückgesetzt.`);
        } else if(selectedType === 'topic'){
          const topic = state.data.topics.find(t => t.id === selectedId);
          const topicName = topic ? topic.name : 'Thema';
          if(!confirm(`Statistiken für Thema "${topicName}" zurücksetzen?`)) return;
          let count = 0;
          for(const card of state.data.cards){
            if(card.topicId === selectedId){
              card.stats = baseStats();
              count++;
            }
          }
          alert(`Statistiken für ${count} Karte(n) im Thema "${topicName}" zurückgesetzt.`);
        }
        
        Storage.save();
        renderStats();
      });
    }
    
    // Export Stats Button
    const exportStatsBtn = $('#export-stats');
    if(exportStatsBtn){
      exportStatsBtn.addEventListener('click', () => {
        const selectedId = state.ui.selectedStatsId;
        const selectedType = state.ui.selectedStatsType;
        
        let cards, name;
        if(!selectedId){
          cards = state.data.cards;
          name = 'Alle';
        } else if(selectedType === 'folder'){
          const folder = state.data.folders.find(f => f.id === selectedId);
          name = folder ? folder.name : 'Ordner';
          const topicIds = state.data.topics.filter(t => t.folderId === selectedId).map(t => t.id);
          cards = state.data.cards.filter(c => topicIds.includes(c.topicId));
        } else if(selectedType === 'topic'){
          const topic = state.data.topics.find(t => t.id === selectedId);
          name = topic ? topic.name : 'Thema';
          cards = state.data.cards.filter(c => c.topicId === selectedId);
        }
        
        // CSV Export
        const rows = [['Begriff', 'Thema', 'Box', 'Streak', 'Gesamt', 'Richtig', 'Erfolgsrate', 'Letzter Review', 'Nächstes Datum']];
        for(const card of cards){
          const topic = state.data.topics.find(t => t.id === card.topicId);
          const s = card.stats || baseStats();
          const successRate = s.total > 0 ? Math.round(100 * s.correct / s.total) : 0;
          rows.push([
            card.term,
            topic ? topic.name : 'Unbekannt',
            s.box || 1,
            s.streak || 0,
            s.total || 0,
            s.correct || 0,
            successRate + '%',
            s.lastReviewed || '—',
            s.nextDue || '—'
          ]);
        }
        
        const csv = rows.map(row => row.map(cell => {
          const str = String(cell);
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(',')).join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lernkarten_statistik_${name}_${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }
    
    // Import Stats Button
    const importStatsBtn = $('#import-stats');
    if(importStatsBtn){
      importStatsBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.onchange = async (e) => {
          const file = e.target.files[0];
          if(!file) return;
          
          try {
            const text = await file.text();
            const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
            const rows = parsed.data || [];
            
            let updated = 0;
            let notFound = 0;
            
            for(const row of rows){
              const term = (row.Begriff || row.term || '').trim();
              const topicName = (row.Thema || row.topic || '').trim();
              
              if(!term) continue;
              
              // Finde Karte
              let card;
              if(topicName){
                const topic = state.data.topics.find(t => t.name === topicName);
                if(topic){
                  card = state.data.cards.find(c => c.term === term && c.topicId === topic.id);
                }
              }
              if(!card){
                card = state.data.cards.find(c => c.term === term);
              }
              
              if(card){
                card.stats = {
                  box: parseInt(row.Box || row.box) || 1,
                  streak: parseInt(row.Streak || row.streak) || 0,
                  total: parseInt(row.Gesamt || row.total || row.Gesamt) || 0,
                  correct: parseInt(row.Richtig || row.correct) || 0,
                  lastReviewed: row['Letzter Review'] || row.lastReviewed || null,
                  nextDue: row['Nächstes Datum'] || row.nextDue || todayISO()
                };
                updated++;
              } else {
                notFound++;
              }
            }
            
            Storage.save();
            renderStats();
            alert(`Import abgeschlossen!\n${updated} Karte(n) aktualisiert.\n${notFound} nicht gefunden.`);
          } catch(err){
            alert('Fehler beim Import: ' + err.message);
          }
        };
        input.click();
      });
    }
  }

  function populateAllSelects(){
    const folderId = state.ui.selectedFolderId;
    const topics = folderId ? state.data.topics.filter(t => t.folderId === folderId) : state.data.topics;
    const options = topics.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
    $('#learn-topic').innerHTML = options;
    $('#import-topic').innerHTML = `<option value="">(alle Themen)</option>` + options;
    $('#export-topic').innerHTML = `<option value="">(alle Themen)</option>` + options;
    
    // Stats-Topic befüllen mit Ordnern und Themen
    const allFolders = state.data.folders;
    const allTopics = state.data.topics;
    
    let statsOptions = `<option value="">🌍 Global (alle)</option>`;
    
    // Ordner hinzufügen
    if(allFolders.length > 0){
      statsOptions += `<optgroup label="Ordner">`;
      statsOptions += allFolders.map(f => {
        const topicCount = allTopics.filter(t => t.folderId === f.id).length;
        return `<option value="folder:${f.id}">📁 ${f.name} (${topicCount} Themen)</option>`;
      }).join('');
      statsOptions += `</optgroup>`;
    }
    
    // Themen hinzufügen
    if(allTopics.length > 0){
      statsOptions += `<optgroup label="Themen">`;
      statsOptions += allTopics.map(t=>{
        const folder = t.folderId ? allFolders.find(f=>f.id===t.folderId) : null;
        const prefix = folder ? `${folder.name} / ` : '';
        const cardCount = state.data.cards.filter(c => c.topicId === t.id).length;
        return `<option value="topic:${t.id}">📝 ${prefix}${t.name} (${cardCount} Karten)</option>`;
      }).join('');
      statsOptions += `</optgroup>`;
    }
    
    const statsSelect = $('#stats-topic');
    if(statsSelect){
      statsSelect.innerHTML = statsOptions;
      // Wert wiederherstellen
      if(state.ui.selectedStatsType === 'folder'){
        statsSelect.value = 'folder:' + state.ui.selectedStatsId;
      } else if(state.ui.selectedStatsType === 'topic'){
        statsSelect.value = 'topic:' + state.ui.selectedStatsId;
      } else {
        statsSelect.value = '';
      }
    }
    
    // Folder-Select befüllen
    const folderOptions = `<option value="">(Alle Ordner)</option>` + state.data.folders.map(f=>`<option value="${f.id}">${f.name}</option>`).join('');
    const folderSelects = ['#learn-folder'];
    folderSelects.forEach(sel => {
      const elem = $(sel);
      if(elem) {
        elem.innerHTML = folderOptions;
        if(folderId) elem.value = folderId;
      }
    });
  }

  // --- Manage Topics & Cards ---
  function bindManage(){
    // Ordner hinzufügen
    $('#add-folder').addEventListener('click', () => {
      const name = $('#new-folder-name').value.trim();
      if(!name) return;
      const id = uid();
      state.data.folders.push({ id, name });
      Storage.save();
      $('#new-folder-name').value='';
      populateAllSelects();
      renderFolderTree();
    });
    
    // Thema verschieben Dialog
    let currentTopicToMove = null;
    $('#move-topic-confirm').addEventListener('click', () => {
      if(!currentTopicToMove) return;
      const newFolderId = $('#move-topic-folder').value || null;
      currentTopicToMove.folderId = newFolderId;
      Storage.save();
      populateAllSelects();
      renderFolderTree();
      $('#move-topic-dialog').close();
      currentTopicToMove = null;
    });
    
    // Expose function to open move dialog
    window.openMoveTopicDialog = (topic) => {
      currentTopicToMove = topic;
      const currentFolder = topic.folderId ? state.data.folders.find(f => f.id === topic.folderId) : null;
      const currentFolderName = currentFolder ? currentFolder.name : '(kein Ordner)';
      $('#move-topic-current').textContent = `Thema "${topic.name}" ist aktuell in: ${currentFolderName}`;
      
      // Befülle Dropdown
      const folderOptions = `<option value="">(Kein Ordner)</option>` + state.data.folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      $('#move-topic-folder').innerHTML = folderOptions;
      $('#move-topic-folder').value = topic.folderId || '';
      
      $('#move-topic-dialog').showModal();
    };
    
    $('#add-topic').addEventListener('click', () => {
      const name = $('#new-topic-name').value.trim();
      if(!name) return;
      const id = uid();
      const folderId = state.ui.selectedFolderId;
      state.data.topics.push({ id, name, answerMode: 'type', folderId });
      Storage.save();
      $('#new-topic-name').value='';
      populateAllSelects();
      renderFolderTree();
    });
    // Aktionen oben: abhängig vom ausgewählten Thema aktivieren/deaktivieren
    const updateManageHeaderUI = () => {
      const tId = state.ui.selectedTopicId;
      const label = $('#manage-selected');
      const addBtn = $('#add-card');
      const aiFillBtn = $('#ai-fill-fields');
      if(tId){
        const t = state.data.topics.find(x=>x.id===tId);
        if(label) label.textContent = `Ausgewähltes Thema: ${t?.name || '—'}`;
        if(addBtn) addBtn.disabled = false;
        if(aiFillBtn) aiFillBtn.disabled = false;
      } else {
        if(label) label.textContent = 'Bitte Thema im Baum auswählen';
        if(addBtn) addBtn.disabled = true;
        if(aiFillBtn) aiFillBtn.disabled = true;
      }
    };
    updateManageHeaderUI();

    $('#add-card').addEventListener('click', () => openCardDialog());
    
    // KI-Felder füllen
    $('#ai-fill-fields').addEventListener('click', openAiFillDialog);
    $('#ai-fill-start').addEventListener('click', startAiFill);
    
    // KI-Begriffe generieren
    $('#ai-generate-terms').addEventListener('click', openAiGenerateDialog);
    $('#ai-generate-start').addEventListener('click', startAiGenerate);

    // Helfer für externe Aufrufe
    window.__updateManageHeaderUI = updateManageHeaderUI;
  }
  
  function openAiFillDialog(){
    const topicId = state.ui.selectedTopicId;
    if(!topicId){ alert('Bitte zuerst ein Thema wählen'); return; }
    
    const cards = state.data.cards.filter(c => c.topicId === topicId);
    if(!cards.length){ alert('Keine Karten im aktuellen Thema'); return; }
    
    // Standard-Prompts basierend auf Zielfeld
    const defaultPrompts = {
      description: 'Erstelle eine kurze, prägnante Umschreibung (1-2 Sätze) für den Begriff "{begriff}". Nenne den Begriff selbst nicht.',
      answer: 'Was ist die richtige Antwort auf: {begriff}? Antworte kurz und präzise.',
      mcOptions: 'Erstelle 4 Multiple-Choice-Antworten für den Begriff "{begriff}". Die erste soll richtig sein, die anderen 3 falsch aber plausibel. Format: Eine Antwort pro Zeile, keine Nummerierung.'
    };
    
    $('#ai-fill-prompt').value = defaultPrompts.description;
    $('#ai-fill-info').textContent = `${cards.length} Karte(n) im aktuellen Thema`;
    $('#ai-fill-progress').textContent = '';
    
    // Prompt ändern wenn Zielfeld geändert wird
    $('#ai-fill-target').onchange = (e) => {
      $('#ai-fill-prompt').value = defaultPrompts[e.target.value] || '';
    };
    
    $('#ai-fill-dialog').showModal();
  }
  
  function openAiGenerateDialog(){
    $('#ai-generate-info').textContent = 'Neues Thema wird erstellt mit den generierten Begriffen';
    $('#ai-generate-progress').textContent = '';
    $('#ai-generate-context').value = '';
    
    $('#ai-generate-dialog').showModal();
  }
  
  async function startAiGenerate(){
    const context = $('#ai-generate-context').value.trim();
    const count = parseInt($('#ai-generate-count').value) || 10;
    const promptTemplate = $('#ai-generate-prompt').value.trim();
    
    if(!context){ alert('Bitte Thema/Kontext eingeben'); return; }
    if(!promptTemplate){ alert('Bitte Prompt-Vorlage eingeben'); return; }
    
    $('#ai-generate-start').disabled = true;
    $('#ai-generate-progress').textContent = 'Generiere Begriffe...';
    
    try {
      // Erstelle Prompt aus Template
      const prompt = promptTemplate
        .replace(/\{anzahl\}/g, count)
        .replace(/\{kontext\}/g, context);
      
      const systemPrompt = 'Du bist ein Lernkarten-Assistent. Erstelle präzise Fachbegriffslisten ohne zusätzliche Erklärungen.';
      const result = await AI.generate(systemPrompt, prompt);
      
      // Parse die Liste (eine Zeile pro Begriff)
      const terms = result.split('\n')
        .map(line => line.trim())
        .map(line => line.replace(/^[\d\.\-\*]+ /, '')) // Entferne Nummerierung/Bullets
        .filter(line => line && line.length > 0);
      
      if(terms.length === 0){
        throw new Error('KI hat keine Begriffe zurückgegeben');
      }
      
      // Erstelle neues Thema
      const topicId = uid();
      const parentFolderId = state.ui.selectedTopicId ? (state.data.topics.find(t=>t.id===state.ui.selectedTopicId)?.folderId || null) : null;
      state.data.topics.push({ 
        id: topicId, 
        name: context, 
        answerMode: 'type',
        folderId: parentFolderId
      });
      
      // Erstelle neue Karten in diesem Thema
      let added = 0;
      for(const term of terms){
        state.data.cards.push({
          id: uid(),
          topicId: topicId,
          term: term,
          description: '',
          answer: '',
          mcOptions: [],
          stats: baseStats()
        });
        added++;
      }
      
      Storage.save();
      populateAllSelects();
      renderTopics();
      
      // Wähle das neue Thema aus
      state.ui.selectedTopicId = topicId;
      if(window.__updateManageHeaderUI) window.__updateManageHeaderUI();
      renderCardsTable();
      
      $('#ai-generate-progress').textContent = `✓ Neues Thema "${context}" mit ${added} Begriff(en) erstellt!`;
      
      // Dialog nach 2 Sekunden schließen
      setTimeout(() => {
        $('#ai-generate-dialog').close();
      }, 2000);
      
    } catch(err){
      console.error('Fehler beim Generieren:', err);
      $('#ai-generate-progress').textContent = 'Fehler: ' + err.message;
    }
    
    $('#ai-generate-start').disabled = false;
  }
  
  async function startAiFill(){
    const topicId = $('#manage-topic').value;
    const target = $('#ai-fill-target').value;
    const source = $('#ai-fill-source').value;
    const promptTemplate = $('#ai-fill-prompt').value.trim();
    const onlyEmpty = $('#ai-fill-only-empty').checked;
    
    if(!promptTemplate){ alert('Bitte Prompt-Vorlage eingeben'); return; }
    
    const cards = state.data.cards.filter(c => c.topicId === topicId);

    // Finde alle Karten, die gefüllt werden sollen
    const toFill = cards.filter(c => {
      if(!onlyEmpty) return true;
      if(target === 'description') return !c.description;
      if(target === 'answer') return !c.answer;
      if(target === 'mcOptions') return !(c.mcOptions && c.mcOptions.length >= 4);
      return false;
    });
    
    if(!toFill.length){
      $('#ai-fill-progress').textContent = 'Nichts zu tun – alle Karten bereits gefüllt.';
      return;
    }

    $('#ai-fill-start').disabled = true;
    $('#ai-fill-progress').textContent = `Sende 1 Prompt für ${toFill.length} Karte(n)...`;

    try {
      // Baue Batch-Prompt: wir schicken alle Karten auf einmal
      const items = toFill.map((c, idx) => ({
        idx,
        term: c.term || '',
        description: c.description || '',
        answer: c.answer || ''
      }));
      
      // Prompt-Instruktionen je Ziel
      const targetInstruction = {
        description: 'Fülle nur das Feld "description" (Umschreibung) prägnant in 1-2 Sätzen, nenne den Begriff nicht.',
        answer: 'Fülle nur das Feld "answer" (richtige Antwort) kurz und präzise.',
        mcOptions: 'Erstelle genau 4 Multiple-Choice-Antworten in "mcOptions" (Array). mcOptions[0] ist die richtige Antwort, mcOptions[1-3] sind falsche aber plausible Antworten. Füge außerdem "answer" identisch zu mcOptions[0] hinzu.'
      }[target];

      const promptBody = items.map(it => {
        let line = `- idx:${it.idx} term:${it.term}`;
        if(it.description) line += ` description:${it.description}`;
        if(it.answer) line += ` answer:${it.answer}`;
        return line;
      }).join('\n');

      const userPrompt = [
        'Du bist ein Lernkarten-Assistent. Bearbeite alle Einträge in einem Schritt.',
        targetInstruction,
        'Gib ausschließlich JSON als Array zurück, gleiche Reihenfolge wie gegeben.',
        'Schema pro Eintrag:',
        target === 'mcOptions'
          ? '{ idx:number, term:string, mcOptions:[string,string,string,string], answer:string }'
          : target === 'answer'
            ? '{ idx:number, term:string, answer:string }'
            : '{ idx:number, term:string, description:string }',
        'Eingabe-Einträge:',
        promptBody
      ].join('\n');

      const systemPrompt = 'Antworte nur mit gültigem JSON. Keine Kommentare, keine zusätzlichen Texte.';
      const result = await AI.generate(systemPrompt, userPrompt);

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch(parseErr){
        throw new Error('KI-Antwort war kein valides JSON');
      }
      if(!Array.isArray(parsed)) throw new Error('KI-Antwort ist kein Array');

      let filled = 0;
      for(const item of parsed){
        const card = toFill[item.idx];
        if(!card) continue;
        if(target === 'description' && typeof item.description === 'string'){
          card.description = item.description.trim();
          filled++;
        } else if(target === 'answer' && typeof item.answer === 'string'){
          card.answer = item.answer.trim();
          filled++;
        } else if(target === 'mcOptions' && Array.isArray(item.mcOptions) && item.mcOptions.length >= 4){
          card.mcOptions = item.mcOptions.slice(0,4).map(x => (x||'').toString().trim());
          card.answer = card.mcOptions[0] || '';
          filled++;
        }
      }

      Storage.save();
      renderCardsTable();
      $('#ai-fill-progress').textContent = `Fertig! ${filled} Karte(n) aktualisiert (1 Prompt gesendet).`;
    } catch(err){
      console.error('Fehler beim Batch-Füllen:', err);
      $('#ai-fill-progress').textContent = 'Fehler: ' + err.message;
    }

    $('#ai-fill-start').disabled = false;
  }
  
  function renderFolderTree(){
    const ul = $('#folder-tree');
    if(!ul) return;
    ul.innerHTML = '';
    
    // Render Ordner mit ihren Themen
    for(const f of state.data.folders){
      const folderTopics = state.data.topics.filter(t => t.folderId === f.id);
      const isCollapsed = !!state.ui.collapsedFolders[f.id];
      
      // Ordner-Element
      const folderLi = document.createElement('li');
      folderLi.style.marginBottom = '12px';
      
      const folderRow = document.createElement('div');
      folderRow.style.display = 'flex';
      folderRow.style.justifyContent = 'space-between';
      folderRow.style.alignItems = 'center';
      folderRow.style.padding = '8px';
      folderRow.style.backgroundColor = 'var(--bg-secondary)';
      folderRow.style.borderRadius = '6px';
      folderRow.style.fontWeight = '600';
      const left = document.createElement('span');
      left.innerHTML = `${isCollapsed ? '▶' : '▼'} 📁 ${f.name} <span class="muted small" style="font-weight: normal;">(${folderTopics.length} Themen)</span>`;
      left.style.cursor = 'pointer';
      left.onclick = () => {
        state.ui.collapsedFolders[f.id] = !isCollapsed;
        renderFolderTree();
      };
      
      const folderBtnGroup = document.createElement('div');
      folderBtnGroup.style.display = 'flex';
      folderBtnGroup.style.gap = '6px';
      
      const renameFolder = document.createElement('button');
      renameFolder.textContent = '✏️';
      renameFolder.className = 'ghost';
      renameFolder.onclick = () => {
        const newName = prompt('Neuer Ordnername:', f.name);
        if(newName === null) return;
        const name = newName.trim();
        if(!name) return;
        f.name = name;
        Storage.save();
        populateAllSelects();
        renderFolderTree();
      };
      
      const deleteFolder = document.createElement('button');
      deleteFolder.textContent = '🗑️';
      deleteFolder.className = 'ghost';
      deleteFolder.onclick = () => {
        if(!confirm('Ordner löschen? (Themen bleiben erhalten)')) return;
        state.data.topics.forEach(t => {
          if(t.folderId === f.id) delete t.folderId;
        });
        state.data.folders = state.data.folders.filter(x => x.id !== f.id);
        if(state.ui.selectedFolderId === f.id) state.ui.selectedFolderId = null;
        Storage.save();
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
      };
      
      folderRow.appendChild(left);
      folderBtnGroup.appendChild(renameFolder);
      folderBtnGroup.appendChild(deleteFolder);
      folderRow.appendChild(folderBtnGroup);
      folderLi.appendChild(folderRow);
      
      // Themen unter diesem Ordner (eingerückt)
      if(folderTopics.length > 0 && !isCollapsed){
        const topicsUl = document.createElement('ul');
        topicsUl.style.marginLeft = '24px';
        topicsUl.style.marginTop = '8px';
        topicsUl.style.listStyle = 'none';
        topicsUl.style.padding = '0';
        
        for(const t of folderTopics){
          const topicLi = createTopicElement(t);
          topicsUl.appendChild(topicLi);
        }
        
        folderLi.appendChild(topicsUl);
      }
      
      ul.appendChild(folderLi);
    }
    
    // Render Themen ohne Ordner
    const orphanTopics = state.data.topics.filter(t => !t.folderId);
    if(orphanTopics.length > 0){
      const orphanHeader = document.createElement('li');
      orphanHeader.style.marginTop = '16px';
      orphanHeader.style.marginBottom = '8px';
      orphanHeader.innerHTML = '<div style="padding: 8px; font-weight: 600; color: var(--text-muted);">📝 Themen ohne Ordner</div>';
      ul.appendChild(orphanHeader);
      
      for(const t of orphanTopics){
        const topicLi = createTopicElement(t);
        topicLi.style.marginLeft = '24px';
        ul.appendChild(topicLi);
      }
    }
  }
  
  function createTopicElement(t){
    const count = state.data.cards.filter(c=>c.topicId===t.id).length;
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.flexDirection = 'column';
    li.style.gap = '8px';
    li.style.marginBottom = '8px';
    li.style.padding = '8px';
    li.style.backgroundColor = 'var(--bg)';
    li.style.border = '1px solid var(--border)';
    li.style.borderRadius = '4px';
    
    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'center';
    topRow.innerHTML = `<span>📝 ${t.name} <span class="muted small">(${count} Karten)</span></span>`;
    // Auswahl durch Klick auf den linken Bereich
    const leftClickable = topRow.querySelector('span');
    leftClickable.style.cursor = 'pointer';
    leftClickable.onclick = () => {
      state.ui.selectedTopicId = t.id;
      renderCardsTable();
      if(window.__updateManageHeaderUI) window.__updateManageHeaderUI();
      // Markierung
      $$('#folder-tree li').forEach(el => el.style.outline = '');
      li.style.outline = '2px solid var(--primary)';
    };
    
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '6px';
    
    const moveBtn = document.createElement('button');
    moveBtn.textContent = '📁';
    moveBtn.title = 'Ordner ändern';
    moveBtn.className = 'ghost';
    moveBtn.onclick = () => {
      window.openMoveTopicDialog(t);
    };
    
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.className = 'ghost';
    renameBtn.onclick = () => {
      const newName = prompt('Neuer Themenname:', t.name);
      if(newName === null) return;
      const name = newName.trim();
      if(!name) return;
      t.name = name;
      Storage.save();
      populateAllSelects();
      renderFolderTree();
      renderCardsTable();
    };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.className = 'ghost';
    deleteBtn.onclick = () => {
      if(!confirm('Thema inkl. Karten löschen?')) return;
      state.data.cards = state.data.cards.filter(c=>c.topicId!==t.id);
      state.data.topics = state.data.topics.filter(x=>x.id!==t.id);
      Storage.save();
      populateAllSelects();
      renderFolderTree();
      renderCardsTable();
    };
    
    btnGroup.appendChild(moveBtn);
    btnGroup.appendChild(renameBtn);
    btnGroup.appendChild(deleteBtn);
    topRow.appendChild(btnGroup);
    
    li.appendChild(topRow);
    
    return li;
  }

  function renderCardsTable(){
    const topicId = state.ui.selectedTopicId || (state.data.topics[0]&&state.data.topics[0].id);
    if(!topicId){ 
      $('#card-table thead').innerHTML = '';
      $('#card-table tbody').innerHTML = ''; 
      return; 
    }
    
    const topic = state.data.topics.find(t => t.id === topicId);
    const answerMode = topic?.answerMode || 'type';
    const table = $('#card-table');
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    
    // Tabellen-Header je nach Antwortmodus anpassen
    if(answerMode === 'multiple-choice'){
      thead.innerHTML = `
        <tr>
          <th>Begriff</th>
          <th>Umschreibung</th>
          <th>MC-Optionen (1=Richtig)</th>
          <th>Stats</th>
          <th>Aktionen</th>
        </tr>`;
    } else if(answerMode === 'judge'){
      thead.innerHTML = `
        <tr>
          <th>Begriff</th>
          <th>Umschreibung</th>
          <th>Richtige Antwort</th>
          <th>Stats</th>
          <th>Aktionen</th>
        </tr>`;
    } else {
      thead.innerHTML = `
        <tr>
          <th>Begriff</th>
          <th>Umschreibung</th>
          <th>Antwort</th>
          <th>Stats</th>
          <th>Aktionen</th>
        </tr>`;
    }

    // Dynamische Spaltenbreiten für die ersten drei Inhalts-Spalten
    const cards = state.data.cards.filter(c=>c.topicId===topicId);
    const perc = (function(){
      const n = Math.max(1, cards.length);
      let t=1,d=1,a=1;
      for(const c of cards){
        t += (c.term||'').length;
        d += (c.description||'').length;
        if(answerMode==='multiple-choice'){
          const opts = c.mcOptions||[];
          const avg = opts.length ? opts.map(x=> (x||'').length).reduce((x,y)=>x+y,0)/opts.length : (c.answer||'').length;
          a += avg;
        } else {
          a += (c.answer||c.term||'').length;
        }
      }
      t = t/n; d = d/n; a = a/n;
      const rem = 70; // Rest für die ersten drei Spalten
      const sum = t+d+a || 1;
      let pT = Math.max(18, Math.round(rem * t / sum));
      let pD = Math.max(30, Math.round(rem * d / sum));
      let pA = Math.max(22, Math.round(rem * a / sum));
      const diff = (pT+pD+pA) - rem;
      if(diff>0){
        // Abziehen von der größten Spalte
        const arr = [ ['T',pT], ['D',pD], ['A',pA] ].sort((x,y)=>y[1]-x[1]);
        if(arr[0][0]==='D') pD -= diff; else if(arr[0][0]==='A') pA -= diff; else pT -= diff;
      } else if(diff<0){
        pD += -diff;
      }
      return { pT, pD, pA, pS: 18, pX: 12 };
    })();

    let colgroup = table.querySelector('colgroup');
    if(!colgroup){
      colgroup = document.createElement('colgroup');
      table.insertBefore(colgroup, thead);
    }
    colgroup.innerHTML = `
      <col style="width:${perc.pT}%">
      <col style="width:${perc.pD}%">
      <col style="width:${perc.pA}%">
      <col style="width:${perc.pS}%">
      <col style="width:${perc.pX}%">`;
    
    tbody.innerHTML = '';
    for(const c of cards){
      const tr = document.createElement('tr');
      const s = c.stats || baseStats();
      
      let extraColumn = '';
      if(answerMode === 'multiple-choice'){
        const opts = c.mcOptions || [];
        const optionsText = opts.map((o,i) => `${i+1}. ${escapeHtml(o||'—')}`).join('<br>');
        extraColumn = `<td class="small">${optionsText || '—'}</td>`;
      } else if(answerMode === 'judge'){
        extraColumn = `<td>${escapeHtml(c.answer||'—')}</td>`;
      } else {
        extraColumn = `<td>${escapeHtml(c.answer||c.term||'—')}</td>`;
      }
      
      tr.innerHTML = `
        <td>${escapeHtml(c.term)}</td>
        <td>${escapeHtml(c.description||'—')}</td>
        ${extraColumn}
        <td class="small muted">Box ${s.box} · ${s.correct}/${s.total}</td>
        <td>
          <button class="ghost" data-edit title="Bearbeiten">✏️</button>
          <button class="ghost" data-delete title="Löschen">🗑️</button>
        </td>`;
      tr.querySelector('[data-edit]').onclick = ()=>openCardDialog(c);
      tr.querySelector('[data-delete]').onclick = ()=>{
        state.data.cards = state.data.cards.filter(x=>x.id!==c.id);
        Storage.save();
        renderCardsTable();
      };
      tbody.appendChild(tr);
    }

    // Header-Status aktualisieren
    if(window.__updateManageHeaderUI) window.__updateManageHeaderUI();
  }

  function openCardDialog(card){
    const dlg = $('#card-dialog');
    const topicId = card?.topicId || state.ui.selectedTopicId;
    const topic = state.data.topics.find(t => t.id === topicId);
    const answerMode = topic?.answerMode || 'type';
    
    $('#card-dialog-title').textContent = card? 'Karte bearbeiten' : 'Neue Karte';
    $('#card-term').value = card?.term||'';
    $('#card-desc').value = card?.description||'';
    
    // Modus anzeigen
    const modeMap = { 'type': 'Tippen', 'judge': 'Richtig/Falsch', 'multiple-choice': 'Multiple Choice (4 Optionen)' };
    const modeInfo = $('#mode-info');
    if(modeInfo) modeInfo.textContent = `Modus: ${modeMap[answerMode] || answerMode}`;
    
    // Immer vier Antwortfelder zeigen und befüllen
    const mcArea = $('#mc-options-area');
    mcArea.style.display = 'block';
    const opts = (card?.mcOptions && Array.isArray(card.mcOptions)) ? card.mcOptions.slice(0,4) : [];
    if(!opts[0] && card?.answer) opts[0] = card.answer;
    $('#card-mc-option-1').value = opts[0] || '';
    $('#card-mc-option-2').value = opts[1] || '';
    $('#card-mc-option-3').value = opts[2] || '';
    $('#card-mc-option-4').value = opts[3] || '';
    
    dlg.returnValue = '';
    dlg.showModal();
    $('#card-save').onclick = (e) => {
      e.preventDefault();
      const topicId = state.ui.selectedTopicId || (state.data.topics[0]&&state.data.topics[0].id) || null;
      if(!topicId){ alert('Bitte zuerst ein Thema anlegen.'); return; }
      
      const mcOptions = [
        $('#card-mc-option-1').value.trim(),
        $('#card-mc-option-2').value.trim(),
        $('#card-mc-option-3').value.trim(),
        $('#card-mc-option-4').value.trim()
      ];
      const payload = {
        term: $('#card-term').value.trim(),
        description: $('#card-desc').value.trim(),
        answer: mcOptions[0] || '',
        mcOptions
      };
      
      // Validierung nur im Multiple-Choice-Modus
      const t = state.data.topics.find(t => t.id === topicId);
      if(t?.answerMode === 'multiple-choice' && !payload.mcOptions[0]){
        alert('Antwort 1 (richtige Antwort) ist erforderlich!');
        return;
      }
      
      if(!payload.term){ alert('Begriff ist erforderlich'); return; }
      if(card){
        Object.assign(card, payload);
      } else {
        state.data.cards.push({ id: uid(), topicId, ...payload, stats: baseStats() });
      }
      Storage.save();
      dlg.close();
      renderCardsTable();
    };
  }

  // --- Learn ---
  function bindLearn(){
    // Ordner-Filter für Lernen
    const learnFolder = $('#learn-folder');
    if(learnFolder){
      learnFolder.addEventListener('change', (e) => {
        state.ui.selectedFolderId = e.target.value || null;
        populateAllSelects();
      });
    }
    
    // Kartenanzahl-Buttons
    let selectedCardCount = null;
    
    const updateCardCountButtons = () => {
      $$('#cards-5, #cards-10, #cards-20, #cards-all').forEach(btn => {
        btn.classList.remove('primary');
        btn.classList.add('ghost');
      });
    };
    
    $('#cards-5').addEventListener('click', () => {
      selectedCardCount = 5;
      updateCardCountButtons();
      $('#cards-5').classList.remove('ghost');
      $('#cards-5').classList.add('primary');
    });
    
    $('#cards-10').addEventListener('click', () => {
      selectedCardCount = 10;
      updateCardCountButtons();
      $('#cards-10').classList.remove('ghost');
      $('#cards-10').classList.add('primary');
    });
    
    $('#cards-20').addEventListener('click', () => {
      selectedCardCount = 20;
      updateCardCountButtons();
      $('#cards-20').classList.remove('ghost');
      $('#cards-20').classList.add('primary');
    });
    
    $('#cards-all').addEventListener('click', () => {
      selectedCardCount = null;
      updateCardCountButtons();
      $('#cards-all').classList.remove('ghost');
      $('#cards-all').classList.add('primary');
    });
    
    // Standard: "Alle" auswählen
    $('#cards-all').click();
    
    $('#start-session').addEventListener('click', () => {
      const displayMode = $('#display-mode').value;
      const ttsMode = $('#tts-mode').value;
      startSession(selectedCardCount, displayMode, ttsMode);
    });
    $('#end-session').addEventListener('click', endSession);
    $('#check-answer').addEventListener('click', () => checkAnswer());
    $('#answer-input').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); checkAnswer(); }});
    $('#mark-correct').addEventListener('click', ()=>finishAnswer(true));
    $('#mark-wrong').addEventListener('click', ()=>finishAnswer(false));
    $('#skip-card').addEventListener('click', ()=>nextCard());
    $('#replay-tts').addEventListener('click', ()=>{
      const mode = state.session.mode;
      const isTTS = mode.startsWith('tts-');
      
      if(!isTTS || !state.session.current) return;
      
      // Mode ist z.B. 'tts-umschreibung-begriff'
      const parts = mode.split('-');
      const speakPart = parts[2]; // 'umschreibung' oder 'begriff'
      
      if(speakPart === 'umschreibung'){
        TTS.speakQuestion(state.session.current.description || '');
      } else {
        TTS.speakQuestion(state.session.current.term);
      }
    });
    
    // Weiter-Button nach falscher Antwort
    $('#continue-after-wrong').addEventListener('click', () => {
      finishAnswer(false);
    });

    // Klick auf den Stempel startet die nächste Frage (egal ob richtig oder falsch)
    $('#answer-stamp').addEventListener('click', () => {
      const stamp = $('#answer-stamp');
      const isClickable = stamp.dataset.clickToContinue === 'true' || stamp.classList.contains('correct');
      if(isClickable && state.session.current){
        stamp.dataset.clickToContinue = '';
        // Gehe zur nächsten Karte (buche Ergebnis)
        const correct = stamp.classList.contains('correct');
        Scheduler.updateAfterAnswer(state.session.current, !!correct);
        state.session.answered += 1;
        if(correct) state.session.correct += 1;
        Storage.save();
        updateSessionStats();
        
        // Session-Ende prüfen
        if(state.session.maxCards && state.session.answered >= state.session.maxCards){
          endSession();
          alert(`Session beendet!\n\nRichtig: ${state.session.correct}\nBeantwortet: ${state.session.answered}\nErfolgsquote: ${Math.round(100*state.session.correct/state.session.answered)}%`);
          return;
        }
        
        nextCard();
      }
    });
    
    // Multiple Choice Buttons
    $$('.choice-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if(btn.disabled) return;
        const selectedAnswer = btn.dataset.answer;
        checkMultipleChoice(selectedAnswer);
      });
    });
  }

  function startSession(cardCount, displayMode, ttsMode){
    const topicId = $('#learn-topic').value;
    if(!topicId){ alert('Bitte ein Thema wählen'); return; }
    
    const topic = state.data.topics.find(t => t.id === topicId);
    
    // Bestimme Antwortmodus: Benutzer-Override oder Topic-Standard
    const modeOverride = $('#learn-mode').value;
    let answerMode = modeOverride || (topic?.answerMode || 'type');
    
    // Baue Mode aus Answer-Modus und Display/TTS zusammen
    let mode = displayMode; // 'umschreibung' oder 'begriff'
    if(ttsMode !== 'none'){
      mode = 'tts-' + displayMode + '-' + ttsMode; // z.B. 'tts-umschreibung-begriff'
    }
    
    state.session.active = true;
    state.session.topicId = topicId;
    state.session.mode = mode;
    state.session.answerMode = answerMode; // Speichere den Antwortmodus
    state.session.answered = 0;
    state.session.correct = 0;
    state.session.maxCards = cardCount;
    state.session.selectedCardCount = cardCount;
    toggleLearnControls(true);
    nextCard();
  }

  function endSession(){
    state.session.active = false;
    state.session.current = null;
    toggleLearnControls(false);
    $('#prompt-text').textContent = 'Session beendet.';
  }

  function toggleLearnControls(running){
    $('#start-session').disabled = running;
    $('#end-session').disabled = !running;
    $('#check-answer').disabled = !running;
    $('#mark-correct').disabled = !running;
    $('#mark-wrong').disabled = !running;
    $('#skip-card').disabled = !running;
    $('#replay-tts').disabled = !running;
    $('#answer-input').value = '';
    $('#feedback').textContent = '';
    updateSessionStats();
  }

  function updateSessionStats(){
    const s = state.session;
    let statsText = '';
    if(s.active){
      statsText = `Richtig: ${s.correct} · Beantwortet: ${s.answered}`;
      if(s.maxCards){
        statsText += ` · Verbleibend: ${s.maxCards - s.answered}`;
      }
    }
    $('#session-stats').textContent = statsText;
  }

  function presentCard(card){
    const mode = state.session.mode;
    const promptTextEl = $('#prompt-text');
    let text = '';
    let speakText = '';
    
    // Parse Mode: 'umschreibung' | 'begriff' | 'tts-umschreibung-umschreibung' | 'tts-umschreibung-begriff' etc.
    const isTTS = mode.startsWith('tts-');
    
    if(isTTS){
      // Mode ist z.B. 'tts-umschreibung-begriff'
      const parts = mode.split('-');
      const displayPart = parts[1]; // 'umschreibung' oder 'begriff'
      const speakPart = parts[2]; // 'umschreibung' oder 'begriff'
      
      // Bestimme was angezeigt wird
      if(displayPart === 'umschreibung'){
        text = card.description || '(keine Umschreibung vorhanden)';
      } else {
        text = card.term;
      }
      
      // Bestimme was vorgelesen wird
      if(speakPart === 'umschreibung'){
        speakText = card.description || '(keine Umschreibung vorhanden)';
      } else {
        speakText = card.term;
      }
      
      TTS.speakQuestion(speakText);
    } else {
      // Nicht-TTS Modi
      if(mode === 'umschreibung'){
        text = card.description || '(keine Umschreibung vorhanden)';
      } else if(mode === 'begriff'){
        text = card.term;
      }
    }
    
    promptTextEl.textContent = text;
    
    // UI anpassen basierend auf Answer Mode (Session-Override oder Topic-Standard)
    const topic = state.data.topics.find(t => t.id === card.topicId);
    const answerMode = state.session.answerMode || topic?.answerMode || 'type';
    
    const answerInputContainer = $('#answer-input-container');
    const answerInput = $('#answer-input');
    const checkBtn = $('#check-answer');
    const markCorrect = $('#mark-correct');
    const markWrong = $('#mark-wrong');
    const multipleChoice = $('#multiple-choice-options');
    const mcButtons = $$('.choice-btn');

    // Default: hide/disable everything, then enable what the mode needs
    answerInputContainer.hidden = true;
    checkBtn.disabled = true;
    multipleChoice.hidden = true;
    mcButtons.forEach(btn => btn.disabled = true);
    markCorrect.hidden = true;
    markWrong.hidden = true;

    if(answerMode === 'type'){
      answerInputContainer.hidden = false;
      checkBtn.disabled = false;
      answerInput.focus();
    } else if(answerMode === 'judge'){
      markCorrect.hidden = false;
      markWrong.hidden = false;
    } else if(answerMode === 'multiple-choice'){
      multipleChoice.hidden = false;
      mcButtons.forEach(btn => btn.disabled = false);
      setupMultipleChoice(card);
    }
    
    $('#card-meta').textContent = `Thema: ${getTopicName(card.topicId)} · Box ${card.stats.box} · Fällig: ${card.stats.nextDue}`;
  }

  function nextCard(){
    if(!state.session.active) return;
    
    const card = Scheduler.nextForTopic(state.session.topicId);
    if(!card){
      $('#prompt-text').textContent = 'Keine Karten im Thema.';
      return;
    }
    
    // Stempel verstecken BEVOR neue Karte präsentiert wird
    const stamp = $('#answer-stamp');
    stamp.setAttribute('hidden', '');
    stamp.style.display = 'none';
    stamp.dataset.clickToContinue = '';
    
    state.session.current = card;
    $('#answer-input').value = '';
    $('#feedback').textContent = '';
    $('#correct-answer-display').hidden = true;
    presentCard(card);
  }

  function expectedAnswer(card){
    return (card.answer && card.answer.trim()) || card.term.trim();
  }

  function normalize(s){
    return s.toLowerCase().replace(/[\s\-_.]+/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }

  function showStamp(correct){
    const stamp = $('#answer-stamp');
    
    // Zuerst alle Attribute/Styles löschen die das Verstecken könnten
    stamp.removeAttribute('hidden');
    stamp.style.cssText = ''; // Alle inline-styles löschen
    stamp.style.setProperty('display', 'block', 'important');
    stamp.style.setProperty('visibility', 'visible', 'important');
    stamp.style.setProperty('opacity', '1', 'important');
    stamp.style.setProperty('position', 'absolute', 'important');
    stamp.style.setProperty('z-index', '9999', 'important');
    stamp.style.setProperty('width', '150px', 'important');
    stamp.style.setProperty('height', '150px', 'important');
    stamp.style.setProperty('top', '50%', 'important');
    stamp.style.setProperty('left', '50%', 'important');
    stamp.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
    // Animation neu starten (explizit setzen)
    stamp.style.animation = 'none';
    void stamp.offsetWidth; // Reflow
    stamp.style.animation = 'stampAppear 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
    
    // Klasse setzen
    stamp.className = 'answer-stamp ' + (correct ? 'correct' : 'wrong');
    // Beide sind klickbar (correct und wrong)
    stamp.dataset.clickToContinue = 'true';
    
    // SSML-Feedback mit Betonung abspielen
    const ttsMode = $('#tts-mode')?.value || 'none';
    if(ttsMode !== 'none'){
      TTS.speakFeedback(correct);
    }
    
    console.log('Stempel angezeigt:', correct ? 'RICHTIG ✓' : 'FALSCH ✗', 'Display:', stamp.style.display, 'Visibility:', stamp.style.visibility, 'getBoundingClientRect:', stamp.getBoundingClientRect());
    
    // Sound abspielen
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if(correct){
      // Erfolgs-Sound: Aufsteigender Ton
      oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime); // C5
      oscillator.frequency.exponentialRampToValueAtTime(783.99, audioContext.currentTime + 0.1); // G5
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } else {
      // Fehler-Sound: Absteigender Ton
      oscillator.frequency.setValueAtTime(392, audioContext.currentTime); // G4
      oscillator.frequency.exponentialRampToValueAtTime(196, audioContext.currentTime + 0.15); // G3
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.25);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.25);
    }
  }

  function setupMultipleChoice(card){
    const correctAnswer = expectedAnswer(card);
    let wrongAnswers = [];
    
    // Wenn Karte eigene MC-Optionen hat, verwende diese
    if(card.mcOptions && card.mcOptions.length >= 4){
      // Option 1 ist die richtige, 2-4 sind falsch
      const allOptions = [...card.mcOptions].sort(() => Math.random() - 0.5);
      
      const buttons = $$('.choice-btn');
      buttons.forEach((btn, idx) => {
        btn.textContent = allOptions[idx];
        btn.disabled = false;
        btn.className = 'choice-btn';
        btn.classList.remove('correct', 'wrong', 'selected');
        btn.dataset.answer = allOptions[idx];
      });
      
      // Richtige Antwort ist die erste MC-Option
      state.session.multipleChoiceCorrect = card.mcOptions[0];
      return;
    }
    
    // Fallback: Generiere aus anderen Karten im Thema
    const topicCards = state.data.cards.filter(c => c.topicId === card.topicId && c.id !== card.id);
    
    // Generiere 3 falsche Antworten
    const shuffled = [...topicCards].sort(() => Math.random() - 0.5);
    for(let i = 0; i < shuffled.length && wrongAnswers.length < 3; i++){
      const ans = expectedAnswer(shuffled[i]);
      if(ans !== correctAnswer){
        wrongAnswers.push(ans);
      }
    }
    
    // Falls nicht genug Karten im Thema, generiere Dummy-Antworten
    while(wrongAnswers.length < 3){
      wrongAnswers.push(`Falsche Option ${wrongAnswers.length + 1}`);
    }
    
    // Mische alle 4 Optionen
    const allOptions = [correctAnswer, ...wrongAnswers].sort(() => Math.random() - 0.5);
    
    // Setze die Buttons - Reset alle Styles
    const buttons = $$('.choice-btn');
    buttons.forEach((btn, idx) => {
      btn.textContent = allOptions[idx];
      btn.disabled = false;
      btn.className = 'choice-btn'; // Reset class
      btn.classList.remove('correct', 'wrong', 'selected');
      btn.dataset.answer = allOptions[idx];
    });
    
    // Speichere richtige Antwort für Vergleich
    state.session.multipleChoiceCorrect = correctAnswer;
  }

  function checkMultipleChoice(selectedAnswer){
    const correct = selectedAnswer === state.session.multipleChoiceCorrect;
    
    // Visuelles Feedback auf Buttons
    $$('.choice-btn').forEach(btn => {
      btn.disabled = true;
      if(btn.dataset.answer === state.session.multipleChoiceCorrect){
        btn.classList.add('correct');
      }
      if(btn.dataset.answer === selectedAnswer && !correct){
        btn.classList.add('wrong');
      }
    });
    
    // Stempel anzeigen
    showStamp(correct);
    
    // Text-Feedback
    $('#feedback').textContent = correct ? '✔️ Richtig!' : '✖ Falsch';
    
    // Bei falscher Antwort: Richtige Antwort prominent anzeigen
    const correctAnswerDisplay = $('#correct-answer-display');
    if(!correct){
      $('#correct-answer-text').textContent = state.session.multipleChoiceCorrect;
      correctAnswerDisplay.hidden = false;
      // Warte auf Klick vom Benutzer - kein automatisches Weiter
    } else {
      correctAnswerDisplay.hidden = true;
      // Bei richtiger Antwort automatisch weiter nach 1.5s
      setTimeout(() => finishAnswer(correct), 1500);
    }
  }

  function checkAnswer(){
    const card = state.session.current; if(!card) return;
    const given = $('#answer-input').value.trim();
    const expected = expectedAnswer(card);
    if(!given){ $('#feedback').textContent = 'Bitte eine Antwort eingeben.'; return; }
    
    // Exakte Übereinstimmung (keine Tippfehler erlaubt - Rechtschreibprüfung!)
    const correct = given === expected;
    
    // Visuelles Feedback: Stempel anzeigen
    showStamp(correct);
    
    // Text-Feedback
    $('#feedback').textContent = correct ? '✔️ Richtig!' : '❌ Falsch';
    
    // Bei falscher Antwort: Richtige Antwort prominent anzeigen
    const correctAnswerDisplay = $('#correct-answer-display');
    if(!correct){
      $('#correct-answer-text').textContent = expected;
      correctAnswerDisplay.hidden = false;
      // Warte auf Klick vom Benutzer - kein automatisches Weiter
    } else {
      correctAnswerDisplay.hidden = true;
      // Bei richtiger Antwort automatisch weiter nach 2s
      setTimeout(() => finishAnswer(correct), 2000);
    }
  }

  function finishAnswer(correct){
    if(!state.session.current) return;
    
    // Stempel für Judge-Modus (wenn er nicht schon von checkAnswer/checkMultipleChoice kam)
    const topic = state.data.topics.find(t => t.id === state.session.current.topicId);
    const answerMode = state.session.answerMode || topic?.answerMode || 'type';
    if(answerMode === 'judge'){
      showStamp(correct);
      $('#feedback').textContent = correct ? '✔️ Richtig!' : '❌ Falsch';
      // Kein Timeout – Benutzer klickt auf Stempel oder drückt Weiter-Button
      return;
    }
    
    Scheduler.updateAfterAnswer(state.session.current, !!correct);
    state.session.answered += 1;
    if(correct) state.session.correct += 1;
    Storage.save();
    updateSessionStats();
    
    // Prüfe ob maximale Anzahl erreicht wurde
    if(state.session.maxCards && state.session.answered >= state.session.maxCards){
      endSession();
      alert(`Session beendet!\n\nRichtig: ${state.session.correct}\nBeantwortet: ${state.session.answered}\nErfolgsquote: ${Math.round(100*state.session.correct/state.session.answered)}%`);
      return;
    }
    
    nextCard();
  }

  function fuzzyMatch(a,b){
    const na = normalize(a), nb = normalize(b);
    if(na===nb) return true;
    // allow small typos: Levenshtein distance <= 1 for length <= 6, <=2 otherwise
    const d = levenshtein(na, nb);
    const tol = nb.length<=6 ? 1 : 2;
    return d <= tol;
  }

  function levenshtein(a,b){
    const dp = Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
    for(let i=0;i<=a.length;i++) dp[i][0]=i;
    for(let j=0;j<=b.length;j++) dp[0][j]=j;
    for(let i=1;i<=a.length;i++){
      for(let j=1;j<=b.length;j++){
        const cost = a[i-1]===b[j-1]?0:1;
        dp[i][j] = Math.min(
          dp[i-1][j]+1,
          dp[i][j-1]+1,
          dp[i-1][j-1]+cost
        );
      }
    }
    return dp[a.length][b.length];
  }

  // --- Import/Export UI ---
  // Import Mapping State
  const importMapping = {
    fileContent: null,
    delimiter: ',',
    headers: [],
    rows: [],
    columnMapping: {}, // { fileColumn: 'term'|'description'|'answer'|'mc1'|'mc2'|'mc3'|'mc4'|'ignore' }
    parsedData: []
  };

  function bindImportExport(){

    // UI: Zeige/Verstecke Felder je nach Format
    $('#import-format').addEventListener('change', () => {
      const format = $('#import-format').value;
      $('#import-file-row').style.display = (format==='csv'||format==='json'||format==='text') ? '' : 'none';
      $('#import-list-row').style.display = (format==='list') ? '' : 'none';
      $('#import-list-mode-row').style.display = (format==='list') ? '' : 'none';
    });

    $('#run-import').addEventListener('click', async () => {
      const format = $('#import-format').value;
      const topicId = $('#import-topic').value || null;
      try {
        if(format==='list'){
          const raw = $('#import-list').value.trim();
          if(!raw){ $('#import-status').textContent = 'Bitte Liste eingeben.'; return; }
          const mode = $('#import-list-mode').value;
          let items = raw.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
          let rows = [];
          if(mode==='same'){
            rows = items.map(x=>({ term: x, answer: x }));
          } else if(mode==='pair'){
            for(let i=0;i<items.length-1;i+=2){
              rows.push({ term: items[i], answer: items[i+1] });
            }
            if(items.length%2===1){
              rows.push({ term: items[items.length-1], answer: items[items.length-1] });
            }
          } else if(mode==='triple'){
            for(let i=0;i<items.length-2;i+=3){
              rows.push({ 
                term: items[i], 
                description: items[i+1], 
                answer: items[i+2] 
              });
            }
            // Unvollständige Tripel werden ignoriert
          } else if(mode==='mc'){
            // 6er-Gruppen: 1. Begriff, 2. Umschreibung, 3-6. MC-Optionen (erste = richtig)
            for(let i=0;i<items.length-5;i+=6){
              rows.push({ 
                term: items[i], 
                description: items[i+1], 
                answer: items[i+2],
                mcOptions: [items[i+2], items[i+3], items[i+4], items[i+5]]
              });
            }
            // Unvollständige Gruppen werden ignoriert
          }
          const count = Importer.fromRows(rows, topicId);
          $('#import-status').textContent = `${count} ${count === 1 ? 'Karte' : 'Karten'} erfolgreich importiert`;
          populateAllSelects();
          renderCardsTable();
          return;
        }
        // Standard-Import
        const file = $('#import-file').files[0];
        const count = await Importer.fromFile(format, file, topicId);
        $('#import-status').textContent = `${count} ${count === 1 ? 'Karte' : 'Karten'} erfolgreich importiert`;
        populateAllSelects();
        renderCardsTable();
      } catch (e){
        console.error(e); $('#import-status').textContent = 'Import fehlgeschlagen';
      }
    });

    // Inhalt erkennen: Öffnet Import-Mapping-Dialog
    $('#detect-import').addEventListener('click', async () => {
      const format = $('#import-format').value;
      const fileInput = $('#import-file');
      
      if (format !== 'csv' && format !== 'text') {
        $('#import-status').textContent = 'Mapping ist nur für CSV/TSV verfügbar';
        return;
      }
      
      const file = fileInput.files[0];
      if (!file) {
        $('#import-status').textContent = 'Bitte zuerst eine Datei wählen';
        return;
      }
      
      try {
        // Datei laden
        const text = await file.text();
        importMapping.fileContent = text;
        
        // Delimiter erkennen
        importMapping.delimiter = guessDelimiter(text);
        
        // Initial parsen
        parseImportFile();
        
        // Dialog öffnen und Phase 1 zeigen
        openImportMappingDialog();
      } catch (e) {
        $('#import-status').textContent = 'Fehler beim Laden: ' + e.message;
      }
    });
    
    // Import Mapping Dialog Funktionen
    function parseImportFile() {
      const parsed = Papa.parse(importMapping.fileContent, {
        delimiter: importMapping.delimiter,
        skipEmptyLines: true
      });
      
      if (!parsed.data || parsed.data.length === 0) {
        throw new Error('Keine Daten gefunden');
      }
      
      // Erste Zeile als Header verwenden
      importMapping.headers = parsed.data[0].map((h, idx) => h || `Spalte ${idx + 1}`);
      importMapping.rows = parsed.data.slice(1);
      
      // Auto-Mapping basierend auf Header-Namen
      autoMapColumns();
    }
    
    function autoMapColumns() {
      importMapping.columnMapping = {};
      
      const normalizeKey = (k) => (k || '')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[ä]/g, 'ae')
        .replace(/[ö]/g, 'oe')
        .replace(/[ü]/g, 'ue')
        .replace(/[ß]/g, 'ss')
        .replace(/\s+/g, '')
        .replace(/_/g, '');
      
      importMapping.headers.forEach((header, idx) => {
        const norm = normalizeKey(header);
        const numMatch = norm.match(/([1-4])$/);
        const num = numMatch ? parseInt(numMatch[1], 10) : null;
        
        // Begriff/Frage/Aufgabe
        if (/^(begriff|term|name|titel|frage|question|aufgabe|prompt)$/.test(norm)) {
          importMapping.columnMapping[idx] = 'term';
          return;
        }
        // Umschreibung/Beschreibung/Erklaerung
        if (/^(umschreibung|description|desc|beschreibung|erklaerung|erklaerung|definition)$/.test(norm)) {
          importMapping.columnMapping[idx] = 'description';
          return;
        }
        // Antwort / Loesung / Richtige Loesung
        if (/^(antwort|answer|loesung|losung|solution)$/.test(norm) || (norm.includes('richtige') && (norm.includes('losung') || norm.includes('loesung')))) {
          importMapping.columnMapping[idx] = 'answer';
          return;
        }
        // Optionen mit Ziffern (Option1..4, Antwort1..4, Ans1..4)
        if (/(option|opt|antwort|answer|ans)[1-4]$/.test(norm) && num) {
          importMapping.columnMapping[idx] = 'mc' + num;
          return;
        }
        // Falsche 1..3 → mc2..mc4
        if (norm.includes('falsch') && num) {
          const mapNum = Math.min(4, Math.max(2, num + 1)); // 1->2, 2->3, 3->4
          importMapping.columnMapping[idx] = 'mc' + mapNum;
          return;
        }
        // Distractor/Wrong 1..3
        if ((norm.includes('wrong') || norm.includes('distractor')) && num) {
          const mapNum = Math.min(4, Math.max(2, num + 1));
          importMapping.columnMapping[idx] = 'mc' + mapNum;
          return;
        }
        
        importMapping.columnMapping[idx] = 'ignore';
      });
    }
    
    function openImportMappingDialog() {
      const dialog = $('#import-mapping-dialog');
      
      // Phase 1 zeigen
      $$('.import-phase').forEach(p => p.classList.remove('active'));
      $('.phase-1').classList.add('active');
      
      // Delimiter Buttons markieren
      $$('.delimiter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-delim') === importMapping.delimiter);
      });
      
      // Preview Tabelle rendern
      renderPreviewTable();
      
      dialog.showModal();
    }
    
    function renderPreviewTable() {
      const thead = $('#preview-header');
      const tbody = $('#preview-body');
      
      // Header
      thead.innerHTML = importMapping.headers.map(h => `<th>${h}</th>`).join('');
      
      // Erste 3 Zeilen
      tbody.innerHTML = importMapping.rows.slice(0, 3).map(row => 
        `<tr>${row.map(cell => `<td title="${cell || ''}">${cell || '—'}</td>`).join('')}</tr>`
      ).join('');
    }
    
    function renderMappingTable() {
      const tbody = $('#mapping-body');
      
      tbody.innerHTML = importMapping.headers.map((header, idx) => {
        const example = importMapping.rows[0]?.[idx] || '—';
        const currentMapping = importMapping.columnMapping[idx] || 'ignore';
        
        return `
          <tr>
            <td><strong>${header}</strong></td>
            <td>
              <select class="mapping-select" data-col-idx="${idx}">
                <option value="ignore" ${currentMapping === 'ignore' ? 'selected' : ''}>❌ Ignorieren</option>
                <option value="term" ${currentMapping === 'term' ? 'selected' : ''}>📝 Begriff</option>
                <option value="description" ${currentMapping === 'description' ? 'selected' : ''}>💬 Umschreibung</option>
                <option value="answer" ${currentMapping === 'answer' ? 'selected' : ''}>✅ Antwort</option>
                <option value="mc1" ${currentMapping === 'mc1' ? 'selected' : ''}>🅰️ MC Option 1 (richtig)</option>
                <option value="mc2" ${currentMapping === 'mc2' ? 'selected' : ''}>🅱️ MC Option 2</option>
                <option value="mc3" ${currentMapping === 'mc3' ? 'selected' : ''}>🅲 MC Option 3</option>
                <option value="mc4" ${currentMapping === 'mc4' ? 'selected' : ''}>🅳 MC Option 4</option>
              </select>
            </td>
            <td class="mapping-example" title="${example}">${example}</td>
          </tr>
        `;
      }).join('');
      
      // Event Listener für Mapping-Änderungen
      $$('.mapping-select').forEach(select => {
        select.addEventListener('change', (e) => {
          const idx = parseInt(e.target.getAttribute('data-col-idx'));
          importMapping.columnMapping[idx] = e.target.value;
          updateResultPreview();
        });
      });
      
      updateResultPreview();
    }
    
    function updateResultPreview() {
      const tbody = $('#result-preview');
      
      // Parse Daten mit aktuellem Mapping
      const previewRows = importMapping.rows.slice(0, 3).map(row => {
        const card = {
          term: '',
          description: '',
          answer: '',
          mcOptions: []
        };
        
        importMapping.headers.forEach((header, idx) => {
          const mapping = importMapping.columnMapping[idx];
          const value = row[idx] || '';
          
          if (mapping === 'term') card.term = value;
          else if (mapping === 'description') card.description = value;
          else if (mapping === 'answer') card.answer = value;
          else if (mapping === 'mc1') card.mcOptions[0] = value;
          else if (mapping === 'mc2') card.mcOptions[1] = value;
          else if (mapping === 'mc3') card.mcOptions[2] = value;
          else if (mapping === 'mc4') card.mcOptions[3] = value;
        });
        
        // Ensure correct answer is first MC option if present
        let opts = card.mcOptions.filter(Boolean);
        if (card.answer) {
          // Put answer first if not already
          if (!opts.length || (opts[0] !== card.answer)) {
            opts = [card.answer, ...opts];
          }
        }
        // Deduplicate and cap at 4
        const seen = new Set();
        card.mcOptions = opts.filter(v => {
          const key = (v || '').toString().trim();
          if (!key || seen.has(key)) return false;
          seen.add(key); return true;
        }).slice(0,4);
        
        return card;
      });
      
      tbody.innerHTML = previewRows.map(card => `
        <tr>
          <td title="${card.term}">${card.term || '—'}</td>
          <td title="${card.description}">${card.description || '—'}</td>
          <td title="${card.answer}">${card.answer || '—'}</td>
          <td title="${card.mcOptions.filter(Boolean).join(', ')}">${card.mcOptions.filter(Boolean).join(', ') || '—'}</td>
        </tr>
      `).join('');
    }
    
    function prepareFinalImport() {
      // Zähle Karten
      const count = importMapping.rows.length;
      $('#summary-count').textContent = count;
      
      // Topic Select befüllen
      const topicSelect = $('#mapping-target-topic');
      const topics = state.data.topics;
      topicSelect.innerHTML = `<option value="">(neues Thema aus Datei)</option>` + 
        topics.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
      
      // Aktuelles Thema auswählen wenn gesetzt
      const currentTopic = $('#import-topic').value;
      if (currentTopic) {
        topicSelect.value = currentTopic;
        const topic = topics.find(t => t.id === currentTopic);
        $('#summary-topic').textContent = topic ? topic.name : 'Neues Thema';
      } else {
        $('#summary-topic').textContent = 'Neues Thema';
      }
      
      topicSelect.addEventListener('change', (e) => {
        const topicId = e.target.value;
        if (topicId) {
          const topic = topics.find(t => t.id === topicId);
          $('#summary-topic').textContent = topic ? topic.name : 'Neues Thema';
        } else {
          $('#summary-topic').textContent = 'Neues Thema';
        }
      });
    }
    
    // Delimiter Button Clicks
    $$('.delimiter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delim = btn.getAttribute('data-delim');
        importMapping.delimiter = delim === '\t' ? '\t' : delim;
        
        // Buttons aktualisieren
        $$('.delimiter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Neu parsen
        parseImportFile();
        renderPreviewTable();
      });
    });
    
    // Phase Navigation
    $('#mapping-next-1')?.addEventListener('click', () => {
      $$('.import-phase').forEach(p => p.classList.remove('active'));
      $('.phase-2').classList.add('active');
      renderMappingTable();
    });
    
    $('#mapping-back-2')?.addEventListener('click', () => {
      $$('.import-phase').forEach(p => p.classList.remove('active'));
      $('.phase-1').classList.add('active');
    });
    
    $('#mapping-next-2')?.addEventListener('click', () => {
      $$('.import-phase').forEach(p => p.classList.remove('active'));
      $('.phase-3').classList.add('active');
      prepareFinalImport();
    });
    
    $('#mapping-back-3')?.addEventListener('click', () => {
      $$('.import-phase').forEach(p => p.classList.remove('active'));
      $('.phase-2').classList.add('active');
    });
    
    // Final Import
    $('#confirm-import')?.addEventListener('click', async () => {
      const topicId = $('#mapping-target-topic').value || null;
      
      try {
        // Konvertiere Rows zu Card-Objekten
        const cards = importMapping.rows.map(row => {
          const card = { term: '', description: '', answer: '', mcOptions: [] };
          
          importMapping.headers.forEach((header, idx) => {
            const mapping = importMapping.columnMapping[idx];
            const value = (row[idx] || '').toString().trim();
            
            if (mapping === 'term') card.term = value;
            else if (mapping === 'description') card.description = value;
            else if (mapping === 'answer') card.answer = value;
            else if (mapping === 'mc1') card.mcOptions[0] = value;
            else if (mapping === 'mc2') card.mcOptions[1] = value;
            else if (mapping === 'mc3') card.mcOptions[2] = value;
            else if (mapping === 'mc4') card.mcOptions[3] = value;
          });
          
          // Merge answer with MC options: ensure answer is first
          let opts = card.mcOptions.filter(Boolean);
          if (card.answer) {
            if (!opts.length || opts[0] !== card.answer) {
              opts = [card.answer, ...opts];
            }
          }
          // Deduplicate and cap at 4
          const seen = new Set();
          opts = opts.filter(v => {
            const key = (v || '').toString().trim();
            if (!key || seen.has(key)) return false; seen.add(key); return true;
          }).slice(0,4);
          card.mcOptions = opts;
          // If no MC options but answer exists, keep answer only
          if (!card.mcOptions.length && card.answer) {
            card.mcOptions = [card.answer];
          }
          if (!card.mcOptions.length) delete card.mcOptions;
          
          return card;
        }).filter(c => c.term); // Nur Karten mit Begriff
        
        // Import durchführen
        const count = Importer.fromRows(cards, topicId);
        
        // Schließen und Status anzeigen
        $('#import-mapping-dialog').close();
        $('#import-status').textContent = `✅ ${count} Karte(n) erfolgreich importiert!`;
        
        populateAllSelects();
        renderCardsTable();
      } catch (e) {
        console.error(e);
        $('#import-status').textContent = 'Fehler beim Import: ' + e.message;
      }
    });

    $('#run-export').addEventListener('click', () => {
      const format = $('#export-format').value;
      const topicId = $('#export-topic').value || null;
      if(format==='json'){
        Storage.exportJSON(topicId);
      } else if(format==='csv'){
        const rows = (topicId? state.data.cards.filter(c=>c.topicId===topicId) : state.data.cards)
          .map(c=>({ topic: getTopicName(c.topicId), term: c.term, description: c.description, answer: c.answer||'' }));
        const csv = Papa.unparse(rows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'lernKarten_export.csv'; a.click(); URL.revokeObjectURL(url);
      }
    });

    $('#drive-load').addEventListener('click', ()=>Drive.load());
    $('#drive-save').addEventListener('click', ()=>Drive.save());
  }

  // --- Settings ---
  function bindSettings(){
    $('#tts-test').addEventListener('click', () => {
      const text = 'Dies ist ein Stimmtest.';
      TTS.speakDirect(text);
    });
    $('#tts-lang').addEventListener('change', (e)=>{ state.data.settings.tts.lang = e.target.value; Storage.save(); refreshVoiceSelectors(); });
    $('#tts-voice').addEventListener('change', (e)=>{ state.data.settings.tts.voiceURI = e.target.value; Storage.save(); });
    $('#tts-rate').addEventListener('input', (e)=>{ state.data.settings.tts.rate = parseFloat(e.target.value); Storage.save(); });

    // KI-Auswahl und Felder initialisieren
    $('#ai-provider').value = state.data.settings.ai.provider || 'openai';
    $('#ai-key-openai').value = state.data.settings.ai.keyOpenai || '';
    $('#ai-key-grok').value = state.data.settings.ai.keyGrok || '';
    $('#ai-endpoint').value = state.data.settings.ai.endpoint || '';
    $('#ai-key').value = state.data.settings.ai.apiKey || '';
    $('#drive-client-id').value = state.data.settings.drive.clientId || '';

    function updateAIFields() {
      const p = $('#ai-provider').value;
      $('#ai-openai-row').style.display = (p==='openai') ? '' : 'none';
      $('#ai-grok-row').style.display = (p==='grok') ? '' : 'none';
      $('#ai-custom-row').style.display = (p==='custom') ? '' : 'none';
    }
    $('#ai-provider').addEventListener('change', e => {
      state.data.settings.ai.provider = e.target.value;
      Storage.save();
      updateAIFields();
    });
    updateAIFields();

    $('#ai-key-openai').addEventListener('input',e=>{ state.data.settings.ai.keyOpenai = e.target.value.trim(); Storage.save(); });
    $('#ai-key-grok').addEventListener('input',e=>{ state.data.settings.ai.keyGrok = e.target.value.trim(); Storage.save(); });
    $('#ai-endpoint').addEventListener('input',(e)=>{ state.data.settings.ai.endpoint = e.target.value.trim(); Storage.save(); });
    $('#ai-key').addEventListener('input',(e)=>{ state.data.settings.ai.apiKey = e.target.value.trim(); Storage.save(); });
    $('#drive-client-id').addEventListener('input',(e)=>{ state.data.settings.drive.clientId = e.target.value.trim(); Storage.save(); });

    $('#test-ai').addEventListener('click', async ()=>{
      try {
        const msg = await AI.describe('Photosynthese');
        $('#ai-status').textContent = `OK: ${msg.slice(0,80)}…`;
      } catch(e){
        let detail = '';
        if(e && e.response) {
          detail = ` (Status: ${e.response.status})`;
        } else if(e && e.message) {
          detail = ` (${e.message})`;
        } else if(typeof e === 'string') {
          detail = ` (${e})`;
        }
        if(e && e.body) {
          detail += `\n${JSON.stringify(e.body)}`;
        }
        $('#ai-status').textContent = 'KI-Fehler: ' + detail;
      }
    });

    $('#drive-auth').addEventListener('click', ()=>Drive.auth());
    $('#drive-signout').addEventListener('click', ()=>Drive.signout());
  }

  // --- Stats ---
  let overviewChart = null;
  function renderStats(){
    const selectedId = state.ui.selectedStatsId;
    const selectedType = state.ui.selectedStatsType;
    const isGlobal = !selectedId;
    
    // Filter Daten nach Auswahl
    let topics, cards;
    if(isGlobal){
      topics = state.data.topics;
      cards = state.data.cards;
    } else if(selectedType === 'folder'){
      // Alle Themen in diesem Ordner
      topics = state.data.topics.filter(t => t.folderId === selectedId);
      const topicIds = topics.map(t => t.id);
      cards = state.data.cards.filter(c => topicIds.includes(c.topicId));
    } else if(selectedType === 'topic'){
      // Nur dieses eine Thema
      topics = state.data.topics.filter(t => t.id === selectedId);
      cards = state.data.cards.filter(c => c.topicId === selectedId);
    } else {
      topics = state.data.topics;
      cards = state.data.cards;
    }
    
    const today = todayISO();
    
    // Metriken
    $('#stat-total-cards').textContent = cards.length;
    $('#stat-total-topics').textContent = topics.length;
    
    const due = cards.filter(c=>(c.stats?.nextDue||today) <= today);
    $('#stat-due-today').textContent = due.length;
    
    const mastered = cards.filter(c=> (c.stats?.box||1) === 5);
    $('#stat-mastered').textContent = mastered.length;
    
    // Box-Verteilung mit Balken
    const boxDist = $('#box-distribution');
    boxDist.innerHTML = '';
    const boxColors = {
      1: '#ef4444',  // rot
      2: '#f59e0b',  // orange
      3: '#eab308',  // gelb
      4: '#22c55e',  // grün
      5: '#7c3aed'   // violett
    };
    
    for(let box = 1; box <= 5; box++){
      const count = cards.filter(c=> (c.stats?.box||1) === box).length;
      const percent = cards.length > 0 ? Math.round(100 * count / cards.length) : 0;
      
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '12px';
      
      const label = document.createElement('div');
      label.style.minWidth = '60px';
      label.style.fontSize = '14px';
      label.style.fontWeight = '500';
      label.textContent = `Box ${box}`;
      
      const barContainer = document.createElement('div');
      barContainer.style.flex = '1';
      barContainer.style.height = '24px';
      barContainer.style.backgroundColor = 'var(--bg-secondary)';
      barContainer.style.borderRadius = '4px';
      barContainer.style.overflow = 'hidden';
      barContainer.style.position = 'relative';
      
      const bar = document.createElement('div');
      bar.style.height = '100%';
      bar.style.width = percent + '%';
      bar.style.backgroundColor = boxColors[box];
      bar.style.transition = 'width 0.3s ease';
      
      const countLabel = document.createElement('div');
      countLabel.style.position = 'absolute';
      countLabel.style.left = '8px';
      countLabel.style.top = '50%';
      countLabel.style.transform = 'translateY(-50%)';
      countLabel.style.fontSize = '13px';
      countLabel.style.fontWeight = '600';
      countLabel.style.color = percent > 15 ? '#fff' : 'var(--text)';
      countLabel.textContent = `${count} (${percent}%)`;
      
      barContainer.appendChild(bar);
      barContainer.appendChild(countLabel);
      row.appendChild(label);
      row.appendChild(barContainer);
      boxDist.appendChild(row);
    }
    
    // Themen-Übersicht (nur verstecken wenn einzelnes Thema gewählt)
    const topicOverviewCard = $('#topic-overview-card');
    const topicStatsContainer = $('#topic-stats');
    
    if(selectedType === 'topic'){
      // Einzelnes Thema: Übersicht ausblenden
      if(topicOverviewCard) topicOverviewCard.style.display = 'none';
    } else {
      // Global oder Ordner: Übersicht anzeigen
      if(topicOverviewCard) topicOverviewCard.style.display = 'block';
      topicStatsContainer.innerHTML = '';
      
      if(topics.length === 0){
        topicStatsContainer.innerHTML = '<p class="muted">Keine Themen vorhanden</p>';
      } else {
      for(const topic of topics){
        const topicCards = cards.filter(c => c.topicId === topic.id);
        if(topicCards.length === 0) continue;
        
        const row = document.createElement('div');
        row.style.marginBottom = '20px';
        row.style.padding = '12px';
        row.style.backgroundColor = 'var(--bg-secondary)';
        row.style.borderRadius = '6px';
        
        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.marginBottom = '8px';
        
        const name = document.createElement('div');
        name.style.fontWeight = '600';
        name.textContent = topic.name;
        
        const counts = document.createElement('div');
        counts.style.fontSize = '13px';
        counts.className = 'muted';
        const topicDue = topicCards.filter(c=>(c.stats?.nextDue||today) <= today).length;
        const topicMastered = topicCards.filter(c=> (c.stats?.box||1) === 5).length;
        counts.textContent = `${topicCards.length} Karten · ${topicDue} fällig · ${topicMastered} gemeistert`;
        
        header.appendChild(name);
        header.appendChild(counts);
        
        // Fortschrittsbalken
        const progressBar = document.createElement('div');
        progressBar.style.height = '8px';
        progressBar.style.backgroundColor = 'var(--bg)';
        progressBar.style.borderRadius = '4px';
        progressBar.style.overflow = 'hidden';
        progressBar.style.display = 'flex';
        
        // Segmente für jede Box
        for(let box = 1; box <= 5; box++){
          const boxCount = topicCards.filter(c=> (c.stats?.box||1) === box).length;
          const boxPercent = topicCards.length > 0 ? (100 * boxCount / topicCards.length) : 0;
          
          if(boxPercent > 0){
            const segment = document.createElement('div');
            segment.style.width = boxPercent + '%';
            segment.style.height = '100%';
            segment.style.backgroundColor = boxColors[box];
            segment.title = `Box ${box}: ${boxCount} Karten`;
            progressBar.appendChild(segment);
          }
        }
        
        row.appendChild(header);
        row.appendChild(progressBar);
        topicStatsContainer.appendChild(row);
      }
    }
    }
    
    // Schwierigste Karten
    const hardest = [...cards]
      .filter(c=>c.stats && c.stats.total>=3)
      .sort((a,b)=> {
        const rateA = a.stats.total ? a.stats.correct/a.stats.total : 1;
        const rateB = b.stats.total ? b.stats.correct/b.stats.total : 1;
        return rateA - rateB;
      })
      .slice(0,30);
    
    const hardList = $('#hardest-cards');
    hardList.innerHTML = '';
    
    if(hardest.length === 0){
      hardList.innerHTML = '<li class="muted">Noch keine Lernstatistiken verfügbar</li>';
    } else {
      hardest.forEach(c=>{
        const rate = c.stats.total ? Math.round(100*c.stats.correct/c.stats.total) : 0;
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        
        const left = document.createElement('span');
        left.textContent = `${c.term}`;
        
        const right = document.createElement('span');
        right.className = 'muted small';
        right.textContent = `${getTopicName(c.topicId)} · ${rate}% (${c.stats.correct}/${c.stats.total})`;
        
        li.appendChild(left);
        li.appendChild(right);
        hardList.appendChild(li);
      });
    }
  }

  // --- Helpers ---
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s){ return (s||'').replace(/["']/g, c=> c==='"'? '&quot;' : '&#39;'); }

  // Kickoff
  window.addEventListener('DOMContentLoaded', init);
})();
