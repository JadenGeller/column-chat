import { useColumnar } from "./hooks/useColumnar.js";
import { Chat } from "./components/Chat.js";
import { Sidebar } from "./components/Sidebar.js";

export function App() {
  const state = useColumnar();

  return (
    <div className="app">
      <div className="chat-area">
        <Chat state={state} />
      </div>
      <Sidebar state={state} />
    </div>
  );
}
