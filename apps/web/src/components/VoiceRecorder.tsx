"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface VoiceRecorderProps {
  maxDuration: number;  // This is the CUE duration - will auto-stop at this time
  onRecordComplete: (blob: Blob) => void;
  disabled?: boolean;
}

type CountdownState = "idle" | "counting" | "recording";

export function VoiceRecorder({
  maxDuration,
  onRecordComplete,
  disabled = false,
}: VoiceRecorderProps) {
  const [state, setState] = useState<CountdownState>("idle");
  const [countdown, setCountdown] = useState(3);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      cleanup();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [cleanup, audioUrl]);

  // Start countdown before recording
  const handleStartClick = async () => {
    // First, get mic permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;
    } catch (err) {
      console.error("Mic access failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
      return;
    }

    // Start countdown
    setState("counting");
    setCountdown(3);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          countdownRef.current = null;
          startRecording();
          return 0;
        }
        window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
        return prev - 1;
      });
    }, 1000);
  };

  const startRecording = () => {
    if (!streamRef.current) return;

    chunksRef.current = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    // Higher bitrate for better quality
    const mediaRecorder = new MediaRecorder(streamRef.current, { 
      mimeType,
      audioBitsPerSecond: 128000  // 128kbps
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
      setPendingBlob(blob);
      cleanup();
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setIsRecording(true);
    setState("recording");
    setRecordingTime(0);

    // Haptic feedback - recording started!
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("heavy");

    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => {
        const next = prev + 0.1;
        // Auto-stop at maxDuration (cue length)
        if (next >= maxDuration) {
          stopRecording();
        }
        return next;
      });
    }, 100);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("light");
    }
  };

  const handleSubmit = async () => {
    if (!pendingBlob) return;
    setSubmitting(true);
    try {
      await onRecordComplete(pendingBlob);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setPendingBlob(null);
    setRecordingTime(0);
  };

  const progress = Math.min((recordingTime / maxDuration) * 100, 100);

  if (disabled) {
    return (
      <div className="card text-center py-8">
        <div className="text-4xl mb-2">✅</div>
        <div className="text-tg-hint">Запись отправлена</div>
      </div>
    );
  }

  // Countdown screen
  if (state === "counting") {
    return (
      <div className="card text-center py-8 space-y-4">
        <div className="text-6xl font-bold text-accent-primary animate-pulse">
          {countdown}
        </div>
        <div className="text-lg text-tg-hint">
          {countdown === 3 && "Приготовьтесь..."}
          {countdown === 2 && "Внимание..."}
          {countdown === 1 && "Поехали!"}
        </div>
        <button
          onClick={() => {
            cleanup();
            setState("idle");
          }}
          className="text-sm text-tg-hint underline"
        >
          Отмена
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      {/* Progress */}
      <div className="h-2 bg-tg-bg rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-primary transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Timer */}
      <div className="text-center text-xl font-mono text-tg-hint">
        {recordingTime.toFixed(1)}s / {maxDuration.toFixed(1)}s
      </div>

      {/* Controls */}
      {!audioUrl ? (
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={isRecording ? stopRecording : handleStartClick}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all ${
              isRecording
                ? "bg-red-500 animate-recording"
                : "bg-accent-primary hover:scale-105"
            }`}
          >
            {isRecording ? "⏹" : "🎤"}
          </button>
          {!isRecording && (
            <p className="text-sm text-tg-hint">
              Нажмите чтобы начать запись
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <audio src={audioUrl} controls className="w-full h-10" />
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleRetry}
              disabled={submitting}
              className="btn-secondary"
            >
              🔄 Заново
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="btn-primary"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </span>
              ) : (
                "✓ Отправить"
              )}
            </button>
          </div>
        </div>
      )}

      {isRecording && (
        <p className="text-center text-sm text-tg-hint">
          Автостоп через {(maxDuration - recordingTime).toFixed(1)}s
        </p>
      )}
    </div>
  );
}

