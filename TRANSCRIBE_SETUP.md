# AWS Amplify Gen2 + Amazon Transcribe リアルタイム音声文字起こしアプリ

## 概要

Amazon Transcribe Streaming APIを使用したリアルタイム音声文字起こし機能の実装手順とコード集です。

## 技術スタック

- **フロントエンド**: React + TypeScript + Vite
- **UI**: Material-UI (MUI)
- **バックエンド**: AWS Amplify Gen2
- **音声認識**: Amazon Transcribe Streaming
- **音声処理**: AudioWorklet API

## プロジェクト構成

```
transcribe-app/
├── amplify/
│   ├── auth/
│   │   └── resource.ts
│   ├── backend.ts
│   └── package.json
├── public/
│   └── audio-processor.js          # AudioWorklet音声処理
├── src/
│   ├── features/
│   │   └── transcribe/
│   │       ├── components/
│   │       │   └── TranscribeRecorder.tsx
│   │       ├── hooks/
│   │       │   └── useAudioRecorder.ts
│   │       ├── services/
│   │       │   └── transcribeService.ts
│   │       ├── types/
│   │       │   └── index.ts
│   │       └── index.ts
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

## セットアップ手順

### 1. Amplify プロジェクト作成

```bash
npm create amplify@latest transcribe-app
cd transcribe-app
```

### 2. 依存関係のインストール

```bash
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
npm install @aws-sdk/client-transcribe-streaming
```

### 3. Amplify バックエンド設定

#### `amplify/backend.ts`

```typescript
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import {
  Policy,
  PolicyDocument,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";

const backend = defineBackend({
  auth,
});

// ユーザープールのパスワードポリシーを設定
const { cfnUserPool } = backend.auth.resources.cfnResources;
if (cfnUserPool) {
  cfnUserPool.usernameAttributes = [];
  cfnUserPool.policies = {
    passwordPolicy: {
      minimumLength: 6,
      requireLowercase: false,
      requireNumbers: false,
      requireSymbols: false,
      requireUppercase: false,
      temporaryPasswordValidityDays: 30,
    },
  };
}

// AWS Transcribe Streamingへのアクセス権限を追加
backend.auth.resources.authenticatedUserIamRole.attachInlinePolicy(
  new Policy(
    backend.auth.resources.authenticatedUserIamRole.stack,
    "TranscribeStreamingPolicy",
    {
      document: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
              "transcribe:StartStreamTranscription",
              "transcribe:StartStreamTranscriptionWebSocket",
            ],
            resources: ["*"],
          }),
        ],
      }),
    }
  )
);
```

### 4. 音声処理ワーカー

#### `public/audio-processor.js`

```javascript
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 512;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const inputChannel = input[0];

      for (let i = 0; i < inputChannel.length; i++) {
        this.buffer[this.bufferIndex] = inputChannel[i];
        this.bufferIndex++;

        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage({
            type: "audiodata",
            buffer: Array.from(this.buffer),
          });
          this.bufferIndex = 0;
        }
      }
    }

    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
```

### 5. 型定義

#### `src/features/transcribe/types/index.ts`

```typescript
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
```

### 6. Transcribe ストリーミングサービス

#### `src/features/transcribe/services/transcribeService.ts`

```typescript
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
```

### 7. 音声録音フック

#### `src/features/transcribe/hooks/useAudioRecorder.ts`

```typescript
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
        } catch (error) {}
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
```

### 8. UIコンポーネント

#### `src/features/transcribe/components/TranscribeRecorder.tsx`

```typescript
import {
  Box,
  Button,
  Typography,
  IconButton,
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
} from "@mui/material";
import { Mic, MicOff, Clear } from "@mui/icons-material";
import { useAudioRecorder } from "../hooks/useAudioRecorder";

