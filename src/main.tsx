import { Amplify } from "aws-amplify";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@aws-amplify/ui-react/styles.css"; //追記
import outputs from "../amplify_outputs.json"; //追記

Amplify.configure(outputs); //追記

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
