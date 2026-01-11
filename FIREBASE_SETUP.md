# Firebase Setup für LernKarten Community Upload

## 1. Firebase Project erstellen

1. Gehe zu https://console.firebase.google.com
2. Klick "Projekt erstellen" 
3. Name: `LernKarten` (oder gewünscht)
4. Google Analytics: Optional
5. "Projekt erstellen"

## 2. Cloud Firestore aktivieren

1. Im linken Menu: "Firestore Database"
2. "Create Database"
3. Region: `europe-west1` (Frankfurt/Belgien für DSGVO)
4. Security Rules: "Start in test mode" (werden dann angepasst)
5. "Create"

## 3. Cloud Storage aktivieren

1. Im linken Menu: "Storage"
2. "Get started"
3. Region: `europe-west1`
4. Security Rules akzeptieren
5. "Done"

## 4. Cloud Functions aktivieren

1. Im linken Menu: "Functions"
2. "Get started"
3. Wähle Region: `europe-west1`
4. "Next"

## 5. GitHub Token in Firebase speichern

Variante A – per CLI (empfohlen):

1. Firebase CLI installieren und anmelden
   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use <dein-projekt-id>
   ```
2. Secret anlegen (du wirst nach dem Token gefragt – PRÜFE, dass er `repo`-Rechte hat)
   ```bash
   firebase functions:secrets:set GITHUB_TOKEN
   ```
3. Deploy der Functions (nachdem du die Functions-Struktur deployed hast)
   ```bash
   firebase deploy --only functions:submitDeck,functions:approveDeck
   ```

Variante B – in der Console:

1. Firebase Console → Build → Functions → Secrets → "Add secret"
2. Name: `GITHUB_TOKEN`
3. Value: Dein GitHub Personal Access Token (Classic) mit `repo` Permission
4. Danach das Secret in der Funktion binden (Binding hinzufügen) oder wie im Code via `runWith({ secrets: [...] })`

Codebindung (bereits im Beispiel umgesetzt):

```ts
import { defineSecret } from 'firebase-functions/params';
const GITHUB_TOKEN = defineSecret('GITHUB_TOKEN');

export const approveDeck = functions
  .region('europe-west1')
  .runWith({ secrets: [GITHUB_TOKEN] })
  .https.onCall(async (data, context) => {
    const githubToken = GITHUB_TOKEN.value();
    // ...
  });
```

## 6. Functions-Code installieren (bereitgestellt)

1. Wechsle in den Functions-Ordner und installiere Abhängigkeiten
   ```bash
   cd functions
   npm install
   ```
2. Bau den TypeScript-Code (wird bei `firebase deploy` ebenfalls automatisch ausgeführt)
   ```bash
   npm run build
   ```
3. Setze die Admin-Email als Runtime-Variable (für die Freigabe-Funktion)
   - Console: Firebase Console → Build → Functions → Runtime environment → Add variable → Name: `ADMIN_EMAIL`, Value: deine Admin-Mail
   - Alternative (CLI): Danach deployen; das Setzen per Console ist am einfachsten/verlässlichsten.
4. Deploy nur die Functions
   ```bash
   firebase deploy --only functions:submitDeck,functions:approveDeck
   ```

Hinweis:
- Der Beispielcode liegt in `functions/src/index.ts`.
- Abhängigkeiten sind in `functions/package.json` definiert; Node 18 wird verwendet.
- `approveDeck` ist nur für die per `ADMIN_EMAIL` hinterlegte Mail erlaubt.

## 7. App Check aktivieren (No-Login Einreichungen)

Um Einreichungen ohne Login zu erlauben, wird Firebase App Check (reCAPTCHA v3) eingesetzt:

1. Firebase Console → Build → App Check → Deine Web App auswählen → reCAPTCHA v3 registrieren
2. Site Key kopieren und in `index.html` eintragen (`window.APP_CHECK_SITE_KEY`)
3. Enforcement in App Check aktivieren (Schalter auf „Enforce“), damit nur verifizierte Aufrufe durchkommen
4. In `functions/src/index.ts` erzwingen wir App Check serverseitig (`if (!context.app) { throw failed-precondition }`).

Frontend: In `index.html` sind die Skripte bereits eingebunden und App Check wird mit einem Platzhalter initialisiert. Ersetze den Site Key:

```html
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-check.js"></script>
<script>
   window.APP_CHECK_SITE_KEY = "DEIN_RECAPTCHA_V3_SITE_KEY";
   firebase.appCheck().activate(window.APP_CHECK_SITE_KEY, true);
   // true = Token Auto-Refresh
   // Hinweis: Keine Login-Pflicht mehr für submitDeck
   // (approveDeck bleibt admin-geschützt)
</script>
```

Serverseitige Limits (Standards)

- Titel: 3–120 Zeichen
- Beschreibung: 10–1000 Zeichen
- Autor: bis 100 Zeichen
- Kategorie: 2–64 Zeichen
- Schwierigkeit: einfach | mittel | schwer
- Tags: 1–10 Stück, je 2–24 Zeichen
- Themen: 1–5
- Karten: 1–300
   - Begriff bis 200, Antwort bis 200, Umschreibung bis 500 Zeichen
   - Hinweis: Multiple-Choice-Optionen werden dynamisch aus anderen Karten erzeugt (keine `mcOptions` im Payload)
- Gesamt-Payload: ca. ≤ 750 KB

Bei Überschreitung wird `invalid-argument` aus der Function zurückgegeben.

## 8. Web App registrieren

1. Im Firebase Console: "Project Settings" > "Your apps"
2. Klick Web-Icon (</>)
3. App Name: `LernKarten Web`
4. "Register app"
5. Copy die Firebase Config (brauchen wir später)

## 9. Authentifizierung einrichten

1. Im linken Menu: "Authentication"
2. "Get started"
3. Sign-in method: "Google" aktivieren
4. Project support email: deine Email
5. "Save"

## Nächste Schritte

- Cloud Function für Upload-Handler
- Firestore Security Rules setzen
- Frontend anpassen
- Admin-Panel erstellen

