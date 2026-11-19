import React, { useState } from "react";
import type { ExecutionResultDto, TestCaseResultDto } from "../../../lib/api-client";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Cpu,
  Layers,
  Terminal,
  Loader2,
  Lock,
} from "lucide-react";

interface TestResultPanelProps {
  executionResult: ExecutionResultDto | null;
  status: string;
  submissionType?: "run" | "submit";
  isLoading?: boolean;
}

export const TestResultPanel: React.FC<TestResultPanelProps> = ({
  executionResult,
  status,
  submissionType = "run",
  isLoading = false,
}) => {
  const [selectedTestIndex, setSelectedTestIndex] = useState<number>(1);

  if (isLoading || status === "queued" || status === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
        <h3 className="text-sm font-semibold text-slate-200">
          {status === "queued" ? "Queued for Execution..." : "Executing Tests on Judge0..."}
        </h3>
        <p className="text-xs text-slate-400 mt-1 max-w-xs">
          Your code is being compiled and evaluated in an isolated execution sandbox.
        </p>
      </div>
    );
  }

  if (!executionResult) {
    return (
      <div className="text-center py-10 px-4 text-slate-500 text-xs">
        Click <strong className="text-slate-300">Run Code</strong> to test your solution against public examples,
        or <strong className="text-slate-300">Submit Solution</strong> to evaluate all test cases.
      </div>
    );
  }

  const testResults: TestCaseResultDto[] = executionResult.testResults || [];
  const activeTest =
    testResults.find((t) => t.testIndex === selectedTestIndex) || testResults[0];

  const getStatusBadge = () => {
    switch (executionResult.status) {
      case "passed":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Accepted ({executionResult.passedCount}/{executionResult.totalCount})</span>
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-950/80 text-red-300 border border-red-800">
            <XCircle className="w-3.5 h-3.5" />
            <span>Wrong Answer ({executionResult.passedCount}/{executionResult.totalCount})</span>
          </span>
        );
      case "compile_error":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Compilation Error</span>
          </span>
        );
      case "runtime_error":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Runtime Error</span>
          </span>
        );
      case "time_limit_exceeded":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-950/80 text-orange-300 border border-orange-800">
            <Clock className="w-3.5 h-3.5" />
            <span>Time Limit Exceeded</span>
          </span>
        );
      case "memory_limit_exceeded":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-950/80 text-purple-300 border border-purple-800">
            <Cpu className="w-3.5 h-3.5" />
            <span>Memory Limit Exceeded</span>
          </span>
        );
      case "system_error":
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            <span>Infrastructure / System Error</span>
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs text-slate-200">
      {/* Overview Metrics Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-950/80 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          {getStatusBadge()}
          <span className="text-[11px] text-slate-400 font-medium">
            {submissionType === "run" ? "Public Test Run" : "Full Evaluation"}
          </span>
        </div>

        <div className="flex items-center space-x-3 text-slate-400 text-[11px]">
          <span className="inline-flex items-center space-x-1">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>{executionResult.durationMs}ms</span>
          </span>
          <span className="inline-flex items-center space-x-1">
            <Cpu className="w-3 h-3 text-slate-500" />
            <span>{Math.round(executionResult.peakMemoryKb / 1024)}MB</span>
          </span>
          <span className="inline-flex items-center space-x-1">
            <Layers className="w-3 h-3 text-slate-500" />
            <span>{executionResult.totalCount} tests</span>
          </span>
        </div>
      </div>

      {/* Fatal Error Output (Compilation Error / System Error) */}
      {(executionResult.compileOutput || executionResult.errorMessage) && (
        <div className="m-3 p-3 bg-red-950/30 border border-red-900/60 rounded-md">
          <div className="flex items-center space-x-1.5 text-red-400 font-semibold mb-1.5">
            <Terminal className="w-3.5 h-3.5" />
            <span>
              {executionResult.compileOutput ? "Compiler Output" : "Execution Error"}
            </span>
          </div>
          <pre className="font-mono text-[11px] text-red-200 whitespace-pre-wrap leading-relaxed max-h-36 overflow-auto">
            {executionResult.compileOutput || executionResult.errorMessage}
          </pre>
        </div>
      )}

      {/* Test Case Tabs & Details */}
      {testResults.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Test Case Selector Tabs */}
          <div className="flex items-center space-x-1 px-3 pt-2 bg-slate-900 border-b border-slate-800 overflow-x-auto">
            {testResults.map((tc) => {
              const isSelected = activeTest?.testIndex === tc.testIndex;
              const isHidden = tc.visibility === "hidden";
              return (
                <button
                  key={tc.testIndex}
                  type="button"
                  onClick={() => setSelectedTestIndex(tc.testIndex)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-t text-xs font-medium border-t border-x transition shrink-0 ${
                    isSelected
                      ? "bg-slate-950 text-white border-slate-700 -mb-px"
                      : "bg-slate-900/60 text-slate-400 border-transparent hover:text-slate-200"
                  }`}
                >
                  {tc.passed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                  <span>
                    {isHidden ? `Hidden #${tc.testIndex}` : `Case #${tc.testIndex}`}
                  </span>
                  {isHidden && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                </button>
              );
            })}
          </div>

          {/* Active Test Case Detail Viewer */}
          {activeTest && (
            <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-slate-950">
              {activeTest.visibility === "hidden" ? (
                /* Hidden Test Case Mask */
                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded text-center space-y-2">
                  <div className="inline-flex items-center justify-center p-2 rounded-full bg-slate-800 text-slate-400">
                    <Lock className="w-5 h-5" />
                  </div>
                  <h4 className="text-xs font-semibold text-slate-200">
                    Hidden Assessment Test Case
                  </h4>
                  <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                    Input, expected output, and harness details are hidden to maintain assessment integrity.
                  </p>
                  <div className="pt-1">
                    <span
                      className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-semibold ${
                        activeTest.passed
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : "bg-red-950 text-red-300 border border-red-800"
                      }`}
                    >
                      {activeTest.passed ? "Passed" : "Failed"}
                    </span>
                  </div>
                </div>
              ) : (
                /* Public Test Case Full Details */
                <>
                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Input
                    </span>
                    <pre className="p-2.5 bg-slate-900 border border-slate-800 rounded font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-pre-wrap">
                      {activeTest.input || "(empty)"}
                    </pre>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Expected Output
                    </span>
                    <pre className="p-2.5 bg-slate-900 border border-slate-800 rounded font-mono text-[11px] text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                      {activeTest.expectedOutput || "(empty)"}
                    </pre>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-400 block mb-1">
                      Actual Output
                    </span>
                    <pre
                      className={`p-2.5 bg-slate-900 border rounded font-mono text-[11px] overflow-x-auto whitespace-pre-wrap ${
                        activeTest.passed
                          ? "border-emerald-800/80 text-emerald-300"
                          : "border-red-800/80 text-red-300"
                      }`}
                    >
                      {activeTest.actualOutput || (activeTest.passed ? "(empty)" : "(no output)")}
                    </pre>
                  </div>

                  {activeTest.stderr && (
                    <div>
                      <span className="text-[11px] font-semibold text-rose-400 block mb-1">
                        Standard Error
                      </span>
                      <pre className="p-2.5 bg-rose-950/20 border border-rose-900/50 rounded font-mono text-[11px] text-rose-300 overflow-x-auto whitespace-pre-wrap">
                        {activeTest.stderr}
                      </pre>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
