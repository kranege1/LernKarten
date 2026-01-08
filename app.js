// LernKarten Application
class LernKartenApp {
    constructor() {
        this.cards = [];
        this.stats = {
            totalSessions: 0,
            totalCorrect: 0,
            totalWrong: 0,
            activities: []
        };
        this.currentView = 'cards';
        this.currentEditingCard = null;
        this.learningSession = {
            mode: null,
            cards: [],
            currentIndex: 0,
            sessionStats: { correct: 0, wrong: 0, hard: 0 }
        };
        this.settings = {
            aiEnabled: false,
            aiApiKey: '',
            ocrEnabled: true,
            voiceEnabled: true
        };
        
        this.init();
    }

    init() {
        this.loadData();
        this.setupEventListeners();
        this.renderCards();
        this.updateStats();
        this.updateSettingsUI();
    }

    // Data Management
    loadData() {
        const savedCards = localStorage.getItem('lernkarten_cards');
        const savedStats = localStorage.getItem('lernkarten_stats');
        const savedSettings = localStorage.getItem('lernkarten_settings');

        if (savedCards) {
            this.cards = JSON.parse(savedCards);
        }
        if (savedStats) {
            this.stats = JSON.parse(savedStats);
        }
        if (savedSettings) {
            this.settings = { ...this.settings, ...JSON.parse(savedSettings) };
        }
    }

    saveData() {
        localStorage.setItem('lernkarten_cards', JSON.stringify(this.cards));
        localStorage.setItem('lernkarten_stats', JSON.stringify(this.stats));
        localStorage.setItem('lernkarten_settings', JSON.stringify(this.settings));
    }

