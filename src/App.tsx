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
                  TRANSCRIBE APP
                </Typography>
                <Button color="inherit" onClick={signOut} sx={{ color: "#000000" }}>
                  SIGN OUT
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
