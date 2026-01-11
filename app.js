// Global Error Handler für Debugging - BEVOR IIFE startet!
console.log('📋 app.js wird geladen...');
window.addEventListener('error', (event) => {
  console.error('❌ Unhandled Error:', event.error);
  console.error('Stack:', event.error?.stack);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('❌ Unhandled Promise Rejection:', event.reason);
});

/* LernKarten – App Logic */
console.log('✅ Starting IIFE...');
(function(){
  'use strict';
  console.log('📝 IIFE started, use strict enabled');
  
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  const state = {
    data: { folders: [], topics: [], cards: [], settings: { tts: { lang: 'de-DE', voiceURI: '', rate: 0.7, charsUsed: 0, requestsUsed: 0, lastResetDate: new Date().toISOString().split('T')[0] }, ai: { provider: 'openai', keyOpenai: '', keyGrok: '', endpoint: '', apiKey: '' }, drive: { clientId: '' } } },
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



  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function toISODate(d){ return d.toISOString().slice(0,10); }
  function clamp(v, min, max){ return Math.min(Math.max(v, min), max); }

  function showImportSuccessDialog(count, topicName, folderName, topicId) {
    console.log('🎉 showImportSuccessDialog aufgerufen:', { count, topicName, folderName, topicId });
    
    $('#import-success-count').textContent = count;
    $('#import-success-count-label').textContent = ` Karte${count !== 1 ? 'n' : ''} importiert`;
    $('#import-success-topic').textContent = topicName;
    $('#import-success-folder').textContent = folderName;
    
    const gotoBtn = $('#import-success-goto');
    if(gotoBtn) {
      gotoBtn.onclick = () => {
        state.ui.selectedTopicId = topicId;
        renderCardsTable();
        if(window.__updateManageHeaderUI) window.__updateManageHeaderUI();
        renderFolderTree();
        document.getElementById('import-success-dialog').close();
        // Switch to Verwalten tab
        document.querySelector('[data-tab="verwalten"]').click();
      };
    }
    
    const dialog = document.getElementById('import-success-dialog');
    console.log('Dialog Element:', dialog);
    if(dialog) {
      console.log('Öffne Dialog mit showModal()');
      dialog.showModal();
    } else {
      console.error('❌ import-success-dialog nicht gefunden!');
    }
  }

  function updateTtsUsageDisplay(){
    const charsUsed = state.data.settings.tts.charsUsed || 0;
    const costUsed = TTS.calculateCost(charsUsed);
    const charsEl = $('#tts-usage-chars');
    const costEl = $('#tts-usage-cost');
    if(charsEl) charsEl.textContent = charsUsed.toLocaleString();
    if(costEl) costEl.textContent = costUsed.toFixed(4);
  }

  function init(){
    console.log('Init started...');
    try {
      Storage.load();
      console.log('Storage loaded');
      TTS.initVoices();
      console.log('TTS initialized');
      bindTabs();
      console.log('Tabs bound');
      bindManage();
      console.log('Manage bound');
      bindLearn();
      console.log('Learn bound');
      bindImportExport();
      console.log('Import/Export bound');
      bindCommunityUpload();
      console.log('Community upload bound');
      bindSettings();
      console.log('Settings bound');
      populateAllSelects();
      renderFolderTree();
      if(state.data.topics.length>0){
        state.ui.selectedTopicId = state.data.topics[0].id;
        renderCardsTable();
      }
      // Initialisiere UI-Werte für Settings
      $('#tts-rate').value = state.data.settings.tts.rate || 0.7;
      $('#google-tts-key').value = state.data.settings.tts.googleKey || '';
      $('#google-voice-type').value = state.data.settings.tts.googleVoiceType || 'Standard';
      $('#google-voice-variant').value = state.data.settings.tts.googleVoiceVariant || 'A';

      // Version im Footer anzeigen
      showDeployedVersion();
      
      // Prüfe ob Deck-URL übergeben wurde (von home.html)
      const params = new URLSearchParams(window.location.search);
      const deckUrl = params.get('deck-url');
      if (deckUrl) {
        // Stille das Deck direkt von der URL
        loadAndImportDeckFromUrl(deckUrl);
      }
      console.log('Init completed successfully');
    } catch(err) {
      console.error('Init failed:', err);
    }
  }

  // Lade und importiere Deck direkt von URL (von home.html)
  async function loadAndImportDeckFromUrl(deckUrl) {
    try {
      console.log('📥 Lade Deck von URL:', deckUrl);
      const response = await fetch(deckUrl);
      const deckData = await response.json();
      
      // Importiere Themen und Karten
      if (deckData.topics && deckData.cards) {
        let importedCount = 0;
        
        // Topics importieren
        deckData.topics.forEach(topic => {
          const existingTopic = state.data.topics.find(t => t.id === topic.id);
          if (!existingTopic) {
            state.data.topics.push({
              id: topic.id || uid(),
              name: topic.name,
              folderId: topic.folderId || null,
              answerMode: topic.answerMode || 'type'
            });
          }
        });
        
        // Karten importieren
        deckData.cards.forEach(cardData => {
          const card = {
            term: cardData.term || '',
            description: cardData.description || '',
            answer: cardData.answer || cardData.term
          };
          if (cardData.mcOptions) card.mcOptions = cardData.mcOptions;
          
          Importer.addCardToTopic(cardData.topicId, card);
          importedCount++;
        });
        
        Storage.save();
        
        // UI aktualisieren
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
        
        // Zeige Erfolgsmeldung
        const deckTitle = deckData.metadata?.title || 'Deck';
        const message = `✅ ${importedCount} Karten aus "${deckTitle}" importiert!`;
        $('#import-status').textContent = message;
        console.log(message);
        
        // Navigiere zum Verwalten-Tab
        $$('.tab').forEach(b=>b.classList.remove('active'));
        const verwaltenBtn = $('[data-tab="verwalten"]');
        if(verwaltenBtn) verwaltenBtn.classList.add('active');
        $$('.tab-panel').forEach(p=>p.classList.remove('active'));
        $('#tab-verwalten').classList.add('active');
        renderCardsTable();
      }
    } catch (error) {
      console.error('Fehler beim Importieren des Decks:', error);
      $('#import-status').textContent = '❌ Fehler beim Laden des Decks: ' + error.message;
    }
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
        el.textContent = `. Version ${sha} (${dateStr})`;
      }
    } catch(e){
      // still fine without version
    }
  }

  const REVIEW_INTERVALS = [0, 1, 2, 4, 7, 14];

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
      const today = todayISO();
      s.total += 1;
      if(isCorrect){
        s.correct += 1;
        s.streak += 1;
        s.box = clamp((s.box||1) + 1, 1, 5);
      } else {
        s.streak = 0;
        s.box = Math.max(1, (s.box||1) - 1);
      }
      s.lastReviewed = today;
      const intervalDays = REVIEW_INTERVALS[s.box] ?? 1;
      const next = new Date();
      next.setDate(next.getDate() + intervalDays);
      s.nextDue = next.toISOString().slice(0,10);
      Storage.save();
      return s;
    }
  };

  // --- TTS ---
  const TTS = {
    currentAudio: null,
    initVoices(){
      if(!('speechSynthesis' in window)) return;
      const load = () => {
        state.voices = window.speechSynthesis.getVoices() || [];
        refreshVoiceSelectors();
      };
      window.speechSynthesis.onvoiceschanged = load;
      load();
    },
    async speakDirect(text){
      if(!text) return;
      this.cancel();
      
      // Check if Google Cloud TTS is configured
      const googleKey = state.data.settings.tts.googleKey;
      if(googleKey && googleKey.trim()){
        try {
          await this.speakWithGoogle(text);
          return;
        } catch(e){
          // Ignore AbortError/interrupted play cases to avoid double playback
          const msg = (e && (e.message || e.toString())) || '';
          const name = e && (e.name || '');
          if(name.includes('AbortError') || msg.includes('AbortError') || msg.includes('interrupted') || msg.includes('removed from the document')){
            console.warn('Google TTS play interrupted (ignored):', e);
            return; // do not fallback to Web Speech
          }
          console.warn('Google TTS failed, falling back to Web Speech API:', e);
        }
      }
      
      // Fallback to Web Speech API
      if(!('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      const voiceURI = state.data.settings.tts.voiceURI || '';
      u.lang = state.data.settings.tts.lang || 'de-DE';
      u.rate = state.data.settings.tts.rate || 1.0;
      let voiceName = 'Standard';
      if(voiceURI && state.voices){
        const v = state.voices.find(x => x.voiceURI === voiceURI);
        if(v){
          u.voice = v;
          voiceName = v.name;
        }
      }
      // Update UI status (show while speaking)
      setTtsStatus(`Web Speech: ${voiceName}`);
      u.onend = () => setTtsStatus(null);
      u.onerror = () => setTtsStatus(null);
      try { window.speechSynthesis.speak(u); } catch(e) { console.error(e); setTtsStatus(null); }
    },
    async speakWithGoogle(text){
      const googleKey = state.data.settings.tts.googleKey;
      const userLang = state.data.settings.tts.lang || 'de-DE';
      const voiceType = state.data.settings.tts.googleVoiceType || 'Standard';
      const voiceVariant = state.data.settings.tts.googleVoiceVariant || 'A';
      const rate = state.data.settings.tts.rate || 1.0;
      
      // Try voices in order: user choice → de-DE with same type → de-DE-Standard-A
      const voicesToTry = [
        { lang: userLang, name: `${userLang}-${voiceType}-${voiceVariant}` },
        { lang: 'de-DE', name: `de-DE-${voiceType}-${voiceVariant}` },
        { lang: 'de-DE', name: 'de-DE-Standard-A' }
      ];
      
      // Remove duplicates
      const uniqueVoices = voicesToTry.filter((v, i, arr) => 
        arr.findIndex(x => x.name === v.name) === i
      );
      
      let response = null;
      let lastError = null;
      
      for(const voice of uniqueVoices){
        // Silent fetch to avoid console errors for expected 400s
        response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: {
              languageCode: voice.lang,
              name: voice.name
            },
            audioConfig: {
              audioEncoding: 'MP3',
              pitch: 0,
              speakingRate: rate
            }
          })
        }).catch(e => {
          // Network error - will be handled below
          lastError = { error: { message: e.message } };
          return null;
        });
        
        if(!response){
          continue; // Network error, try next voice
        }
        
        if(response.ok){
          console.log(`Using Google TTS voice: ${voice.name}`);
          // Update UI status (show while playing)
          setTtsStatus(`Google TTS: ${voice.name}`);
          break; // Success!
        }
        
        // Parse error silently
        const errorData = await response.json().catch(() => ({}));
        lastError = errorData;
        
        if(errorData.error?.message?.includes('does not exist')){
          console.warn(`Voice ${voice.name} not available, trying next fallback...`);
          continue; // Try next voice
        } else {
          // Different error - this is actually a problem
          throw new Error(`Google TTS API error ${response.status}: ${errorData.error?.message || 'Unknown error'}`);
        }
      }
      
      // If no voice worked, throw the last error
      if(!response || !response.ok){
        const msg = lastError?.error?.message || 'All voice fallbacks failed';
        throw new Error(`Google TTS API error: ${msg}`);
      }
      
      const data = await response.json();
      if(!data.audioContent){
        throw new Error('No audio content in response');
      }
      
      // Track usage
      const charsUsed = text.length;
      state.data.settings.tts.charsUsed = (state.data.settings.tts.charsUsed || 0) + charsUsed;
      state.data.settings.tts.requestsUsed = (state.data.settings.tts.requestsUsed || 0) + 1;
      Storage.save();
      updateTtsUsageDisplay();
      
      // Play audio
      const audioBlob = this.base64ToBlob(data.audioContent, 'audio/mpeg');
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      
      return new Promise((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          setTtsStatus(null);
          this.currentAudio = null;
          resolve();
        };
        audio.onerror = (e) => {
          URL.revokeObjectURL(audioUrl);
          setTtsStatus(null);
          const mediaErr = audio.error;
          this.currentAudio = null;
          // Treat aborted/interrupted playback as non-fatal to avoid fallback
          if (mediaErr && (mediaErr.code === 1)) { // MEDIA_ERR_ABORTED
            console.warn('Google TTS media aborted; ignoring as non-fatal');
            resolve();
            return;
          }
          const msg = (e && e.message) || '';
          if (msg.includes('AbortError') || msg.includes('removed from the document') || msg.includes('interrupted')){
            console.warn('Google TTS playback interrupted; ignoring as non-fatal');
            resolve();
            return;
          }
          reject(e);
        };
        // Start playback; if play() rejects (e.g., AbortError), don't immediately fallback.
        // We'll rely on onerror to detect real playback failures.
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function'){
          playPromise.catch(() => {
            // Silently ignore play() interruptions; onerror will handle true failures.
          });
        }
      });
    },
    base64ToBlob(base64, contentType){
      const byteCharacters = atob(base64);
      const byteArrays = [];
      
      for (let offset = 0; offset < byteCharacters.length; offset += 512) {
        const slice = byteCharacters.slice(offset, offset + 512);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
      }
      
      return new Blob(byteArrays, { type: contentType });
    },
    speakQuestion(text){
      this.speakDirect(text);
    },
    speakFeedback(isCorrect){
      const text = isCorrect ? 'Richtig.' : 'Leider falsch.';
      this.speakDirect(text);
    },
    calculateCost(charsUsed){
      const pricePerMillion = 4.0; // rough estimate for budgeting display
      return (charsUsed || 0) / 1_000_000 * pricePerMillion;
    },
    cancel(){
      try{ if('speechSynthesis' in window) window.speechSynthesis.cancel(); }catch(e){}
      if(this.currentAudio){
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio = null;
      }
      setTtsStatus(null);
    }
  };

  // UI helper to show/hide TTS status (null hides)
  function setTtsStatus(text){
    const statusEl = $('#tts-status');
    const statusText = $('#tts-status-text');
    if(!statusEl || !statusText) return;
    if(text){
      statusEl.style.display = 'flex';
      statusText.textContent = text;
    } else {
      statusEl.style.display = 'none';
      statusText.textContent = '';
    }
  }

  function refreshVoiceSelectors(){
    const langSel = $('#tts-lang');
    const voiceSel = $('#tts-voice');
    
    // Use Web Speech API voices
    const voices = state.voices || [];
    
    // Whitelist für erlaubte Sprachen mit bevorzugten Varianten
    const allowedLanguages = {
      'de': { name: 'Deutsch', preferred: 'de-DE' },
      'en': { name: 'Englisch', preferred: 'en-US' },
      'it': { name: 'Italienisch', preferred: 'it-IT' },
      'es': { name: 'Spanisch', preferred: 'es-ES' },
      'fr': { name: 'Französisch', preferred: 'fr-FR' }
    };
    
    // Finde verfügbare Sprachen (nur eine Variante pro Sprache)
    const allLangs = [...new Set(voices.map(v=>v.lang))];
    const languageMap = new Map();
    
    for(const lang of allLangs){
      const prefix = lang.split('-')[0];
      if(allowedLanguages[prefix]){
        // Bevorzuge die Hauptvariante (de-DE, en-US, etc.), sonst erste verfügbare
        if(!languageMap.has(prefix) || lang === allowedLanguages[prefix].preferred){
          languageMap.set(prefix, lang);
        }
      }
    }
    
    // Erstelle sortierte Liste der Sprachen
    const sortedLanguages = ['de', 'en', 'it', 'es', 'fr']
      .filter(prefix => languageMap.has(prefix))
      .map(prefix => ({
        code: languageMap.get(prefix),
        name: allowedLanguages[prefix].name
      }));
    
    // Erstelle Dropdown mit nur 5 Einträgen
    langSel.innerHTML = sortedLanguages.map(lang => 
      `<option value="${lang.code}">${lang.name}</option>`
    ).join('');
    
    langSel.value = state.data.settings.tts.lang || 'de-DE';
    
    const filteredVoices = voices.filter(v=>v.lang===langSel.value);
    voiceSel.innerHTML = `<option value="">Standard</option>` + 
      filteredVoices.map(v=>`<option value="${v.voiceURI}">${v.name}</option>`).join('');
    voiceSel.value = state.data.settings.tts.voiceURI || '';
  }

  // --- GitHub Community Upload ---
  const GitHub = {
    token: '', // WICHTIG: GitHub Token hier eintragen (nicht committen!)
    owner: 'kranege1',
    repo: 'LernKarten',
    branch: 'gh-pages',
    decksPath: 'shared-decks',

    // UTF-8 safe btoa replacement
    utf8ToBase64(str) {
      // Funktioniert mit Umlauten und Sonderzeichen
      const bytes = new TextEncoder().encode(str);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    },

    async uploadDeck(deckData) {
      if (!this.token) throw new Error('GitHub Token nicht gesetzt');
      
      try {
        const statusEl = $('#upload-status');
        statusEl.style.display = 'block';
        statusEl.innerHTML = '⏳ Lade Deck hoch...';
        statusEl.style.background = 'rgba(59, 130, 246, 0.1)';
        statusEl.style.borderLeft = '3px solid #3b82f6';

        // 1. Erstelle Deck-Dateiname (slug)
        const deckSlug = deckData.title
          .toLowerCase()
          .replace(/[ä]/g, 'ae')
          .replace(/[ö]/g, 'oe')
          .replace(/[ü]/g, 'ue')
          .replace(/[ß]/g, 'ss')
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        
        const fileName = `${deckSlug}.json`;
        const filePath = `${this.decksPath}/${fileName}`;

        // 2. Erstelle Deck-JSON
        const deckJson = {
          metadata: {
            id: uid(),
            title: deckData.title,
            description: deckData.description,
            difficulty: deckData.difficulty,
            category: deckData.category,
            author: deckData.author,
            tags: deckData.tags.split(',').map(t => t.trim()),
            createdAt: new Date().toISOString(),
            cardCount: deckData.cards.length
          },
          topics: deckData.topics,
          cards: deckData.cards
        };

        // 3. Lade aktuelle catalog.json
        const catalogResponse = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.decksPath}/catalog.json`,
          { headers: { 'Authorization': `token ${this.token}` } }
        );
        
        let catalogSha = null;
        let catalog = {
          decks: [],
          lastUpdated: new Date().toISOString()
        };

        if (catalogResponse.ok) {
          const catalogData = await catalogResponse.json();
          catalogSha = catalogData.sha;
          const content = decodeURIComponent(atob(catalogData.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          catalog = JSON.parse(content);
        }

        // 4. Füge neues Deck zur Katalog hinzu
        catalog.decks = catalog.decks.filter(d => d.id !== deckJson.metadata.id);
        const newCatalogEntry = {
          id: deckJson.metadata.id,
          title: deckData.title,
          description: deckData.description,
          category: deckData.category,
          language: 'de',
          cardCount: deckData.cards.length,
          difficulty: deckData.difficulty,
          author: deckData.author,
          tags: deckJson.metadata.tags,
          fileName: fileName,
          downloadUrl: `https://${this.owner}.github.io/${this.repo}/${filePath}`,
          created: new Date().toISOString().split('T')[0]
        };
        catalog.decks.push(newCatalogEntry);
        catalog.lastUpdated = new Date().toISOString();

        // 5. Prüfe ob Deck-Datei bereits existiert
        let deckFileSha = null;
        try {
          const checkDeckResponse = await fetch(
            `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${filePath}`,
            { 
              headers: { 'Authorization': `token ${this.token}` },
              cache: 'no-cache'
            }
          );
          if (checkDeckResponse.ok) {
            const deckFileData = await checkDeckResponse.json();
            deckFileSha = deckFileData.sha;
          } else if (checkDeckResponse.status === 404) {
            // Datei existiert noch nicht - wird neu erstellt
            console.log('Neue Deck-Datei wird erstellt:', filePath);
          }
        } catch (e) {
          // Netzwerkfehler oder andere Probleme
          console.log('Deck-Status konnte nicht geprüft werden:', e.message);
        }

        // 6. Upload Deck-Datei
        const deckContent = this.utf8ToBase64(JSON.stringify(deckJson, null, 2));
        const deckUploadBody = {
          message: deckFileSha ? `Update community deck: ${deckData.title}` : `Add community deck: ${deckData.title}`,
          content: deckContent
        };
        if (deckFileSha) {
          deckUploadBody.sha = deckFileSha;
        }
        
        const uploadResponse = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${filePath}?ref=${this.branch}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `token ${this.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(deckUploadBody)
          }
        );

        if (!uploadResponse.ok) {
          throw new Error(`Upload fehlgeschlagen: ${uploadResponse.statusText}`);
        }

        // 7. Update catalog.json - hole SHA frisch vor dem Update
        const catalogRefreshResponse = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.decksPath}/catalog.json`,
          { headers: { 'Authorization': `token ${this.token}` } }
        );
        
        let finalCatalogSha = null;
        if (catalogRefreshResponse.ok) {
          const catalogRefreshData = await catalogRefreshResponse.json();
          finalCatalogSha = catalogRefreshData.sha;
          // Lade auch den aktuellsten Inhalt um Konflikte zu vermeiden
          const latestContent = decodeURIComponent(atob(catalogRefreshData.content).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
          const latestCatalog = JSON.parse(latestContent);
          
          // Merge: füge unser Deck hinzu wenn nicht schon drin
          const existingDeck = latestCatalog.decks.find(d => d.id === deckJson.metadata.id);
          if (!existingDeck) {
            latestCatalog.decks.push({
              id: deckJson.metadata.id,
              title: deckData.title,
              description: deckData.description,
              category: deckData.category,
              language: 'de',
              cardCount: deckData.cards.length,
              difficulty: deckData.difficulty,
              author: deckData.author,
              tags: deckJson.metadata.tags,
              fileName: fileName,
              downloadUrl: `https://${this.owner}.github.io/${this.repo}/${filePath}`,
              created: new Date().toISOString().split('T')[0]
            });
          }
          latestCatalog.lastUpdated = new Date().toISOString();
          catalog = latestCatalog;
        }
        
        const catalogContent = this.utf8ToBase64(JSON.stringify(catalog, null, 2));
        const catalogBody = {
          message: `Update catalog: add ${deckData.title}`,
          content: catalogContent
        };
        // Nutze die frische SHA
        if (finalCatalogSha) {
          catalogBody.sha = finalCatalogSha;
        }
        
        const catalogUpdateResponse = await fetch(
          `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.decksPath}/catalog.json?ref=${this.branch}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `token ${this.token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(catalogBody)
          }
        );

        if (!catalogUpdateResponse.ok) {
          throw new Error(`Katalog-Update fehlgeschlagen: ${catalogUpdateResponse.statusText}`);
        }

        statusEl.innerHTML = `
          <div style="text-align: center; padding: 8px;">
            <div style="font-size: 24px; margin-bottom: 8px;">🎉</div>
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">Vielen Dank!</div>
            <div style="font-size: 14px; margin-bottom: 8px;">Dein Deck wurde erfolgreich hochgeladen.</div>
            <div style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">
              <strong>"${deckData.title}"</strong><br>
              ${deckData.cards.length} Karten • ${deckData.category}<br>
              <br>
              ⏳ <em>Dein Deck erscheint in den Community Decks in 1-2 Minuten,<br>sobald GitHub Pages die Änderungen deployed hat.</em>
              <br><br>
              Danke, dass du die Community unterstützt! 💚
            </div>
            <a href="home.html#decks" style="display: inline-block; padding: 8px 16px; background: var(--primary); color: white; text-decoration: none; border-radius: 6px; font-size: 13px;">
              📚 Zu Community Decks
            </a>
          </div>
        `;
        statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
        statusEl.style.borderLeft = '3px solid #10b981';

        return true;
      } catch (error) {
  // Firebase Integration für Community Uploads
  const FirebaseUpload = {
    async submitDeck(deckData) {
      try {
        const statusEl = $('#upload-status');
        statusEl.style.display = 'block';
        statusEl.innerHTML = '⏳ Reiche Deck ein...';
        statusEl.style.background = 'rgba(59, 130, 246, 0.1)';
        statusEl.style.borderLeft = '3px solid #3b82f6';

        // Cloud Function aufrufen
        const submitDeck = firebaseFunctions.httpsCallable('submitDeck');
        const result = await submitDeck(deckData);

        statusEl.innerHTML = `
          <div style="text-align: center; padding: 12px;">
            <div style="font-size: 24px; margin-bottom: 8px;">🎉</div>
            <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">Danke!</div>
            <div style="font-size: 14px; margin-bottom: 8px;">Dein Deck wurde eingereicht.</div>
            <div style="font-size: 12px; color: var(--muted); margin-top: 8px;">
              <strong>"${deckData.title}"</strong><br>
              ${deckData.cards.length} Karten • ${deckData.category}<br>
              <br>
              ⏳ Ein Admin wird es reviewen und freigeben.<br>
              Das dauert normalerweise wenige Stunden.
            </div>
          </div>
        `;
        statusEl.style.background = 'rgba(16, 185, 129, 0.1)';
        statusEl.style.borderLeft = '3px solid #10b981';

        return true;
      } catch (error) {
        console.error('Submit error:', error);
        const statusEl = $('#upload-status');
        statusEl.innerHTML = `❌ Fehler: ${error.message}`;
        statusEl.style.background = 'rgba(239, 68, 68, 0.1)';
        statusEl.style.borderLeft = '3px solid #ef4444';
        throw error;
      }
    }
  };

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
          // Re-parse without headers
          const rawParsed = Papa.parse(text, { header: false, skipEmptyLines: true, delimiter: delim });
          rows = (rawParsed.data || []).map(r => {
            if(!Array.isArray(r) || r.length < 3) return null;
            return { 
              term: r[0], 
              description: r[1], 
              answer: r[2]
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
          answer: r.answer || r.antwort || ''
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
      answer: (c.answer||'').toString().trim()
    };
  }

  // --- AI (optional) ---
  const AI = {
    describe: async function(term) {
      const ai = state.data.settings.ai;
      let endpoint = '', apiKey = '', body = {}, headers = {}, model = '';
      const useProxy = false; // Direkt-Zugriff (OpenAI/Grok unterstützen CORS)
      
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
      const useProxy = false;
      
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
        answer: r.answer || ''
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
    console.log('bindTabs: Suche nach .tab buttons mit data-tab...');
    const tabButtons = $$('button.tab[data-tab]');
    console.log('bindTabs: Gefunden', tabButtons.length, 'Tab Buttons');
    tabButtons.forEach(btn => {
      console.log('bindTabs: Binde', btn.getAttribute('data-tab'));
      btn.addEventListener('click', () => {
        console.log('Tab clicked:', btn.getAttribute('data-tab'));
        $$('button.tab[data-tab]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const id = btn.getAttribute('data-tab');
        console.log('Aktiviere Tab:', id);
        $$('.tab-panel').forEach(p=>p.classList.remove('active'));
        const panel = $(`#tab-${id}`);
        if(panel) {
          panel.classList.add('active');
          if(id==='statistik') renderStats();
          if(id==='verwalten') renderCardsTable();
        } else {
          console.error('Panel nicht gefunden: #tab-' + id);
        }
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
    const allFolders = state.data.folders;
    const allTopics = state.data.topics;
    
    // Lern-Topic bleibt nur Themen (wie bisher)
    const learnTopics = folderId ? allTopics.filter(t => t.folderId === folderId) : allTopics;
    const learnOptions = learnTopics.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
    $('#learn-topic').innerHTML = learnOptions;
    
    // Import/Export: Ordner + Themen hierarchisch auswählbar
    let hierOptions = `<option value="">(alle Themen)</option>`;
    allFolders.forEach(f => {
      hierOptions += `<option value="folder:${f.id}">📁 ${f.name}</option>`;
      const folderTopics = allTopics.filter(t => t.folderId === f.id);
      folderTopics.forEach(t => { hierOptions += `<option value="${t.id}">   └─ ${t.name}</option>`; });
    });
    const orphanTopics = allTopics.filter(t => !t.folderId);
    orphanTopics.forEach(t => { hierOptions += `<option value="${t.id}">📄 ${t.name}</option>`; });
    
    $('#import-topic').innerHTML = hierOptions;
    $('#export-topic').innerHTML = hierOptions;
    
    // Stats-Topic befüllen mit Ordnern und Themen (hierarchisch)
    
    let statsOptions = `<option value="">🌍 Global (alle)</option>`;
    
    // Ordner + deren Themen (flach, visuell eingerückt)
    allFolders.forEach(f => {
      const folderTopics = allTopics.filter(t => t.folderId === f.id);
      const folderCount = folderTopics.length;
      
      // Ordner selbst auswählbar
      statsOptions += `<option value="folder:${f.id}">📁 ${f.name} (${folderCount} Themen)</option>`;
      
      // Themen darunter eingerückt
      folderTopics.forEach(t => {
        const cardCount = state.data.cards.filter(c => c.topicId === t.id).length;
        statsOptions += `<option value="topic:${t.id}">   └─ ${t.name} (${cardCount} Karten)</option>`;
      });
    });
    
    // Themen ohne Ordner
    const orphanTopicsForStats = allTopics.filter(t => !t.folderId);
    orphanTopicsForStats.forEach(t => {
      const cardCount = state.data.cards.filter(c => c.topicId === t.id).length;
      statsOptions += `<option value="topic:${t.id}">📄 ${t.name} (${cardCount} Karten)</option>`;
    });
    
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
    // Ordner hinzufügen (per Prompt)
    $('#add-folder').addEventListener('click', () => {
      const input = prompt('Neuer Ordnername:');
      if(input === null) return;
      const name = input.trim();
      if(!name) return;
      const id = uid();
      state.data.folders.push({ id, name });
      Storage.save();
      populateAllSelects();
      renderFolderTree();
      renderCardsTable();
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
      renderCardsTable();
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
      const input = prompt('Neues Thema:');
      if(input === null) return;
      const name = input.trim();
      if(!name) return;
      const id = uid();
      const folderId = state.ui.selectedFolderId || null;
      state.data.topics.push({ id, name, answerMode: 'type', folderId });
      Storage.save();
      populateAllSelects();
      renderFolderTree();
      renderCardsTable();
    });
    // Aktionen oben: abhängig vom ausgewählten Thema aktivieren/deaktivieren
    const updateManageHeaderUI = () => {
      const tId = state.ui.selectedTopicId;
      const label = $('#manage-selected');
      const addBtn = $('#add-card');
      const aiFillBtn = $('#ai-fill-fields');
      const shareBtn = document.getElementById('share-community');
      if(tId){
        const t = state.data.topics.find(x=>x.id===tId);
        if(label) label.textContent = `Ausgewähltes Thema: ${t?.name || '—'}`;
        if(addBtn) addBtn.disabled = false;
        if(aiFillBtn) aiFillBtn.disabled = false;
        if(shareBtn) shareBtn.disabled = false;
      } else {
        if(label) label.textContent = 'Bitte Thema im Baum auswählen';
        if(addBtn) addBtn.disabled = true;
        if(aiFillBtn) aiFillBtn.disabled = true;
        if(shareBtn) shareBtn.disabled = true;
      }
    };
    updateManageHeaderUI();

    $('#add-card').addEventListener('click', () => openCardDialog());
    
    // KI-Felder füllen
    $('#ai-fill-fields').addEventListener('click', openAiFillDialog);
    $('#ai-fill-start').addEventListener('click', startAiFill);
    $('#ai-copy-source-to-target').addEventListener('click', copySourceToTarget);
    
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
      term: 'Erstelle einen prägnanten Begriff (3-8 Worte) basierend auf: {umschreibung} / {antwort}',
      description: 'Erstelle eine kurze, prägnante Umschreibung (3-8 Worte) für den Begriff "{begriff}". Nenne den Begriff selbst nicht.',
      answer: 'Was ist die richtige Antwort auf: {begriff}? Antworte kurz und präzise.'
    };
    
    $('#ai-fill-prompt').value = defaultPrompts.term;
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
      
      $('#ai-generate-progress').textContent = `OK - Neues Thema "${context}" mit ${added} Begriff(en) erstellt!`;
      
      // Dialog nach 2 Sekunden schlie├ƒen
      setTimeout(() => {
        $('#ai-generate-dialog').close();
      }, 2000);
      
    } catch(err){
      console.error('Fehler beim Generieren:', err);
      $('#ai-generate-progress').textContent = 'Fehler: ' + err.message;
    }
    
    $('#ai-generate-start').disabled = false;
  }
  
  function copySourceToTarget(){
    const topicId = state.ui.selectedTopicId;
    if(!topicId){ alert('Bitte zuerst ein Thema auswählen'); return; }
    
    const target = $('#ai-fill-target').value;
    const source = $('#ai-fill-source').value;
    const onlyEmpty = $('#ai-fill-only-empty').checked;
    
    if(source === target){
      alert('Quelle und Zielfeld sind identisch. Bitte wähle unterschiedliche Felder.');
      return;
    }
    
    const cards = state.data.cards.filter(c => c.topicId === topicId);
    
    let copied = 0;
    for(const card of cards){
      // Prüfe ob Zielfeld leer ist (falls "nur leere Felder" aktiviert)
      const targetIsEmpty = !card[target] || card[target].trim() === '';
      if(onlyEmpty && !targetIsEmpty) continue;
      
      // Kopiere Quelle nach Ziel
      const sourceValue = card[source];
      if(sourceValue && sourceValue.trim()){
        card[target] = sourceValue;
        copied++;
      }
    }
    
    if(copied > 0){
      Storage.save();
      renderCardsTable();
      $('#ai-fill-progress').textContent = `✓ ${copied} Karte(n) kopiert: ${source} → ${target}`;
    } else {
      $('#ai-fill-progress').textContent = 'Nichts zu kopieren (alle Quellenfelder leer oder Zielfelder bereits gefüllt).';
    }
  }
  
  async function startAiFill(){
    const topicId = state.ui.selectedTopicId;
    if(!topicId){ alert('Bitte zuerst ein Thema auswählen'); return; }
    
    const target = $('#ai-fill-target').value;
    const source = $('#ai-fill-source').value;
    const promptTemplate = $('#ai-fill-prompt').value.trim();
    const onlyEmpty = $('#ai-fill-only-empty').checked;
    
    if(!promptTemplate){ alert('Bitte Prompt-Vorlage eingeben'); return; }
    
    const cards = state.data.cards.filter(c => c.topicId === topicId);

    // Finde alle Karten, die gefüllt werden sollen
    const toFill = cards.filter(c => {
      if(!onlyEmpty) return true;
      if(target === 'term') return !c.term;
      if(target === 'description') return !c.description;
      if(target === 'answer') return !c.answer;
      return false;
    });
    
    if(!toFill.length){
      $('#ai-fill-progress').textContent = 'Nichts zu tun - alle Karten bereits gefüllt.';
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
        term: 'Fülle nur das Feld "term" (Begriff) mit einem prägnanten Begriff in 3-8 Worten.',
        description: 'Fülle nur das Feld "description" (Umschreibung) prägnant in 3-8 Worten, nenne den Begriff nicht.',
        answer: 'Fülle nur das Feld "answer" (richtige Antwort) kurz und präzise.'
      }[target];

      const promptBody = items.map(it => {
        let line = `- idx:${it.idx} term:${it.term}`;
        if(it.description) line += ` description:${it.description}`;
        if(it.answer) line += ` answer:${it.answer}`;
        return line;
      }).join('\n');

      const schemaLine = target === 'term'
        ? '{ idx:number, term:string, description:string, answer:string }'
        : target === 'answer'
        ? '{ idx:number, term:string, answer:string }'
        : '{ idx:number, term:string, description:string }';

      const userPrompt = [
        'Du bist ein Lernkarten-Assistent. Bearbeite alle Einträge in einem Schritt und antworte NUR mit JSON.',
        '',
        targetInstruction,
        '',
        'Du MUSST GENAU folgendes JSON-Format verwenden:',
        `[${schemaLine}, ${schemaLine}, ...]`,
        '',
        'Eingabe-Einträge:',
        promptBody,
        '',
        'WICHTIG: Antworte AUSSCHLIESSLICH mit JSON-Array. Keine vorherigen oder nachfolgenden Kommentare!'
      ].join('\n');

      const systemPrompt = 'Du bist ein Hilfs-Bot der nur JSON zurückgibt. Keine Erklärungen, keine Markdown-Blöcke. Nur reines JSON-Array.';
      
      console.log('System Prompt:', systemPrompt);
      console.log('User Prompt:', userPrompt);
      
      const result = await AI.generate(systemPrompt, userPrompt);
      
      console.log('KI-Antwort (roh):', result);

      // Versuche JSON zu extrahieren (falls KI Markdown-Blöcke um JSON herum hat)
      let jsonStr = result.trim();
      if(jsonStr.includes('```')){
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if(match) jsonStr = match[1].trim();
      }
      
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch(parseErr){
        console.error('JSON-Parse Fehler:', parseErr, 'bei:', jsonStr);
        throw new Error('KI-Antwort war kein valides JSON: ' + jsonStr.slice(0, 100));
      }
      if(!Array.isArray(parsed)) throw new Error('KI-Antwort ist kein Array');

      let filled = 0;
      for(const item of parsed){
        const card = toFill[item.idx];
        if(!card) continue;
        if(target === 'term' && typeof item.term === 'string'){
          card.term = item.term.trim();
          filled++;
        } else if(target === 'description' && typeof item.description === 'string'){
          card.description = item.description.trim();
          filled++;
        } else if(target === 'answer' && typeof item.answer === 'string'){
          card.answer = item.answer.trim();
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
      folderLi.className = 'tree-folder';
      folderLi.setAttribute('data-collapsed', isCollapsed);
      folderLi.setAttribute('data-folder-id', f.id);
      
      const folderRow = document.createElement('div');
      folderRow.className = 'tree-folder-row';
      
      // Drag over Handler für Ordner
      folderRow.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        folderRow.classList.add('drag-over');
      });
      folderRow.addEventListener('dragleave', () => {
        folderRow.classList.remove('drag-over');
      });
      folderRow.addEventListener('drop', (e) => {
        e.preventDefault();
        folderRow.classList.remove('drag-over');
        const topicId = e.dataTransfer.getData('text/plain');
        const topic = state.data.topics.find(t => t.id === topicId);
        if(topic && topic.folderId !== f.id){
          topic.folderId = f.id;
          Storage.save();
          populateAllSelects();
          renderFolderTree();
          renderCardsTable();
        }
      });
      
      const left = document.createElement('div');
      left.className = 'tree-folder-label';
      left.innerHTML = `
        <span class="tree-toggle">${isCollapsed ? '▶' : '▼'}</span>
        <span class="tree-icon">📁</span>
        <span class="tree-name">${f.name}</span>
        <span class="tree-count">${folderTopics.length}</span>
      `;
      left.onclick = () => {
        state.ui.collapsedFolders[f.id] = !isCollapsed;
        renderFolderTree();
      };
      
      const folderBtnGroup = document.createElement('div');
      folderBtnGroup.className = 'tree-actions';
      
      const renameFolder = document.createElement('button');
      renameFolder.textContent = '✏️';
      renameFolder.title = 'Umbenennen';
      renameFolder.className = 'ghost small';
      renameFolder.onclick = (e) => {
        e.stopPropagation();
        const newName = prompt('Neuer Ordnername:', f.name);
        if(newName === null) return;
        const name = newName.trim();
        if(!name) return;
        f.name = name;
        Storage.save();
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
      };
      
      const deleteFolder = document.createElement('button');
      deleteFolder.textContent = '🗑️';
      deleteFolder.title = 'Löschen';
      deleteFolder.className = 'ghost small';
      deleteFolder.onclick = (e) => {
        e.stopPropagation();
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
      if(folderTopics.length > 0){
        const topicsUl = document.createElement('ul');
        topicsUl.className = 'tree-children';
        topicsUl.style.display = isCollapsed ? 'none' : 'block';
        
        for(const t of folderTopics){
          const topicLi = createTopicElement(t, true, f.id);
          topicsUl.appendChild(topicLi);
        }
        
        folderLi.appendChild(topicsUl);
      }
      
      ul.appendChild(folderLi);
    }
    
    // Render Themen ohne Ordner
    const orphanTopics = state.data.topics.filter(t => !t.folderId);
    if(orphanTopics.length > 0){
      for(const t of orphanTopics){
        const topicLi = createTopicElement(t, false, null);
        ul.appendChild(topicLi);
      }
    }
  }
  
  function createTopicElement(t, isNested, parentFolderId){
    const count = state.data.cards.filter(c=>c.topicId===t.id).length;
    const isSelected = state.ui.selectedTopicId === t.id;
    
    const li = document.createElement('li');
    li.className = 'tree-topic' + (isSelected ? ' tree-selected' : '');
    if(!isNested) li.classList.add('tree-topic-root');
    li.setAttribute('data-topic-id', t.id);
    li.draggable = true;
    
    const topRow = document.createElement('div');
    topRow.className = 'tree-topic-row';
    
    // Drag Start - speichere Topic ID
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    
    const leftSpan = document.createElement('div');
    leftSpan.className = 'tree-topic-label';
    leftSpan.innerHTML = `
      <span class="tree-icon">📄</span>
      <span class="tree-name">${t.name}</span>
      <span class="tree-count">${count}</span>
    `;
    leftSpan.onclick = (e) => {
      e.stopPropagation();
      state.ui.selectedTopicId = t.id;
      renderCardsTable();
      if(window.__updateManageHeaderUI) window.__updateManageHeaderUI();
      renderFolderTree();
    };
    
    const btnGroup = document.createElement('div');
    btnGroup.className = 'tree-actions';
    
    const moveBtn = document.createElement('button');
    moveBtn.textContent = '📁';
    moveBtn.title = 'Ordner ändern';
    moveBtn.className = 'ghost small';
    moveBtn.onclick = (e) => {
      e.stopPropagation();
      window.openMoveTopicDialog(t);
    };
    
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Umbenennen';
    renameBtn.className = 'ghost small';
    renameBtn.onclick = (e) => {
      e.stopPropagation();
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
    deleteBtn.title = 'Löschen';
    deleteBtn.className = 'ghost small';
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
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
    topRow.appendChild(leftSpan);
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
    
    // Tabellen-Header einheitlich (MC-Optionen werden automatisch generiert)
    thead.innerHTML = `
      <tr>
        <th>Begriff</th>
        <th>Umschreibung</th>
        <th>Antwort</th>
        <th>Stats</th>
        <th>Aktionen</th>
      </tr>`;

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
        // Abziehen von der grö├ƒten Spalte
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
      
      // Begriff (bearbeitbar wie Excel)
      const termCell = document.createElement('td');
      termCell.contentEditable = 'true';
      termCell.textContent = c.term || '';
      termCell.style.cursor = 'text';
      termCell.addEventListener('blur', () => {
        const newValue = termCell.textContent.trim();
        if(newValue && newValue !== c.term){
          c.term = newValue;
          Storage.save();
        } else if(!newValue){
          termCell.textContent = c.term;
        }
      });
      termCell.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          termCell.blur();
        }
      });
      
      // Umschreibung (bearbeitbar wie Excel)
      const descCell = document.createElement('td');
      descCell.contentEditable = 'true';
      descCell.textContent = c.description || '';
      descCell.style.cursor = 'text';
      descCell.addEventListener('blur', () => {
        const newValue = descCell.textContent.trim();
        if(newValue !== c.description){
          c.description = newValue;
          Storage.save();
        }
      });
      descCell.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          descCell.blur();
        }
      });
      
      // Antwort (bearbeitbar wie Excel)
      const answerCell = document.createElement('td');
      answerCell.contentEditable = 'true';
      answerCell.style.cursor = 'text';
      answerCell.textContent = c.answer || '';
      answerCell.addEventListener('blur', () => {
        const newValue = answerCell.textContent.trim();
        if(newValue !== c.answer){
          c.answer = newValue;
          Storage.save();
        }
      });
      answerCell.addEventListener('keydown', (e) => {
        if(e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          answerCell.blur();
        }
      });
      
      // Stats (nicht bearbeitbar)
      const statsCell = document.createElement('td');
      statsCell.className = 'small muted';
      statsCell.textContent = `Box ${s.box} · ${s.correct}/${s.total}`;
      
      // Aktionen
      const actionsCell = document.createElement('td');
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'ghost';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Löschen';
      deleteBtn.onclick = () => {
        state.data.cards = state.data.cards.filter(x=>x.id!==c.id);
        Storage.save(); 
        renderCardsTable();
      };
      actionsCell.appendChild(deleteBtn);
      
      tr.appendChild(termCell);
      tr.appendChild(descCell);
      tr.appendChild(answerCell);
      tr.appendChild(statsCell);
      tr.appendChild(actionsCell);
      
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
    const modeMap = { 'type': 'Tippen', 'judge': 'Richtig/Falsch', 'multiple-choice': 'Multiple Choice (Auto)' };
    const modeInfo = $('#mode-info');
    if(modeInfo) modeInfo.textContent = `Modus: ${modeMap[answerMode] || answerMode}`;
    
    dlg.returnValue = '';
    dlg.showModal();
    $('#card-save').onclick = (e) => {
      e.preventDefault();
      const topicId = state.ui.selectedTopicId || (state.data.topics[0]&&state.data.topics[0].id) || null;
      if(!topicId){ alert('Bitte zuerst ein Thema anlegen.'); return; }
      
      const payload = {
        term: $('#card-term').value.trim(),
        description: $('#card-desc').value.trim(),
        answer: $('#card-answer').value.trim()
      };
      
      if(!payload.term){ alert('Begriff ist erforderlich'); return; }
      if(!payload.answer){ alert('Antwort ist erforderlich'); return; }
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
    
    // Judge-Modus: Antwort zeigen Button
    $('#reveal-answer').addEventListener('click', ()=>{
      const card = state.session.current;
      if(!card) return;
      
      const judgeRevealContainer = $('#judge-reveal-container');
      const judgeAnswerDisplay = $('#judge-answer-display');
      const markCorrect = $('#mark-correct');
      const markWrong = $('#mark-wrong');
      
      // Zeige die Antwort
      const answer = expectedAnswer(card);
      judgeAnswerDisplay.textContent = answer;
      judgeAnswerDisplay.style.display = 'block';
      judgeRevealContainer.style.display = 'none';
      
      // Zeige Richtig/Falsch Buttons
      markCorrect.hidden = false;
      markWrong.hidden = false;
      markCorrect.disabled = false;
      markWrong.disabled = false;
    });
    $('#skip-card').addEventListener('click', ()=>finishAnswer(false));
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
    const promptEl = $('#prompt');
    let text = '';
    let speakText = '';
    
    // Animation auf die Karte anwenden
    const animations = ['slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'rotate', 'flip'];
    const randomAnimation = animations[Math.floor(Math.random() * animations.length)];
    
    // Animation entfernen (falls noch vorhanden) und neu hinzufügen
    promptEl.classList.remove('card-enter', ...animations.map(a => `${a}`));
    void promptEl.offsetWidth; // Reflow erzwingen
    promptEl.classList.add('card-enter', randomAnimation);
    
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
    multipleChoice.style.display = 'none';
    mcButtons.forEach(btn => {
      btn.disabled = true;
      btn.style.display = 'none';
    });
    markCorrect.hidden = true;
    markWrong.hidden = true;

    if(answerMode === 'type'){
      answerInputContainer.hidden = false;
      checkBtn.disabled = false;
      answerInput.focus();
      // Ensure MC options are completely hidden in type mode
      multipleChoice.hidden = true;
      multipleChoice.style.display = 'none';
      $('#judge-reveal-container').style.display = 'none';
    } else if(answerMode === 'judge'){
      // Judge-Modus: Erst Antwort-Button, dann Richtig/Falsch Buttons nach Reveal
      const judgeRevealContainer = $('#judge-reveal-container');
      judgeRevealContainer.style.display = 'block';
      $('#judge-answer-display').style.display = 'none';
      markCorrect.hidden = true;
      markWrong.hidden = true;
    } else if(answerMode === 'multiple-choice'){
      multipleChoice.hidden = false;
      multipleChoice.style.display = 'grid';
      mcButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.display = 'block';
      });
      setupMultipleChoice(card);
      $('#judge-reveal-container').style.display = 'none';
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
    
    console.log('Stempel angezeigt:', correct ? 'RICHTIG OK' : 'FALSCH', 'Display:', stamp.style.display, 'Visibility:', stamp.style.visibility, 'getBoundingClientRect:', stamp.getBoundingClientRect());
    
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
    
    // Generiere falsche Antworten aus anderen Karten im Thema
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
    $('#feedback').textContent = correct ? 'Richtig!' : 'Falsch';
    
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
    $('#feedback').textContent = correct ? 'Richtig!' : 'Falsch';
    
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
    
    // Stempel anzeigen
    showStamp(correct);
    
    // SSML-Feedback mit Betonung abspielen
    const ttsMode = $('#tts-mode')?.value || 'none';
    if(ttsMode !== 'none'){
      TTS.speakFeedback(correct);
    }
    
    Scheduler.updateAfterAnswer(state.session.current, !!correct);
    state.session.answered += 1;
    if(correct) state.session.correct += 1;
    Storage.save();
    updateSessionStats();
    
    // Nach kurzer Zeit zur nächsten Karte (Stempel-Animation anschauen)
    setTimeout(() => {
      // Prüfe ob maximale Anzahl erreicht wurde
      if(state.session.maxCards && state.session.answered >= state.session.maxCards){
        endSession();
        alert(`Session beendet!\n\nRichtig: ${state.session.correct}\nBeantwortet: ${state.session.answered}\nErfolgsquote: ${Math.round(100*state.session.correct/state.session.answered)}%`);
        return;
      }
      
      nextCard();
    }, 1500);
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
    console.log('🔍 bindImportExport called');

    // UI: Zeige/Verstecke Felder je nach Format
    $('#import-format').addEventListener('change', () => {
      const format = $('#import-format').value;
      $('#import-file-row').style.display = (format==='csv'||format==='json') ? '' : 'none';
      $('#import-list-row').style.display = (format==='list') ? '' : 'none';
      $('#import-list-mode-row').style.display = (format==='list') ? '' : 'none';
    });

    // Import von URL
    $('#import-from-url').addEventListener('click', async () => {
      const url = $('#import-url').value.trim();
      if (!url) {
        $('#import-status').textContent = 'Bitte URL eingeben.';
        return;
      }
      
      try {
        $('#import-status').textContent = 'Lade Deck von URL...';
        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Prüfe ob es ein vollständiges Deck-Format ist (mit topics + cards)
        if (data.topics && data.cards) {
          // Vollständiges Deck mit Themen und Karten
          const importedCount = importFullDeck(data);
          $('#import-status').textContent = `✅ ${importedCount} Karten importiert!`;
          $('#import-url').value = '';
          populateAllSelects();
          renderFolderTree();
        } else if (Array.isArray(data)) {
          // Einfaches Array von Karten
          const topicId = $('#import-topic').value || null;
          if (!topicId) {
            $('#import-status').textContent = 'Bitte Ziel-Thema auswählen.';
            return;
          }
          
          data.forEach(row => {
            const card = {
              id: uid(),
              topicId: topicId,
              term: row.term || row.begriff || '',
              description: row.description || row.umschreibung || '',
              answer: row.answer || row.antwort || (row.term || row.begriff || ''),
              stats: baseStats()
            };
            if (row.mcOptions) card.mcOptions = row.mcOptions;
            state.data.cards.push(card);
          });
          
          Storage.save();
          $('#import-status').textContent = `✅ ${data.length} Karten importiert!`;
          $('#import-url').value = '';
          renderCardsTable();
        } else {
          throw new Error('Unbekanntes Deck-Format');
        }
        
      } catch (error) {
        console.error('URL-Import Fehler:', error);
        $('#import-status').textContent = '❌ Fehler: ' + error.message;
      }
    });
    
    // Vollständiges Deck importieren (mit Topics)
    function importFullDeck(deckData) {
      let importedCount = 0;
      
      // Topics importieren
      if (deckData.topics && Array.isArray(deckData.topics)) {
        deckData.topics.forEach(topic => {
          // Prüfe ob Topic mit gleicher ID bereits existiert
          const existingTopic = state.data.topics.find(t => t.id === topic.id);
          if (!existingTopic) {
            // Neues Topic hinzufügen
            state.data.topics.push({
              id: topic.id || generateId(),
              name: topic.name,
              folderId: topic.folderId || null,
              answerMode: topic.answerMode || 'type'
            });
          }
        });
      }
      
      // Karten importieren
      if (deckData.cards && Array.isArray(deckData.cards)) {
        deckData.cards.forEach(cardData => {
          const card = {
            id: uid(),
            topicId: cardData.topicId,
            term: cardData.term || '',
            description: cardData.description || '',
            answer: cardData.answer || cardData.term,
            stats: baseStats()
          };
          if (cardData.mcOptions) card.mcOptions = cardData.mcOptions;
          state.data.cards.push(card);
          importedCount++;
        });
      }
      
      Storage.save();
      return importedCount;
    }

    $('#run-import').addEventListener('click', async () => {
      const format = $('#import-format').value;
      const importSelection = $('#import-topic').value || null;
      let topicId = null;
      let selectedFolderForImport = null;
      if (importSelection) {
        if (importSelection.startsWith('folder:')) {
          selectedFolderForImport = importSelection.split(':')[1];
        } else {
          topicId = importSelection;
        }
      }
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
          // Wenn kein Thema gewählt, ggf. neues Thema unter ausgewähltem Ordner anlegen
          if (!topicId) {
            const newTopicId = uid();
            const folderId = selectedFolderForImport || state.ui.selectedFolderId || null;
            const newTopicName = 'Liste-Import';
            state.data.topics.push({ id: newTopicId, name: newTopicName, folderId, answerMode: 'type' });
            topicId = newTopicId;
            Storage.save();
          }
          const count = Importer.fromRows(rows, topicId);
          $('#import-status').textContent = `${count} ${count === 1 ? 'Karte' : 'Karten'} erfolgreich importiert`;
          populateAllSelects();
          renderFolderTree();
          renderCardsTable();
          
          // Öffne Success Dialog
          const topic = state.data.topics.find(t => t.id === topicId);
          const folder = topic?.folderId ? state.data.folders.find(f => f.id === topic.folderId) : null;
          showImportSuccessDialog(count, topic?.name || '—', folder?.name || 'Ohne Ordner', topicId);
          return;
        }
        // Standard-Import
        const file = $('#import-file').files[0];
        if (!file) {
          $('#import-status').textContent = 'Bitte eine Datei wählen.';
          return;
        }
        
        let newTopicName = null;
        // Wenn kein Thema ausgewählt: erstelle neues Thema mit Dateinamen
        if (!topicId) {
          newTopicName = file.name.replace(/\.[^.]+$/, ''); // Entferne Dateiendung
          const newTopicId = uid();
          const folderId = selectedFolderForImport || state.ui.selectedFolderId || null;
          state.data.topics.push({
            id: newTopicId,
            name: newTopicName,
            folderId: folderId,
            answerMode: 'type'
          });
          topicId = newTopicId;
          Storage.save();
        }
        
        const count = await Importer.fromFile(format, file, topicId);
        $('#import-status').textContent = `${count} ${count === 1 ? 'Karte' : 'Karten'} erfolgreich importiert`;
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
        
        // Öffne Success Dialog
        const topic = state.data.topics.find(t => t.id === topicId);
        const folder = topic?.folderId ? state.data.folders.find(f => f.id === topic.folderId) : null;
        showImportSuccessDialog(count, topic?.name || '—', folder?.name || 'Ohne Ordner', topicId);
      } catch (e){
        console.error(e); $('#import-status').textContent = 'Import fehlgeschlagen';
      }
    });

    // Inhalt erkennen: öffnet Import-Mapping-Dialog
    const detectBtn = $('#detect-import');
    console.log('🔘 detect-import Button:', detectBtn);
    
    if (!detectBtn) {
      console.error('❌ detect-import Button nicht gefunden!');
      return;
    }
    
    detectBtn.addEventListener('click', async () => {
      console.log('✅ detect-import clicked!');
      const format = $('#import-format').value;
      const fileInput = $('#import-file');
      
      try {
        if (format === 'list') {
          // Liste: aus Textarea lesen
          const raw = $('#import-list').value.trim();
          if (!raw) { $('#import-status').textContent = 'Bitte Liste eingeben.'; return; }
          importMapping.fileContent = raw;
          importMapping.fileName = 'Liste';
          
          // Für Liste kein Delimiter nötig
          parseImportFile();
          openImportMappingDialog();
          return;
        }
        
        // Datei-basiert: Auto-detect format from file extension
        const file = fileInput.files[0];
        if (!file) {
          $('#import-status').textContent = 'Bitte zuerst eine Datei wählen';
          return;
        }
        
        if (file.name) {
          const ext = file.name.split('.').pop().toLowerCase();
          if (ext === 'json') {
            $('#import-format').value = 'json';
          } else if (ext === 'csv' || ext === 'tsv') {
            $('#import-format').value = 'csv';
          } else if (ext === 'txt') {
            $('#import-format').value = 'text';
          }
        }
        
        const currentFormat = $('#import-format').value;
        if (currentFormat !== 'csv' && currentFormat !== 'json' && currentFormat !== 'list') {
          $('#import-status').textContent = 'Mapping ist für CSV/TSV und Liste verfügbar';
          return;
        }
        
        // Datei laden
        const text = await file.text();
        importMapping.fileContent = text;
        importMapping.fileName = file.name; // Speichere Dateinamen
        
        // Delimiter erkennen
        importMapping.delimiter = guessDelimiter(text);
        
        // Initial parsen
        parseImportFile();
        
        // Dialog öffnen und Phase 1 zeigen
        openImportMappingDialog();
      } catch (e) {
        $('#import-status').textContent = 'Fehler beim Laden: ' + e.message;
        console.error('detect-import error:', e);
      }
    });
    
    // Auto-detect format when file is selected
    $('#import-file')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file && file.name) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'json') {
          $('#import-format').value = 'json';
        } else if (ext === 'csv' || ext === 'tsv') {
          $('#import-format').value = 'csv';
        } else if (ext === 'txt') {
          $('#import-format').value = 'list';
        }
        // Trigger format change event to update UI
        $('#import-format').dispatchEvent(new Event('change'));
      }
    });
    
    // Import Mapping Dialog Funktionen
    function parseImportFile() {
      const format = $('#import-format').value;
      let parsed;
      
      if (format === 'json') {
        // JSON-Datei: direkt parsen
        try {
          const jsonData = JSON.parse(importMapping.fileContent);
          // jsonData kann array of cards oder {cards: [...]} sein
          const cardsArray = Array.isArray(jsonData) ? jsonData : (jsonData.cards || []);
          
          if (cardsArray.length === 0) {
            throw new Error('Keine Karten in JSON gefunden');
          }
          
          // Extrahiere alle Spalten-Namen aus allen Karten
          const allKeys = new Set();
          cardsArray.forEach(c => Object.keys(c).forEach(k => allKeys.add(k)));
          importMapping.headers = Array.from(allKeys).sort();
          
          // Konvertiere JSON-Objekte zu Arrays für tabellarische Ansicht
          importMapping.rows = cardsArray.map(card => 
            importMapping.headers.map(h => card[h] || '')
          );
          
        } catch (e) {
          throw new Error('JSON-Parse Fehler: ' + e.message);
        }
      } else if (format === 'text') {
        // Text-Datei: eine Zeile = ein Begriff
        const lines = importMapping.fileContent.split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 0);
        
        if (lines.length === 0) {
          throw new Error('Keine Daten gefunden');
        }
        
        // Spalte: "Begriff"
        importMapping.headers = ['Begriff'];
        importMapping.rows = lines.map(line => [line]);
        
      } else if (format === 'list') {
        // Liste aus Textarea mit Modus
        const raw = importMapping.fileContent || '';
        const items = raw.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
        const mode = $('#import-list-mode').value;
        const rows = [];
        
        if (items.length === 0) {
          throw new Error('Keine Daten in Liste gefunden');
        }
        
        if (mode === 'same') {
          importMapping.headers = ['Begriff', 'Antwort'];
          items.forEach(x => rows.push([x, x]));
        } else if (mode === 'pair') {
          importMapping.headers = ['Begriff', 'Antwort'];
          for (let i = 0; i < items.length - 1; i += 2) {
            rows.push([items[i], items[i+1]]);
          }
        } else if (mode === 'triple') {
          importMapping.headers = ['Begriff', 'Umschreibung', 'Antwort'];
          for (let i = 0; i < items.length - 2; i += 3) {
            rows.push([items[i], items[i+1], items[i+2]]);
          }
        } else if (mode === 'mc') {
          importMapping.headers = ['Begriff', 'Umschreibung', 'Antwort1', 'Antwort2', 'Antwort3', 'Antwort4'];
          for (let i = 0; i < items.length - 5; i += 6) {
            rows.push([items[i], items[i+1], items[i+2], items[i+3], items[i+4], items[i+5]]);
          }
        } else {
          // Fallback: nur Begriffe
          importMapping.headers = ['Begriff'];
          items.forEach(x => rows.push([x]));
        }
        
        importMapping.rows = rows;
        
      } else {
        // CSV/TSV-Datei
        parsed = Papa.parse(importMapping.fileContent, {
          delimiter: importMapping.delimiter,
          skipEmptyLines: true
        });
        
        if (!parsed.data || parsed.data.length === 0) {
          throw new Error('Keine Daten gefunden');
        }
        
        // Erste Zeile als Header verwenden
        importMapping.headers = parsed.data[0].map((h, idx) => h || `Spalte ${idx + 1}`);
        importMapping.rows = parsed.data.slice(1);
      }
      
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
        .replace(/[├ƒ]/g, 'ss')
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
        
        importMapping.columnMapping[idx] = 'ignore';
      });
    }
    
    function openImportMappingDialog() {
      const dialog = $('#import-mapping-dialog');
      
      if (!dialog) {
        console.error('Dialog import-mapping-dialog nicht gefunden!');
        return;
      }
      
      const format = $('#import-format').value;
      
      // Bei JSON/Liste direkt zu Phase 2 springen (keine Delimiter-Auswahl nötig)
      if (format === 'json' || format === 'list') {
        $$('.import-phase').forEach(p => p.classList.remove('active'));
        $('.phase-2').classList.add('active');
        renderMappingTable();
      } else {
        // Bei CSV/Text: Phase 1 zeigen
        $$('.import-phase').forEach(p => p.classList.remove('active'));
        const phase1 = $('.phase-1');
        if (phase1) {
          phase1.classList.add('active');
        }
        
        // Delimiter Buttons markieren
        $$('.delimiter-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-delim') === importMapping.delimiter);
        });
        
        // Preview Tabelle rendern
        renderPreviewTable();
      }
      
      try {
        dialog.showModal();
      } catch (e) {
        console.error('Fehler beim Öffnen des Dialogs:', e);
      }
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
                <option value="ignore" ${currentMapping === 'ignore' ? 'selected' : ''}>Ignorieren</option>
                <option value="term" ${currentMapping === 'term' ? 'selected' : ''}>Begriff</option>
                <option value="description" ${currentMapping === 'description' ? 'selected' : ''}>Umschreibung</option>
                <option value="answer" ${currentMapping === 'answer' ? 'selected' : ''}>Antwort</option>
              </select>
            </td>
            <td class="mapping-example" title="${example}">${example}</td>
          </tr>
        `;
      }).join('');
      
      // Event Listener für Mapping-├änderungen
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
          answer: ''
        };
        
        importMapping.headers.forEach((header, idx) => {
          const mapping = importMapping.columnMapping[idx];
          const value = row[idx] || '';
          
          if (mapping === 'term') card.term = value;
          else if (mapping === 'description') card.description = value;
          else if (mapping === 'answer') card.answer = value;
        });
        
        return card;
      });
      
      tbody.innerHTML = previewRows.map(card => `
        <tr>
          <td title="${card.term}">${card.term || '—'}</td>
          <td title="${card.description}">${card.description || '—'}</td>
          <td title="${card.answer}">${card.answer || '—'}</td>
        </tr>
      `).join('');
    }
    
    function prepareFinalImport() {
      // Zähle Karten
      const count = importMapping.rows.length;
      $('#summary-count').textContent = count;
      
      // Folder Select befüllen
      const folderSelect = $('#mapping-target-folder');
      const folders = state.data.folders;
      folderSelect.innerHTML = `<option value="">(Kein Ordner)</option>` + 
        folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
      
      // Aktuellen Ordner auswählen wenn gesetzt
      const currentFolder = state.ui.selectedFolderId;
      if (currentFolder) {
        folderSelect.value = currentFolder;
      }
      
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
      const format = $('#import-format').value;
      if (format === 'json') {
        // Bei JSON: Dialog schließen (da wir Phase 1 übersprungen haben)
        $('#import-mapping-dialog').close();
      } else {
        // Bei CSV/Text: zurück zu Phase 1
        $$('.import-phase').forEach(p => p.classList.remove('active'));
        $('.phase-1').classList.add('active');
      }
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
      let topicId = $('#mapping-target-topic').value || null;
      
      try {
        // Konvertiere Rows zu Card-Objekten
        const cards = importMapping.rows.map(row => {
          const card = { term: '', description: '', answer: '' };
          
          importMapping.headers.forEach((header, idx) => {
            const mapping = importMapping.columnMapping[idx];
            const value = (row[idx] || '').toString().trim();
            
            if (mapping === 'term') card.term = value;
            else if (mapping === 'description') card.description = value;
            else if (mapping === 'answer') card.answer = value;
          });
          
          return card;
        }).filter(c => c.term); // Nur Karten mit Begriff
        
        // Wenn kein Thema ausgewählt: erstelle neues Thema mit Dateinamen
        let newTopicName = null;
        let folderName = null;
        if (!topicId && importMapping.fileName) {
          newTopicName = importMapping.fileName.replace(/\.[^.]+$/, '');
          const newTopicId = uid();
          const folderId = $('#mapping-target-folder').value || null;
          state.data.topics.push({
            id: newTopicId,
            name: newTopicName,
            folderId: folderId,
            answerMode: 'type'
          });
          topicId = newTopicId;
          
          // Folder name für Success Dialog
          if (folderId) {
            const folder = state.data.folders.find(f => f.id === folderId);
            folderName = folder ? folder.name : null;
          }
          
          Storage.save();
        }
        
        // Import durchführen
        const count = Importer.fromRows(cards, topicId);
        
        // Schließen und Status anzeigen
        $('#import-mapping-dialog').close();
        $('#import-status').textContent = `Import abgeschlossen: ${count} Karte(n) erfolgreich importiert!`;
        
        // Success Dialog anzeigen wenn neues Thema erstellt wurde
        if (newTopicName) {
          showImportSuccessDialog(count, newTopicName, folderName || 'Ohne Ordner', topicId);
        }
        
        populateAllSelects();
        renderFolderTree();
        renderCardsTable();
        
        // Öffne Success Dialog
        const topic = state.data.topics.find(t => t.id === topicId);
        const folder = topic?.folderId ? state.data.folders.find(f => f.id === topic.folderId) : null;
        showImportSuccessDialog(count, topic?.name || '—', folder?.name || 'Ohne Ordner', topicId);
      } catch (e) {
        console.error(e);
        $('#import-status').textContent = 'Fehler beim Import: ' + e.message;
      }
    });

    $('#run-export').addEventListener('click', () => {
      const format = $('#export-format').value;
      const selection = $('#export-topic').value || null;
      let topicId = null;
      let folderId = null;
      if (selection) {
        if (selection.startsWith('folder:')) folderId = selection.split(':')[1];
        else topicId = selection;
      }
      
      if (format === 'json') {
        if (folderId) {
          const folder = state.data.folders.find(f => f.id === folderId);
          const topics = state.data.topics.filter(t => t.folderId === folderId);
          const topicIds = new Set(topics.map(t => t.id));
          const cards = state.data.cards.filter(c => topicIds.has(c.topicId));
          const data = { folders: folder ? [folder] : [], topics, cards };
          const json = JSON.stringify(data, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `lernKarten_${folder ? folder.name : 'Ordner'}.json`;
          a.click();
          URL.revokeObjectURL(url);
        } else {
          Storage.exportJSON(topicId);
        }
      } else if (format === 'csv') {
        let cardsToExport = [];
        if (folderId) {
          const topics = state.data.topics.filter(t => t.folderId === folderId);
          const topicIds = new Set(topics.map(t => t.id));
          cardsToExport = state.data.cards.filter(c => topicIds.has(c.topicId));
        } else {
          cardsToExport = topicId ? state.data.cards.filter(c => c.topicId === topicId) : state.data.cards;
        }
        const rows = cardsToExport.map(c => ({ topic: getTopicName(c.topicId), term: c.term, description: c.description, answer: c.answer || '' }));
        const csv = Papa.unparse(rows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'lernKarten_export.csv'; a.click(); URL.revokeObjectURL(url);
      }
    });


  }

  // --- Community Upload Modal ---
  function bindCommunityUpload(){
    const overlay = $('#community-upload-overlay');
    const shareBtn = $('#share-community');
    const uploadBtn = $('#upload-submit');
    const cancelBtn = $('#upload-cancel');
    const closeBtn = overlay.querySelector('.close-btn');
    const deckTitleInput = $('#deck-title');
    const deckDescriptionInput = $('#deck-description');
    const deckDifficultyInput = $('#deck-difficulty');
    const deckAuthorInput = $('#deck-author');
    const deckTagsInput = $('#deck-tags');
    const deckCategoryInput = $('#deck-category');
    const tagsContainer = $('#tags-container');
    const newTagInput = $('#new-tag');
    const addTagBtn = $('#add-tag-btn');

    // Vordefinierte Tags
    const predefinedTags = ['Anfänger', 'Fortgeschritten', 'Experte', 'Prüfungsvorbereitung', 'Vokabeln', 'Grammatik', 'Schule', 'Studium', 'Beruf', 'Grundlagen', 'Übungen'];
    let selectedTags = new Set();

    // Render Tag-Buttons
    const renderTagButtons = () => {
      tagsContainer.innerHTML = '';
      
      // Vordefinierte Tags
      predefinedTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag-btn' + (selectedTags.has(tag) ? ' active' : '');
        btn.textContent = tag;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          toggleTag(tag);
        });
        tagsContainer.appendChild(btn);
      });

      // Custom Tags
      Array.from(selectedTags).filter(t => !predefinedTags.includes(t)).forEach(tag => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag-btn active custom';
        btn.innerHTML = `${tag} <span style="margin-left: 4px; cursor: pointer;">✕</span>`;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          selectedTags.delete(tag);
          updateTagsInput();
          renderTagButtons();
        });
        tagsContainer.appendChild(btn);
      });

      updateTagsInput();
    };

    const toggleTag = (tag) => {
      if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      renderTagButtons();
    };

    const updateTagsInput = () => {
      deckTagsInput.value = Array.from(selectedTags).join(',');
    };

    // Initialisiere Tag-Buttons
    renderTagButtons();

    // "Share to Community" Button - nur wenn Thema ausgewählt
    shareBtn.addEventListener('click', () => {
      if (!state.ui.selectedTopicId) {
        alert('Bitte wähle ein Thema aus');
        return;
      }

      // Overlay öffnen
      overlay.style.display = 'flex';
      selectedTags.clear();
      renderTagButtons();

      // Auto-Fill mit Thema-Info
      const topic = state.data.topics.find(t => t.id === state.ui.selectedTopicId);
      if (topic) {
        deckTitleInput.value = topic.name;
        deckDescriptionInput.value = `Ein Kartenset zum Thema ${topic.name}`;
      }
    });

    // Overlay schließen
    const closeModal = () => {
      overlay.style.display = 'none';
      $('#upload-status').style.display = 'none';
      $('#upload-status').innerHTML = '';
      selectedTags.clear();
      renderTagButtons();
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);

    // Overlay schließen beim Klick auf den Hintergrund
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal();
      }
    });

    // Overlay schließen mit ESC-Taste
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.style.display === 'flex') {
        closeModal();
      }
    });

    // Neuen Tag hinzufügen
    addTagBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const newTag = newTagInput.value.trim();
      if (!newTag) {
        alert('Bitte gib einen Tag-Namen ein');
        return;
      }
      if (selectedTags.has(newTag) || predefinedTags.includes(newTag)) {
        alert('Dieser Tag existiert bereits');
        return;
      }
      selectedTags.add(newTag);
      newTagInput.value = '';
      renderTagButtons();
    });

    // Enter-Taste im Tag-Input
    newTagInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTagBtn.click();
      }
    });

    // Upload durchführen
    uploadBtn.addEventListener('click', async () => {
      // Validierung
      const title = deckTitleInput.value.trim();
      const description = deckDescriptionInput.value.trim();
      const difficulty = deckDifficultyInput.value.trim();
      const author = deckAuthorInput.value.trim() || 'Anonym';
      const tags = deckTagsInput.value;
      const category = deckCategoryInput.value.trim();
      const selectedTagsArray = tags ? tags.split(',').map(t => t.trim()) : [];

      if (!title || !description || !difficulty || selectedTagsArray.length === 0 || !category) {
        alert('Bitte fülle alle Pflichtfelder aus (mindestens ein Tag erforderlich)');
        return;
      }      if (!state.ui.selectedTopicId) {
        alert('Fehler: Kein Thema ausgewählt');
        return;
      }

      // Kein Login erforderlich – App Check schützt den Backend-Endpoint

      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = '⏳ Lädt hoch...';

        // Sammle Deck-Daten
        const topic = state.data.topics.find(t => t.id === state.ui.selectedTopicId);
        const deckCards = state.data.cards.filter(c => c.topicId === state.ui.selectedTopicId);

        const deckPayload = {
          title,
          description,
          difficulty,
          author,
          tags: selectedTagsArray,
          category,
          topics: [topic],
          cards: deckCards
        };

        // Upload zu Firebase (Cloud Function)
        await FirebaseUpload.submitDeck(deckPayload);

        // Overlay nach 3 Sekunden schließen
        setTimeout(() => {
          closeModal();

          uploadBtn.disabled = false;
          uploadBtn.textContent = '📤 Hochladen';
        }, 2000);
      } catch (error) {
        console.error('Upload error:', error);
        uploadBtn.disabled = false;
        uploadBtn.textContent = '📤 Hochladen';
      }
    });
  }

  // --- Settings ---
  function bindSettings(){
    $('#tts-lang').value = state.data.settings.tts.lang || 'de-DE';
    $('#tts-rate').value = state.data.settings.tts.rate || 1.0;
    $('#tts-voice').value = state.data.settings.tts.voiceURI || '';

    $('#tts-test').addEventListener('click', () => {
      const text = 'Stimmtest. Dies ist eine kurze Probe.';
      TTS.speakDirect(text);
    });
    $('#tts-lang').addEventListener('change', (e)=>{ state.data.settings.tts.lang = e.target.value; Storage.save(); refreshVoiceSelectors(); });
    $('#tts-voice').addEventListener('change', (e)=>{ state.data.settings.tts.voiceURI = e.target.value; Storage.save(); });
    $('#tts-rate').addEventListener('input', (e)=>{ state.data.settings.tts.rate = parseFloat(e.target.value); Storage.save(); });

    // Test Google API Key
    $('#test-google-key').addEventListener('click', async () => {
      const googleKey = ($('#google-tts-key')?.value || '').trim();
      const statusEl = $('#google-key-status');
      const testBtn = $('#test-google-key');
      
      if(!googleKey){
        statusEl.style.color = '#d9534f';
        statusEl.textContent = 'Bitte zuerst API Key eingeben';
        return;
      }
      
      testBtn.disabled = true;
      testBtn.textContent = 'Teste...';
      statusEl.style.color = '#666';
      statusEl.textContent = 'API Key wird geprüft...';
      
      try {
        // Call Google Cloud TTS API directly
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(googleKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text: 'Test' },
            voice: {
              languageCode: 'de-DE',
              name: 'de-DE-Standard-A'
            },
            audioConfig: {
              audioEncoding: 'MP3',
              pitch: 0,
              speakingRate: 1.0
            }
          })
        });
        
        if(response.ok){
          const data = await response.json();
          if(data.audioContent){
            statusEl.style.color = '#5cb85c';
            statusEl.textContent = 'API Key ist gültig und funktioniert!';
          } else {
            statusEl.style.color = '#d9534f';
            statusEl.textContent = 'Ungültige Antwort von Google API';
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          statusEl.style.color = '#d9534f';
          
          if(response.status === 400){
            statusEl.textContent = 'API Key ungültig oder Text-to-Speech API nicht aktiviert';
          } else if(response.status === 403){
            statusEl.textContent = 'API Key hat keine Berechtigung für Text-to-Speech API';
          } else if(response.status === 429){
            statusEl.textContent = 'Zu viele Anfragen - bitte später nochmal versuchen';
          } else {
            statusEl.textContent = `Fehler ${response.status}: ${errorData.error || 'Unbekannter Fehler'}`;
          }
        }
      } catch(e){
        statusEl.style.color = '#d9534f';
        statusEl.textContent = 'Netzwerkfehler: ' + e.message;
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Key testen';
      }
    });
    // Setup Google voice section listeners
    $('#google-tts-key').addEventListener('input', (e) => { 
      state.data.settings.tts.googleKey = e.target.value; 
      Storage.save(); 
    });
    
    $('#google-voice-type').addEventListener('change', (e) => { 
      state.data.settings.tts.googleVoiceType = e.target.value; 
      Storage.save(); 
    });
    
    $('#google-voice-variant').addEventListener('change', (e) => { 
      state.data.settings.tts.googleVoiceVariant = e.target.value; 
      Storage.save(); 
    });

    // Initialize and update TTS usage display
    updateTtsUsageDisplay();
    
    $('#tts-reset-usage').addEventListener('click', () => {
      if(confirm('TTS-Verbrauch wirklich zurücksetzen?')){
        state.data.settings.tts.charsUsed = 0;
        state.data.settings.tts.requestsUsed = 0;
        state.data.settings.tts.lastResetDate = new Date().toISOString().split('T')[0];
        Storage.save();
        updateTtsUsageDisplay();
      }
    });

    // KI-Auswahl und Felder initialisieren
    $('#ai-provider').value = state.data.settings.ai.provider || 'openai';
    $('#ai-key-openai').value = state.data.settings.ai.keyOpenai || '';
    $('#ai-key-grok').value = state.data.settings.ai.keyGrok || '';
    $('#ai-endpoint').value = state.data.settings.ai.endpoint || '';
    $('#ai-key').value = state.data.settings.ai.apiKey || '';


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
    
    // Themen-├£bersicht (nur verstecken wenn einzelnes Thema gewählt)
    const topicOverviewCard = $('#topic-overview-card');
    const topicStatsContainer = $('#topic-stats');
    
    if(selectedType === 'topic'){
      // Einzelnes Thema: ├£bersicht ausblenden
      if(topicOverviewCard) topicOverviewCard.style.display = 'none';
    } else {
      // Global oder Ordner: ├£bersicht anzeigen
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
        counts.textContent = `${topicCards.length} Karten . ${topicDue} fällig . ${topicMastered} gemeistert`;
        
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
        right.textContent = `${getTopicName(c.topicId)} . ${rate}% (${c.stats.correct}/${c.stats.total})`;
        
        li.appendChild(left);
        li.appendChild(right);
        hardList.appendChild(li);
      });
    }
  }

  // --- Helpers ---
  function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function escapeAttr(s){ return (s||'').replace(/["']/g, c=> c==='"'? '&quot;' : '&#39;'); }

  // --- Firebase Authentication ---
  function initFirebaseAuth() {
    // Listen for auth state changes
    firebaseAuth.onAuthStateChanged((user) => {
      const loginBtn = $('#firebase-login-btn');
      const userInfo = $('#user-info');
      const userName = $('#user-name');
      const logoutBtn = $('#firebase-logout-btn');
      const shareBtn = $('#share-community');
      const adminLink = $('#admin-link');

      if (user) {
        // User eingeloggt
        loginBtn.style.display = 'none';
        userInfo.style.display = 'inline-flex';
        userName.textContent = user.displayName || user.email;
        // shareBtn bleibt abhängig vom ausgewählten Thema (kein Login erforderlich)

        // Admin-Link nur für Admin-E-Mail anzeigen (UI-Hinweis; Server prüft zusätzlich)
        try {
          const adminEmail = (window && window.APP_ADMIN_EMAIL) ? String(window.APP_ADMIN_EMAIL) : '';
          const isAdmin = !!(adminEmail && user.email && user.email === adminEmail);
          if (adminLink) adminLink.style.display = isAdmin ? 'inline-block' : 'none';
        } catch(e){ /* ignore */ }
      } else {
        // User nicht eingeloggt
        loginBtn.style.display = 'inline-block';
        userInfo.style.display = 'none';
        // shareBtn bleibt abhängig vom ausgewählten Thema (kein Login erforderlich)
        if (adminLink) adminLink.style.display = 'none';
      }
    });

    // Login Button (optional; Upload funktioniert nun auch ohne Login)
    const loginBtn = $('#firebase-login-btn');
    loginBtn.addEventListener('click', async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebaseAuth.signInWithPopup(provider);
      } catch (error) {
        console.error('Login error:', error);
        alert('Login fehlgeschlagen: ' + error.message);
      }
    });

    // Logout Button
    const logoutBtn = $('#firebase-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await firebaseAuth.signOut();
        } catch (error) {
          console.error('Logout error:', error);
        }
      });
    }
  }

  // Kickoff
  console.log('⚙️ App Kickoff: Registriere DOMContentLoaded listener');
  window.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOMContentLoaded event fired, rufe init() auf...');
    init();
  });
  
  // Firebase Auth nach DOM-Load
  window.addEventListener('load', () => {
    console.log('✅ Page fully loaded');
    if (typeof firebaseAuth !== 'undefined') {
      initFirebaseAuth();
    }
  });

}}}

})();