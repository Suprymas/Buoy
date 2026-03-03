package db

import (
	"context"
	"fmt"
	"time"
)

// Reading represents one buoy data point
type Reading struct {
	Time      time.Time
	BuoyID    string
	Latitude  float64
	Longitude float64
	ImageURL  string
}

// InsertReading saves a GPS reading to TimescaleDB
func (db *DB) InsertReading(ctx context.Context, r Reading) error {
	_, err := db.Pool.Exec(ctx, `
		INSERT INTO buoy_readings (time, buoy_id, latitude, longitude, image_url)
		VALUES ($1, $2, $3, $4, $5)
	`, r.Time, r.BuoyID, r.Latitude, r.Longitude, r.ImageURL)

	if err != nil {
		return fmt.Errorf("insert reading failed: %w", err)
	}
	return nil
}

// GetLatestReadings returns the most recent N readings for a buoy
func (db *DB) GetLatestReadings(ctx context.Context, buoyID string, limit int) ([]Reading, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT time, buoy_id, latitude, longitude, image_url
		FROM buoy_readings
		WHERE buoy_id = $1
		ORDER BY time DESC
		LIMIT $2
	`, buoyID, limit)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var readings []Reading
	for rows.Next() {
		var r Reading
		if err := rows.Scan(&r.Time, &r.BuoyID, &r.Latitude, &r.Longitude, &r.ImageURL); err != nil {
			return nil, err
		}
		readings = append(readings, r)
	}
	return readings, nil
}

// GetLastKnownPosition returns the most recent position of every buoy
func (db *DB) GetLastKnownPosition(ctx context.Context) ([]Reading, error) {
	rows, err := db.Pool.Query(ctx, `
		SELECT DISTINCT ON (buoy_id)
			time, buoy_id, latitude, longitude, image_url
		FROM buoy_readings
		ORDER BY buoy_id, time DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	var readings []Reading
	for rows.Next() {
		var r Reading
		if err := rows.Scan(&r.Time, &r.BuoyID, &r.Latitude, &r.Longitude, &r.ImageURL); err != nil {
			return nil, err
		}
		readings = append(readings, r)
	}
	return readings, nil
}
