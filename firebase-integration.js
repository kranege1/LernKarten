// Firebase-Integration für LernKarten Frontend
// Füge zu index.html hinzu

// Firebase Config (aus Firebase Console kopieren)
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Firebase & Cloud Functions Integration
class FirebaseManager {
  constructor() {
    firebase.initializeApp(firebaseConfig);
    this.auth = firebase.auth();
    this.functions = firebase.functions("europe-west1");
  }

  async loginWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await this.auth.signInWithPopup(provider);
      return result.user;
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  }

  logout() {
    return this.auth.signOut();
  }

  async submitDeck(deckData) {
    // Cloud Function aufrufen (sicher - Token ist versteckt)
    const submitDeck = this.functions.httpsCallable("submitDeck");
    return await submitDeck(deckData);
  }

  onAuthStateChanged(callback) {
    this.auth.onAuthStateChanged(callback);
  }

  getCurrentUser() {
    return this.auth.currentUser;
  }
}

// Nutze in app.js
const firebaseManager = new FirebaseManager();

// Bevor User uploaden kann: Login erforderlich
function bindCommunityUpload() {
  const shareBtn = $("#share-community");

  shareBtn.addEventListener("click", async () => {
    const user = firebaseManager.getCurrentUser();

    if (!user) {
      // Login erforderlich
      const confirmed = confirm("Du musst dich einloggen um ein Deck hochzuladen. Jetzt einloggen?");
      if (confirmed) {
        try {
          await firebaseManager.loginWithGoogle();
        } catch (error) {
          alert("Login fehlgeschlagen");
          return;
        }
      } else {
        return;
      }
    }

    // Overlay öffnen
    const overlay = $("#community-upload-overlay");
    overlay.style.display = "flex";
    // ... Rest wie vorher ...
  });

  // Bei Upload-Submit
  const uploadBtn = $("#upload-submit");
  uploadBtn.addEventListener("click", async () => {
    // ... Validierung ...

    try {
      uploadBtn.disabled = true;
      uploadBtn.textContent = "⏳ Wird eingereicht...";

      const deckPayload = {
        title,
        description,
        difficulty,
        author,
        tags: selectedTagsArray,
        category,
        topics: [topic],
        cards: deckCards,
      };

      // Cloud Function aufrufen (sicher!)
      const result = await firebaseManager.submitDeck(deckPayload);

      const statusEl = $("#upload-status");
      statusEl.style.display = "block";
      statusEl.innerHTML = `
        <div style="text-align: center; padding: 12px;">
          <div style="font-size: 24px; margin-bottom: 8px;">🎉</div>
          <div style="font-size: 16px; font-weight: 600; margin-bottom: 4px;">Danke!</div>
          <div style="font-size: 14px;">Dein Deck wurde eingereicht!</div>
          <div style="font-size: 12px; color: var(--muted); margin-top: 8px;">
            Ein Admin wird es reviewen und freigeben.<br>
            ⏳ Das dauert normalerweise wenige Stunden.
          </div>
        </div>
      `;
      statusEl.style.background = "rgba(16, 185, 129, 0.1)";
      statusEl.style.borderLeft = "3px solid #10b981";

      setTimeout(() => {
        closeModal();
      }, 3000);
    } catch (error) {
      console.error("Submit error:", error);
      alert("Fehler: " + error.message);
      uploadBtn.disabled = false;
      uploadBtn.textContent = "📤 Hochladen";
    }
  });
}
