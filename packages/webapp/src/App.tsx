import { useColumnar } from "./hooks/useColumnar.js";
import { Chat } from "./components/Chat.js";
import { Sidebar } from "./components/Sidebar.js";
import { ApiKeyOverlay } from "./components/ApiKeyOverlay.js";

interface AppProps {
  chatId: string;
}

export function App({ chatId }: AppProps) {
  const state = useColumnar(chatId);

  // Show API key overlay in local mode when no key is set
  if (state.mode === "local" && !state.apiKey) {
    return <ApiKeyOverlay onSubmit={state.setApiKey} />;
  }

  return (
    <div className="app">
      <span className="vertical-label">Analysis</span>
      <span className="registration-mark top-center">+</span>
      <span className="registration-mark bottom-center">+</span>
      <div className="chat-area">
        <Chat state={state} />
      </div>
      <Sidebar state={state} />
    </div>
  );
}
