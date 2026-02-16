import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "../styles/app.css";

const path = window.location.pathname;
let chatId: string;
if (path.match(/^\/chat\/([a-zA-Z0-9_-]+)$/)) {
  chatId = path.split("/")[2];
} else {
  chatId = crypto.randomUUID();
  window.history.replaceState(null, "", `/chat/${chatId}`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App chatId={chatId} />
  </StrictMode>
);
