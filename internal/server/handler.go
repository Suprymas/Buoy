package server

import (
	"buoy-hub/internal/client"
//	"buoy-hub/internal/db"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
)

// GPSMessage is the JSON structure sent by the buoy as a text frame
type GPSMessage struct {
	BuoyID    string  `json:"buoy_id"`
	Latitude  float64 `json:"lat"`
	Longitude float64 `json:"lon"`
	Timestamp int64   `json:"time"` // unix timestamp from ESP32
}

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
	s.clients[clientID] = c

	log.Printf("[+] Buoy connected: %s (total: %d)", clientID, len(s.clients))
	ws.WriteMessage(websocket.TextMessage, []byte("Welcome! Your ID is: "+clientID))

	defer s.disconnect(clientID, ws)

	s.readLoop(c)
}

// readLoop continuously reads messages from a connected buoy.
// Text frames = GPS JSON, Binary frames = raw image bytes
func (s *Server) readLoop(c *client.Client) {
	for {
		msgType, message, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway) {
				log.Printf("Read error from %s: %v", c.ID, err)
			}
			break
		}

		switch msgType {
		case websocket.TextMessage:
			go s.handleGPS(c, message)
		case websocket.BinaryMessage:
			go s.handleImage(c, message)
		}
	}
}

// handleGPS parses a GPS JSON message and saves it to TimescaleDB
func (s *Server) handleGPS(c *client.Client, message []byte) {
	var gps GPSMessage
	if err := json.Unmarshal(message, &gps); err != nil {
		log.Printf("Failed to parse GPS from %s: %v", c.ID, err)
		return
	}

	log.Printf("[GPS] %s → lat: %f, lon: %f", c.ID, gps.Latitude, gps.Longitude)

	//reading := db.Reading{
	//	Time:      time.Unix(gps.Timestamp, 0),
	//	BuoyID:    c.ID,
	//	Latitude:  gps.Latitude,
	//	Longitude: gps.Longitude,
	//}

	//if err := s.db.InsertReading(r.Context(), reading); err != nil {
	//	log.Printf("Failed to save GPS reading: %v", err)
	//}
}

// handleImage receives raw binary image bytes from a buoy.
// TODO: save to MinIO and update the image_url in the last reading
func (s *Server) handleImage(c *client.Client, message []byte) {
	log.Printf("[IMG] %s → received %d bytes", c.ID, len(message))
	// MinIO upload will go here
}

// disconnect cleans up a buoy connection.
func (s *Server) disconnect(clientID string, ws *websocket.Conn) {
	delete(s.clients, clientID)
	ws.Close()
	log.Printf("[-] Buoy disconnected: %s (total: %d)", clientID, len(s.clients))
}

// HealthHandler returns a simple JSON health check.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fmt.Fprint(w, `{"status":"ok"}`)
}
