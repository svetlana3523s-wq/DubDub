"use client";

import { useRef, useEffect, useState, useCallback } from "react";

interface Cue {
  roleIndex: number;
  startSec: number;
  durationSec: number;
}

interface VideoPlayerProps {
  src: string;
  startTime?: number;
  endTime?: number;
  muted?: boolean;
  showTimeRange?: boolean;  // Show time indicator
  label?: string;  // Optional label above video
  cues?: Cue[];  // Cues for mute ranges (for "with cuts" mode)
  showAudioModeSwitch?: boolean;  // Show original/with-cuts toggle
}

type AudioMode = "original" | "with-cuts";
type LoadState = "loading" | "ready" | "error";

export function VideoPlayer({ 
  src, 
  startTime = 0, 
  endTime, 
  muted = false,
  showTimeRange = true,
  label,
  cues = [],
  showAudioModeSwitch = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [audioMode, setAudioMode] = useState<AudioMode>("with-cuts");
  const [inCueRange, setInCueRange] = useState(false);

  // Check if current time is within any cue range
  const isInCueRange = useCallback((time: number): boolean => {
    return cues.some(cue => 
      time >= cue.startSec && time < cue.startSec + cue.durationSec
    );
  }, [cues]);

  // Load video only when src changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setLoadState("loading");

    const handleLoadedMetadata = () => {
      video.currentTime = startTime;
    };

    const handleCanPlay = () => {
      setLoadState("ready");
    };

    const handleError = () => {
      console.error("Video load error:", video.error);
      setLoadState("error");
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("error", handleError);

    video.load();

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("error", handleError);
    };
  }, [src, startTime]);

  // Playback controls (separate from loading)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      if (endTime && video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlaying(false);
      }

      if (audioMode === "with-cuts" && cues.length > 0) {
        const nowInCue = isInCueRange(video.currentTime);
        setInCueRange(nowInCue);
        video.muted = nowInCue || isMuted;
      }
    };

    const handleEnded = () => setIsPlaying(false);
    const handlePause = () => setIsPlaying(false);
    const handlePlay = () => setIsPlaying(true);

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("pause", handlePause);
    video.addEventListener("play", handlePlay);

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("play", handlePlay);
    };
  }, [startTime, endTime, audioMode, cues, isMuted, isInCueRange]);

  // Update muted state when audio mode changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    if (audioMode === "original") {
      video.muted = isMuted;
      setInCueRange(false);
    }
  }, [audioMode, isMuted]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      video.currentTime = startTime;
      video.play();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (video) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      // In original mode, directly set muted
      // In with-cuts mode, muting is controlled by time position
      if (audioMode === "original") {
        video.muted = newMuted;
      }
    }
  };

  const toggleAudioMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAudioMode(prev => prev === "original" ? "with-cuts" : "original");
  };

  return (
    <div className="space-y-2">
      {label && (
        <div className="text-sm text-tg-hint">{label}</div>
      )}
      
      {/* Audio mode switch */}
      {showAudioModeSwitch && cues.length > 0 && (
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => setAudioMode("with-cuts")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              audioMode === "with-cuts"
                ? "bg-accent-primary text-white"
                : "bg-tg-secondary text-tg-hint"
            }`}
          >
            ✂️ С вырезами
          </button>
          <button
            onClick={() => setAudioMode("original")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              audioMode === "original"
                ? "bg-accent-primary text-white"
                : "bg-tg-secondary text-tg-hint"
            }`}
          >
            🔊 Оригинал
          </button>
        </div>
      )}

      <div className="relative group rounded-xl overflow-hidden bg-black/20">
        {/* Loading placeholder */}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {/* Error state */}
        {loadState === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-10 text-white">
            <div className="text-3xl mb-2">⚠️</div>
            <div className="text-sm">Не удалось загрузить видео</div>
            <button 
              onClick={() => {
                setLoadState("loading");
                videoRef.current?.load();
              }}
              className="mt-2 px-3 py-1 bg-white/20 rounded-full text-xs hover:bg-white/30"
            >
              Повторить
            </button>
          </div>
        )}

        <video
          ref={videoRef}
          src={src}
          className="w-full"
          muted={audioMode === "with-cuts" ? (inCueRange || isMuted) : isMuted}
          playsInline
          preload="auto"
        />

        {/* Play overlay */}
        {loadState === "ready" && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity"
          >
            <div
              className={`w-14 h-14 rounded-full bg-white/90 flex items-center justify-center text-2xl transition-transform ${
                isPlaying ? "scale-0" : "scale-100"
              }`}
            >
              ▶️
            </div>
          </button>
        )}

        {/* Mute button */}
        <button
          onClick={toggleMute}
          className="absolute top-2 right-2 w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-lg hover:bg-black/80 transition-colors"
        >
          {isMuted ? "🔇" : "🔊"}
        </button>

        {/* "Muted for cue" indicator */}
        {audioMode === "with-cuts" && inCueRange && isPlaying && (
          <div className="absolute top-2 left-2 bg-orange-500/90 px-2 py-1 rounded text-xs text-white animate-pulse">
            ✂️ Вырезано
          </div>
        )}

        {/* Time range indicator */}
        {showTimeRange && (startTime > 0 || endTime) && (
          <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">
            {startTime.toFixed(1)}s — {endTime?.toFixed(1) ?? "end"}
          </div>
        )}
      </div>
    </div>
  );
}

