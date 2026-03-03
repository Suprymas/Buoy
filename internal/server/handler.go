package server

import (
	"buoy-hub/internal/client"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// HandleConnection upgrades the HTTP request to a WebSocket
// and starts listening for messages from the buoy.
func (s *Server) HandleConnection(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}

	clientID := fmt.Sprintf("buoy-%d", time.Now().UnixNano())
	c := client.New(clientID, ws)
	s.mu.Lock()
	s.clients[clientID] = c
	total := len(s.clients)
	s.mu.Unlock()

	log.Printf("[+] Buoy connected: %s (total: %d)", clientID, total)
	s.addLog("info", "connected", clientID, fmt.Sprintf("client connected (total: %d)", total))
	if err := c.Write(websocket.TextMessage, []byte("Welcome! Your ID is: "+clientID)); err != nil {
		log.Printf("Welcome message failed for %s: %v", clientID, err)
	}

	defer s.disconnect(clientID, ws)

	s.readLoop(c)
}

// readLoop continuously reads messages from a connected buoy.
func (s *Server) readLoop(c *client.Client) {
	for {
		_, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway) {
				log.Printf("Read error from %s: %v", c.ID, err)
				s.addLog("error", "read_error", c.ID, err.Error())
			}
			break
		}

		log.Printf("[MSG] %s @ %s: %s", c.ID, time.Now().Format("15:04:05"), string(message))
		s.handleMessage(c, message)
	}
}

// handleMessage processes an incoming message from a buoy.
// This is where you'll add GPS parsing, image saving, DB writes, etc.
func (s *Server) handleMessage(c *client.Client, message []byte) {
	s.addLog("info", "message", c.ID, string(message))
	s.broadcast(websocket.TextMessage, message)
}

// disconnect cleans up a buoy connection.
func (s *Server) disconnect(clientID string, ws *websocket.Conn) {
	s.mu.Lock()
	delete(s.clients, clientID)
	total := len(s.clients)
	s.mu.Unlock()
	ws.Close()
	log.Printf("[-] Buoy disconnected: %s (total: %d)", clientID, total)
	s.addLog("info", "disconnected", clientID, fmt.Sprintf("client disconnected (total: %d)", total))
}

// HealthHandler returns a simple JSON health check.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}

func (s *Server) broadcast(messageType int, payload []byte) {
	s.mu.RLock()
	clients := make([]*client.Client, 0, len(s.clients))
	for _, c := range s.clients {
		clients = append(clients, c)
	}
	s.mu.RUnlock()

	for _, c := range clients {
		if err := c.Write(messageType, payload); err != nil {
			log.Printf("Broadcast error to %s: %v", c.ID, err)
		}
	}
}
