package server

import (
	"buoy-hub/internal/client"
	"buoy-hub/internal/db"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// GPSMessage is the legacy JSON structure sent by some buoy clients as a text frame.
type GPSMessage struct {
	BuoyID    string  `json:"buoy_id"`
	Latitude  float64 `json:"lat"`
	Longitude float64 `json:"lon"`
	Timestamp int64   `json:"time"`
}

type telemetryMessage struct {
	BuoyID   string `json:"buoyId"`
	Status   string `json:"status"`
	GPS      string `json:"gps"`
	Sats     string `json:"sats,omitempty"`
	Compass  string `json:"compass"`
	ImageURL string `json:"imageUrl,omitempty"`
}

// HandleConnection upgrades the HTTP request to a WebSocket and starts listening for messages.
func (s *Server) HandleConnection(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	role := clientRole(r)
	clientID := fmt.Sprintf("%s-%d", role, time.Now().UnixNano())
	c := client.New(clientID, role, ws)

	s.mu.Lock()
	s.clients[clientID] = c
	total := len(s.clients)
	s.mu.Unlock()

	log.Printf("[+] %s connected: %s (total: %d)", role, clientID, total)
	s.addLog("info", "connected", clientID, fmt.Sprintf("%s connected (total: %d)", role, total))

	if err := c.Write(websocket.TextMessage, []byte("Welcome! Your ID is: "+clientID)); err != nil {
		log.Printf("Welcome message failed for %s: %v", clientID, err)
	}

	defer s.disconnect(clientID, ws)

	s.readLoop(c)
}

// readLoop continuously reads messages from a connected websocket client.
func (s *Server) readLoop(c *client.Client) {
	for {
		msgType, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway) {
				log.Printf("Read error from %s: %v", c.ID, err)
				s.addLog("error", "read_error", c.ID, err.Error())
			}
			break
		}

		switch msgType {
		case websocket.TextMessage:
			s.handleTelemetry(c, message)
		case websocket.BinaryMessage:
			s.handleImage(c, message)
		}
	}
}

func (s *Server) handleTelemetry(c *client.Client, message []byte) {
	payload, state, reading, ok := parseTelemetryPayload(c.ID, message)
	if !ok {
		log.Printf("Failed to parse telemetry from %s: %s", c.ID, string(message))
		s.addLog("error", "parse_error", c.ID, string(message))
		return
	}

	satSource := payload.Sats
	if satSource == "" {
		satSource = payload.GPS
	}
	sats, hasSats := parseSatelliteCount(satSource)
	if hasSats {
		log.Printf("[MSG] %s @ %s sats=%d gps=%s compass=%s", c.ID, time.Now().Format("15:04:05"), sats, payload.GPS, payload.Compass)
		s.addLog("info", "message", c.ID, fmt.Sprintf("sats=%d gps=%s compass=%s", sats, payload.GPS, payload.Compass))
	} else {
		log.Printf("[MSG] %s @ %s: %s", c.ID, time.Now().Format("15:04:05"), string(message))
		s.addLog("info", "message", c.ID, string(message))
	}

	s.mu.Lock()
	existing := s.latest[payload.BuoyID]
	if existing.Snapshot.ImageURL != "" {
		state.Snapshot.ImageURL = existing.Snapshot.ImageURL
		reading.ImageURL = existing.Snapshot.ImageURL
	}
	s.latest[payload.BuoyID] = state
	s.links[c.ID] = payload.BuoyID
	s.mu.Unlock()

	if err := s.db.InsertReading(context.Background(), reading); err != nil {
		log.Printf("Failed to save telemetry for %s: %v", payload.BuoyID, err)
		s.addLog("error", "db_write_error", payload.BuoyID, err.Error())
	}

	s.broadcastSnapshot(state.Snapshot)
}

func (s *Server) handleImage(c *client.Client, message []byte) {
	buoyID, state := s.currentStateForClient(c.ID)
	if buoyID == "" {
		buoyID = c.ID
		state = buoyState{
			Snapshot: buoySnapshot{
				ID:      buoyID,
				BuoyID:  buoyID,
				Status:  "online",
				GPS:     "waiting",
				Compass: "waiting",
			},
		}
	}

	url, err := s.storage.UploadImage(context.Background(), buoyID, message)
	if err != nil {
		log.Printf("Failed to upload image from %s: %v", c.ID, err)
		s.addLog("error", "image_upload_error", buoyID, err.Error())
		return
	}

	state.Snapshot.ImageURL = url

	s.mu.Lock()
	s.latest[buoyID] = state
	s.mu.Unlock()

	if err := s.db.InsertReading(context.Background(), db.Reading{
		Time:      time.Now().UTC(),
		BuoyID:    buoyID,
		Latitude:  state.Latitude,
		Longitude: state.Longitude,
		ImageURL:  url,
	}); err != nil {
		log.Printf("Failed to save image reading for %s: %v", buoyID, err)
		s.addLog("error", "db_write_error", buoyID, err.Error())
	}

	log.Printf("[IMG] %s -> %s", buoyID, url)
	s.addLog("info", "image", buoyID, url)
	s.broadcastSnapshot(state.Snapshot)
}

