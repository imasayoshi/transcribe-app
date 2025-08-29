import { fetchAuthSession } from "aws-amplify/auth";
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from "@aws-sdk/client-transcribe-streaming";

export const createTranscribeStreamingClient = async () => {
  try {
    const session = await fetchAuthSession();
    const credentials = session.credentials;

    if (!credentials) {
      throw new Error("認証情報が取得できませんでした");
    }
    const transcribeClient = new TranscribeStreamingClient({
      region: "ap-northeast-1",
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });

    return transcribeClient;
  } catch (error) {
    console.error("❌ TranscribeStreamingClient作成エラー:", error);
    throw error;
  }
};

export const encodePCMChunk = (chunk: Float32Array): Uint8Array => {
  const buffer = new ArrayBuffer(chunk.length * 2);
  const view = new DataView(buffer);
  let offset = 0;

  for (let i = 0; i < chunk.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, chunk[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buffer);
};

export const createAudioStream = async function* (
  mediaStream: MediaStream,
  onStop: () => boolean,
  sampleRate: number = 16000
): AsyncGenerator<{ AudioEvent: { AudioChunk: Uint8Array } }> {
  const audioContext = new AudioContext({ sampleRate });
  const source = audioContext.createMediaStreamSource(mediaStream);

  await audioContext.audioWorklet.addModule("/audio-processor.js");
  const processor = new AudioWorkletNode(audioContext, "audio-processor");

  const audioQueue: Uint8Array[] = [];
  let isProcessing = true;
  let chunkCount = 0;

  processor.port.onmessage = (event) => {
    if (!isProcessing) return;

    if (event.data.type === "audiodata") {
      const inputData = new Float32Array(event.data.buffer);
      const encodedChunk = encodePCMChunk(inputData);

      if (encodedChunk.length > 0) {
        audioQueue.push(encodedChunk);
        chunkCount++;
      }
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  try {
    while (!onStop() && isProcessing) {
      if (audioQueue.length > 0) {
        const chunk = audioQueue.shift()!;
        yield { AudioEvent: { AudioChunk: chunk } };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    isProcessing = false;
    processor.disconnect();
    source.disconnect();
    await audioContext.close();
  }
};

export const startTranscribeStreaming = async (
  mediaStream: MediaStream,
  onTranscriptionResult: (text: string, isFinal: boolean) => void,
  onStop: () => boolean,
  sampleRate: number = 16000
) => {
  try {
    const client = await createTranscribeStreamingClient();
    const audioStream = createAudioStream(mediaStream, onStop, sampleRate);

    const command = new StartStreamTranscriptionCommand({
      LanguageCode: "ja-JP",
      MediaEncoding: "pcm",
      MediaSampleRateHertz: sampleRate,
      AudioStream: audioStream,
    });

    const response = await client.send(command);

    if (response.TranscriptResultStream) {
      let eventCount = 0;

      for await (const event of response.TranscriptResultStream) {
        eventCount++;

        if (event.TranscriptEvent && event.TranscriptEvent.Transcript) {
          const results = event.TranscriptEvent.Transcript.Results;
          if (results && results.length > 0) {
            const result = results[0];
            const transcript = result.Alternatives?.[0]?.Transcript || "";
            const isFinal = !result.IsPartial;

            if (transcript) {
              onTranscriptionResult(transcript, isFinal);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("❌ Transcribe Streamingエラー:", error);
    throw error;
  }
};
