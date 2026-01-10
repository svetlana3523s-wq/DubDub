"use client";

import { useEffect, useState, useRef } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";

interface PlyrVideoPlayerProps {
  src: string;           // Original video URL
  srcCuts?: string;      // Video with audio cut at cue ranges (optional)
  startTime?: number;
  endTime?: number;
  muted?: boolean;
  showTimeRange?: boolean;
  label?: string;
  showAudioModeSwitch?: boolean;  // Show toggle between original and cuts
}

type AudioMode = "original" | "with-cuts";

export function PlyrVideoPlayer({
  src,
  srcCuts,
  startTime = 0,
  endTime,
  muted = false,
  showTimeRange = true,
  label,
  showAudioModeSwitch = false,
}: PlyrVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  // Default to "with-cuts" if cuts video is available, otherwise "original"
  const [audioMode, setAudioMode] = useState<AudioMode>(srcCuts ? "with-cuts" : "original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  // Get current video source based on mode
  const currentSrc = audioMode === "with-cuts" && srcCuts ? srcCuts : src;

  // Initialize Plyr
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentSrc) return;

    setLoadState("loading");

    const player = new Plyr(video, {
      controls: [
        "play-large",
        "restart",
        "play",
        "progress",
      ],
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      seekTime: 5,
      clickToPlay: true,
      hideControls: true,
      resetOnEnd: false,
      volume: 1.0,
      muted: muted,
    });

    playerRef.current = player;

    const handleReady = () => {
      setLoadState("ready");
      player.volume = 1.0;
      if (startTime > 0) {
        player.currentTime = startTime;
      }
    };

    const handleLoadedMetadata = () => {
      if (startTime > 0) {
        player.currentTime = startTime;
      }
    };

    const handleError = () => {
      console.error("Video load error:", video.error);
      setLoadState("error");
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    // Handle endTime constraint
    const handleTimeUpdate = () => {
      if (endTime && player.currentTime >= endTime) {
        player.pause();
        player.currentTime = startTime;
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    player.on("ready", handleReady);
    player.on("error", handleError);
    player.on("play", handlePlay);
    player.on("pause", handlePause);
    player.on("ended", handleEnded);
    player.on("timeupdate", handleTimeUpdate);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      player.off("play", handlePlay);
      player.off("pause", handlePause);
      player.off("ended", handleEnded);
      player.off("timeupdate", handleTimeUpdate);
      if (player) {
        player.destroy();
        playerRef.current = null;
      }
    };
  }, [currentSrc, startTime, endTime, muted]);

  // Update muted state
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.muted = muted;
    }
  }, [muted]);

  return (
    <div className="space-y-2">
      {label && <div className="text-sm text-tg-hint">{label}</div>}

      {/* Audio mode switch - only show if cuts video is available */}
      {showAudioModeSwitch && srcCuts && (
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
          src={currentSrc}
          className="plyr-video w-full"
          playsInline
          preload="auto"
        />

        {/* Time range indicator */}
        {showTimeRange && (startTime > 0 || endTime) && (
          <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs z-20">
            {startTime.toFixed(1)}s — {endTime?.toFixed(1) ?? "end"}
          </div>
        )}
      </div>
    </div>
  );
}
