import { useRef } from "react";
import { useColumnar } from "./hooks/useColumnar.js";
import { Chat } from "./components/Chat.js";
import { ConfigEditor } from "./components/ConfigEditor.js";
import { ApiKeyOverlay } from "./components/ApiKeyOverlay.js";

interface AppProps {
  chatId: string;
}

export function App({ chatId }: AppProps) {
  const state = useColumnar(chatId);
  const scrollLeftRef = useRef(0);

  // Show API key overlay in local mode when no key is set
  if (state.mode === "local" && !state.apiKey) {
    return <ApiKeyOverlay onSubmit={state.setApiKey} />;
  }

  return (
    <div className="app">
      <span className="vertical-label">{state.editing ? "Configure" : "Chat"}</span>
      <span className="registration-mark top-center">+</span>
      <span className="registration-mark bottom-center">+</span>
      {state.editing ? (
        <ConfigEditor state={state} scrollLeftRef={scrollLeftRef} />
      ) : (
        <div className="chat-area">
          <Chat state={state} scrollLeftRef={scrollLeftRef} />
        </div>
      )}
    </div>
  );
}
