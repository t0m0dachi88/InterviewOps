import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getInterviewRoomApi,
  createSubmissionApi,
  listSubmissionsApi,
  getSubmissionStatusApi,
  getAccessToken,
  type InterviewRoomData,
  type SubmissionDto,
  type ExecutionResultDto,
} from "../../../lib/api-client";
import { useInterviewSocket } from "../hooks/useInterviewSocket";
import { useCollaborativeEditor } from "../../code-editor/hooks/useCollaborativeEditor";
import { InterviewHeader } from "../components/InterviewHeader";
import { QuestionPanel } from "../components/QuestionPanel";
import { CollaborativeEditor } from "../../code-editor/components/CollaborativeEditor";
import { SubmissionPanel } from "../../submissions/components/SubmissionPanel";
import { VideoRoom } from "../../video/components/VideoRoom";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";

export const InterviewRoomPage: React.FC = () => {
  const { interviewId } = useParams<{ interviewId: string }>();
  const navigate = useNavigate();

  const [roomData, setRoomData] = useState<InterviewRoomData | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionFeedback, setSubmissionFeedback] = useState<string | null>(null);

  // Execution state (Phase 4)
  const [currentExecution, setCurrentExecution] = useState<ExecutionResultDto | null>(null);
  const [executionStatus, setExecutionStatus] = useState<string>("idle");
  const [executionType, setExecutionType] = useState<"run" | "submit">("run");
  const activePollTimerRef = React.useRef<any>(null);

  // Determine effective access token (user token for team members, or stored candidate room token)
  const userToken = getAccessToken();
  const candidateRoomToken = interviewId
    ? sessionStorage.getItem(`interview_token_${interviewId}`) ||
      localStorage.getItem(`interview_token_${interviewId}`)
    : null;

  const effectiveToken = userToken || candidateRoomToken || "";

  // Real-time WebSocket connection
  const {
    socket,
    isConnected,
    isReconnecting,
    participants,
    activeQuestionId,
    setActiveQuestionId,
    switchActiveQuestion,
    socketError,
  } = useInterviewSocket({
    interviewId: interviewId || "",
    token: effectiveToken,
    onActiveQuestionChanged: (newQuestionId) => {
      setActiveQuestionId(newQuestionId);
    },
    onSubmissionReceived: (newSubmission) => {
      setSubmissions((prev) => [newSubmission, ...prev.filter((s) => s.id !== newSubmission.id)]);
    },
    onExecutionUpdated: (payload) => {
      if (activePollTimerRef.current) {
        clearInterval(activePollTimerRef.current);
        activePollTimerRef.current = null;
      }
      setIsRunning(false);
      setIsSubmitting(false);
      setExecutionStatus(payload.status);
      if (payload.executionResult) {
        setCurrentExecution(payload.executionResult);
      }
      // Update submission in history list if present
      if (payload.submissionId) {
        setSubmissions((prev) =>
          prev.map((sub) =>
            sub.id === payload.submissionId
              ? {
                  ...sub,
                  status: payload.status,
                  executionResult: payload.executionResult || sub.executionResult,
                }
              : sub,
          ),
        );
      }
    },
  });

  // Load initial room data
  const loadRoom = useCallback(async () => {
    if (!interviewId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getInterviewRoomApi(interviewId);
      setRoomData(data);
      if (data.activeQuestionId) {
        setActiveQuestionId(data.activeQuestionId);
      }
    } catch (err: any) {
      setError(err.message || "Failed to enter interview room");
    } finally {
      setIsLoading(false);
    }
  }, [interviewId, setActiveQuestionId]);

  useEffect(() => {
    loadRoom();
  }, [loadRoom]);

  // Load submissions for active question
  const loadSubmissions = useCallback(async () => {
    if (!interviewId || !activeQuestionId) return;
    try {
      const result = await listSubmissionsApi(interviewId, activeQuestionId);
      setSubmissions(result.submissions);
    } catch {
      // Non-blocking error for submissions
    }
  }, [interviewId, activeQuestionId]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  // Active question snapshot
  const activeQuestion =
    roomData?.questions.find((q) => q.questionId === activeQuestionId) ||
    roomData?.questions[0];

  const currentStarterCode =
    activeQuestion?.starterCodeByLanguage?.javascript ||
    activeQuestion?.starterCodeByLanguage?.python ||
    activeQuestion?.starterCodeByLanguage?.cpp ||
    "";

  // Collaborative Monaco Editor binding
  const {
    handleEditorMount,
    language,
    setLanguage,
    isSynced,
    resetCode,
    getSourceCode,
  } = useCollaborativeEditor({
    socket,
    interviewId: interviewId || "",
    questionId: activeQuestionId,
    starterCode: currentStarterCode,
    defaultLanguage: "javascript",
    readOnly: !roomData?.permissions.canEdit,
  });

  // Polling fallback for execution status
  const startStatusPolling = (submissionId: string) => {
    if (activePollTimerRef.current) {
      clearInterval(activePollTimerRef.current);
    }

    let attempts = 0;
    activePollTimerRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 20) {
        clearInterval(activePollTimerRef.current);
        activePollTimerRef.current = null;
        setIsRunning(false);
        setIsSubmitting(false);
        return;
      }

      try {
        const res = await getSubmissionStatusApi(submissionId);
        if (res.status === "completed" || res.status === "failed") {
          clearInterval(activePollTimerRef.current);
          activePollTimerRef.current = null;
          setIsRunning(false);
          setIsSubmitting(false);
          setExecutionStatus(res.status);
          if (res.executionResult) {
            setCurrentExecution(res.executionResult);
          }
          setSubmissions((prev) =>
            prev.map((sub) =>
              sub.id === submissionId
                ? {
                    ...sub,
                    status: res.status as any,
                    executionResult: res.executionResult,
                  }
                : sub,
            ),
          );
        }
      } catch {
        // Continue polling
      }
    }, 1500);
  };

  // Save Code Action (Draft)
  const handleSave = async () => {
    if (!interviewId || !activeQuestionId) return;
    setIsSaving(true);
    try {
      const sourceCode = getSourceCode();
      const res = await createSubmissionApi(interviewId, activeQuestionId, {
        sourceCode,
        language,
        status: "saved",
      });
      setSubmissionFeedback(res.message);
      setSubmissions((prev) => [res.submission, ...prev.filter((s) => s.id !== res.submission.id)]);
    } catch (err: any) {
      setSubmissionFeedback(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Run Code Action (Public test cases)
  const handleRun = async () => {
    if (!interviewId || !activeQuestionId) return;
    setIsRunning(true);
    setExecutionType("run");
    setExecutionStatus("queued");
    setCurrentExecution(null);
    try {
      const sourceCode = getSourceCode();
      const res = await createSubmissionApi(interviewId, activeQuestionId, {
        sourceCode,
        language,
        submissionType: "run",
      });
      setSubmissionFeedback(res.message);
      setSubmissions((prev) => [res.submission, ...prev.filter((s) => s.id !== res.submission.id)]);
      startStatusPolling(res.submission.id);
    } catch (err: any) {
      setIsRunning(false);
      setExecutionStatus("failed");
      setSubmissionFeedback(`Run failed: ${err.message}`);
    }
  };

  // Submit Code Action (Public + hidden test cases)
  const handleSubmit = async () => {
    if (!interviewId || !activeQuestionId) return;
    setIsSubmitting(true);
    setExecutionType("submit");
    setExecutionStatus("queued");
    setCurrentExecution(null);
    try {
      const sourceCode = getSourceCode();
      const res = await createSubmissionApi(interviewId, activeQuestionId, {
        sourceCode,
        language,
        submissionType: "submit",
      });
      setSubmissionFeedback(res.message);
      setSubmissions((prev) => [res.submission, ...prev.filter((s) => s.id !== res.submission.id)]);
      startStatusPolling(res.submission.id);
    } catch (err: any) {
      setIsSubmitting(false);
      setExecutionStatus("failed");
      setSubmissionFeedback(`Submission failed: ${err.message}`);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-200">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <h2 className="text-base font-semibold">Connecting to Interview Room...</h2>
        <p className="text-xs text-slate-400 mt-1">Verifying room credentials and presence</p>
      </div>
    );
  }

  // Error / Unauthorized state
  if (error || !roomData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-slate-200 p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-6 shadow-xl text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-950/80 border border-red-800 flex items-center justify-center mx-auto text-red-400">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Interview Room Access Denied</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            {error || "You are not authorized to access this live interview workspace."}
          </p>
          <div className="pt-2 flex justify-center space-x-3">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition"
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={loadRoom}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition shadow-sm"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  const effectiveParticipants =
    participants.length > 0 ? participants : roomData.participants;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <InterviewHeader
        title={roomData.interview.title}
        organizationName={roomData.interview.organizationName}
        status={roomData.interview.status}
        durationMinutes={roomData.interview.durationMinutes}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        participantCount={effectiveParticipants.length}
        isInterviewer={roomData.permissions.isInterviewer}
        participantName={roomData.participant.name}
      />

      {/* Socket or Room Error Banner */}
      {socketError && (
        <div className="px-4 py-2 bg-amber-950/80 border-b border-amber-800 text-amber-200 text-xs flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Real-time notice: {socketError}</span>
        </div>
      )}

      {/* Main Workspace Layout */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0 overflow-hidden">
        {/* Left: Question Panel (4 cols) */}
        <section className="lg:col-span-4 h-full min-h-0 overflow-hidden">
          <QuestionPanel
            questions={roomData.questions}
            activeQuestionId={activeQuestionId}
            onSelectQuestion={(qId) => {
              if (roomData.permissions.canNavigateQuestions) {
                switchActiveQuestion(qId);
              }
            }}
            canNavigate={roomData.permissions.canNavigateQuestions}
          />
        </section>

        {/* Center: Collaborative Monaco Code Editor (5 cols) */}
        <section className="lg:col-span-5 h-full min-h-0 overflow-hidden flex flex-col">
          <CollaborativeEditor
            language={language}
            onLanguageChange={setLanguage}
            onMount={handleEditorMount}
            isSynced={isSynced}
            canReset={roomData.permissions.isInterviewer}
            onReset={() => resetCode(currentStarterCode)}
            readOnly={!roomData.permissions.canEdit}
          />
        </section>

        {/* Right: Video Call & Submissions Panel (3 cols) */}
        <section className="lg:col-span-3 h-full min-h-0 flex flex-col space-y-3 overflow-hidden">
          {/* Top Video Tile */}
          <div className="h-56 shrink-0">
            <VideoRoom
              interviewId={roomData.interview.id}
              participantName={roomData.participant.name}
              isCandidate={roomData.participant.isCandidate}
            />
          </div>

          {/* Bottom Submissions Panel */}
          <div className="flex-1 min-h-0">
            <SubmissionPanel
              submissions={submissions}
              onSave={handleSave}
              onRun={handleRun}
              onSubmit={handleSubmit}
              isSaving={isSaving}
              isRunning={isRunning}
              isSubmitting={isSubmitting}
              currentExecution={currentExecution}
              executionStatus={executionStatus}
              executionType={executionType}
              lastMessage={submissionFeedback}
            />
          </div>
        </section>
      </main>
    </div>
  );
};
