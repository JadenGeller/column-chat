import { useRef, useState } from "react";
import { useColumnar } from "./hooks/useColumnar.js";
import { Chat } from "./components/Chat.js";
import { ConfigEditor } from "./components/ConfigEditor.js";
import { ApiKeyOverlay } from "./components/ApiKeyOverlay.js";

interface AppProps {
  chatId: string;
  initialConfig?: import("../shared/types.js").SessionConfig;
}

export function App({ chatId, initialConfig }: AppProps) {
  const state = useColumnar(chatId, initialConfig);
  const scrollLeftRef = useRef(0);
  const [showApiKeyOverlay, setShowApiKeyOverlay] = useState(false);

  // Show API key overlay in local mode when no key is set, or on demand
  if (state.mode === "local" && (!state.apiKey || showApiKeyOverlay)) {
    return <ApiKeyOverlay onSubmit={(key) => {
      state.setApiKey(key);
      setShowApiKeyOverlay(false);
    }} />;
  }

  return (
    <div className="app">
      <span className="vertical-label">{state.editing ? "Configure" : "Chat"}</span>
      {!state.editing && <>
        <span className="registration-mark top-center">+</span>
        <span className="registration-mark bottom-center">+</span>
      </>}
      {state.editing ? (
        <ConfigEditor state={state} scrollLeftRef={scrollLeftRef} />
      ) : (
        <div className="chat-area">
          <Chat state={state} scrollLeftRef={scrollLeftRef} onChangeApiKey={() => setShowApiKeyOverlay(true)} />
        </div>
      )}
    </div>
  );
}
