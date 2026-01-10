"use client";

import { useEffect, useState, useRef } from "react";
import type { Cue } from "@dubdub/shared";

interface PlyrVideoPlayerProps {
  src: string;
  startTime?: number;
  endTime?: number;
  muted?: boolean;
  showTimeRange?: boolean;
  label?: string;
  cues?: Cue[];
  showAudioModeSwitch?: boolean;
}

type AudioMode = "original" | "with-cuts";

export function PlyrVideoPlayer({
  src,
  startTime = 0,
  endTime,
  muted = false,
  showTimeRange = true,
  label,
  cues = [],
  showAudioModeSwitch = false,
}: PlyrVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>("with-cuts");
  const [inCueRange, setInCueRange] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);

  // Check if current time is within any cue range
  const isInCueRange = (time: number): boolean => {
    return cues.some((cue) => time >= cue.startSec && time < cue.startSec + cue.durationSec);
  };

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Handle video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      setLoadState("ready");
      setDuration(video.duration);
      if (startTime > 0) {
        video.currentTime = startTime;
      }
      video.volume = 1.0;
    };

    const handleError = () => {
      console.error("Video load error:", video.error);
      setLoadState("error");
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setShowControls(true);
    };

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Handle cue-based muting
      if (audioMode === "with-cuts" && cues.length > 0) {
        const nowInCue = isInCueRange(time);
        setInCueRange(nowInCue);
        video.muted = nowInCue || muted;
      }

      // Handle endTime constraint
      if (endTime && time >= endTime) {
        video.pause();
        video.currentTime = startTime;
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", handleError);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", handleError);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [src, startTime, endTime, audioMode, cues, muted]);

  // Update muted state when audio mode changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (audioMode === "original") {
      video.muted = muted;
      setInCueRange(false);
    } else if (audioMode === "with-cuts" && cues.length > 0) {
      const nowInCue = isInCueRange(video.currentTime);
      setInCueRange(nowInCue);
      video.muted = nowInCue || muted;
    }
  }, [audioMode, muted, cues]);

  // Auto-hide controls when playing
  useEffect(() => {
    if (isPlaying) {
      hideControlsTimeout.current = setTimeout(() => {
        setShowControls(false);
      }, 2000);
    } else {
      setShowControls(true);
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    }

    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [isPlaying]);

  const handleContainerClick = () => {
    if (isPlaying) {
      setShowControls(true);
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
      hideControlsTimeout.current = setTimeout(() => {
        if (isPlaying) setShowControls(false);
      }, 2000);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const handleRestart = () => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = startTime;
    video.play();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);

    // Immediately apply mute state at new position
    if (audioMode === "with-cuts" && cues.length > 0) {
      const nowInCue = isInCueRange(time);
      setInCueRange(nowInCue);
      video.muted = nowInCue || muted;
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="space-y-2">
      {label && <div className="text-sm text-tg-hint">{label}</div>}

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

      <div 
        className="relative rounded-xl overflow-hidden bg-black"
        onClick={handleContainerClick}
      >
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
              onClick={(e) => {
                e.stopPropagation();
                setLoadState("loading");
                videoRef.current?.load();
              }}
              className="mt-2 px-3 py-1 bg-white/20 rounded-full text-xs hover:bg-white/30"
            >
              Повторить
            </button>
          </div>
        )}

        {/* Video element */}
        <video
          ref={videoRef}
          src={src}
          className="w-full"
          playsInline
          preload="auto"
        />

        {/* Large center play button (shown when paused) */}
        {loadState === "ready" && !isPlaying && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="absolute inset-0 flex items-center justify-center z-20"
          >
            <div className="w-16 h-16 bg-accent-primary/90 rounded-full flex items-center justify-center shadow-lg hover:bg-accent-primary transition-colors">
              <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </button>
        )}

        {/* Controls bar */}
        {loadState === "ready" && (
          <div 
            className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 transition-opacity duration-200 ${
              showControls ? "opacity-100" : "opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress bar */}
            <div className="mb-2">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="w-full h-1 bg-white/30 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3390ec 0%, #3390ec ${progressPercent}%, rgba(255,255,255,0.3) ${progressPercent}%, rgba(255,255,255,0.3) 100%)`,
                }}
              />
            </div>

            {/* Control buttons */}
            <div className="flex items-center gap-3">
              {/* Restart button */}
              <button
                onClick={handleRestart}
                className="text-white/80 hover:text-white transition-colors"
                title="В начало"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                </svg>
              </button>

              {/* Play/Pause button */}
              <button
                onClick={togglePlay}
                className="text-white hover:text-white/80 transition-colors"
                title={isPlaying ? "Пауза" : "Воспроизвести"}
              >
                {isPlaying ? (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>

              {/* Time display */}
              <div className="text-white/80 text-xs ml-auto">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>
        )}

        {/* "Muted for cue" indicator */}
        {audioMode === "with-cuts" && inCueRange && isPlaying && (
          <div className="absolute top-2 left-2 bg-orange-500/90 px-2 py-1 rounded text-xs text-white animate-pulse z-20">
            ✂️ Вырезано
          </div>
        )}

        {/* Time range indicator */}
        {showTimeRange && (startTime > 0 || endTime) && (
          <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-xs text-white z-20">
            {startTime.toFixed(1)}s — {endTime?.toFixed(1) ?? "end"}
          </div>
        )}
      </div>
    </div>
  );
}
