import { useEffect, useState, useRef, useCallback } from "react";
import { io as ioClient, type Socket } from "socket.io-client";
import type { ParticipantDto } from "../../../lib/api-client";

interface UseInterviewSocketOptions {
  interviewId: string;
  token: string;
  onActiveQuestionChanged?: (questionId: string) => void;
  onSubmissionReceived?: (submission: any) => void;
  onExecutionUpdated?: (payload: any) => void;
}

export function useInterviewSocket({
  interviewId,
  token,
  onActiveQuestionChanged,
  onSubmissionReceived,
  onExecutionUpdated,
}: UseInterviewSocketOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [socketError, setSocketError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!interviewId || !token) return;

    const wsUrl = import.meta.env.VITE_WS_URL || "http://localhost:5000";

    const socket = ioClient(wsUrl, {
      auth: { token },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setIsReconnecting(false);
      setSocketError(null);

      // Join interview room
      socket.emit("interview:join", { interviewId }, (response: any) => {
        if (response?.success && response.data) {
          setParticipants(response.data.participants || []);
          if (response.data.activeQuestionId) {
            setActiveQuestionId(response.data.activeQuestionId);
          }
        }
      });
    });

    socket.on("disconnect", (reason) => {
      setIsConnected(false);
      if (reason === "io server disconnect") {
        socket.connect();
      } else {
        setIsReconnecting(true);
      }
    });

    socket.on("connect_error", (err) => {
      setIsConnected(false);
      setSocketError(err.message || "Failed to connect to real-time server");
    });

    socket.on("interview:room_state", (state: any) => {
      if (state.participants) {
        setParticipants(state.participants);
      }
      if (state.activeQuestionId) {
        setActiveQuestionId(state.activeQuestionId);
      }
    });

    socket.on("interview:participant_joined", (payload: any) => {
      if (payload.participants) {
        setParticipants(payload.participants);
      } else if (payload.participant) {
        setParticipants((prev) => {
          if (prev.some((p) => p.id === payload.participant.id)) return prev;
          return [...prev, payload.participant];
        });
      }
    });

    socket.on("interview:participant_left", (payload: any) => {
      if (payload.participants) {
        setParticipants(payload.participants);
      } else if (payload.participantId) {
        setParticipants((prev) => prev.filter((p) => p.id !== payload.participantId));
      }
    });

    socket.on("interview:active_question_changed", (payload: any) => {
      if (payload.questionId) {
        setActiveQuestionId(payload.questionId);
        onActiveQuestionChanged?.(payload.questionId);
      }
    });

    socket.on("submission:saved", (payload: any) => {
      onSubmissionReceived?.(payload.submission);
    });

    socket.on("submission:submitted", (payload: any) => {
      onSubmissionReceived?.(payload.submission);
    });

    socket.on("submission:queued", (payload: any) => {
      onSubmissionReceived?.(payload.submission);
      onExecutionUpdated?.({
        status: "queued",
        submissionId: payload.submission?.id || payload.submissionId,
        submissionType: payload.submission?.submissionType,
      });
    });

    socket.on("submission:completed", (payload: any) => {
      onExecutionUpdated?.(payload);
    });

    socket.on("submission:failed", (payload: any) => {
      onExecutionUpdated?.(payload);
    });

    socket.on("interview:error", (payload: any) => {
      setSocketError(payload.message || "An interview error occurred");
    });

    return () => {
      socket.emit("interview:leave", { interviewId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [interviewId, token]);

  const switchActiveQuestion = useCallback(
    (questionId: string) => {
      if (!socketRef.current) return;
      socketRef.current.emit(
        "interview:set_active_question",
        { interviewId, questionId },
        (res: any) => {
          if (res?.success) {
            setActiveQuestionId(questionId);
          }
        },
      );
    },
    [interviewId],
  );

  return {
    socket: socketRef.current,
    isConnected,
    isReconnecting,
    participants,
    activeQuestionId,
    setActiveQuestionId,
    switchActiveQuestion,
    socketError,
  };
}
