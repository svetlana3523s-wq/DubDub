"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface VoiceRecorderProps {
  maxDuration: number;
  onRecordComplete: (blob: Blob) => void;
  disabled?: boolean;
}

export function VoiceRecorder({
  maxDuration,
  onRecordComplete,
  disabled = false,
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, { mimeType });

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
      setRecordingTime(0);

      // Haptic feedback
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred("medium");

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const next = prev + 0.1;
          if (next >= maxDuration) {
            stopRecording();
          }
          return next;
        });
      }, 100);
    } catch (err) {
      console.error("Mic access failed:", err);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("error");
    }
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
        {recordingTime.toFixed(1)}s / {maxDuration}s
      </div>

      {/* Controls */}
      {!audioUrl ? (
        <div className="flex justify-center">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl transition-all ${
              isRecording
                ? "bg-red-500 animate-recording"
                : "bg-accent-primary hover:scale-105"
            }`}
          >
            {isRecording ? "⏹" : "🎤"}
          </button>
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
          Нажмите для остановки
        </p>
      )}
    </div>
  );
}

