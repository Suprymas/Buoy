package server

import (
	"buoy-hub/internal/client"
	"buoy-hub/internal/db"
	"net/http"

	"github.com/gorilla/websocket"
)

// Server manages all connected buoy clients and database access
type Server struct {
	clients map[string]*client.Client
	db      *db.DB
}

func New(database *db.DB) *Server {
	return &Server{
		clients: make(map[string]*client.Client),
		db:      database,
	}
}

// upgrader upgrades HTTP connections to WebSocket.
// CheckOrigin returns true to allow all origins.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}
