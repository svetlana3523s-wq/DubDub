"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
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
  const playerRef = useRef<Plyr | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>("with-cuts");
  const [inCueRange, setInCueRange] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  // Check if current time is within any cue range
  const isInCueRange = useCallback((time: number): boolean => {
    return cues.some((cue) => time >= cue.startSec && time < cue.startSec + cue.durationSec);
  }, [cues]);

  // Initialize Plyr
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setLoadState("loading");

    const player = new Plyr(video, {
      controls: [
        "play-large",
        "restart",
        "rewind",
        "play",
        "fast-forward",
        "progress",
        "current-time",
        "duration",
        "mute",
        "volume",
        "settings",
        "pip",
        "fullscreen",
      ],
      keyboard: { focused: true, global: false },
      tooltips: { controls: true, seek: true },
      seekTime: 5,
      clickToPlay: true,
      hideControls: true,
      resetOnEnd: false,
      settings: ["speed"],
      speed: {
        selected: 1,
        options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      },
    });

    playerRef.current = player;

    const handleReady = () => {
      setLoadState("ready");
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

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    player.on("ready", handleReady);
    player.on("error", handleError);
    player.on("play", handlePlay);
    player.on("pause", handlePause);
    player.on("ended", handleEnded);

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      player.off("play", handlePlay);
      player.off("pause", handlePause);
      player.off("ended", handleEnded);
      if (player) {
        player.destroy();
        playerRef.current = null;
      }
    };
  }, [src, startTime]);

  // Handle time updates for cue ranges
  useEffect(() => {
    const player = playerRef.current;
    const video = videoRef.current;
    if (!player || !video || audioMode !== "with-cuts" || cues.length === 0) return;

    const handleTimeUpdate = () => {
      const currentTime = player.currentTime || 0;
      const nowInCue = isInCueRange(currentTime);
      setInCueRange(nowInCue);

      // Mute during cue ranges
      video.muted = nowInCue || muted;

      // Handle endTime
      if (endTime && currentTime >= endTime) {
        player.pause();
        player.currentTime = startTime;
      }
    };

    player.on("timeupdate", handleTimeUpdate);

    return () => {
      player.off("timeupdate", handleTimeUpdate);
    };
  }, [startTime, endTime, audioMode, cues, muted, isInCueRange]);

  // Update muted state when audio mode changes
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (audioMode === "original") {
      video.muted = muted;
      setInCueRange(false);
    }
  }, [audioMode, muted]);

  // Update muted prop
  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioMode === "with-cuts") return;
    video.muted = muted;
  }, [muted, audioMode]);

  const toggleAudioMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setAudioMode((prev) => (prev === "original" ? "with-cuts" : "original"));
  };

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
          className="plyr-video w-full"
          playsInline
          preload="auto"
        />

        {/* "Muted for cue" indicator */}
        {audioMode === "with-cuts" && inCueRange && isPlaying && (
          <div className="absolute top-2 left-2 bg-orange-500/90 px-2 py-1 rounded text-xs text-white animate-pulse z-20">
            ✂️ Вырезано
          </div>
        )}

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

