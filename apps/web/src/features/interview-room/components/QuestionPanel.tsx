import React, { useState } from "react";
import type { QuestionSnapshotDto } from "../../../lib/api-client";
import { Check, Copy, Clock, Layers } from "lucide-react";

interface QuestionPanelProps {
  questions: QuestionSnapshotDto[];
  activeQuestionId: string | null;
  onSelectQuestion: (questionId: string) => void;
  canNavigate: boolean;
}

export const QuestionPanel: React.FC<QuestionPanelProps> = ({
  questions,
  activeQuestionId,
  onSelectQuestion,
  canNavigate,
}) => {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const activeQuestion =
    questions.find((q) => q.questionId === activeQuestionId) || questions[0];

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!activeQuestion) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-slate-400 bg-slate-900 border border-slate-800 rounded-lg">
        No assessment questions configured for this interview.
      </div>
    );
  }

  const difficultyBadgeColor = (diff?: string) => {
    switch (diff?.toLowerCase()) {
      case "easy":
        return "bg-emerald-950/60 text-emerald-300 border-emerald-800/60";
      case "hard":
        return "bg-rose-950/60 text-rose-300 border-rose-800/60";
      default:
        return "bg-amber-950/60 text-amber-300 border-amber-800/60";
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden text-slate-200">
      {/* Question Selector Tabs */}
      {questions.length > 1 && (
        <div className="flex items-center space-x-1 p-2 bg-slate-950 border-b border-slate-800 overflow-x-auto text-xs">
          {questions.map((q, idx) => {
            const isActive = q.questionId === activeQuestion.questionId;
            return (
              <button
                key={q.questionId}
                type="button"
                onClick={() => {
                  if (canNavigate) {
                    onSelectQuestion(q.questionId);
                  }
                }}
                disabled={!canNavigate && !isActive}
                className={`px-3 py-1.5 rounded font-medium flex items-center space-x-1.5 transition whitespace-nowrap ${
                  isActive
                    ? "bg-blue-600 text-white shadow-sm"
                    : canNavigate
                      ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                      : "text-slate-500 cursor-not-allowed opacity-60"
                }`}
                title={!canNavigate && !isActive ? "Only interviewers can switch the active question" : undefined}
              >
                <span>Q{idx + 1}</span>
                <span className="max-w-[120px] truncate">{q.title}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Question Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-white tracking-tight">
              {activeQuestion.title}
            </h2>
            <div className="flex items-center space-x-2">
              <span className={`px-2 py-0.5 text-xs font-medium rounded border ${difficultyBadgeColor("medium")}`}>
                Version {activeQuestion.version}
              </span>
              {activeQuestion.timeAllocationMinutes && (
                <span className="flex items-center space-x-1 text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>{activeQuestion.timeAllocationMinutes}m</span>
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <Layers className="w-3.5 h-3.5 text-blue-400" />
            <span>Immutable Assessment Snapshot</span>
          </div>
        </div>

        {/* Problem Statement */}
        <div className="prose prose-invert max-w-none text-slate-300 whitespace-pre-wrap leading-relaxed text-sm">
          {activeQuestion.statement}
        </div>

        {/* Examples */}
        {activeQuestion.examples && activeQuestion.examples.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Examples
            </h3>
            {activeQuestion.examples.map((ex, idx) => (
              <div
                key={idx}
                className="bg-slate-950 border border-slate-800 rounded p-3 text-xs space-y-1.5 font-mono"
              >
                <div className="flex justify-between items-center text-slate-400 font-sans text-[11px] mb-1">
                  <span>Example {idx + 1}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(`Input: ${ex.input}\nOutput: ${ex.output}`, idx)}
                    className="hover:text-white flex items-center space-x-1"
                  >
                    {copiedIndex === idx ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Input: </span>
                  <span className="text-slate-200">{ex.input}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-sans">Output: </span>
                  <span className="text-emerald-400">{ex.output}</span>
                </div>
                {ex.explanation && (
                  <div className="text-slate-400 font-sans text-[11px] pt-1 border-t border-slate-900">
                    <span className="text-slate-500">Explanation: </span>
                    {ex.explanation}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Constraints */}
        {activeQuestion.constraints && activeQuestion.constraints.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Constraints
            </h3>
            <ul className="list-disc list-inside space-y-1 text-xs text-slate-300 font-mono">
              {activeQuestion.constraints.map((c, idx) => (
                <li key={idx}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
