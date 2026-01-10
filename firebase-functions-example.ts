// Firebase Cloud Function für Deck-Upload
// Datei: functions/src/index.ts

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
    // Authentifizierung prüfen
    if (!context.auth) {
      throw new functions.https.HttpsError(
        "unauthenticated",
        "User muss eingeloggt sein"
      );
    }

    try {
      // Validierung
      if (!data.title || !data.description || !data.difficulty || !data.category) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Pflichtfelder fehlen"
        );
      }

      if (data.cards.length === 0) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          "Mindestens 1 Karte erforderlich"
        );
      }

      // Submission im Firestore speichern
      const submission = {
        userId: context.auth.uid,
        userEmail: context.auth.token.email,
        ...data,
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: "pending", // pending, approved, rejected
        deckFileName: `${data.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")}-${Date.now()}.json`,
      };

      const docRef = await db.collection("submissions").add(submission);

      // Deck-JSON speichern im Storage
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

      const bucket = admin.storage().bucket();
      await bucket.file(`submissions/${submission.deckFileName}`).save(
        JSON.stringify(deckJson, null, 2),
        {
          metadata: {
            contentType: "application/json",
          },
        }
      );

      return {
        success: true,
        submissionId: docRef.id,
        message: "Deck erfolgreich eingereicht! Admin wird es in Kürze reviewen.",
      };
    } catch (error: any) {
      console.error("Submit error:", error);
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Fehler beim Einreichen"
      );
    }
  });

// Für Admin: Deck freigeben und zu GitHub pushen
// Secret sicher aus Firebase Secrets Manager laden
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

export const approveDeck = functions
  .region("europe-west1")
  .runWith({ secrets: [GITHUB_TOKEN] })
  .https.onCall(async (data: { submissionId: string }, context) => {
    // Nur Admin darf das
    if (context.auth?.token.email !== process.env.ADMIN_EMAIL) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "Nur Admin erlaubt"
      );
    }

    try {
      const submission = await db
        .collection("submissions")
        .doc(data.submissionId)
        .get();

      if (!submission.exists) {
        throw new functions.https.HttpsError("not-found", "Submission nicht gefunden");
      }

      const submissionData = submission.data() as any;

      // Deck-JSON aus Storage laden
      const bucket = admin.storage().bucket();
      const deckFile = bucket.file(
        `submissions/${submissionData.deckFileName}`
      );
      const [deckContent] = await deckFile.download();
      const deckJson = JSON.parse(deckContent.toString());

      // Zu GitHub pushen (Secret aus Secrets Manager)
      const githubToken = GITHUB_TOKEN.value();
      const owner = "kranege1";
      const repo = "LernKarten";
      const branch = "gh-pages";
      const filePath = `shared-decks/${submissionData.deckFileName}`;

      // 1. Upload Deck-Datei zu GitHub
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
          }),
        }
      );

      if (!uploadResponse.ok) {
        throw new Error(`GitHub upload failed: ${uploadResponse.statusText}`);
      }

      // 2. Catalog aktualisieren
      const catalogResponse = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/shared-decks/catalog.json`,
        {
          headers: {
            Authorization: `token ${githubToken}`,
          },
        }
      );

      const catalogData: any = await catalogResponse.json();
      const catalogContent = Buffer.from(catalogData.content, "base64").toString();
      const catalog = JSON.parse(catalogContent);

      // Neuen Eintrag hinzufügen
      catalog.decks.push({
        id: submission.id,
        title: submissionData.title,
        description: submissionData.description,
        category: submissionData.category,
        language: "de",
        cardCount: submissionData.cards.length,
        difficulty: submissionData.difficulty,
        author: submissionData.author,
        tags: submissionData.tags,
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
          }),
        }
      );

      if (!catalogUpdateResponse.ok) {
        throw new Error(
          `Catalog update failed: ${catalogUpdateResponse.statusText}`
        );
      }

      // Status in Firestore updaten
      await db.collection("submissions").doc(data.submissionId).update({
        status: "approved",
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedBy: context.auth?.token.email,
      });

      return {
        success: true,
        message: "Deck wurde genehmigt und veröffentlicht!",
      };
    } catch (error: any) {
      console.error("Approve error:", error);
      throw new functions.https.HttpsError(
        "internal",
        error.message || "Fehler beim Genehmigen"
      );
    }
  });
