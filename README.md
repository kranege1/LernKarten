# 🎓 LernKarten

Ein modernes, lokales Lernkartensystem mit verschiedenen Fragemodi (Text, Sprache, Bild), optionaler KI-Umschreibung, OCR aus Bildern, Import/Export und Statistik.

## ✨ Features

### 📝 Kartenverwaltung
- **Karten erstellen, bearbeiten und löschen**: Erstelle unbegrenzt viele Lernkarten
- **Text und Bilder**: Füge sowohl Text als auch Bilder zu Fragen und Antworten hinzu
- **Tags**: Organisiere deine Karten mit benutzerdefinierten Tags
- **Suchfunktion**: Durchsuche alle Karten nach Text oder Tags

### 🎯 Lernmodi
- **Text-Modus**: Klassisches Karteikarten-Lernen
- **Sprach-Modus**: Nutze die Web Speech API für Sprachausgabe
- **Bild-Modus**: Lerne mit visuellen Hilfsmitteln

### 🤖 Intelligente Features
- **OCR (Optical Character Recognition)**: Extrahiere Text aus Bildern mit Tesseract.js
- **KI-Umschreibung**: Optional: Nutze OpenAI API, um Kartentexte umzuformulieren und zu verbessern
- **Intelligente Bewertung**: Bewerte Karten als "Richtig", "Schwer" oder "Falsch"

### 📊 Statistiken
- Verfolge deine Lernfortschritte
- Übersicht über alle Karten, gelernte Karten und Lernsitzungen
- Erfolgsrate in Prozent
- Aktivitätsverlauf

### 💾 Import/Export
- **JSON-Export**: Exportiere alle Karten im JSON-Format
- **CSV-Export**: Exportiere Karten als CSV-Datei
- **Import-Funktion**: Importiere Karten aus JSON- oder CSV-Dateien

### 🔒 Datenschutz
- **100% Lokal**: Alle Daten werden im Browser gespeichert (localStorage)
- **Keine Server**: Keine Datenübertragung an externe Server (außer optional OpenAI API)
- **Offline-fähig**: Funktioniert komplett offline (außer OCR-Bibliothek beim ersten Laden)

## 🚀 Installation & Nutzung

### Einfache Nutzung
1. Klone oder lade das Repository herunter
2. Öffne `index.html` in einem modernen Webbrowser
3. Fertig! Keine weitere Installation nötig

### Mit lokalem Server (empfohlen für Tests)
```bash
# Python 3
python3 -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (npx)
npx http-server

# Dann öffne: http://localhost:8000
```

## 📖 Anleitung

### Karte erstellen
1. Klicke auf "+ Neue Karte"
2. Gib Frage und Antwort ein
3. Optional: Füge Bilder hinzu oder nutze OCR
4. Optional: Füge Tags hinzu
5. Klicke auf "Speichern"

### Lernen starten
1. Gehe zum Tab "Lernen"
2. Wähle einen Lernmodus (Text, Sprache oder Bild)
3. Beantworte die Fragen
4. Bewerte deine Antworten (Richtig, Schwer, Falsch)

### OCR nutzen
1. Beim Erstellen einer Karte auf "📷 OCR aus Bild" klicken
2. Bild mit Text auswählen
3. Warten, bis der Text extrahiert ist
4. Text wird automatisch ins Textfeld eingefügt

### KI-Umschreibung aktivieren
1. Gehe zu "Einstellungen"
2. Aktiviere "KI-Umschreibung aktivieren"
3. Gib deinen OpenAI API-Schlüssel ein
4. Beim Erstellen von Karten erscheint nun der "✨ KI umschreiben"-Button

### Daten exportieren
1. Klicke auf "Export" im Karten-Tab
2. Es werden automatisch JSON- und CSV-Dateien heruntergeladen

### Daten importieren
1. Klicke auf "Import" im Karten-Tab
2. Wähle "JSON Datei wählen" oder "CSV Datei wählen"
3. Wähle die Datei aus
4. Die Karten werden importiert

## 🛠️ Technologie-Stack

- **Frontend**: Vanilla JavaScript (ES6+)
- **Styling**: CSS3 mit modernem Design
- **Datenspeicherung**: LocalStorage API
- **OCR**: Tesseract.js (via CDN)
- **Sprachausgabe**: Web Speech API
- **Optional AI**: OpenAI API

## 📋 CSV-Format für Import

```csv
Frage,Antwort,Tags
"Was ist die Hauptstadt von Deutschland?","Berlin","Geographie;Deutschland"
"Wie heißt der höchste Berg Deutschlands?","Zugspitze","Geographie;Deutschland;Berge"
```

## 🔐 Sicherheit & Datenschutz

- Alle Daten werden **lokal im Browser** gespeichert
- Der OpenAI API-Schlüssel wird nur lokal gespeichert
- Keine Cookies oder Tracking
- Keine Datenübertragung an Dritte (außer OpenAI, falls aktiviert)

## 🌐 Browser-Kompatibilität

- ✅ Chrome/Edge (empfohlen)
- ✅ Firefox
- ✅ Safari
- ⚠️ Sprachausgabe funktioniert nicht in allen Browsern gleich

## 📱 Responsive Design

Die Anwendung ist vollständig responsive und funktioniert auf:
- Desktop-Computern
- Tablets
- Smartphones

## 🤝 Beitragen

Beiträge sind willkommen! Erstelle einfach einen Pull Request oder öffne ein Issue.

## 📄 Lizenz

Dieses Projekt ist Open Source und frei verfügbar.

## 🎯 Roadmap

Mögliche zukünftige Features:
- Spaced Repetition Algorithmus
- Mehrere Kartenstapel
- Dark Mode
- Erweiterte Statistiken
- Mehr Import-/Export-Formate
- Offline PWA (Progressive Web App)

## 💡 Tipps

- Nutze Tags, um Karten zu organisieren
- Exportiere regelmäßig deine Daten als Backup
- Füge Bilder hinzu, um visuell zu lernen
- Nutze die OCR-Funktion für handgeschriebene Notizen
- Die Sprachausgabe hilft beim auditiven Lernen

---

**Viel Erfolg beim Lernen! 🎓**
