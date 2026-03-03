package main

import (
	"buoy-hub/internal/db"
	"buoy-hub/internal/server"
	"context"
	"log"
	"net/http"
)

func main() {
	ctx := context.Background()

	// Connect to TimescaleDB
	database, err := db.New(ctx)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer database.Close()

	// Create server with DB reference
	s := server.New(database)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.HandleConnection)
	mux.HandleFunc("/health", server.HealthHandler)

	addr := ":8080"
	log.Printf("Buoy hub starting on ws://localhost%s/ws", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
