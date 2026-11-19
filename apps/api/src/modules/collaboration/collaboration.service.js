import * as Y from "yjs";
import { CodeDocument } from "./code-document.model.js";
import { Interview } from "../interviews/interview.model.js";

class CollaborationService {
  constructor() {
    // roomKey: `${interviewId}:${questionId}` -> { doc: Y.Doc, debouncedSaveTimer: NodeJS.Timeout, isDirty: boolean }
    this.activeDocs = new Map();
  }

  _getRoomKey(interviewId, questionId) {
    return `${String(interviewId)}:${String(questionId)}`;
  }

  /**
   * Load or initialize a collaborative Y.Doc for an interview question.
   *
   * @param {string} interviewId
   * @param {string} questionId
   * @param {string} [defaultStarterCode]
   * @returns {Promise<Y.Doc>}
   */
  async getOrCreateDocument(interviewId, questionId, defaultStarterCode = "") {
    const roomKey = this._getRoomKey(interviewId, questionId);

    if (this.activeDocs.has(roomKey)) {
      return this.activeDocs.get(roomKey).doc;
    }

    const doc = new Y.Doc();
    let dbDoc = await CodeDocument.findOne({ interviewId, questionId });

    if (dbDoc && dbDoc.yjsState && dbDoc.yjsState.length > 0) {
      Y.applyUpdate(doc, new Uint8Array(dbDoc.yjsState));
    } else {
      // Find starter code from interview question snapshot if not supplied
      let initialCode = defaultStarterCode;
      if (!initialCode) {
        const interview = await Interview.findById(interviewId).lean();
        if (interview && interview.questionSnapshots) {
          const snapshot = interview.questionSnapshots.find(
            (q) => String(q.questionId) === String(questionId),
          );
          if (snapshot?.starterCodeByLanguage) {
            initialCode =
              snapshot.starterCodeByLanguage.javascript ||
              snapshot.starterCodeByLanguage.python ||
              snapshot.starterCodeByLanguage.cpp ||
              "// Start coding here\n";
          }
        }
      }

      const yText = doc.getText("monaco");
      if (initialCode) {
        yText.insert(0, initialCode);
      }

      // Initialize in database
      const interview = await Interview.findById(interviewId).lean();
      const organizationId = interview ? interview.organizationId : null;

      if (organizationId) {
        const updateBytes = Buffer.from(Y.encodeStateAsUpdate(doc));
        dbDoc = await CodeDocument.findOneAndUpdate(
          { interviewId, questionId },
          {
            organizationId,
            interviewId,
            questionId,
            language: "javascript",
            yjsState: updateBytes,
            text: yText.toString(),
            version: 1,
            lastSavedAt: new Date(),
          },
          { upsert: true, new: true },
        );
      }
    }

    const entry = {
      doc,
      interviewId: String(interviewId),
      questionId: String(questionId),
      debouncedSaveTimer: null,
      isDirty: false,
    };

    doc.on("update", () => {
      this._scheduleSave(entry);
    });

    this.activeDocs.set(roomKey, entry);
    return doc;
  }

  _scheduleSave(entry) {
    entry.isDirty = true;
    if (entry.debouncedSaveTimer) return;

    entry.debouncedSaveTimer = setTimeout(async () => {
      entry.debouncedSaveTimer = null;
      if (entry.isDirty) {
        await this.flushDocument(entry.interviewId, entry.questionId);
      }
    }, 1500);
  }

  /**
   * Flush in-memory Yjs document to MongoDB.
   *
   * @param {string} interviewId
   * @param {string} questionId
   */
  async flushDocument(interviewId, questionId) {
    const roomKey = this._getRoomKey(interviewId, questionId);
    const entry = this.activeDocs.get(roomKey);
    if (!entry) return null;

    entry.isDirty = false;
    const doc = entry.doc;
    const updateBytes = Buffer.from(Y.encodeStateAsUpdate(doc));
    const currentText = doc.getText("monaco").toString();

    const updated = await CodeDocument.findOneAndUpdate(
      { interviewId, questionId },
      {
        yjsState: updateBytes,
        text: currentText,
        lastSavedAt: new Date(),
        $inc: { version: 1 },
      },
      { new: true },
    );

    return updated;
  }

  /**
   * Reset collaborative document to specified starter code.
   *
   * @param {string} interviewId
   * @param {string} questionId
   * @param {string} starterCode
   */
  async resetDocument(interviewId, questionId, starterCode = "") {
    const doc = await this.getOrCreateDocument(interviewId, questionId);
    const yText = doc.getText("monaco");

    doc.transact(() => {
      yText.delete(0, yText.length);
      if (starterCode) {
        yText.insert(0, starterCode);
      }
    });

    await this.flushDocument(interviewId, questionId);
    return doc;
  }

  /**
   * Get current plain text code for question document.
   *
   * @param {string} interviewId
   * @param {string} questionId
   * @returns {Promise<string>}
   */
  async getCurrentCode(interviewId, questionId) {
    const roomKey = this._getRoomKey(interviewId, questionId);
    if (this.activeDocs.has(roomKey)) {
      return this.activeDocs.get(roomKey).doc.getText("monaco").toString();
    }

    const dbDoc = await CodeDocument.findOne({ interviewId, questionId }).lean();
    return dbDoc?.text || "";
  }
}

export const collaborationService = new CollaborationService();
