import { useEffect, useRef, useState } from "react";

const initialMessages = [
  { id: "boot", type: "system", text: "Frontend ready. Connect to start sending websocket messages." },
];

function createSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export default function App() {
  const [health, setHealth] = useState("checking");
  const [status, setStatus] = useState("disconnected");
  const [draft, setDraft] = useState("ping from React");
  const [messages, setMessages] = useState(initialMessages);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`health request failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setHealth(data.status ?? "unknown");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth("offline");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function appendMessage(type, text) {
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-${current.length}`, type, text },
    ]);
  }

  function connect() {
    if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
      return;
    }

    const socket = new WebSocket(createSocketUrl());
    socketRef.current = socket;
    setStatus("connecting");

    socket.onopen = () => {
      setStatus("connected");
      appendMessage("system", "WebSocket connected.");
    };

    socket.onmessage = (event) => {
      appendMessage("incoming", event.data);
    };

    socket.onerror = () => {
      appendMessage("system", "WebSocket error.");
    };

    socket.onclose = () => {
      setStatus("disconnected");
      appendMessage("system", "WebSocket closed.");
      socketRef.current = null;
    };
  }

  function disconnect() {
    socketRef.current?.close();
  }

  function sendMessage(event) {
    event.preventDefault();

    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN || !draft.trim()) {
      return;
    }

    socketRef.current.send(draft);
    appendMessage("outgoing", draft);
    setDraft("");
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">React + Go template</p>
        <h1>Buoy control surface</h1>
        <p className="lede">
          A starter frontend for the Go websocket server. Use it as the base for telemetry,
          camera feeds, operator controls, and device diagnostics.
        </p>
      </section>

      <section className="status-grid">
        <article className="panel">
          <span className="label">HTTP health</span>
          <strong>{health}</strong>
        </article>
        <article className="panel">
          <span className="label">WebSocket</span>
          <strong>{status}</strong>
        </article>
      </section>

      <section className="workspace">
        <article className="panel console">
          <div className="console-header">
            <h2>Connection</h2>
            <div className="actions">
              <button type="button" onClick={connect} disabled={status !== "disconnected"}>
                Connect
              </button>
              <button type="button" className="ghost" onClick={disconnect} disabled={status === "disconnected"}>
                Disconnect
              </button>
            </div>
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Enter a websocket message"
            />
            <button type="submit" disabled={status !== "connected"}>
              Send
            </button>
          </form>

          <div className="log">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                {message.text}
              </div>
            ))}
          </div>
        </article>

        <article className="panel notes">
          <h2>Project layout</h2>
          <ul>
            <li>`frontend/` contains the React app and Vite config.</li>
            <li>`/health` and `/ws` stay on the Go server.</li>
            <li>Production traffic can be served from one binary plus `frontend/dist`.</li>
          </ul>
        </article>
      </section>
    </main>
  );
}
