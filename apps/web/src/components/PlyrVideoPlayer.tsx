"use client";

import { useEffect, useState, useRef } from "react";
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

  // Refs for accessing current values in timeupdate handler (avoid stale closures)
  const cuesRef = useRef(cues);
  const audioModeRef = useRef(audioMode);
  const mutedRef = useRef(muted);
  const endTimeRef = useRef(endTime);
  const startTimeRef = useRef(startTime);

  // Sync refs with props/state
  useEffect(() => { cuesRef.current = cues; }, [cues]);
  useEffect(() => { audioModeRef.current = audioMode; }, [audioMode]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { endTimeRef.current = endTime; }, [endTime]);
  useEffect(() => { startTimeRef.current = startTime; }, [startTime]);

  // Helper function to check if time is in any cue range
  const checkInCueRange = (time: number, currentCues: Cue[]): boolean => {
    return currentCues.some((cue) => time >= cue.startSec && time < cue.startSec + cue.durationSec);
  };

  // Initialize Plyr and set up timeupdate handler
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

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
      volume: 1.0, // Always maximum volume
      muted: false,
    });

    playerRef.current = player;

    const handleReady = () => {
      setLoadState("ready");
      // Set volume to maximum
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

    // Timeupdate handler - uses refs to always have current values
    const handleTimeUpdate = () => {
      const currentCues = cuesRef.current;
      const currentAudioMode = audioModeRef.current;
      const currentMuted = mutedRef.current;
      const currentEndTime = endTimeRef.current;
      const currentStartTime = startTimeRef.current;

      // Only apply cue-based muting in "with-cuts" mode
      if (currentAudioMode === "with-cuts" && currentCues.length > 0) {
        const currentTime = player.currentTime || 0;
        const nowInCue = checkInCueRange(currentTime, currentCues);
        setInCueRange(nowInCue);

        // Mute during cue ranges
        video.muted = nowInCue || currentMuted;

        // Handle endTime
        if (currentEndTime && currentTime >= currentEndTime) {
          player.pause();
          player.currentTime = currentStartTime;
        }
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    player.on("ready", handleReady);
    player.on("error", handleError);
    player.on("play", handlePlay);
    player.on("pause", handlePause);
    player.on("ended", handleEnded);
    player.on("timeupdate", handleTimeUpdate);
    
    // Ensure volume is always maximum
    player.on("loadedmetadata", () => {
      player.volume = 1.0;
    });

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
  }, [src, startTime]);

  // WORKAROUND: Immediately apply correct mute state when player is ready and cues are available
  // This fixes the race condition where timeupdate hasn't fired yet
  useEffect(() => {
    const player = playerRef.current;
    const video = videoRef.current;
    if (!player || !video || loadState !== "ready") return;

    if (audioMode === "with-cuts" && cues.length > 0) {
      const currentTime = player.currentTime || 0;
      const nowInCue = checkInCueRange(currentTime, cues);
      setInCueRange(nowInCue);
      video.muted = nowInCue || muted;
    } else if (audioMode === "original") {
      video.muted = muted;
      setInCueRange(false);
    }
  }, [loadState, cues, audioMode, muted]);

  // Update muted prop when in original mode
  useEffect(() => {
    const video = videoRef.current;
    if (!video || audioMode === "with-cuts") return;
    video.muted = muted;
  }, [muted, audioMode]);

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

