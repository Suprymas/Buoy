package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type buoySnapshot struct {
	Time     string `json:"time,omitempty"`
	ID       string `json:"id"`
	BuoyID   string `json:"buoyId"`
	Status   string `json:"status"`
	GPS      string `json:"gps"`
	Sats     string `json:"sats,omitempty"`
	Compass  string `json:"compass"`
	ImageURL string `json:"imageUrl,omitempty"`
}

const offlineAfter = 60 * time.Second

type buoyState struct {
	Snapshot  buoySnapshot
	Latitude  float64
	Longitude float64
	Heading   float64
}

func (s *Server) BuoysHandler(w http.ResponseWriter, r *http.Request) {
	buoys := []buoySnapshot{}
	readings, err := s.db.GetLastKnownPosition(r.Context())
	if err == nil {
		now := time.Now().UTC()
		for _, reading := range readings {
			imageURL := reading.ImageURL
			if imageURL == "" {
				latestImageURL, storageErr := s.storage.GetLatestImageURL(r.Context(), reading.BuoyID)
				if storageErr == nil {
					imageURL = latestImageURL
				}
			}

			status := "offline"
			if now.Sub(reading.Time.UTC()) <= offlineAfter {
				status = "online"
			}

			buoys = append(buoys, buoySnapshot{
				Time:     reading.Time.UTC().Format("15:04:05"),
				ID:       reading.BuoyID,
				BuoyID:   reading.BuoyID,
				Status:   status,
				GPS:      fmt.Sprintf("%f,%f", reading.Latitude, reading.Longitude),
				Sats:     "waiting",
				Compass:  "waiting",
				ImageURL: imageURL,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Buoys []buoySnapshot `json:"buoys"`
	}{
		Buoys: buoys,
	})
}
