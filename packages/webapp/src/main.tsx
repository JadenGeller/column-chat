import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SessionConfig } from "../shared/types.js";
import { App } from "./App.js";
import "../styles/app.css";

// Capture hash before any replaceState calls clear it
const hash = window.location.hash;

const path = window.location.pathname;
let chatId: string;
if (path.match(/^\/chat\/([a-zA-Z0-9_-]+)$/)) {
  chatId = path.split("/")[2];
} else {
  chatId = crypto.randomUUID();
  window.history.replaceState(null, "", `/chat/${chatId}`);
}

// Decode shared config from URL hash fragment
let initialConfig: SessionConfig | undefined;
if (hash.startsWith("#config=")) {
  try {
    const { deserializeConfig } = await import("../shared/generate.js");
    initialConfig = deserializeConfig(hash.slice("#config=".length));
  } catch (e) {
    console.error("Failed to decode config from URL:", e);
  }
  // Clear hash so reloads don't re-apply
  window.history.replaceState(null, "", window.location.pathname);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App chatId={chatId} initialConfig={initialConfig} />
  </StrictMode>
);
