import { useColumnar } from "./hooks/useColumnar.js";
import { Chat } from "./components/Chat.js";
import { Sidebar } from "./components/Sidebar.js";

export function App() {
  const state = useColumnar();

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
