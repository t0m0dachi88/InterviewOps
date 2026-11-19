import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getCandidateInvitationApi,
  acceptCandidateInvitationApi,
  type CandidateInvitationDto,
} from "../lib/api-client";
import { Clock, Calendar, AlertCircle, ArrowRight, RefreshCw, CheckCircle2 } from "lucide-react";

export const CandidateJoinPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invitationData, setInvitationData] = useState<CandidateInvitationDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided.");
      setIsLoading(false);
      return;
    }

    async function loadInvitation() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getCandidateInvitationApi(token!);
        setInvitationData(data);
      } catch (err: any) {
        setError(err.message || "Failed to load invitation.");
      } finally {
        setIsLoading(false);
      }
    }

    loadInvitation();
  }, [token]);

  const handleJoin = async () => {
    if (!token) return;
    setIsJoining(true);
    setError(null);
    try {
      const result = await acceptCandidateInvitationApi(token);
      sessionStorage.setItem(`interview_token_${result.interviewId}`, result.roomToken);
      localStorage.setItem(`interview_token_${result.interviewId}`, result.roomToken);
      navigate(`/interviews/${result.interviewId}`);
    } catch (err: any) {
      setError(err.message || "Failed to join interview room.");
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-200">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-sm">Verifying interview invitation...</p>
      </div>
    );
  }

  if (error || !invitationData) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-6 text-center space-y-4 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-red-950 border border-red-800 flex items-center justify-center mx-auto text-red-400">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white">Invalid or Expired Invitation</h2>
          <p className="text-sm text-slate-300 leading-relaxed">
            {error || "This interview invitation is invalid or has expired."}
          </p>
        </div>
      </div>
    );
  }

  const { invitation, interview, organization } = invitationData;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-200">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-blue-900/60 to-indigo-900/60 border-b border-slate-800 p-6 text-center">
          <div className="w-12 h-12 rounded bg-blue-600 flex items-center justify-center mx-auto text-white font-bold text-lg mb-3 shadow">
            HP
          </div>
          <span className="text-xs uppercase tracking-wider font-semibold text-blue-300">
            {organization.name}
          </span>
          <h1 className="text-xl font-bold text-white mt-1">{interview.title}</h1>
        </div>

        {/* Content Details */}
        <div className="p-6 space-y-5">
          <div className="bg-slate-950 border border-slate-800/80 rounded p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
              <span className="text-slate-400">Candidate:</span>
              <span className="font-semibold text-slate-200">
                {invitation.candidateName} ({invitation.candidateEmail})
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
              <span className="text-slate-400">Interview Type:</span>
              <span className="capitalize font-semibold text-slate-200">
                {interview.interviewType}
              </span>
            </div>

            <div className="flex items-center justify-between pb-2 border-b border-slate-800/60">
              <span className="text-slate-400 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                <span>Duration:</span>
              </span>
              <span className="font-semibold text-slate-200">
                {interview.durationMinutes} minutes
              </span>
            </div>

            {interview.scheduledStartAt && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Calendar className="w-3.5 h-3.5 text-blue-400" />
                  <span>Scheduled Time:</span>
                </span>
                <span className="font-semibold text-slate-200">
                  {new Date(interview.scheduledStartAt).toLocaleString([], {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 text-xs text-slate-400">
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Real-time collaborative code editor with syntax highlighting</span>
            </div>
            <div className="flex items-start space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Voice and video communication with your interviewer</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded bg-red-950/80 border border-red-800 text-red-200 text-xs">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleJoin}
            disabled={isJoining}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded shadow-sm flex items-center justify-center space-x-2 transition disabled:opacity-50"
          >
            <span>{isJoining ? "Entering Workspace..." : "Enter Live Interview"}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
