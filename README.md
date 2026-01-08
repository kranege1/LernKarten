# LernKarten – Karten Lernspiel

Ein modernes, lokales Lernkartensystem mit verschiedenen Fragemodi (Text, Sprache, Bild), optionaler KI-Umschreibung, OCR aus Bildern, Import/Export und Statistik.

## Features
- Fragemodi: Begriff anzeigen, Umschreibung anzeigen, Bild anzeigen
- Vorlesen per TTS (Web Speech API), Sprache/Stimme einstellbar
- Umschreibung je Karte speicherbar; optional Live-Umschreibung via konfigurierbarem OpenAI-kompatiblen Endpoint
- Spaced-Repetition (Leitner-System), falsche Antworten kommen häufiger dran
- Themenverwaltung, beliebig viele Karten pro Thema
- Statistik mit Charts (Chart.js): Fällige Karten, schwierigste Karten, Box-Übersicht
- Import (CSV/TSV/JSON/Textliste) und Export (JSON/CSV)
- OCR (Tesseract.js) um Text aus Bildern zu extrahieren (de/en)
- Daten lokal im Browser (localStorage); Exportdateien z.B. in Google Drive speicherbar. Optional: Google Drive-Hooks (konfigurierbar)

## Schnellstart
1. Öffne `index.html` im Browser (oder starte einen lokalen Server).
2. Lege unter "Verwalten" ein Thema und Karten an.
3. Starte unter "Lernen" eine Session und wähle den Fragemodus.

### Lokaler Server (optional)
Mit Node.js:
```powershell
npm install -g http-server
http-server . -p 5173
```
Dann im Browser: http://localhost:5173

## Datenformate
- CSV/TSV: Spalten (auto-erkannt): `topic`, `term`/`begriff`, `description`/`umschreibung`, `answer`/`antwort`, `imageurl`/`bild`
- JSON: Entweder das komplette Schema `{ topics: [...], cards: [...] }` oder eine Liste von Kartenobjekten mit Feldern
  `term`, `description`, `answer`, `imageUrl`.
- Textliste: Eine Zeile = ein Begriff; Thema im Import-UI wählen.

## KI-Umschreibung (optional)
- Einstellungen: `OpenAI-kompatibler Endpoint` und `API Key` eintragen (z.B. eigener Server mit OpenAI-kompatiblem API).
- Button "Testanfrage" prüft die Konfiguration.

## Google Drive (optional)
- In den Einstellungen `OAuth Client ID` hinterlegen. Die bereitgestellten Buttons sind Platzhalter; eine vollständige Integration erfordert OAuth-Setup in der Google Cloud Console.

## Hinweise
- TTS erfordert einen unterstützten Browser (Chromium/Edge/Chrome, Safari).
- OCR passiert im Browser und kann je nach Bildgröße einige Sekunden dauern.
- Exportiere regelmäßig deine Daten (JSON), um Backups zu haben.
