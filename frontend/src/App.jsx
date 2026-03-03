import { useEffect, useRef, useState } from "react";

function createSocketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function createSocketHostLabel() {
  return `${window.location.hostname}:${window.location.port || "80"}`;
}

function parseIncoming(raw) {
  try {
    const data = JSON.parse(raw);
    return typeof data === "object" && data ? data : null;
  } catch {
    return null;
  }
}

function buildBuoyState(current, payload, rawText) {
  const buoyId = payload.buoyId || payload.id || "unknown-boey";
  const existing = current[buoyId] || {
    id: buoyId,
    imageUrl: "",
    status: "online",
    gps: "waiting",
    compass: "waiting",
  };

  const telemetry = payload.telemetry && typeof payload.telemetry === "object" ? payload.telemetry : {};
  const nextGps = payload.gps || telemetry.gps || existing.gps;
  const nextCompass = payload.compass || telemetry.compass || existing.compass;
  const nextImageUrl = payload.imageBase64
    ? `data:image/jpeg;base64,${payload.imageBase64}`
    : payload.imageUrl || existing.imageUrl;

  return {
    ...current,
    [buoyId]: {
      ...existing,
      imageUrl: nextImageUrl,
      gps: nextGps,
      compass: nextCompass,
      status: payload.status || payload.message || rawText || existing.status,
    },
  };
}

function formatLogEntry(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "";

  if (entry.event === "message") {
    return `[MSG] ${entry.clientId || "unknown"} @ ${time}: ${entry.message || ""}`;
  }

  if (entry.event === "connected") {
    return `[+] ${entry.clientId || "unknown"} @ ${time}: ${entry.message || "client connected"}`;
  }

  if (entry.event === "disconnected") {
    return `[-] ${entry.clientId || "unknown"} @ ${time}: ${entry.message || "client disconnected"}`;
  }

  if (entry.event === "read_error") {
    return `[ERR] ${entry.clientId || "unknown"} @ ${time}: ${entry.message || "read error"}`;
  }

  const parts = [`[${entry.timestamp}]`, entry.level, entry.event];

  if (entry.clientId) {
    parts.push(`client=${entry.clientId}`);
  }

  if (entry.message) {
    parts.push(entry.message);
  }

  return parts.join(" | ");
}

export default function App() {
  const [menu, setMenu] = useState("dashboard");
  const [health, setHealth] = useState("offline");
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [boeys, setBoeys] = useState({});
  const [logs, setLogs] = useState([]);
  const socketRef = useRef(null);
  const socketHost = createSocketHostLabel();

  const connectedBoeys = Object.values(boeys).sort((left, right) => left.id.localeCompare(right.id));

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
          setHealth(data.status === "ok" ? "online" : "offline");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth("offline");
        }
      });

    fetch("/logs")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`logs request failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          const nextLogs = Array.isArray(data.logs) ? data.logs : [];
          setLogs(nextLogs);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLogs([]);
        }
      });

    const socket = new WebSocket(createSocketUrl());
    socketRef.current = socket;
    setSocketStatus("disconnected");

    socket.onopen = () => {
      setSocketStatus("connected");
    };

    socket.onmessage = (event) => {
      const rawText = String(event.data);
      const payload = parseIncoming(rawText);

      if (payload?.type === "server_log" && payload.entry) {
        setLogs((current) => [payload.entry, ...current].slice(0, 500));
      }

      if (payload && (payload.buoyId || payload.id)) {
        setBoeys((current) => buildBuoyState(current, payload, rawText));
      }
    };

    socket.onerror = () => {
      setSocketStatus("error");
    };

    socket.onclose = () => {
      setSocketStatus("disconnected");
      socketRef.current = null;
    };

    return () => {
      cancelled = true;
      socket.close();
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-status">
          <span className="status-badge">Server: {health}</span>
          <span className="status-badge">Realtime: {socketStatus === "connected" ? "connected" : "disconnected"}</span>
          <span className="status-badge">WS_HOST: {socketHost}</span>
        </div>
        <nav className="menu-bar">
          <button
            type="button"
            className={menu === "dashboard" ? "nav-link active" : "nav-link"}
            onClick={() => setMenu("dashboard")}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={menu === "logs" ? "nav-link active" : "nav-link"}
            onClick={() => setMenu("logs")}
          >
            Logs
          </button>
        </nav>
      </header>

      {menu === "dashboard" && <DashboardView boeys={connectedBoeys} />}
      {menu === "logs" && <LogsView logs={logs} />}
    </main>
  );
}

function DashboardView({ boeys }) {
  return (
    <section className="page">
      {boeys.length === 0 ? (
        <article className="panel empty-panel">[NO BOEYS CONNECTED]</article>
      ) : (
        <div className="dashboard-grid">
          {boeys.map((boey) => (
            <article key={boey.id} className="panel dashboard-card">
              <div className="dashboard-card-header">
                <strong>{boey.id}</strong>
                <span>{boey.status}</span>
              </div>

              <div className="video-feed small">
                {boey.imageUrl ? (
                  <img src={boey.imageUrl} alt={`${boey.id} video feed`} />
                ) : (
                  <div className="video-off">[VIDEO OFF]</div>
                )}
              </div>

              <div className="mini-status">
                <div className="mini-field">
                  <span>GPS</span>
                  <strong>{String(boey.gps)}</strong>
                </div>
                <div className="mini-field">
                  <span>Compass</span>
                  <strong>{String(boey.compass)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LogsView({ logs }) {
  return (
    <section className="page">
      <article className="panel logs-panel">
        {logs.length === 0 ? (
          <div className="logs-empty">[NO LOGS]</div>
        ) : (
          <div className="logs-list">
            {logs.map((entry) => (
              <pre key={entry.id} className="log-entry">
                {formatLogEntry(entry)}
              </pre>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
