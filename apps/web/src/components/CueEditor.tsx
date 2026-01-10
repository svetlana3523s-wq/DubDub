"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { Cue } from "@dubdub/shared";

interface CueEditorProps {
  videoUrl: string | null;
  videoDuration: number;
  fps: number;
  cues: Cue[];
  onChange: (cues: Cue[]) => void;
}

export function CueEditor({ videoUrl, videoDuration, fps, cues, onChange }: CueEditorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [editingCueIndex, setEditingCueIndex] = useState<number | null>(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  
  // Frame-based inputs for selection
  const [startFrame, setStartFrame] = useState<string>("");
  const [endFrame, setEndFrame] = useState<string>("");

  // Helper functions for frame/seconds conversion
  const secondsToFrames = (seconds: number): number => {
    return Math.round(seconds * fps);
  };

  const framesToSeconds = (frames: number): number => {
    return frames / fps;
  };

  const totalFrames = secondsToFrames(videoDuration);

  // Update current time from video
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", () => setIsPlaying(true));
    video.addEventListener("pause", () => setIsPlaying(false));
    video.addEventListener("ended", () => setIsPlaying(false));

    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", () => setIsPlaying(true));
      video.removeEventListener("pause", () => setIsPlaying(false));
      video.removeEventListener("ended", () => setIsPlaying(false));
    };
  }, [videoUrl]);

  // Validate cues don't overlap
  const validateCues = useCallback((newCues: Cue[]): boolean => {
    for (let i = 0; i < newCues.length; i++) {
      const cue = newCues[i];
      if (!cue || cue.startSec < 0 || cue.durationSec <= 0) {
        return false;
      }
      if (cue.startSec + cue.durationSec > videoDuration) {
        return false;
      }
      // Check overlaps with other cues
      for (let j = i + 1; j < newCues.length; j++) {
        const other = newCues[j];
        if (!other) continue;
        const cueEnd = cue.startSec + cue.durationSec;
        const otherEnd = other.startSec + other.durationSec;
        if (
          (cue.startSec >= other.startSec && cue.startSec < otherEnd) ||
          (cueEnd > other.startSec && cueEnd <= otherEnd) ||
          (cue.startSec <= other.startSec && cueEnd >= otherEnd)
        ) {
          return false;
        }
      }
    }
    return true;
  }, [videoDuration]);

  const handleSeek = (time: number) => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.max(0, Math.min(time, videoDuration));
      setCurrentTime(video.currentTime);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const setStartTime = () => {
    setSelectionStart(currentTime);
    setStartFrame(String(secondsToFrames(currentTime)));
    if (selectionEnd !== null && currentTime > selectionEnd) {
      setSelectionEnd(null);
      setEndFrame("");
    }
  };

  const setEndTime = () => {
    if (selectionStart === null) {
      setSelectionStart(0);
      setStartFrame("0");
    }
    setSelectionEnd(currentTime);
    setEndFrame(String(secondsToFrames(currentTime)));
  };

  // Update selection from frame inputs
  const handleStartFrameChange = (value: string) => {
    setStartFrame(value);
    const frame = parseInt(value);
    if (!isNaN(frame) && frame >= 0) {
      const seconds = framesToSeconds(frame);
      if (seconds <= videoDuration) {
        setSelectionStart(seconds);
        handleSeek(seconds);
      }
    }
  };

  const handleEndFrameChange = (value: string) => {
    setEndFrame(value);
    const frame = parseInt(value);
    if (!isNaN(frame) && frame >= 0) {
      const seconds = framesToSeconds(frame);
      if (seconds <= videoDuration) {
        setSelectionEnd(seconds);
      }
    }
  };

  // Update frame inputs when selection changes from buttons
  useEffect(() => {
    if (selectionStart !== null) {
      setStartFrame(String(secondsToFrames(selectionStart)));
    }
  }, [selectionStart, fps]);

  useEffect(() => {
    if (selectionEnd !== null) {
      setEndFrame(String(secondsToFrames(selectionEnd)));
    }
  }, [selectionEnd, fps]);

  const addCueFromSelection = () => {
    const start = selectionStart ?? 0;
    const end = selectionEnd ?? videoDuration;
    if (end <= start) {
      alert("Конец должен быть позже начала");
      return;
    }

    const newCue: Cue = {
      roleIndex: cues.length,
      startSec: start,
      durationSec: end - start,
    };

    const newCues = [...cues, newCue];
    if (validateCues(newCues)) {
      onChange(newCues);
      setSelectionStart(null);
      setSelectionEnd(null);
    } else {
      alert("Тайминг пересекается с существующими или выходит за пределы видео");
    }
  };

  const updateCue = (index: number, updates: Partial<Cue>) => {
    const newCues = [...cues];
    newCues[index] = { ...newCues[index]!, ...updates };
    // Re-sort by startSec
    newCues.sort((a, b) => a.startSec - b.startSec);
    // Update roleIndex
    newCues.forEach((c, i) => {
      c.roleIndex = i;
    });
    if (validateCues(newCues)) {
      onChange(newCues);
      setEditingCueIndex(null);
    } else {
      alert("Тайминг пересекается с существующими или выходит за пределы видео");
    }
  };

  const deleteCue = (index: number) => {
    const newCues = cues.filter((_, i) => i !== index);
    // Update roleIndex
    newCues.forEach((c, i) => {
      c.roleIndex = i;
    });
    onChange(newCues);
    setEditingCueIndex(null);
  };

  if (!videoUrl) {
    return (
      <div className="card">
        <div className="text-center text-tg-hint">
          Загрузите видео для редактирования таймингов
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Video Player */}
      <div className="card">
        <div className="space-y-2">
          <div className="relative rounded-xl overflow-hidden bg-black/20">
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full"
              playsInline
              preload="auto"
            />
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
          </div>

          {/* Time Slider */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {/* Frame backward button */}
              <button
                onClick={() => {
                  const frameDuration = 1 / fps;
                  handleSeek(Math.max(0, currentTime - frameDuration));
                }}
                className="px-3 py-1.5 rounded-lg bg-tg-secondary hover:bg-tg-border transition-colors text-sm font-medium"
                title="Кадр назад"
              >
                ⏪
              </button>
              
              {/* Time slider */}
              <input
                type="range"
                min={0}
                max={videoDuration}
                step={1 / fps}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-tg-secondary rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #3390ec 0%, #3390ec ${(currentTime / videoDuration) * 100}%, #e5e5e5 ${(currentTime / videoDuration) * 100}%, #e5e5e5 100%)`,
                }}
              />
              
              {/* Frame forward button */}
              <button
                onClick={() => {
                  const frameDuration = 1 / fps;
                  handleSeek(Math.min(videoDuration, currentTime + frameDuration));
                }}
                className="px-3 py-1.5 rounded-lg bg-tg-secondary hover:bg-tg-border transition-colors text-sm font-medium"
                title="Кадр вперед"
              >
                ⏩
              </button>
            </div>
            <div className="flex justify-between text-xs text-tg-hint">
              <span>Кадр {secondsToFrames(currentTime)} / {totalFrames}</span>
              <span>{currentTime.toFixed(3)}s / {videoDuration.toFixed(3)}s</span>
            </div>
          </div>

          {/* Frame Inputs */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-tg-hint mb-1 block">Начало (кадр)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={totalFrames}
                  value={startFrame}
                  onChange={(e) => handleStartFrameChange(e.target.value)}
                  placeholder="0"
                  className="flex-1 px-2 py-1.5 rounded bg-tg-secondary text-sm border border-tg-border focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                />
                <button
                  onClick={setStartTime}
                  className="px-3 py-1.5 rounded-lg bg-tg-secondary hover:bg-tg-border transition-colors text-sm"
                  title="Установить из текущей позиции"
                >
                  📍
                </button>
              </div>
              {selectionStart !== null && (
                <div className="text-xs text-tg-hint mt-1">
                  {selectionStart.toFixed(3)}s
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-tg-hint mb-1 block">Конец (кадр)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  max={totalFrames}
                  value={endFrame}
                  onChange={(e) => handleEndFrameChange(e.target.value)}
                  placeholder="0"
                  className="flex-1 px-2 py-1.5 rounded bg-tg-secondary text-sm border border-tg-border focus:ring-2 focus:ring-accent-primary focus:border-transparent"
                />
                <button
                  onClick={setEndTime}
                  className="px-3 py-1.5 rounded-lg bg-tg-secondary hover:bg-tg-border transition-colors text-sm"
                  title="Установить из текущей позиции"
                >
                  📍
                </button>
              </div>
              {selectionEnd !== null && (
                <div className="text-xs text-tg-hint mt-1">
                  {selectionEnd.toFixed(3)}s
                </div>
              )}
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex gap-2">
            <button
              onClick={addCueFromSelection}
              disabled={selectionStart === null || selectionEnd === null}
              className="flex-1 btn-tg-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ➕ Добавить реплику
            </button>
          </div>
        </div>
      </div>

      {/* Cues Table */}
      <div className="card">
        <div className="text-sm font-medium mb-3">Тайминги ({cues.length})</div>
        {cues.length === 0 ? (
          <div className="text-center text-tg-hint py-4">
            Нет таймингов. Используйте кнопки выше для добавления.
          </div>
        ) : (
          <div className="space-y-2">
            {cues.map((cue, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  editingCueIndex === index
                    ? "border-accent-primary bg-accent-primary/10"
                    : "border-tg-secondary bg-tg-secondary/5"
                }`}
              >
                {editingCueIndex === index ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-tg-hint">Начало (с)</label>
                        <input
                          type="number"
                          step="0.01"
                          min={0}
                          max={videoDuration}
                          value={cue.startSec.toFixed(2)}
                          onChange={(e) => {
                            const start = parseFloat(e.target.value) || 0;
                            updateCue(index, { startSec: Math.max(0, Math.min(start, videoDuration)) });
                          }}
                          className="w-full px-2 py-1 rounded bg-tg-secondary text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-tg-hint">Длительность (с)</label>
                        <input
                          type="number"
                          step="0.01"
                          min={0.01}
                          max={videoDuration - cue.startSec}
                          value={cue.durationSec.toFixed(2)}
                          onChange={(e) => {
                            const duration = parseFloat(e.target.value) || 0.01;
                            updateCue(index, {
                              durationSec: Math.min(duration, videoDuration - cue.startSec),
                            });
                          }}
                          className="w-full px-2 py-1 rounded bg-tg-secondary text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingCueIndex(null)}
                        className="flex-1 btn-tg text-sm"
                      >
                        ✓ Готово
                      </button>
                      <button
                        onClick={() => deleteCue(index)}
                        className="flex-1 btn-tg text-sm bg-red-500/20 text-red-500"
                      >
                        🗑 Удалить
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">Роль {cue.roleIndex + 1}</div>
                      <div className="text-xs text-tg-hint">
                        {cue.startSec.toFixed(2)}s — {(cue.startSec + cue.durationSec).toFixed(2)}s
                        {" "}
                        (длительность: {cue.durationSec.toFixed(2)}s)
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setEditingCueIndex(index);
                        handleSeek(cue.startSec);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-accent-primary/20 text-accent-primary text-sm"
                    >
                      ✏️ Редактировать
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

