import * as functions from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import fetch from "node-fetch";

admin.initializeApp();
const db = admin.firestore();

interface DeckSubmission {
  title: string;
  description: string;
  difficulty: string;
  category: string;
  author: string;
  tags: string[];
  cards: any[];
  topics: any[];
}

export const submitDeck = functions
  .region("europe-west1")
  .https.onCall(async (data: DeckSubmission, context) => {
    // App Check validation - currently disabled for testing
    // TODO: Enable App Check in production by uncommenting below
    // if (!context.app) {
    //   throw new functions.https.HttpsError(
    //     "failed-precondition",
    //     "App Check erforderlich. Bitte App Check aktivieren."
    //   );
    // }
    console.log("submitDeck called, App Check status:", context.app ? "valid" : "not present");

    try {
      if (!data.title || !data.description || !data.difficulty || !data.category) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Pflichtfelder fehlen"
        );
      }

      if (!data.cards || data.cards.length === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Mindestens 1 Karte erforderlich"
        );
      }

      // --- Serverseitige Validierung & Limits ---
      const limits = {
        maxCards: 300,
        maxTopics: 5,
        maxTags: 10,
        maxPayloadBytes: 750_000, // ~750 KB
        title: { min: 3, max: 120 },
        description: { min: 10, max: 1000 },
        author: { min: 0, max: 100 },
        category: { min: 2, max: 64 },
        tagLen: { min: 2, max: 24 },
        term: { min: 1, max: 200 },
        answer: { min: 1, max: 200 },
        desc: { min: 0, max: 500 },
      } as const;

      const difficultyAllowed = new Set(["einfach", "mittel", "schwer"]);

      const len = (s: any) => (typeof s === "string" ? s.trim().length : 0);
      const ensure = (cond: boolean, msg: string) => {
        if (!cond) throw new functions.https.HttpsError("invalid-argument", msg);
      };

      // Basic fields
      ensure(len(data.title) >= limits.title.min && len(data.title) <= limits.title.max, `Titel muss ${limits.title.min}-${limits.title.max} Zeichen haben`);
      ensure(len(data.description) >= limits.description.min && len(data.description) <= limits.description.max, `Beschreibung muss ${limits.description.min}-${limits.description.max} Zeichen haben`);
      ensure(len(data.category) >= limits.category.min && len(data.category) <= limits.category.max, `Kategorie muss ${limits.category.min}-${limits.category.max} Zeichen haben`);
      ensure(len(data.author) <= limits.author.max, `Autor darf max. ${limits.author.max} Zeichen haben`);
      ensure(difficultyAllowed.has(String(data.difficulty).toLowerCase()), `Ungültige Schwierigkeit (erlaubt: einfach|mittel|schwer)`);

      // Tags
      const tags = Array.isArray(data.tags) ? data.tags : [];
      ensure(tags.length >= 1 && tags.length <= limits.maxTags, `Zwischen 1 und ${limits.maxTags} Tags erforderlich`);
      for (const t of tags) {
        ensure(typeof t === "string", "Tag muss String sein");
        const L = len(t);
        ensure(L >= limits.tagLen.min && L <= limits.tagLen.max, `Tag-Länge ${limits.tagLen.min}-${limits.tagLen.max}`);
      }

      // Topics
      const topics = Array.isArray(data.topics) ? data.topics : [];
      ensure(topics.length >= 1 && topics.length <= limits.maxTopics, `Zwischen 1 und ${limits.maxTopics} Themen erlaubt`);
      for (const tp of topics) {
        ensure(tp && len(tp.name) >= 1 && len(tp.name) <= limits.title.max, "Ungültiges Topic (Name fehlt/zu lang)");
      }

      // Cards
      const cards = Array.isArray(data.cards) ? data.cards : [];
      ensure(cards.length >= 1 && cards.length <= limits.maxCards, `Anzahl Karten 1-${limits.maxCards}`);
      for (const c of cards) {
        ensure(c && typeof c === "object", "Ungültige Karte");
        ensure(len(c.term) >= limits.term.min && len(c.term) <= limits.term.max, `Begriff-Länge ${limits.term.min}-${limits.term.max}`);
        ensure(len(c.answer) >= limits.answer.min && len(c.answer) <= limits.answer.max, `Antwort-Länge ${limits.answer.min}-${limits.answer.max}`);
        ensure(len(c.description || "") <= limits.desc.max, `Umschreibung max. ${limits.desc.max} Zeichen`);
        // Keine mcOptions-Prüfung: Multiple-Choice-Optionen werden dynamisch aus anderen Karten generiert
      }

      // Approx total payload size
      const approxSize = Buffer.byteLength(
        JSON.stringify({ topics, cards, meta: { title: data.title, tags } }),
        "utf8"
      );
      ensure(approxSize <= limits.maxPayloadBytes, `Payload zu groß (>${Math.round(limits.maxPayloadBytes/1000)} KB)`);

      const submission = {
        userId: context.auth?.uid || null,
        userEmail: (context.auth?.token as any)?.email || null,
        ...data,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending",
        deckFileName: `${data.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")}-${Date.now()}.json`,
      } as any;

      const docRef = await db.collection("submissions").add(submission);

      // Store full deck JSON directly in Firestore (simpler than using Storage)
      const deckJson = {
        metadata: {
          id: docRef.id,
          title: data.title,
          description: data.description,
          difficulty: data.difficulty,
          category: data.category,
          author: data.author,
          tags: data.tags,
          cardCount: data.cards.length,
          submittedAt: new Date().toISOString(),
        },
        topics: data.topics,
        cards: data.cards,
      };

      // Save deck content directly to the submission document
      await docRef.update({
        deckContent: deckJson
      });

      return {
        success: true,
        submissionId: docRef.id,
        message: "Deck erfolgreich eingereicht! Admin wird es in Kürze reviewen.",
      };
    } catch (error: any) {
      console.error("Submit error:", error);
      throw new functions.https.HttpsError(
        "internal",
        error?.message || "Fehler beim Einreichen"
      );
    }
  });

