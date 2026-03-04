import { useEffect, useRef, useState } from "react";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function createHttpBaseUrl() {
  const configuredBase = import.meta.env.VITE_BACKEND_BASE_URL?.trim();
  return configuredBase ? trimTrailingSlash(configuredBase) : window.location.origin;
}

function createSocketUrl() {
  const configuredSocketBase = import.meta.env.VITE_WS_BASE_URL?.trim();

  if (configuredSocketBase) {
    return `${trimTrailingSlash(configuredSocketBase)}/ws?role=viewer`;
  }

  const backendBase = createHttpBaseUrl();
  const protocol = backendBase.startsWith("https://") ? "wss://" : "ws://";
  const host = backendBase.replace(/^https?:\/\//, "");
  return `${protocol}${host}/ws?role=viewer`;
}

function createSocketHostLabel() {
  const configuredSocketBase = import.meta.env.VITE_WS_BASE_URL?.trim();
  if (configuredSocketBase) {
    return trimTrailingSlash(configuredSocketBase);
  }

  return createHttpBaseUrl().replace(/^https?:\/\//, "");
}

function createApiUrl(path) {
  return `${createHttpBaseUrl()}${path}`;
}

function resolveImageUrl(imageUrl) {
  if (!imageUrl) {
    return "";
  }

  if (/^https?:\/\//i.test(imageUrl) || imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/")) {
    return `${createHttpBaseUrl()}${imageUrl}`;
  }

  return `${createHttpBaseUrl()}/${imageUrl}`;
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
    : resolveImageUrl(payload.imageUrl) || existing.imageUrl;

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

function formatBuoySnapshot(buoy) {
  const parts = [
    `[DB] ${buoy.buoyId || buoy.id || "unknown"}`,
    `status=${buoy.status || "unknown"}`,
    `gps=${String(buoy.gps ?? "waiting")}`,
    `compass=${String(buoy.compass ?? "waiting")}`,
  ];

  if (buoy.imageUrl) {
    parts.push("image=available");
  }

  return parts.join(" | ");
}

export default function App() {
  const [menu, setMenu] = useState("dashboard");
  const [health, setHealth] = useState("offline");
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [boeys, setBoeys] = useState({});
  const [logs, setLogs] = useState([]);
  const [dbBuoys, setDbBuoys] = useState([]);
  const [dbStatus, setDbStatus] = useState("unavailable");
  const [dbConfig, setDbConfig] = useState(() => ({
    host: window.localStorage.getItem("db_host") || "",
    port: window.localStorage.getItem("db_port") || "",
    user: window.localStorage.getItem("db_user") || "",
    password: window.localStorage.getItem("db_password") || "",
    name: window.localStorage.getItem("db_name") || "",
  }));
  const socketRef = useRef(null);
  const socketHost = createSocketHostLabel();

  const connectedBoeys = Object.values(boeys).sort((left, right) => left.id.localeCompare(right.id));

  useEffect(() => {
    let cancelled = false;

    fetch(createApiUrl("/health"))
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

    fetch(createApiUrl("/logs"))
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

    fetch(createApiUrl("/api/buoys"))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`buoys request failed: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setDbBuoys(Array.isArray(data.buoys) ? data.buoys : []);
          setDbStatus("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDbBuoys([]);
          setDbStatus("unavailable");
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
      {menu === "logs" && <LogsView dbBuoys={dbBuoys} dbConfig={dbConfig} dbStatus={dbStatus} logs={logs} onDbConfigChange={setDbConfig} />}
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

function LogsView({ dbBuoys, dbConfig, dbStatus, logs, onDbConfigChange }) {
  function updateField(field, value) {
    onDbConfigChange((current) => {
      const next = { ...current, [field]: value };
      window.localStorage.setItem(`db_${field}`, value);
      return next;
    });
  }

  return (
    <section className="page">
      <article className="panel logs-panel">
        <div className="logs-section-header">
          <strong>Database Settings</strong>
          <span>frontend only</span>
        </div>
        <p className="settings-note">
          Temporary frontend-only placeholders. This should be changed in the future to backend/server configuration.
        </p>
        <div className="settings-grid">
          <label className="settings-field">
            <span>Host</span>
            <input value={dbConfig.host} onChange={(event) => updateField("host", event.target.value)} />
          </label>
          <label className="settings-field">
            <span>Port</span>
            <input value={dbConfig.port} onChange={(event) => updateField("port", event.target.value)} />
          </label>
          <label className="settings-field">
            <span>User</span>
            <input value={dbConfig.user} onChange={(event) => updateField("user", event.target.value)} />
          </label>
          <label className="settings-field">
            <span>Password</span>
            <input
              type="password"
              value={dbConfig.password}
              onChange={(event) => updateField("password", event.target.value)}
            />
          </label>
          <label className="settings-field wide">
            <span>Database</span>
            <input value={dbConfig.name} onChange={(event) => updateField("name", event.target.value)} />
          </label>
        </div>
      </article>

      <article className="panel logs-panel">
        <div className="logs-section-header">
          <strong>Database Snapshot</strong>
          <span>{dbStatus}</span>
        </div>
        {dbBuoys.length === 0 ? (
          <div className="logs-empty small">[NO DB DATA]</div>
        ) : (
          <div className="logs-list compact">
            {dbBuoys.map((buoy) => (
              <pre key={buoy.buoyId || buoy.id} className="log-entry db-entry">
                {formatBuoySnapshot(buoy)}
              </pre>
            ))}
          </div>
        )}
      </article>

      <article className="panel logs-panel">
        <div className="logs-section-header">
          <strong>Server Logs</strong>
          <span>{logs.length} entries</span>
        </div>
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