    // Event Listeners
    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                this.switchView(view);
            });
        });

        // Cards View
        document.getElementById('add-card-btn').addEventListener('click', () => this.openCardModal());
        document.getElementById('import-btn').addEventListener('click', () => this.openImportModal());
        document.getElementById('export-btn').addEventListener('click', () => this.exportData());
        document.getElementById('search-input').addEventListener('input', (e) => this.searchCards(e.target.value));

        // Card Modal
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.modal').classList.remove('active');
            });
        });
        document.getElementById('cancel-card-btn').addEventListener('click', () => this.closeCardModal());
        document.getElementById('save-card-btn').addEventListener('click', () => this.saveCard());

        // Image uploads
        this.setupImageUpload('question');
        this.setupImageUpload('answer');

        // OCR
        this.setupOCR('question');
        this.setupOCR('answer');

        // AI Rewriting
        document.getElementById('question-ai-btn').addEventListener('click', () => this.rewriteWithAI('question'));
        document.getElementById('answer-ai-btn').addEventListener('click', () => this.rewriteWithAI('answer'));

        // Learn View
        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.mode;
                this.startLearning(mode);
            });
        });
        document.getElementById('back-to-cards').addEventListener('click', () => {
            this.switchView('cards');
            this.resetLearningSession();
        });
        document.getElementById('show-answer-btn').addEventListener('click', () => this.showAnswer());
        document.getElementById('correct-btn').addEventListener('click', () => this.answerCard('correct'));
        document.getElementById('hard-btn').addEventListener('click', () => this.answerCard('hard'));
        document.getElementById('wrong-btn').addEventListener('click', () => this.answerCard('wrong'));

        // Voice controls
        document.getElementById('speak-question-btn').addEventListener('click', () => this.speakText('question'));
        document.getElementById('speak-answer-btn').addEventListener('click', () => this.speakText('answer'));

        // Settings
        document.getElementById('ai-enabled').addEventListener('change', (e) => {
            this.settings.aiEnabled = e.target.checked;
            this.saveData();
            this.updateSettingsUI();
        });
        document.getElementById('ai-api-key').addEventListener('change', (e) => {
            this.settings.aiApiKey = e.target.value;
            this.saveData();
        });
        document.getElementById('ocr-enabled').addEventListener('change', (e) => {
            this.settings.ocrEnabled = e.target.checked;
            this.saveData();
        });
        document.getElementById('voice-enabled').addEventListener('change', (e) => {
            this.settings.voiceEnabled = e.target.checked;
            this.saveData();
        });
        document.getElementById('clear-data-btn').addEventListener('click', () => this.clearAllData());

        // Import
        document.getElementById('import-json-btn').addEventListener('click', () => {
            document.getElementById('import-file-input').accept = '.json';
            document.getElementById('import-file-input').click();
        });
        document.getElementById('import-csv-btn').addEventListener('click', () => {
            document.getElementById('import-file-input').accept = '.csv';
            document.getElementById('import-file-input').click();
        });
        document.getElementById('import-file-input').addEventListener('change', (e) => this.handleImport(e));
    }

    // View Management
    switchView(viewName) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        
        document.getElementById(`${viewName}-view`).classList.add('active');
        document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
        
        this.currentView = viewName;

        if (viewName === 'stats') {
            this.updateStats();
        }
    }

    // Card Management
    renderCards(filteredCards = null) {
        const cardsToRender = filteredCards || this.cards;
        const cardsList = document.getElementById('cards-list');
        
        if (cardsToRender.length === 0) {
            cardsList.innerHTML = '<div class="empty-state"><p>Noch keine Karten vorhanden. Erstelle deine erste Lernkarte!</p></div>';
            return;
        }

        cardsList.innerHTML = cardsToRender.map(card => `
            <div class="card-item" data-id="${card.id}">
                <div class="card-item-header">
                    <div class="card-item-title">Frage</div>
                    <div class="card-item-actions">
                        <button onclick="app.editCard('${card.id}')" title="Bearbeiten">✏️</button>
                        <button onclick="app.deleteCard('${card.id}')" title="Löschen">🗑️</button>
                    </div>
                </div>
                <div class="card-item-content">
                    ${card.question.text || ''}
                    ${card.question.image ? `<img src="${card.question.image}" class="card-item-image" alt="Question image">` : ''}
                </div>
                ${card.tags && card.tags.length > 0 ? `
                    <div class="card-tags">
                        ${card.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    searchCards(query) {
        if (!query) {
            this.renderCards();
            return;
        }

        const filtered = this.cards.filter(card => {
            const searchText = query.toLowerCase();
            return (
                (card.question.text && card.question.text.toLowerCase().includes(searchText)) ||
                (card.answer.text && card.answer.text.toLowerCase().includes(searchText)) ||
                (card.tags && card.tags.some(tag => tag.toLowerCase().includes(searchText)))
            );
        });

        this.renderCards(filtered);
    }

    openCardModal(card = null) {
        this.currentEditingCard = card;
        const modal = document.getElementById('card-modal');
        const modalTitle = document.getElementById('modal-title');

        if (card) {
            modalTitle.textContent = 'Karte bearbeiten';
            document.getElementById('card-question-input').value = card.question.text || '';
            document.getElementById('card-answer-input').value = card.answer.text || '';
            document.getElementById('card-tags-input').value = card.tags ? card.tags.join(', ') : '';
            
            if (card.question.image) {
                document.getElementById('question-image-preview').innerHTML = `<img src="${card.question.image}" alt="Question">`;
            }
            if (card.answer.image) {
                document.getElementById('answer-image-preview').innerHTML = `<img src="${card.answer.image}" alt="Answer">`;
            }
        } else {
            modalTitle.textContent = 'Neue Karte erstellen';
            document.getElementById('card-question-input').value = '';
            document.getElementById('card-answer-input').value = '';
            document.getElementById('card-tags-input').value = '';
            document.getElementById('question-image-preview').innerHTML = '';
            document.getElementById('answer-image-preview').innerHTML = '';
        }

        modal.classList.add('active');
    }

    closeCardModal() {
        document.getElementById('card-modal').classList.remove('active');
        this.currentEditingCard = null;
    }

    saveCard() {
        const questionText = document.getElementById('card-question-input').value.trim();
        const answerText = document.getElementById('card-answer-input').value.trim();
        const tagsInput = document.getElementById('card-tags-input').value.trim();

        if (!questionText && !answerText) {
            alert('Bitte gib mindestens eine Frage oder Antwort ein.');
            return;
        }

        const questionImage = document.getElementById('question-image-preview').querySelector('img')?.src || null;
        const answerImage = document.getElementById('answer-image-preview').querySelector('img')?.src || null;
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

        if (this.currentEditingCard) {
            // Edit existing card
            const card = this.cards.find(c => c.id === this.currentEditingCard.id);
            card.question = { text: questionText, image: questionImage };
            card.answer = { text: answerText, image: answerImage };
            card.tags = tags;
            card.updatedAt = new Date().toISOString();
        } else {
            // Create new card
            const newCard = {
                id: this.generateId(),
                question: { text: questionText, image: questionImage },
                answer: { text: answerText, image: answerImage },
                tags: tags,
                stats: { correct: 0, wrong: 0, hard: 0 },
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.cards.push(newCard);
        }

        this.saveData();
        this.renderCards();
        this.closeCardModal();
    }

    editCard(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (card) {
            this.openCardModal(card);
        }
    }

    deleteCard(cardId) {
        if (confirm('Möchtest du diese Karte wirklich löschen?')) {
            this.cards = this.cards.filter(c => c.id !== cardId);
            this.saveData();
            this.renderCards();
        }
    }

    // Image Upload
    setupImageUpload(type) {
        const btn = document.getElementById(`${type}-image-btn`);
        const input = document.getElementById(`${type}-image-input`);
        const preview = document.getElementById(`${type}-image-preview`);

        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    preview.innerHTML = `<img src="${event.target.result}" alt="${type}">`;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // OCR Functionality
    setupOCR(type) {
        const btn = document.getElementById(`${type}-ocr-btn`);
        const input = document.getElementById(`${type}-ocr-input`);
        const textarea = document.getElementById(`card-${type}-input`);

        btn.addEventListener('click', () => {
            if (!this.settings.ocrEnabled) {
                alert('OCR ist in den Einstellungen deaktiviert.');
                return;
            }
            input.click();
        });

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                btn.disabled = true;
                btn.innerHTML = '⏳ OCR läuft...';

                try {
                    const result = await Tesseract.recognize(file, 'deu', {
                        logger: m => {
                            // Update button with progress if available
                            if (m.status === 'recognizing text' && m.progress) {
                                const percent = Math.round(m.progress * 100);
                                btn.innerHTML = `⏳ OCR: ${percent}%`;
                            }
                        }
                    });
                    
                    const extractedText = result.data.text.trim();
                    if (extractedText) {
                        textarea.value = extractedText;
                    } else {
                        alert('Kein Text im Bild gefunden.');
                    }
                } catch (error) {
                    console.error('OCR Error:', error);
                    alert('Fehler beim Extrahieren des Textes.');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '📷 OCR aus Bild';
                }
            }
        });
    }

    // AI Rewriting
    async rewriteWithAI(type) {
        if (!this.settings.aiEnabled || !this.settings.aiApiKey) {
            alert('Bitte aktiviere KI in den Einstellungen und gib deinen API-Schlüssel ein.');
            return;
        }

        const textarea = document.getElementById(`card-${type}-input`);
        const currentText = textarea.value.trim();

        if (!currentText) {
            alert('Bitte gib zuerst einen Text ein.');
            return;
        }

        const btn = document.getElementById(`${type}-ai-btn`);
        btn.disabled = true;
        btn.innerHTML = '⏳ KI arbeitet...';

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.settings.aiApiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-3.5-turbo',
                    messages: [{
                        role: 'user',
                        content: `Bitte formuliere folgenden Text für eine Lernkarte um, um ihn klarer und prägnanter zu machen: "${currentText}"`
                    }],
                    max_tokens: 200
                })
            });

            if (!response.ok) {
                throw new Error('API-Anfrage fehlgeschlagen');
            }

            const data = await response.json();
            const rewrittenText = data.choices[0].message.content.trim();
            
            if (confirm(`Neuer Text:\n\n${rewrittenText}\n\nMöchtest du diesen Text verwenden?`)) {
                textarea.value = rewrittenText;
            }
        } catch (error) {
            console.error('AI Error:', error);
            alert('Fehler bei der KI-Umschreibung. Prüfe deinen API-Schlüssel.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '✨ KI umschreiben';
        }
    }

    // Learning Mode
    startLearning(mode) {
        if (this.cards.length === 0) {
            alert('Keine Karten zum Lernen vorhanden.');
            return;
        }

        this.learningSession.mode = mode;
        this.learningSession.cards = [...this.cards].sort(() => Math.random() - 0.5); // Shuffle
        this.learningSession.currentIndex = 0;
        this.learningSession.sessionStats = { correct: 0, wrong: 0, hard: 0 };

        document.querySelector('.learn-mode-selection').style.display = 'none';
        document.getElementById('learn-card-area').style.display = 'block';

        if (mode === 'voice' && this.settings.voiceEnabled) {
            document.getElementById('voice-controls').style.display = 'flex';
        } else {
            document.getElementById('voice-controls').style.display = 'none';
        }

        this.showCurrentCard();
    }

    showCurrentCard() {
        const card = this.learningSession.cards[this.learningSession.currentIndex];
        
        document.getElementById('current-card-num').textContent = this.learningSession.currentIndex + 1;
        document.getElementById('total-cards-num').textContent = this.learningSession.cards.length;

        // Show question
        const questionText = document.getElementById('question-text');
        const questionImage = document.getElementById('question-image');
        
        questionText.textContent = card.question.text || '';
        if (card.question.image) {
            questionImage.src = card.question.image;
            questionImage.style.display = 'block';
        } else {
            questionImage.style.display = 'none';
        }

        // Hide answer initially
        document.getElementById('learn-answer').style.display = 'none';
        document.getElementById('show-answer-btn').style.display = 'block';
        document.getElementById('answer-buttons').style.display = 'none';
        document.getElementById('speak-answer-btn').style.display = 'none';

        // Auto-speak in voice mode
        if (this.learningSession.mode === 'voice' && this.settings.voiceEnabled) {
            setTimeout(() => this.speakText('question'), 500);
        }
    }

    showAnswer() {
        const card = this.learningSession.cards[this.learningSession.currentIndex];
        
        const answerText = document.getElementById('answer-text');
        const answerImage = document.getElementById('answer-image');
        
        answerText.textContent = card.answer.text || '';
        if (card.answer.image) {
            answerImage.src = card.answer.image;
            answerImage.style.display = 'block';
        } else {
            answerImage.style.display = 'none';
        }

        document.getElementById('learn-answer').style.display = 'block';
        document.getElementById('show-answer-btn').style.display = 'none';
        document.getElementById('answer-buttons').style.display = 'flex';

        if (this.learningSession.mode === 'voice' && this.settings.voiceEnabled) {
            document.getElementById('speak-answer-btn').style.display = 'inline-flex';
            setTimeout(() => this.speakText('answer'), 500);
        }
    }

    answerCard(result) {
        const card = this.learningSession.cards[this.learningSession.currentIndex];
        
        // Update stats
        this.learningSession.sessionStats[result]++;
        card.stats[result]++;

        if (result === 'correct') {
            this.stats.totalCorrect++;
        } else if (result === 'wrong') {
            this.stats.totalWrong++;
        }

        // Add activity
        this.stats.activities.unshift({
            type: result,
            cardId: card.id,
            timestamp: new Date().toISOString()
        });

        // Keep only last 50 activities
        if (this.stats.activities.length > 50) {
            this.stats.activities = this.stats.activities.slice(0, 50);
        }

        this.saveData();

        // Move to next card
        this.learningSession.currentIndex++;
        
        if (this.learningSession.currentIndex >= this.learningSession.cards.length) {
            this.endLearningSession();
        } else {
            this.showCurrentCard();
        }
    }

    endLearningSession() {
        this.stats.totalSessions++;
        this.saveData();

        const { correct, wrong, hard } = this.learningSession.sessionStats;
        const total = correct + wrong + hard;
        const successRate = total > 0 ? Math.round((correct / total) * 100) : 0;

        alert(`Lernsitzung beendet!\n\nRichtig: ${correct}\nSchwer: ${hard}\nFalsch: ${wrong}\nErfolgsrate: ${successRate}%`);

        this.resetLearningSession();
    }

    resetLearningSession() {
        this.learningSession = {
            mode: null,
            cards: [],
            currentIndex: 0,
            sessionStats: { correct: 0, wrong: 0, hard: 0 }
        };

        document.querySelector('.learn-mode-selection').style.display = 'block';
        document.getElementById('learn-card-area').style.display = 'none';
    }

    // Voice/Speech
    speakText(type) {
        if (!this.settings.voiceEnabled) {
            return;
        }

        const card = this.learningSession.cards[this.learningSession.currentIndex];
        const text = type === 'question' ? card.question.text : card.answer.text;

        if (!text || !('speechSynthesis' in window)) {
            return;
        }

        // Cancel any ongoing speech
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        utterance.rate = 0.9;
        
        window.speechSynthesis.speak(utterance);
    }

    // Statistics
    updateStats() {
        document.getElementById('total-cards-stat').textContent = this.cards.length;
        
        const learnedCards = this.cards.filter(c => c.stats.correct > 0 || c.stats.wrong > 0 || c.stats.hard > 0).length;
        document.getElementById('learned-cards-stat').textContent = learnedCards;
        
        document.getElementById('sessions-stat').textContent = this.stats.totalSessions;
        
        const total = this.stats.totalCorrect + this.stats.totalWrong;
        const successRate = total > 0 ? Math.round((this.stats.totalCorrect / total) * 100) : 0;
        document.getElementById('success-rate-stat').textContent = successRate + '%';

        // Render activities
        const activityList = document.getElementById('activity-list');
        if (this.stats.activities.length === 0) {
            activityList.innerHTML = '<p class="empty-state">Noch keine Aktivitäten vorhanden.</p>';
        } else {
            activityList.innerHTML = this.stats.activities.slice(0, 10).map(activity => {
                const card = this.cards.find(c => c.id === activity.cardId);
                const cardPreview = card ? card.question.text?.substring(0, 50) : 'Gelöschte Karte';
                const emoji = activity.type === 'correct' ? '✅' : activity.type === 'wrong' ? '❌' : '⚠️';
                const date = new Date(activity.timestamp).toLocaleString('de-DE');
                
                return `
                    <div class="activity-item">
                        <div>${emoji} ${cardPreview}</div>
                        <div class="activity-item-time">${date}</div>
                    </div>
                `;
            }).join('');
        }
    }

    // Settings
    updateSettingsUI() {
        document.getElementById('ai-enabled').checked = this.settings.aiEnabled;
        document.getElementById('ai-api-key').value = this.settings.aiApiKey || '';
        document.getElementById('ocr-enabled').checked = this.settings.ocrEnabled;
        document.getElementById('voice-enabled').checked = this.settings.voiceEnabled;

        const aiSettings = document.getElementById('ai-settings');
        const aiButtons = document.querySelectorAll('#question-ai-btn, #answer-ai-btn');
        
        if (this.settings.aiEnabled) {
            aiSettings.style.display = 'flex';
            aiButtons.forEach(btn => btn.style.display = 'inline-flex');
        } else {
            aiSettings.style.display = 'none';
            aiButtons.forEach(btn => btn.style.display = 'none');
        }
    }

    clearAllData() {
        if (confirm('Möchtest du wirklich ALLE Daten löschen? Dies kann nicht rückgängig gemacht werden!')) {
            if (confirm('Bist du dir absolut sicher? Alle Karten und Statistiken gehen verloren!')) {
                localStorage.clear();
                this.cards = [];
                this.stats = {
                    totalSessions: 0,
                    totalCorrect: 0,
                    totalWrong: 0,
                    activities: []
                };
                this.renderCards();
                this.updateStats();
                alert('Alle Daten wurden gelöscht.');
            }
        }
    }

    // Import/Export
    openImportModal() {
        document.getElementById('import-modal').classList.add('active');
    }

    async handleImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const content = e.target.result;
                let importedCards = [];

                if (file.name.endsWith('.json')) {
                    const data = JSON.parse(content);
                    importedCards = Array.isArray(data) ? data : [data];
                } else if (file.name.endsWith('.csv')) {
                    importedCards = this.parseCSV(content);
                }

                if (importedCards.length > 0) {
                    // Assign new IDs to avoid conflicts
                    importedCards.forEach(card => {
                        card.id = this.generateId();
                        if (!card.stats) {
                            card.stats = { correct: 0, wrong: 0, hard: 0 };
                        }
                        if (!card.question) {
                            card.question = { text: card.question || '', image: null };
                        }
                        if (!card.answer) {
                            card.answer = { text: card.answer || '', image: null };
                        }
                    });

                    this.cards.push(...importedCards);
                    this.saveData();
                    this.renderCards();
                    
                    document.getElementById('import-modal').classList.remove('active');
                    alert(`${importedCards.length} Karte(n) erfolgreich importiert!`);
                } else {
                    alert('Keine gültigen Karten in der Datei gefunden.');
                }
            } catch (error) {
                console.error('Import error:', error);
                alert('Fehler beim Importieren der Datei.');
            }
        };

        reader.readAsText(file);
    }

    parseCSV(content) {
        const lines = content.split('\n').filter(line => line.trim());
        const cards = [];

        // Skip header if present
        const startIndex = lines[0].toLowerCase().includes('frage') ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Simple CSV parsing - handles basic quoted fields
            const parts = [];
            let current = '';
            let inQuotes = false;
            
            for (let j = 0; j < line.length; j++) {
                const char = line[j];
                
                if (char === '"') {
                    inQuotes = !inQuotes;
                } else if (char === ',' && !inQuotes) {
                    parts.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current.trim());

            // Remove quotes from parts
            const cleanParts = parts.map(p => p.replace(/^"|"$/g, ''));

            if (cleanParts.length >= 2) {
                cards.push({
                    question: { text: cleanParts[0], image: null },
                    answer: { text: cleanParts[1], image: null },
                    tags: cleanParts[2] ? cleanParts[2].split(';').map(t => t.trim()).filter(t => t) : [],
                    stats: { correct: 0, wrong: 0, hard: 0 },
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
            }
        }

        return cards;
    }

    exportData() {
        const exportData = this.cards.map(card => ({
            question: card.question.text,
            answer: card.answer.text,
            tags: card.tags ? card.tags.join(';') : '',
            stats: card.stats
        }));

        // Export as JSON
        const jsonData = JSON.stringify(this.cards, null, 2);
        this.downloadFile(jsonData, 'lernkarten.json', 'application/json');

        // Also offer CSV
        const csvData = this.convertToCSV(exportData);
        this.downloadFile(csvData, 'lernkarten.csv', 'text/csv');

        alert('Daten wurden als JSON und CSV exportiert!');
    }

    convertToCSV(data) {
        const headers = ['Frage', 'Antwort', 'Tags', 'Richtig', 'Falsch', 'Schwer'];
        const rows = data.map(item => [
            `"${item.question}"`,
            `"${item.answer}"`,
            `"${item.tags}"`,
            item.stats.correct,
            item.stats.wrong,
            item.stats.hard
        ]);

        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }

    downloadFile(content, filename, type) {
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    }

    // Utilities
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substring(2);
    }
}

// Initialize app
const app = new LernKartenApp();
