"use client";

import { useRef, useEffect, useState } from "react";

interface VideoPlayerProps {
  src: string;
  startTime?: number;
  endTime?: number;
}

export function VideoPlayer({ src, startTime = 0, endTime }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.currentTime = startTime;

    const handleTimeUpdate = () => {
      if (endTime && video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlaying(false);
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
  }, [startTime, endTime]);

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

  return (
    <div className="relative group rounded-xl overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        className="w-full"
        muted
        playsInline
        preload="metadata"
      />

      {/* Play overlay */}
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

      {/* Time range indicator */}
      {(startTime > 0 || endTime) && (
        <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">
          {startTime.toFixed(1)}s — {endTime?.toFixed(1) ?? "end"}
        </div>
      )}
    </div>
  );
}

