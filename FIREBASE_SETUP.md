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

## 6. Web App registrieren

1. Im Firebase Console: "Project Settings" > "Your apps"
2. Klick Web-Icon (</>)
3. App Name: `LernKarten Web`
4. "Register app"
5. Copy die Firebase Config (brauchen wir später)

## 7. Authentifizierung einrichten

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