func (s *Server) disconnect(clientID string, ws *websocket.Conn) {
	s.mu.Lock()
	delete(s.clients, clientID)
	delete(s.links, clientID)
	total := len(s.clients)
	s.mu.Unlock()

	_ = ws.Close()
	log.Printf("[-] Client disconnected: %s (total: %d)", clientID, total)
	s.addLog("info", "disconnected", clientID, fmt.Sprintf("client disconnected (total: %d)", total))
}

// HealthHandler returns a simple JSON health check.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}

func (s *Server) broadcastSnapshot(snapshot buoySnapshot) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	s.broadcastToRole("viewer", websocket.TextMessage, payload)
}

func (s *Server) broadcastToRole(role string, messageType int, payload []byte) {
	s.mu.RLock()
	clients := make([]*client.Client, 0, len(s.clients))
	for _, c := range s.clients {
		if c.Role == role {
			clients = append(clients, c)
		}
	}
	s.mu.RUnlock()

	for _, c := range clients {
		if err := c.Write(messageType, payload); err != nil {
			log.Printf("Broadcast error to %s: %v", c.ID, err)
		}
	}
}

func (s *Server) currentStateForClient(clientID string) (string, buoyState) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if buoyID, ok := s.links[clientID]; ok {
		if state, ok := s.latest[buoyID]; ok {
			return buoyID, state
		}
	}

	if state, ok := s.latest[clientID]; ok {
		return clientID, state
	}

	return "", buoyState{}
}

func clientRole(r *http.Request) string {
	if r.URL.Query().Get("role") == "viewer" {
		return "viewer"
	}
	return "buoy"
}

func parseTelemetryPayload(clientID string, message []byte) (telemetryMessage, buoyState, db.Reading, bool) {
	var live telemetryMessage
	if err := json.Unmarshal(message, &live); err == nil && (live.BuoyID != "" || live.GPS != "" || live.Sats != "" || live.Compass != "" || live.Status != "") {
		if live.BuoyID == "" {
			live.BuoyID = clientID
		}
		if live.Status == "" {
			live.Status = "online"
		}

		lat, lon := parseGPSString(live.GPS)
		state := buoyState{
			Snapshot: buoySnapshot{
				ID:       live.BuoyID,
				BuoyID:   live.BuoyID,
				Status:   live.Status,
				GPS:      defaultString(live.GPS, "waiting"),
				Sats:     defaultString(live.Sats, "waiting"),
				Compass:  defaultString(live.Compass, "waiting"),
				ImageURL: live.ImageURL,
			},
			Latitude:  lat,
			Longitude: lon,
		}

		reading := db.Reading{
			Time:      time.Now().UTC(),
			BuoyID:    live.BuoyID,
			Latitude:  lat,
			Longitude: lon,
			ImageURL:  live.ImageURL,
		}

		return live, state, reading, true
	}

	var legacy GPSMessage
	if err := json.Unmarshal(message, &legacy); err == nil && (legacy.BuoyID != "" || legacy.Latitude != 0 || legacy.Longitude != 0) {
		buoyID := legacy.BuoyID
		if buoyID == "" {
			buoyID = clientID
		}

		gps := fmt.Sprintf("%f,%f", legacy.Latitude, legacy.Longitude)
		live = telemetryMessage{
			BuoyID:  buoyID,
			Status:  "online",
			GPS:     gps,
			Sats:    "waiting",
			Compass: "waiting",
		}

		state := buoyState{
			Snapshot: buoySnapshot{
				ID:      buoyID,
				BuoyID:  buoyID,
				Status:  "online",
				GPS:     gps,
				Sats:    "waiting",
				Compass: "waiting",
			},
			Latitude:  legacy.Latitude,
			Longitude: legacy.Longitude,
		}

		readingTime := time.Now().UTC()
		if legacy.Timestamp > 0 {
			readingTime = time.Unix(legacy.Timestamp, 0).UTC()
		}

		reading := db.Reading{
			Time:      readingTime,
			BuoyID:    buoyID,
			Latitude:  legacy.Latitude,
			Longitude: legacy.Longitude,
		}

		return live, state, reading, true
	}

	return telemetryMessage{}, buoyState{}, db.Reading{}, false
}

func parseGPSString(value string) (float64, float64) {
	parts := strings.Split(value, ",")
	if len(parts) != 2 && len(parts) != 3 {
		return 0, 0
	}

	latIndex := 0
	lonIndex := 1
	if len(parts) == 3 {
		latIndex = 1
		lonIndex = 2
	}

	lat, errLat := strconv.ParseFloat(strings.TrimSpace(parts[latIndex]), 64)
	lon, errLon := strconv.ParseFloat(strings.TrimSpace(parts[lonIndex]), 64)
	if errLat != nil || errLon != nil {
		return 0, 0
	}

	return lat, lon
}

func parseSatelliteCount(value string) (int, bool) {
	parts := strings.Split(value, ",")
	if len(parts) < 1 {
		return 0, false
	}

	sats, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil {
		return 0, false
	}

	return sats, true
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
