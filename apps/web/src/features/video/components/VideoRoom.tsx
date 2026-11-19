import React, { useState, useEffect, useRef } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  AlertCircle,
  Users,
} from "lucide-react";
import { getLiveKitTokenApi, type LiveKitTokenData } from "../../../lib/api-client";

interface VideoRoomProps {
  interviewId: string;
  participantName: string;
  isCandidate: boolean;
}

export const VideoRoom: React.FC<VideoRoomProps> = ({
  interviewId,
  participantName,
  isCandidate,
}) => {
  const [tokenData, setTokenData] = useState<LiveKitTokenData | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Fetch token on mount or when interviewId changes
  useEffect(() => {
    let isMounted = true;
    async function fetchToken() {
      try {
        const data = await getLiveKitTokenApi(interviewId);
        if (isMounted) {
          setTokenData(data);
        }
      } catch (err: any) {
        if (isMounted) {
          // eslint-disable-next-line no-console
          console.warn("LiveKit token fetch notice:", err.message);
        }
      }
    }
    fetchToken();
    return () => {
      isMounted = false;
    };
  }, [interviewId]);

  // Handle local user media (camera and microphone)
  useEffect(() => {
    let localStream: MediaStream | null = null;

    async function setupLocalMedia() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setMediaError("Media devices API is not supported in this browser.");
          return;
        }

        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        streamRef.current = localStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }
        setIsJoined(true);
        setMediaError(null);
      } catch (err: any) {
        // Media unavailable or permission denied
        setMediaError(
          "Camera/microphone permission not granted. You can continue the interview without video.",
        );
        setIsVideoEnabled(false);
        setIsAudioEnabled(false);
      }
    }

    setupLocalMedia();

    return () => {
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = null;
    };
  }, []);

  const toggleAudio = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !isAudioEnabled;
      });
      setIsAudioEnabled(!isAudioEnabled);
    }
  };

  const toggleVideo = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !isVideoEnabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
    }
  };

  const handleLeaveCall = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    setIsJoined(false);
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-slate-800 rounded-lg overflow-hidden text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950 border-b border-slate-800 text-xs">
        <div className="flex items-center space-x-2">
          <Users className="w-3.5 h-3.5 text-blue-400" />
          <span className="font-semibold text-slate-300">Live Video</span>
        </div>
        {tokenData && !tokenData.isConfigured && (
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
            Preview Mode
          </span>
        )}
      </div>

      {/* Main Video Area */}
      <div className="flex-1 bg-black/80 flex flex-col items-center justify-center relative p-3 overflow-hidden">
        {mediaError && (
          <div className="absolute top-2 inset-x-2 z-10 p-2.5 bg-amber-950/80 border border-amber-800/80 rounded text-amber-200 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
            <span className="leading-tight">{mediaError}</span>
          </div>
        )}

        {/* Video Tile */}
        <div className="w-full h-full max-h-52 bg-slate-950 border border-slate-800 rounded-md overflow-hidden relative flex items-center justify-center">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isVideoEnabled ? "block" : "hidden"}`}
          />

          {!isVideoEnabled && (
            <div className="flex flex-col items-center justify-center space-y-2 text-slate-500">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold text-base">
                {participantName.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-xs">{participantName} (Camera Off)</span>
            </div>
          )}

          {/* Participant Label Overlay */}
          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/60 backdrop-blur-sm text-[11px] text-white flex items-center space-x-1.5">
            <span>{participantName} {isCandidate ? "(Candidate)" : "(Interviewer)"}</span>
            {!isAudioEnabled && <MicOff className="w-3 h-3 text-red-400" />}
          </div>
        </div>
      </div>

      {/* Media Controls Bar */}
      <div className="px-3 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-center space-x-3">
        <button
          type="button"
          onClick={toggleAudio}
          className={`p-2 rounded-full border transition ${
            isAudioEnabled
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
              : "bg-red-950 border-red-800 text-red-300 hover:bg-red-900"
          }`}
          title={isAudioEnabled ? "Mute Microphone" : "Unmute Microphone"}
        >
          {isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={toggleVideo}
          className={`p-2 rounded-full border transition ${
            isVideoEnabled
              ? "bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700"
              : "bg-red-950 border-red-800 text-red-300 hover:bg-red-900"
          }`}
          title={isVideoEnabled ? "Turn Off Camera" : "Turn On Camera"}
        >
          {isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
        </button>

        {isJoined && (
          <button
            type="button"
            onClick={handleLeaveCall}
            className="p-2 rounded-full bg-red-600 hover:bg-red-700 text-white transition shadow-sm"
            title="Leave Video Call"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
