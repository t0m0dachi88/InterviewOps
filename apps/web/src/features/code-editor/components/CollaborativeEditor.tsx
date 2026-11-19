import React, { useState } from "react";
import Editor from "@monaco-editor/react";
import { RotateCcw, CheckCircle2, RefreshCw } from "lucide-react";

interface CollaborativeEditorProps {
  language: string;
  onLanguageChange: (lang: string) => void;
  onMount: (editor: any) => void;
  isSynced: boolean;
  canReset: boolean;
  onReset: () => void;
  readOnly?: boolean;
}

const SUPPORTED_LANGUAGES = [
  { id: "javascript", label: "JavaScript" },
  { id: "python", label: "Python" },
  { id: "cpp", label: "C++" },
];

export const CollaborativeEditor: React.FC<CollaborativeEditorProps> = ({
  language,
  onLanguageChange,
  onMount,
  isSynced,
  canReset,
  onReset,
  readOnly = false,
}) => {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] border border-slate-800 rounded-lg overflow-hidden shadow-sm">
      {/* Editor Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#252526] border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-3">
          <label className="text-slate-400 font-medium">Language:</label>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="bg-[#1e1e1e] text-slate-200 border border-slate-700 rounded px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>

          {readOnly && (
            <span className="px-2 py-0.5 rounded text-[10px] bg-amber-900/60 text-amber-200 border border-amber-700/50">
              Read-Only
            </span>
          )}
        </div>

        <div className="flex items-center space-x-3">
          {/* Sync indicator */}
          <div className="flex items-center space-x-1.5 text-slate-300">
            {isSynced ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] text-emerald-400">Synced</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                <span className="text-[11px] text-amber-400">Syncing...</span>
              </>
            )}
          </div>

          {/* Reset Code Button */}
          {canReset && (
            <button
              type="button"
              onClick={() => setShowResetConfirm(true)}
              className="inline-flex items-center space-x-1 px-2.5 py-1 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition text-xs"
              title="Reset code to question template"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 w-full relative">
        <Editor
          height="100%"
          language={language === "cpp" ? "cpp" : language}
          theme="vs-dark"
          options={{
            fontSize: 14,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: "on",
            readOnly,
          }}
          onMount={onMount}
        />
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-5 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-white mb-2">Reset Code Template?</h3>
            <p className="text-sm text-slate-300 mb-5">
              This will overwrite the current editor contents with the default starter code.
              Collaborators will see this reset immediately.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-300 hover:text-white border border-slate-700 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setShowResetConfirm(false);
                }}
                className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white font-medium rounded"
              >
                Reset Code
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
