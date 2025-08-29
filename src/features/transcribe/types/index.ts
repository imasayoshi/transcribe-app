export interface TranscriptionResult {
  transcript: string;
  timestamp: number;
}

export interface RecordingState {
  isRecording: boolean;
  isProcessing: boolean;
  error: string | null;
}

export interface AudioChunk {
  data: Blob;
  timestamp: number;
}
