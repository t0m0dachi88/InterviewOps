import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { MonacoBinding } from "y-monaco";
import type { Socket } from "socket.io-client";

interface UseCollaborativeEditorProps {
  socket: Socket | null;
  interviewId: string;
  questionId: string | null;
  starterCode?: string;
  defaultLanguage?: string;
  readOnly?: boolean;
}

export function useCollaborativeEditor({
  socket,
  interviewId,
  questionId,
  starterCode = "",
  defaultLanguage = "javascript",
  readOnly = false,
}: UseCollaborativeEditorProps) {
  const [language, setLanguage] = useState<string>(defaultLanguage);
  const [isSynced, setIsSynced] = useState<boolean>(false);

  const docRef = useRef<Y.Doc | null>(null);
  const editorRef = useRef<any>(null);
  const bindingRef = useRef<MonacoBinding | null>(null);

  // Initialize and synchronize collaborative document
  useEffect(() => {
    if (!socket || !interviewId || !questionId) return;

    // Create fresh Yjs document for this question
    const doc = new Y.Doc();
    docRef.current = doc;
    setIsSynced(false);

    const yText = doc.getText("monaco");

    // Rebind Monaco if editor is already mounted
    if (editorRef.current) {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      try {
        const binding = new MonacoBinding(
          yText,
          editorRef.current.getModel(),
          new Set([editorRef.current]),
        );
        bindingRef.current = binding;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Failed to create MonacoBinding:", err);
      }
    }

    // Join document room on server
    socket.emit("yjs:join", { interviewId, questionId, starterCode }, () => {
      setIsSynced(true);
    });

    const handleSync = (payload: any) => {
      if (payload.questionId === questionId && payload.update) {
        try {
          const binary = Uint8Array.from(atob(payload.update), (c) =>
            c.charCodeAt(0),
          );
          Y.applyUpdate(doc, binary, "server");
          setIsSynced(true);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Error applying yjs:sync update:", err);
        }
      }
    };

    const handleUpdate = (payload: any) => {
      if (payload.questionId === questionId && payload.update) {
        try {
          const binary = Uint8Array.from(atob(payload.update), (c) =>
            c.charCodeAt(0),
          );
          Y.applyUpdate(doc, binary, "server");
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error("Error applying yjs:update:", err);
        }
      }
    };

    socket.on("yjs:sync", handleSync);
    socket.on("yjs:update", handleUpdate);

    // Send local document edits to server (ignore updates originating from server)
    const handleDocUpdate = (update: Uint8Array, origin: any) => {
      if (origin !== "server") {
        let binary = "";
        const len = update.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(update[i]);
        }
        const base64Update = btoa(binary);

        socket.emit("yjs:update", {
          interviewId,
          questionId,
          update: base64Update,
        });
      }
    };

    doc.on("update", handleDocUpdate);

    return () => {
      socket.off("yjs:sync", handleSync);
      socket.off("yjs:update", handleUpdate);
      doc.off("update", handleDocUpdate);

      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
      doc.destroy();
      docRef.current = null;
    };
  }, [socket, interviewId, questionId]);

  // When Monaco editor instance mounts
  const handleEditorMount = useCallback(
    (editor: any) => {
      editorRef.current = editor;

      if (readOnly) {
        editor.updateOptions({ readOnly: true });
      }

      if (docRef.current) {
        const yText = docRef.current.getText("monaco");
        if (bindingRef.current) {
          bindingRef.current.destroy();
        }
        try {
          const binding = new MonacoBinding(
            yText,
            editor.getModel(),
            new Set([editor]),
          );
          bindingRef.current = binding;
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Failed to bind Monaco in mount:", err);
        }
      }
    },
    [readOnly],
  );

  const resetCode = useCallback(
    (newStarterCode: string) => {
      if (!socket || !interviewId || !questionId) return;
      socket.emit("yjs:reset", {
        interviewId,
        questionId,
        starterCode: newStarterCode,
      });
    },
    [socket, interviewId, questionId],
  );

  const getSourceCode = useCallback(() => {
    if (docRef.current) {
      return docRef.current.getText("monaco").toString();
    }
    if (editorRef.current) {
      return editorRef.current.getValue();
    }
    return "";
  }, []);

  return {
    editorRef,
    handleEditorMount,
    language,
    setLanguage,
    isSynced,
    resetCode,
    getSourceCode,
  };
}
