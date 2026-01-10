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
    if (selectionEnd !== null && currentTime > selectionEnd) {
      setSelectionEnd(null);
    }
  };

  const setEndTime = () => {
    if (selectionStart === null) {
      setSelectionStart(0);
    }
    setSelectionEnd(currentTime);
  };

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
          <div className="space-y-1">
            <input
              type="range"
              min={0}
              max={videoDuration}
              step={0.1}
              value={currentTime}
              onChange={(e) => handleSeek(parseFloat(e.target.value))}
              className="w-full h-2 bg-tg-secondary rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #3390ec 0%, #3390ec ${(currentTime / videoDuration) * 100}%, #e5e5e5 ${(currentTime / videoDuration) * 100}%, #e5e5e5 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-tg-hint">
              <span>{currentTime.toFixed(2)}s</span>
              <span>{videoDuration.toFixed(2)}s</span>
            </div>
          </div>

          {/* Selection Controls */}
          <div className="flex gap-2">
            <button
              onClick={setStartTime}
              className="flex-1 btn-tg text-sm"
            >
              ⏱ Начало: {selectionStart !== null ? selectionStart.toFixed(2) + "s" : "—"}
            </button>
            <button
              onClick={setEndTime}
              className="flex-1 btn-tg text-sm"
            >
              ⏱ Конец: {selectionEnd !== null ? selectionEnd.toFixed(2) + "s" : "—"}
            </button>
            <button
              onClick={addCueFromSelection}
              disabled={selectionStart === null || selectionEnd === null}
              className="flex-1 btn-tg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ➕ Добавить
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

