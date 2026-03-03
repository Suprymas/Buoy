package server

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

const maxLogEntries = 500

type LogEntry struct {
	ID        int64  `json:"id"`
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Event     string `json:"event"`
	ClientID  string `json:"clientId,omitempty"`
	Message   string `json:"message"`
}

func (s *Server) addLog(level string, event string, clientID string, message string) {
	entry := LogEntry{
		ID:        time.Now().UnixNano(),
		Timestamp: time.Now().Format(time.RFC3339),
		Level:     level,
		Event:     event,
		ClientID:  clientID,
		Message:   message,
	}

	s.mu.Lock()
	s.logs = append([]LogEntry{entry}, s.logs...)
	if len(s.logs) > maxLogEntries {
		s.logs = s.logs[:maxLogEntries]
	}
	s.mu.Unlock()

	payload, err := json.Marshal(struct {
		Type  string   `json:"type"`
		Entry LogEntry `json:"entry"`
	}{
		Type:  "server_log",
		Entry: entry,
	})
	if err != nil {
		return
	}

	s.broadcast(websocket.TextMessage, payload)
}

func (s *Server) LogsHandler(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	logs := append([]LogEntry(nil), s.logs...)
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Logs []LogEntry `json:"logs"`
	}{
		Logs: logs,
	})
}
