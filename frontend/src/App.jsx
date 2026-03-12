import { useEffect, useRef, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

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

function parseGpsCoordinates(value) {
  const parsed = parseGpsData(value);
  if (!parsed || parsed.latitude == null || parsed.longitude == null) {
    return null;
  }

  return [parsed.latitude, parsed.longitude];
}

function parseGpsData(value) {
  if (typeof value !== "string") {
    return null;
  }

  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2 && parts.length !== 3) {
    return null;
  }

  const hasSats = parts.length === 3;
  const satsText = hasSats ? parts[0] : "";
  const latText = hasSats ? parts[1] : parts[0];
  const lonText = hasSats ? parts[2] : parts[1];

  const satellites = hasSats ? Number.parseInt(satsText || "", 10) : null;
  const latitude = Number.parseFloat(latText || "");
  const longitude = Number.parseFloat(lonText || "");

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    satellites: Number.isFinite(satellites) ? satellites : null,
    latitude,
    longitude,
  };
}

function readTelemetryValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return undefined;
}

function parseSatelliteValue(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDirectionDegrees(value) {
  const degrees = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(degrees)) {
    return 0;
  }

  return ((degrees % 360) + 360) % 360;
}

function createBuoyIcon(name, direction) {
  return divIcon({
    className: "buoy-marker-shell",
    html: `
      <div class="buoy-marker" style="--direction:${direction}deg">
        <div class="buoy-dot">
          <div class="buoy-arrow"></div>
        </div>
        <div class="buoy-label">${name}</div>
      </div>
    `,
    iconSize: [140, 64],
    iconAnchor: [19, 51],
    popupAnchor: [0, -51],
  });
}

function FitMapToBuoys({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length === 0) {
      return;
    }

    if (positions.length === 1) {
      map.setView(positions[0], 16, { animate: true });
      return;
    }

    map.fitBounds(positions, {
      padding: [20, 20],
      maxZoom: 18,
      animate: true,
    });
  }, [map, positions]);

  return null;
}