// Admin approval function - requires GITHUB_TOKEN secret
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

// Hardcoded admin email - change this to your email
const ADMIN_EMAIL = "gerald.kranewitter@gmail.com";

export const approveDeck = functions
  .region("europe-west1")
  .runWith({ secrets: [GITHUB_TOKEN] })
  .https.onCall(async (data: { submissionId: string }, context) => {
    // Check admin permission
    if (!context.auth?.token?.email || context.auth.token.email !== ADMIN_EMAIL) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Nur Admin erlaubt. Eingeloggt als: ${context.auth?.token?.email || 'nicht eingeloggt'}`
      );
    }

    try {
      const submissionSnap = await db
        .collection("submissions")
        .doc(data.submissionId)
        .get();

      if (!submissionSnap.exists) {
        throw new functions.https.HttpsError("not-found", "Submission nicht gefunden");
      }

      const submissionData = submissionSnap.data() as any;

      // Get deck content directly from Firestore (saved in deckContent field)
      const deckJson = submissionData.deckContent;
      if (!deckJson) {
        throw new functions.https.HttpsError("not-found", "Deck-Inhalt nicht gefunden");
      }

      const githubToken = GITHUB_TOKEN.value().trim();
      if (!githubToken) {
        throw new functions.https.HttpsError("failed-precondition", "GitHub Token nicht konfiguriert");
      }

      const owner = "kranege1";
      const repo = "LernKarten";
      const branch = "gh-pages";
      const filePath = `shared-decks/${submissionData.deckFileName}`;

      // 1) Upload Deck file to GitHub
      const deckContent64 = Buffer.from(
        JSON.stringify(deckJson, null, 2)
      ).toString("base64");

      const uploadResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
        {
          method: "PUT",
          headers: {
            Authorization: `token ${githubToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Add community deck: ${submissionData.title}`,
            content: deckContent64,
            branch: branch,
          }),
        }
      );

      if (!uploadResponse.ok) {
        const errText = await uploadResponse.text();
        throw new Error(`GitHub upload failed: ${uploadResponse.status} - ${errText}`);
      }

      // 2) Update catalog.json
      const catalogResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/shared-decks/catalog.json?ref=${branch}`,
        {
          headers: {
            Authorization: `token ${githubToken}`,
          },
        }
      );

      if (!catalogResponse.ok) {
        throw new Error(`Load catalog failed: ${catalogResponse.statusText}`);
      }

      const catalogData: any = await catalogResponse.json();
      const catalogContent = Buffer.from(catalogData.content, "base64").toString("utf-8");
      const catalog = JSON.parse(catalogContent);

      catalog.decks.push({
        id: submissionSnap.id,
        title: submissionData.title,
        description: submissionData.description,
        category: submissionData.category,
        language: "de",
        cardCount: Array.isArray(submissionData.cards) ? submissionData.cards.length : 0,
        difficulty: submissionData.difficulty,
        author: submissionData.author || "Anonym",
        tags: submissionData.tags || [],
        fileName: submissionData.deckFileName,
        downloadUrl: `https://${owner}.github.io/${repo}/shared-decks/${submissionData.deckFileName}`,
        created: new Date().toISOString().split("T")[0],
      });

      catalog.lastUpdated = new Date().toISOString();

      const catalogContent64 = Buffer.from(
        JSON.stringify(catalog, null, 2)
      ).toString("base64");

      const catalogUpdateResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/shared-decks/catalog.json?ref=${branch}`,
        {
          method: "PUT",
          headers: {
            Authorization: `token ${githubToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Update catalog: add ${submissionData.title}`,
            content: catalogContent64,
            sha: catalogData.sha,
            branch: branch,
          }),
        }
      );

      if (!catalogUpdateResponse.ok) {
        const errText = await catalogUpdateResponse.text();
        throw new Error(`Catalog update failed: ${catalogUpdateResponse.status} - ${errText}`);
      }

      // 3) Mark submission as approved
      await db.collection("submissions").doc(data.submissionId).update({
        status: "approved",
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: context.auth?.token?.email,
      });

      return {
        success: true,
        message: "Deck wurde genehmigt und auf GitHub veröffentlicht!",
      };
    } catch (error: any) {
      console.error("Approve error:", error);
      throw new functions.https.HttpsError(
        "internal",
        error?.message || "Fehler beim Genehmigen"
      );
    }
  });

export const deleteDeck = functions
  .region("europe-west1")
  .runWith({ secrets: [GITHUB_TOKEN] })
  .https.onCall(async (data: { fileName: string; id?: string }, context) => {
    if (!context.auth?.token?.email || context.auth.token.email !== ADMIN_EMAIL) {
      throw new functions.https.HttpsError(
        "permission-denied",
        `Nur Admin erlaubt. Eingeloggt als: ${context.auth?.token?.email || 'nicht eingeloggt'}`
      );
    }

    const fileName = String(data.fileName || "").trim();
    if (!fileName) {
      throw new functions.https.HttpsError("invalid-argument", "fileName fehlt");
    }

    const githubToken = GITHUB_TOKEN.value().trim();
    if (!githubToken) {
      throw new functions.https.HttpsError("failed-precondition", "GitHub Token nicht konfiguriert");
    }

    const owner = "kranege1";
    const repo = "LernKarten";
    const branch = "gh-pages";
    const filePath = `shared-decks/${fileName}`;

    try {
      // Get file SHA for deletion
      const fileResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      if (!fileResp.ok) {
        throw new Error(`Deck-Datei nicht gefunden: ${fileResp.statusText}`);
      }
      const fileJson: any = await fileResp.json();
      const fileSha = fileJson.sha;

      // Delete the deck file
      const delResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `token ${githubToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Remove community deck: ${fileName}`,
            sha: fileSha,
            branch,
          }),
        }
      );
      if (!delResp.ok) {
        const errText = await delResp.text();
        throw new Error(`Löschen fehlgeschlagen: ${delResp.status} - ${errText}`);
      }

      // Load catalog.json
      const catalogResp = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/shared-decks/catalog.json?ref=${branch}`,
        { headers: { Authorization: `token ${githubToken}` } }
      );
      if (!catalogResp.ok) {
        throw new Error(`Katalog laden fehlgeschlagen: ${catalogResp.statusText}`);
      }
      const catalogData: any = await catalogResp.json();
      const catalogContent = Buffer.from(catalogData.content, "base64").toString("utf-8");
      const catalog = JSON.parse(catalogContent);

      // Remove entry
      catalog.decks = (catalog.decks || []).filter((d: any) => d.fileName !== fileName && d.id !== data.id);
      catalog.lastUpdated = new Date().toISOString();

      const newCatalog64 = Buffer.from(JSON.stringify(catalog, null, 2)).toString("base64");
      const catalogUpdate = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/shared-decks/catalog.json?ref=${branch}`,
        {
          method: "PUT",
          headers: { Authorization: `token ${githubToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: `Update catalog: remove ${fileName}`,
            content: newCatalog64,
            sha: catalogData.sha,
            branch,
          }),
        }
      );
      if (!catalogUpdate.ok) {
        const errText = await catalogUpdate.text();
        throw new Error(`Katalog-Update fehlgeschlagen: ${catalogUpdate.status} - ${errText}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error("deleteDeck error:", error);
      throw new functions.https.HttpsError("internal", error?.message || "Fehler beim Löschen");
    }
  });

