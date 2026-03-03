package client

import "github.com/gorilla/websocket"

// Client represents a connected WebSocket buoy
type Client struct {
	ID   string
	Conn *websocket.Conn
}

func New(id string, conn *websocket.Conn) *Client {
	return &Client{
		ID:   id,
		Conn: conn,
	}
}