function mergeBuoySources(dbBuoys, liveBuoys) {
  const merged = new Map();

  for (const buoy of dbBuoys) {
    const buoyId = buoy.buoyId || buoy.id;
    if (!buoyId) {
      continue;
    }

    merged.set(buoyId, {
      ...buoy,
      id: buoy.id || buoyId,
      buoyId,
    });
  }

  for (const buoy of liveBuoys) {
    const buoyId = buoy.buoyId || buoy.id;
    if (!buoyId) {
      continue;
    }

    merged.set(buoyId, {
      ...(merged.get(buoyId) || {}),
      ...buoy,
      id: buoy.id || buoyId,
      buoyId,
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function buildBuoyState(current, payload, rawText) {
  const buoyId = payload.buoyId || payload.id || "unknown-boey";
  const existing = current[buoyId] || {
    id: buoyId,
    imageUrl: "",
    status: "online",
    gps: "waiting",
    sats: "waiting",
    compass: "waiting",
  };

  const telemetry = payload.telemetry && typeof payload.telemetry === "object" ? payload.telemetry : {};
  const nextGps = readTelemetryValue(payload.gps, telemetry.gps, existing.gps) ?? "waiting";
  const nextSats = readTelemetryValue(payload.sats, telemetry.sats, existing.sats) ?? "waiting";
  const nextCompass = readTelemetryValue(payload.compass, telemetry.compass, existing.compass) ?? "waiting";
  const nextImageUrl = payload.imageBase64
    ? `data:image/jpeg;base64,${payload.imageBase64}`
    : resolveImageUrl(payload.imageUrl) || existing.imageUrl;

  return {
    ...current,
    [buoyId]: {
      ...existing,
      imageUrl: nextImageUrl,
      gps: nextGps,
      sats: nextSats,
      compass: nextCompass,
      status: payload.status || payload.message || rawText || existing.status,
    },
  };
}

function extractTelemetryDetails(entry) {
  const payload = parseIncoming(entry.message || "");
  if (payload) {
    const buoyId = payload.buoyId || payload.buoy_id || entry.clientId || "unknown";
    let satellites = parseSatelliteValue(readTelemetryValue(payload.sats, payload.telemetry?.sats));
    let latitude = null;
    let longitude = null;

    if (typeof payload.gps === "string") {
      const parsedGps = parseGpsData(payload.gps);
      if (parsedGps) {
        if (satellites == null) {
          satellites = parsedGps.satellites;
        }
        latitude = String(parsedGps.latitude);
        longitude = String(parsedGps.longitude);
      }
    } else if (payload.lat != null || payload.lon != null) {
      latitude = String(payload.lat ?? "");
      longitude = String(payload.lon ?? "");
    }

    const compass = payload.compass ?? "waiting";

    if (!latitude && !longitude && satellites == null && payload.gps == null && payload.lat == null && payload.lon == null && payload.compass == null) {
      return null;
    }

    return {
      buoyId,
      satellites,
      latitude: latitude || "waiting",
      longitude: longitude || "waiting",
      compass: String(compass),
    };
  }

  const compactMessage = String(entry.message || "").trim();
  const satsMatch = compactMessage.match(/sats\s*=\s*(\d+)/i);
  const gpsMatch = compactMessage.match(/gps\s*=\s*([^\s;]+)/i);
  const compassMatch = compactMessage.match(/compass\s*=\s*([^\s;]+)/i);
  if (!satsMatch && !gpsMatch && !compassMatch) {
    return null;
  }

  let latitude = "waiting";
  let longitude = "waiting";
  let satellites = null;
  let compass = "waiting";

  if (satsMatch) {
    const parsedSats = Number.parseInt(satsMatch[1], 10);
    satellites = Number.isFinite(parsedSats) ? parsedSats : null;
  }

  if (gpsMatch) {
    const parsedGps = parseGpsData(gpsMatch[1]);
    if (parsedGps) {
      latitude = String(parsedGps.latitude);
      longitude = String(parsedGps.longitude);
      if (satellites == null) {
        satellites = parsedGps.satellites;
      }
    }
  }

  if (compassMatch) {
    compass = compassMatch[1];
  }

  return {
    buoyId: entry.clientId || "unknown",
    satellites,
    latitude,
    longitude,
    compass,
  };
}

function formatCompassDisplay(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "waiting") {
    return "waiting";
  }

  return `${normalized}°`;
}

function formatLogEntry(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "";

  if (entry.event === "message") {
    const telemetry = extractTelemetryDetails(entry);
    if (telemetry) {
      const satsDisplay = telemetry.satellites == null ? "waiting" : String(telemetry.satellites);
      return `Time: ${time || "--:--:--"}; ID: ${telemetry.buoyId}; Sats: ${satsDisplay}; Lat: ${telemetry.latitude} Lon: ${telemetry.longitude}; Compass: ${formatCompassDisplay(telemetry.compass)}`;
    }

    return `Time: ${time || "--:--:--"}; ID: ${entry.clientId || "unknown"}; Message: ${entry.message || ""}`;
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
  const time = typeof buoy.time === "string" && buoy.time.trim() ? buoy.time.trim() : "--:--:--";
  const status = String(buoy.status || "").toLowerCase() === "online" ? "Online" : "Offline";
  return `Time: ${time}; ID: ${buoy.buoyId || buoy.id || "unknown"}; Status: ${status}`;
}

function renderLogEntry(entry) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--";

  if (entry.event === "image") {
    const imageUrl = resolveImageUrl(entry.message || "");
    return (
      <>
        {`Time: ${time}; ID: ${entry.clientId || "unknown"}; `}
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noreferrer">
            Image received
          </a>
        ) : (
          "Image received"
        )}
      </>
    );
  }

  return formatLogEntry(entry);
}

export default function App() {
  const [menu, setMenu] = useState("dashboard");
  const [health, setHealth] = useState("offline");
  const [socketStatus, setSocketStatus] = useState("disconnected");
  const [boeys, setBoeys] = useState({});
  const [logs, setLogs] = useState([]);
  const [dbBuoys, setDbBuoys] = useState([]);
  const [dbStatus, setDbStatus] = useState("unavailable");
  const socketRef = useRef(null);
  const socketHost = createSocketHostLabel();

  const connectedBoeys = Object.values(boeys).sort((left, right) => left.id.localeCompare(right.id));
  const allBoeys = mergeBuoySources(dbBuoys, connectedBoeys);

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
            className={menu === "map" ? "nav-link active" : "nav-link"}
            onClick={() => setMenu("map")}
          >
            Map
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
      {menu === "logs" && <LogsView dbBuoys={dbBuoys} dbStatus={dbStatus} logs={logs} />}
      {menu === "map" && <MapView boeys={allBoeys} />}
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
                  <span>Sat</span>
                  <strong>{parseSatelliteValue(boey.sats) ?? parseGpsData(boey.gps)?.satellites ?? "waiting"}</strong>
                </div>
                <div className="mini-field">
                  <span>GPS</span>
                  <strong>{String(boey.gps)}</strong>
                </div>
                <div className="mini-field">
                  <span>Compass</span>
                  <strong>{formatCompassDisplay(boey.compass)}</strong>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LogsView({ dbBuoys, dbStatus, logs }) {
  return (
    <section className="page">
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
                {renderLogEntry(entry)}
              </pre>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

function MapView({ boeys }) {
  const mappedBoeys = boeys
    .map((buoy) => {
      const coordinates = parseGpsCoordinates(buoy.gps);
      if (!coordinates) {
        return null;
      }

      return {
        ...buoy,
        coordinates,
        direction: parseDirectionDegrees(buoy.compass),
      };
    })
    .filter(Boolean);

  const center = mappedBoeys.length > 0 ? mappedBoeys[0].coordinates : [54.6872, 25.2797];

  return (
    <section className="page">
      <article className="panel map-panel">
        <div className="logs-section-header">
          <strong>Buoy Map</strong>
          <span>{mappedBoeys.length} positioned</span>
        </div>
        {mappedBoeys.length === 0 ? (
          <div className="logs-empty">[NO GPS DATA]</div>
        ) : (
          <div className="map-frame">
            <MapContainer center={center} zoom={7} scrollWheelZoom className="map-canvas">
              <FitMapToBuoys positions={mappedBoeys.map((buoy) => buoy.coordinates)} />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {mappedBoeys.map((buoy) => (
                <Marker
                  key={buoy.buoyId || buoy.id}
                  position={buoy.coordinates}
                  icon={createBuoyIcon(buoy.buoyId || buoy.id, buoy.direction)}
                >
                  <Popup>
                    <strong>{buoy.buoyId || buoy.id}</strong>
                    <br />
                    {buoy.gps}
                    <br />
                    Direction: {buoy.direction}°
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
            <div className="map-overlay">
              {mappedBoeys.map((buoy) => (
                <div key={buoy.buoyId || buoy.id} className="map-chip">
                  <span className="map-chip-dot" />
                  <strong>{buoy.buoyId || buoy.id}</strong>
                  <span>{buoy.gps}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
