CREATE EXTENSION IF NOT EXISTS timescaledb;

-- GPS readings (time-series — will become a hypertable)
CREATE TABLE IF NOT EXISTS buoy_readings (
    time        TIMESTAMPTZ     NOT NULL,
    buoy_id     TEXT            NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    heading     DOUBLE PRECISION,
    image_url   TEXT
);

-- Convert to TimescaleDB hypertable, partitioned by time
SELECT create_hypertable('buoy_readings', by_range('time'));

-- Index for fast per-buoy queries
CREATE INDEX IF NOT EXISTS idx_buoy_readings_buoy_id
    ON buoy_readings (buoy_id, time DESC);

-- Auto-compress data older than 7 days
ALTER TABLE buoy_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'buoy_id',
    timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('buoy_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- Auto-delete raw data older than 90 days
SELECT add_retention_policy('buoy_readings', INTERVAL '90 days', if_not_exists => TRUE);
