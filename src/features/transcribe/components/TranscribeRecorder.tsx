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
} from "@mui/material";
import { Mic, MicOff, Clear } from "@mui/icons-material";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useRef, useEffect } from "react";

export const TranscribeRecorder = () => {
  const {
    state,
    transcriptions,
    currentTranscript,
    startRecording,
    stopRecording,
    clearTranscriptions,
  } = useAudioRecorder();

  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcriptions]);

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
            transcription results
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
        <Box
          sx={{
            mb: 2,
            backgroundColor: "#fff",
            borderRadius: 1,
            border: "1px dashed #e0e0e0",
            minHeight: "56px",
          }}
        >
          <Typography
            variant="body1"
            sx={{
              wordBreak: "break-word",
              color: "primary.main",
              m: 1,
            }}
          >
            {currentTranscript ||
              (state.isRecording ? "listening..." : "ready to record")}
          </Typography>
        </Box>

        {transcriptions.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 4 }}
          >
            start recording to transcribe-stream
          </Typography>
        ) : (
          <List sx={{ maxHeight: 500, overflow: "auto" }}>
            {transcriptions.map((transcription) => (
              <ListItem
                key={transcription.timestamp}
                alignItems="flex-start"
                sx={{ px: 0 }}
              >
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
            ))}
            <div ref={listEndRef} />
          </List>
        )}
      </Box>
    </Box>
  );
};
