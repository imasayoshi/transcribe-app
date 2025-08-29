import { useState, useRef, useCallback, useEffect } from "react";
import type { RecordingState, TranscriptionResult } from "../types";
import { startTranscribeStreaming } from "../services/transcribeService";

export const useAudioRecorder = () => {
  const [state, setState] = useState<RecordingState>({
    isRecording: false,
    isProcessing: false,
    error: null,
  });

  const [transcriptions, setTranscriptions] = useState<TranscriptionResult[]>(
    []
  );
  const [currentTranscript, setCurrentTranscript] = useState<string>("");

  const streamRef = useRef<MediaStream | null>(null);
  const isStoppedRef = useRef<boolean>(false);
  const streamingPromiseRef = useRef<Promise<void> | null>(null);

  const onTranscriptionResult = useCallback(
    (text: string, isFinal: boolean) => {

      if (isFinal) {
        // 確定結果を履歴に追加
        if (text.trim()) {
          setTranscriptions((prev) => [
            ...prev,
            {
              transcript: text,
              timestamp: Date.now(),
            },
          ]);
        }
        setCurrentTranscript(""); // 暫定結果をクリア
      } else {
        // 暫定結果を表示
        setCurrentTranscript(text);
      }
    },
    []
  );

  const startRecording = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, error: null, isProcessing: true }));

      // マイクアクセス（16kHzに設定）
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;
      isStoppedRef.current = false;

      // Transcribeストリーミング開始
      streamingPromiseRef.current = startTranscribeStreaming(
        stream,
        onTranscriptionResult,
        () => isStoppedRef.current,
        16000
      );

      setState((prev) => ({
        ...prev,
        isRecording: true,
        isProcessing: false,
      }));

      // ストリーミング完了を待機（バックグラウンドで実行）
      streamingPromiseRef.current.catch((error) => {
        console.error("❌ ストリーミングエラー:", error);
        setState((prev) => ({
          ...prev,
          error:
            error instanceof Error ? error.message : "音声認識に失敗しました",
        }));
      });
    } catch (error) {
      console.error("❌ 録音開始エラー:", error);
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "録音開始に失敗しました",
        isProcessing: false,
      }));
    }
  }, [onTranscriptionResult]);

  const stopRecording = useCallback(async () => {
    try {
      isStoppedRef.current = true;

      // MediaStream停止
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      setState((prev) => ({ ...prev, isRecording: false }));
      setCurrentTranscript("");

      // ストリーミング処理の完了を待機
      if (streamingPromiseRef.current) {
        try {
          await streamingPromiseRef.current;
        } catch (error) {
        }
        streamingPromiseRef.current = null;
      }

    } catch (error) {
      console.error("❌ 録音停止エラー:", error);
      setState((prev) => ({
        ...prev,
        error:
          error instanceof Error ? error.message : "録音停止に失敗しました",
      }));
    }
  }, []);

  const clearTranscriptions = useCallback(() => {
    setTranscriptions([]);
    setCurrentTranscript("");
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      isStoppedRef.current = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    state,
    transcriptions,
    currentTranscript,
    startRecording,
    stopRecording,
    clearTranscriptions,
  };
};