export const TranscribeRecorder = () => {
  const {
    state,
    transcriptions,
    currentTranscript,
    startRecording,
    stopRecording,
    clearTranscriptions,
  } = useAudioRecorder();

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString("ja-JP");
  };

  return (
    <Box sx={{ maxWidth: 800, mx: "auto", p: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "center", mb: 3 }}>
        {!state.isRecording ? (
          <Button
            variant="text"
            color="primary"
            size="large"
            startIcon={<Mic />}
            onClick={startRecording}
            disabled={state.isProcessing}
            sx={{ minWidth: 150 }}
          >
            start recording
          </Button>
        ) : (
          <Button
            variant="text"
            color="error"
            size="large"
            startIcon={<MicOff />}
            onClick={stopRecording}
            sx={{ minWidth: 150 }}
          >
            stop recording
          </Button>
        )}
      </Box>

      {state.isProcessing && (
        <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
          <CircularProgress size={24} />
          <Typography variant="body2" sx={{ ml: 1 }}>
            transcribing...
          </Typography>
        </Box>
      )}

      {state.error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {state.error}
        </Alert>
      )}

      <Box sx={{ p: 2 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 2,
          }}
        >
          <Typography variant="h6" component="h3">
            result
          </Typography>
          {transcriptions.length > 0 && (
            <IconButton
              onClick={clearTranscriptions}
              size="small"
              title="clear"
            >
              <Clear />
            </IconButton>
          )}
        </Box>

        {/* リアルタイム暫定結果 */}
        {currentTranscript && (
          <Box
            sx={{
              mb: 2,
              p: 2,
              backgroundColor: "#f0f8ff",
              borderRadius: 1,
              border: "1px dashed #2196f3",
            }}
          >
            <Typography
              variant="caption"
              color="primary"
              sx={{ fontSize: "0.75rem", fontWeight: "bold" }}
            >
              transcribing...
            </Typography>
            <Typography
              variant="body1"
              sx={{
                wordBreak: "break-word",
                fontStyle: "italic",
                color: "primary.main",
                mt: 0.5,
              }}
            >
              {currentTranscript}
            </Typography>
          </Box>
        )}

        {transcriptions.length === 0 && !currentTranscript ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 4 }}
          >
            start recording to see real-time transcription
          </Typography>
        ) : (
          <List sx={{ maxHeight: 400, overflow: "auto" }}>
            {transcriptions.map((transcription, index) => (
              <Box key={transcription.timestamp}>
                <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                  <ListItemText
                    primary={transcription.transcript}
                    secondary={formatTimestamp(transcription.timestamp)}
                    primaryTypographyProps={{
                      variant: "body1",
                      sx: { wordBreak: "break-word" },
                    }}
                    secondaryTypographyProps={{
                      variant: "caption",
                      color: "text.secondary",
                    }}
                  />
                </ListItem>
                {index < transcriptions.length - 1 && <Divider />}
              </Box>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};
```

### 9. エクスポート設定

#### `src/features/transcribe/index.ts`

```typescript
export { TranscribeRecorder } from "./components/TranscribeRecorder";
export { useAudioRecorder } from "./hooks/useAudioRecorder";
export { startTranscribeStreaming } from "./services/transcribeService";
export * from "./types";
```

### 10. メインアプリケーション

#### `src/App.tsx`

```typescript
import { Authenticator } from "@aws-amplify/ui-react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import {
  CssBaseline,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Container,
} from "@mui/material";
import { TranscribeRecorder } from "./features/transcribe";

const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1976d2",
    },
  },
});

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Authenticator>
        {({ signOut }) => (
          <>
            <AppBar position="static" sx={{ backgroundColor: "#ffffff", boxShadow: "none" }}>
              <Toolbar>
                <Typography
                  variant="h6"
                  component="div"
                  sx={{ flexGrow: 1, color: "#000000" }}
                >
                  transcribe app
                </Typography>
                <Button color="inherit" onClick={signOut} sx={{ color: "#000000" }}>
                  sign out
                </Button>
              </Toolbar>
            </AppBar>

            <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
              <TranscribeRecorder />
            </Container>
          </>
        )}
      </Authenticator>
    </ThemeProvider>
  );
}

export default App;
```

#### `src/main.tsx`

```typescript
import { Amplify } from "aws-amplify";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../amplify_outputs.json";

Amplify.configure(outputs);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### 11. パッケージ設定

#### `package.json` (依存関係部分)

```json
{
  "dependencies": {
    "@aws-amplify/ui-react": "^6.12.0",
    "@aws-sdk/client-transcribe-streaming": "^3.x.x",
    "@emotion/react": "^11.14.0",
    "@emotion/styled": "^11.14.1",
    "@mui/icons-material": "^7.3.1",
    "@mui/material": "^7.3.1",
    "aws-amplify": "^6.15.5",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  }
}
```

## 実行手順

### 1. 開発環境の起動（ユーザーが実行）

```bash
npx ampx sandbox
```

### 2. ブラウザでアクセス

```
http://localhost:5173
```

### 3. 認証とテスト

1. サインアップ/サインイン
2. マイクアクセスを許可
3. 「start recording」ボタンをクリック
4. 話す → リアルタイムで文字起こし表示
5. 「stop recording」で停止

## トラブルシューティング

### マイクアクセスエラー

- HTTPSまたはlocalhostでのみ動作
- ブラウザのマイク権限を確認

### Transcribeエラー

- IAM権限が正しく設定されているか確認
- 認証が完了しているか確認

### AudioWorkletエラー

- `/audio-processor.js`ファイルが`public/`にあるか確認
- HTTPS接続が必要な場合がある

## 主要機能

- ✅ リアルタイム音声文字起こし
- ✅ 暫定結果と確定結果の区別表示
- ✅ 文字起こし履歴の保存
- ✅ エラーハンドリング
- ✅ レスポンシブUI
- ✅ AWS認証統合

## 音声設定

