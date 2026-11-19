import React from "react";
import { Users, Wifi, WifiOff, LogOut, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface InterviewHeaderProps {
  title: string;
  organizationName: string;
  status: string;
  durationMinutes: number;
  isConnected: boolean;
  isReconnecting: boolean;
  participantCount: number;
  isInterviewer: boolean;
  participantName: string;
}

export const InterviewHeader: React.FC<InterviewHeaderProps> = ({
  title,
  organizationName,
  status,
  durationMinutes,
  isConnected,
  isReconnecting,
  participantCount,
  isInterviewer,
  participantName,
}) => {
  const navigate = useNavigate();

  const handleExit = () => {
    if (window.confirm("Are you sure you want to exit the interview room?")) {
      navigate("/dashboard");
    }
  };

  const statusBadge = (s: string) => {
    switch (s.toLowerCase()) {
      case "live":
      case "in_progress":
        return (
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="capitalize">{s.replace("_", " ")}</span>
          </span>
        );
      case "completed":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-950/80 text-blue-300 border border-blue-800">
            Completed
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800 capitalize">
            {s}
          </span>
        );
    }
  };

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between text-slate-200 select-none">
      {/* Brand & Interview Title */}
      <div className="flex items-center space-x-3 truncate">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-xs tracking-wider">
            IO
          </div>
          <span className="font-semibold text-white text-sm hidden sm:inline">
            Interview Ops
          </span>
        </div>

        <span className="text-slate-600 hidden sm:inline">/</span>

        <div className="flex items-center space-x-2 truncate">
          <span className="text-xs text-slate-400 font-medium hidden md:inline">
            {organizationName}
          </span>
          <span className="text-slate-600 hidden md:inline">•</span>
          <h1 className="text-sm font-semibold text-slate-100 truncate max-w-[200px] sm:max-w-[320px]">
            {title}
          </h1>
          {durationMinutes > 0 && (
            <span className="text-xs text-slate-400 hidden lg:inline">
              ({durationMinutes} min)
            </span>
          )}
          {statusBadge(status)}
        </div>
      </div>

      {/* Meta & Connection Controls */}
      <div className="flex items-center space-x-3 text-xs">
        {/* Presence Counter */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-800/80 rounded border border-slate-700/60 text-slate-300">
          <Users className="w-3.5 h-3.5 text-blue-400" />
          <span>
            {participantCount} {participantCount === 1 ? "person" : "people"} online
          </span>
        </div>

        {/* Real-time Connection State */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700/60">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium hidden sm:inline">Connected</span>
            </>
          ) : isReconnecting ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="text-amber-400 font-medium hidden sm:inline">Reconnecting</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
              <span className="text-red-400 font-medium hidden sm:inline">Offline</span>
            </>
          )}
        </div>

        {/* Current Participant Profile */}
        <div className="flex items-center space-x-1.5 text-slate-300 font-medium pl-2 border-l border-slate-800">
          {isInterviewer && <Shield className="w-3.5 h-3.5 text-blue-400" />}
          <span className="truncate max-w-[120px]">{participantName}</span>
        </div>

        {/* Exit Button */}
        <button
          type="button"
          onClick={handleExit}
          className="flex items-center space-x-1 px-2.5 py-1 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 rounded transition"
          title="Exit Room"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Leave</span>
        </button>
      </div>
    </header>
  );
};
