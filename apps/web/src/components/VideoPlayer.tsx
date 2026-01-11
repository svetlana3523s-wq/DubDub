"use client";

import { useRef, useEffect, useState } from "react";

interface VideoPlayerProps {
  src: string;           // Original video URL
  srcCuts?: string;      // Video with audio cut (server-processed)
  startTime?: number;
  endTime?: number;
  muted?: boolean;
  showTimeRange?: boolean;
  label?: string;
  showAudioModeSwitch?: boolean;
}

type AudioMode = "original" | "with-cuts";
type LoadState = "loading" | "ready" | "error";

export function VideoPlayer({ 
  src, 
  srcCuts,
  startTime = 0, 
  endTime, 
  muted = false,
  showTimeRange = true,
  label,
  showAudioModeSwitch = false,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(muted);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [audioMode, setAudioMode] = useState<AudioMode>(srcCuts ? "with-cuts" : "original");
  const [currentTime, setCurrentTime] = useState(startTime);
  const [duration, setDuration] = useState(0);

  // Current video source based on mode
  const currentSrc = audioMode === "with-cuts" && srcCuts ? srcCuts : src;
  
  // Effective duration (endTime or full duration)
  const effectiveEnd = endTime ?? duration;
  const effectiveStart = startTime;

  // Load video when src changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentSrc) return;

    setLoadState("loading");
    setIsPlaying(false);

    const handleLoadedMetadata = () => {
      video.currentTime = startTime;
      setDuration(video.duration);
      setCurrentTime(startTime);
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
  }, [currentSrc, startTime]);

  // Playback controls
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      
      if (endTime && video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlaying(false);
        setCurrentTime(startTime);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      video.currentTime = startTime;
      setCurrentTime(startTime);
    };
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
  }, [startTime, endTime]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
    } else {
      // If at end, restart from beginning
      if (endTime && video.currentTime >= endTime - 0.1) {
        video.currentTime = startTime;
      }
      video.play();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const video = videoRef.current;
    if (video) {
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      video.muted = newMuted;
    }
  };

  const handleModeChange = (mode: AudioMode) => {
    const video = videoRef.current;
    if (video) {
      video.pause();
    }
    setAudioMode(mode);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    
    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setCurrentTime(newTime);
  };

  // Format time as MM:SS
  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage for the range within startTime-endTime
  const progressPercent = effectiveEnd > effectiveStart 
    ? ((currentTime - effectiveStart) / (effectiveEnd - effectiveStart)) * 100
    : 0;

  return (
    <div className="space-y-2">
      {label && (
        <div className="text-sm text-tg-hint">{label}</div>
      )}
      
      {/* Audio mode switch - only if srcCuts available */}
      {showAudioModeSwitch && srcCuts && (
        <div className="flex gap-2 text-sm">
          <button
            onClick={() => handleModeChange("with-cuts")}
            className={`px-3 py-1.5 rounded-full transition-colors ${
              audioMode === "with-cuts"
                ? "bg-accent-primary text-white"
                : "bg-tg-secondary text-tg-hint"
            }`}
          >
            ✂️ С вырезами
          </button>
          <button
            onClick={() => handleModeChange("original")}
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

      <div className="relative rounded-xl overflow-hidden bg-black">
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
          src={currentSrc}
          className="w-full"
          muted={isMuted}
          playsInline
          preload="auto"
          onClick={togglePlay}
        />

        {/* Controls overlay */}
        {loadState === "ready" && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 space-y-2">
            {/* Progress bar */}
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={effectiveStart}
                max={effectiveEnd}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1 bg-white/30 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-3
                  [&::-webkit-slider-thumb]:h-3
                  [&::-webkit-slider-thumb]:rounded-full
                  [&::-webkit-slider-thumb]:bg-white
                  [&::-webkit-slider-thumb]:cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 ${progressPercent}%, rgba(255,255,255,0.3) ${progressPercent}%)`
                }}
              />
            </div>
            
            {/* Controls row */}
            <div className="flex items-center justify-between">
              {/* Play/Pause button */}
              <button
                onClick={togglePlay}
                className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white hover:bg-white/30 transition-colors"
              >
                {isPlaying ? "⏸" : "▶️"}
              </button>

              {/* Time display */}
              <div className="text-xs text-white/80">
                {formatTime(currentTime - effectiveStart)} / {formatTime(effectiveEnd - effectiveStart)}
              </div>

              {/* Mute button */}
              <button
                onClick={toggleMute}
                className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-lg hover:bg-white/30 transition-colors"
              >
                {isMuted ? "🔇" : "🔊"}
              </button>
            </div>
          </div>
        )}

        {/* Time range indicator (for fragments) */}
        {showTimeRange && (startTime > 0 || endTime) && (
          <div className="absolute top-2 left-2 bg-black/60 px-2 py-1 rounded text-xs text-white">
            {startTime.toFixed(1)}s — {endTime?.toFixed(1) ?? "end"}
          </div>
        )}
      </div>
    </div>
  );
}