- **サンプリングレート**: 16kHz
- **音声形式**: PCM
- **言語**: 日本語 (ja-JP)
- **チャンネル**: モノラル

## 🚨 重要：なぜ最初の実装は失敗したのか

### ❌ 失敗パターン1: 複雑なクラス設計

**やってしまったこと：**

```typescript
export class RealTimeTranscriber {
  private audioQueue: Uint8Array[] = [];
  private isStreaming = false;
  // 複雑なキューイング処理
  // 複雑な送信制御
  // 複雑なエラーハンドリング
}
```

**問題点：**

- 過度に複雑な設計
- デバッグが困難
- 無限ループが発生
- メモリリークの可能性

**教訓：** シンプルイズベスト。関数ベースで十分

---

### ❌ 失敗パターン2: 音声フォーマットの誤解

**やってしまったこと：**

```typescript
// 録音
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: "audio/webm;codecs=opus", // WebM形式
});

// Transcribe送信
MediaEncoding: "ogg-opus"; // ❌ 不整合
```

**問題点：**

- WebM ≠ OGG形式
- Amazon Transcribeが認識できない
- 空の結果しか返らない

**正解：**

```typescript
// AudioWorkletでPCM形式に変換
MediaEncoding: "pcm"; // ✅ 確実に動作
```

**教訓：** 音声フォーマットの統一が重要

---

### ❌ 失敗パターン3: ScriptProcessorNode使用

**やってしまったこと：**

```typescript
// 廃止予定のAPI使用
const processor = audioContext.createScriptProcessor(4096, 1, 1);
processor.onaudioprocess = (event) => {
  // 頻繁すぎる処理でパフォーマンス問題
  // 無限ループになりやすい
};
```

**問題点：**

- ScriptProcessorNodeは廃止予定
- メインスレッドをブロック
- 処理頻度が高すぎる
- 無限ループになりやすい

**正解：**

```typescript
// AudioWorklet使用
await audioContext.audioWorklet.addModule("/audio-processor.js");
const processor = new AudioWorkletNode(audioContext, "audio-processor");
```

**教訓：** 最新のWeb APIを使用する

---

### ❌ 失敗パターン4: ストリーミング API の誤用

**やってしまったこと：**

```typescript
// 録音完了後に一括送信
mediaRecorder.onstop = async () => {
  const audioBlob = new Blob(audioChunks);
  // ❌ ストリーミングAPIに大きなファイルを一括送信
  yield { AudioEvent: { AudioChunk: entireAudioFile } };
}
```

**問題点：**

- ストリーミングAPIなのに一括送信
- リアルタイム性がない
- Transcribeが正常に動作しない

**正解：**

```typescript
// 継続的な小さなチャンク送信
while (!onStop()) {
  if (audioQueue.length > 0) {
    const chunk = audioQueue.shift();
    yield { AudioEvent: { AudioChunk: chunk } };
  }
  await new Promise(resolve => setTimeout(resolve, 10));
}
```

**教訓：** ストリーミングAPIは継続的な送信が必要

---

### ❌ 失敗パターン5: サンプリングレートの不一致

**やってしまったこと：**

```typescript
// 録音設定
sampleRate: 48000; // 48kHz

// Transcribe設定
MediaSampleRateHertz: 16000; // ❌ 16kHz（不一致）
```

**問題点：**

- サンプリングレートの不一致
- 音声データが正しく処理されない
- 認識精度が低下

**正解：**

```typescript
// 統一する
sampleRate: 16000;
MediaSampleRateHertz: 16000;
```

**教訓：** 音声パイプライン全体で設定を統一

---

## ✅ 成功のポイント

### 1. シンプルな関数ベース設計

- クラスではなく関数で実装
- 責任を明確に分離
- デバッグしやすい構造

### 2. 適切な音声フォーマット

- AudioWorkletでPCM変換
- 16kHzで統一
- Amazon Transcribe標準に準拠

### 3. 真のストリーミング処理

- 継続的な小さなチャンク送信
- リアルタイム応答
- 適切な間隔制御

### 4. 最新Web API使用

- AudioWorkletProcessor
- AsyncGenerator
- 非推奨APIを避ける

## 🚫 避けるべき設計パターン

1. **過度な抽象化**: シンプルが一番
2. **複雑なキューイング**: 基本的な送信で十分
3. **フォーマット変換**: 最初から適切な形式を選択
4. **メインスレッド処理**: WebWorker/AudioWorkletを使用
5. **一括処理思考**: ストリーミングは継続的処理

## 📋 設計時のチェックリスト

- [ ] 音声フォーマットは統一されているか？
- [ ] サンプリングレートは一致しているか？
- [ ] ストリーミングAPIを正しく使用しているか？
- [ ] AudioWorkletを使用しているか？
- [ ] 設計はシンプルか？

**最重要：** 複雑な実装より、動作する簡単な実装を選ぶ
