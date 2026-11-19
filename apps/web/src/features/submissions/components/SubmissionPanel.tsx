import React, { useState } from "react";
import type { SubmissionDto, ExecutionResultDto } from "../../../lib/api-client";
import {
  Save,
  Send,
  Play,
  History,
  CheckCircle,
  Eye,
  X,
  Terminal,
  Loader2,
} from "lucide-react";
import { TestResultPanel } from "./TestResultPanel";

interface SubmissionPanelProps {
  submissions: SubmissionDto[];
  onSave: () => Promise<void>;
  onRun?: () => Promise<void>;
  onSubmit: () => Promise<void>;
  isSaving: boolean;
  isRunning?: boolean;
  isSubmitting: boolean;
  currentExecution?: ExecutionResultDto | null;
  executionStatus?: string;
  executionType?: "run" | "submit";
  lastMessage?: string | null;
}

export const SubmissionPanel: React.FC<SubmissionPanelProps> = ({
  submissions,
  onSave,
  onRun,
  onSubmit,
  isSaving,
  isRunning = false,
  isSubmitting,
  currentExecution = null,
  executionStatus = "idle",
  executionType = "run",
  lastMessage = null,
}) => {
  const [activeTab, setActiveTab] = useState<"results" | "history">("results");
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionDto | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const isExecuting = isRunning || isSubmitting;

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden text-slate-200">
      {/* Top Action & Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-950 border-b border-slate-800">
        {/* Tab Switcher */}
        <div className="flex items-center space-x-1 bg-slate-900 p-0.5 rounded border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab("results")}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition ${
              activeTab === "results"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Test Results</span>
            {currentExecution && (
              <span
                className={`w-2 h-2 rounded-full ${
                  currentExecution.status === "passed"
                    ? "bg-emerald-400"
                    : "bg-red-400"
                }`}
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition ${
              activeTab === "history"
                ? "bg-slate-800 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>History ({submissions.length})</span>
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || isExecuting}
            className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded transition disabled:opacity-50"
            title="Save code snapshot without running tests"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isSaving ? "Saving..." : "Save Draft"}</span>
          </button>

          {onRun && (
            <button
              type="button"
              onClick={async () => {
                setActiveTab("results");
                await onRun();
              }}
              disabled={isSaving || isExecuting}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-slate-100 bg-indigo-600 hover:bg-indigo-500 rounded transition shadow-sm disabled:opacity-50"
              title="Execute code against public test cases"
            >
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{isRunning ? "Running..." : "Run Code"}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowSubmitConfirm(true)}
            disabled={isSaving || isExecuting}
            className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded transition shadow-sm disabled:opacity-50"
            title="Evaluate against public and hidden test cases"
          >
            {isSubmitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>{isSubmitting ? "Submitting..." : "Submit Solution"}</span>
          </button>
        </div>
      </div>

      {/* Informative Status Notice */}
      {lastMessage && (
        <div className="px-3 py-1.5 bg-blue-950/30 border-b border-blue-900/40 text-[11px] text-blue-300 truncate">
          {lastMessage}
        </div>
      )}

      {/* Main Tab Area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "results" ? (
          <TestResultPanel
            executionResult={currentExecution}
            status={executionStatus}
            submissionType={executionType}
            isLoading={isExecuting}
          />
        ) : (
          <div className="h-full overflow-y-auto p-3 space-y-2 text-xs">
            {submissions.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                No submissions recorded yet for this question. Run code or submit when ready.
              </div>
            ) : (
              submissions.map((sub) => {
                const isRun = sub.submissionType === "run";
                const isDraft = sub.status === "saved";
                const res = sub.executionResult;

                return (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800/80 rounded hover:border-slate-700 transition"
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="font-mono text-slate-400 font-semibold text-[11px]">
                        #{sub.sequenceNumber}
                      </span>

                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${
                          isDraft
                            ? "bg-slate-800 text-slate-300 border-slate-700"
                            : isRun
                              ? "bg-indigo-950/70 text-indigo-300 border-indigo-800/60"
                              : "bg-emerald-950/70 text-emerald-300 border-emerald-800/60"
                        }`}
                      >
                        {isDraft ? "Draft" : isRun ? "Run" : "Submit"}
                      </span>

                      {res && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            res.status === "passed"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {res.status === "passed"
                            ? `Passed (${res.passedCount}/${res.totalCount})`
                            : res.status.replace(/_/g, " ")}
                        </span>
                      )}

                      <span className="text-slate-400 font-mono text-[11px]">
                        {sub.language}
                      </span>
                      <span className="text-slate-500 text-[10px] hidden sm:inline">
                        {sub.createdAt
                          ? new Date(sub.createdAt).toLocaleTimeString()
                          : ""}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedSubmission(sub)}
                      className="flex items-center space-x-1 px-2 py-1 text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 rounded text-[11px] border border-slate-700/60 transition"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Details</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Submit Confirmation Dialog */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl text-slate-200">
            <h3 className="text-base font-semibold text-white mb-2 flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-blue-400" />
              <span>Submit Solution for Evaluation?</span>
            </h3>
            <p className="text-xs text-slate-300 mb-5 leading-relaxed">
              This will execute your code against both public examples and hidden test cases,
              freezing an immutable solution snapshot in the interview record.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowSubmitConfirm(false);
                  setActiveTab("results");
                  await onSubmit();
                }}
                className="px-3.5 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium rounded transition shadow-sm"
              >
                Confirm & Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Code Snapshot & Execution Result Modal */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-white text-sm">
                  Submission #{selectedSubmission.sequenceNumber} Details
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  {selectedSubmission.language}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 font-semibold uppercase">
                  {selectedSubmission.submissionType || selectedSubmission.status}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto space-y-3 bg-[#1e1e1e]">
              {selectedSubmission.executionResult && (
                <div className="p-3 bg-slate-900 border border-slate-800 rounded mb-2 text-xs">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-slate-200">Execution Outcome:</span>
                    <span
                      className={`font-semibold px-2 py-0.5 rounded ${
                        selectedSubmission.executionResult.status === "passed"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : "bg-red-950 text-red-300 border border-red-800"
                      }`}
                    >
                      {selectedSubmission.executionResult.status.toUpperCase()} (
                      {selectedSubmission.executionResult.passedCount}/
                      {selectedSubmission.executionResult.totalCount} passed)
                    </span>
                  </div>
                  {selectedSubmission.executionResult.compileOutput && (
                    <pre className="p-2 bg-red-950/30 text-red-300 text-[11px] rounded whitespace-pre-wrap">
                      {selectedSubmission.executionResult.compileOutput}
                    </pre>
                  )}
                </div>
              )}

              <span className="text-xs text-slate-400 block font-semibold">
                Source Code Snapshot:
              </span>
              <pre className="font-mono text-xs text-slate-200 whitespace-pre leading-relaxed p-3 bg-slate-950 border border-slate-800 rounded overflow-x-auto">
                {selectedSubmission.sourceCode}
              </pre>
            </div>

            <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs text-slate-400">
              <span>
                Submitted by {selectedSubmission.submittedBy.name} (
                {selectedSubmission.submittedBy.role})
              </span>
              <span>
                {selectedSubmission.createdAt
                  ? new Date(selectedSubmission.createdAt).toLocaleString()
                  : ""}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
