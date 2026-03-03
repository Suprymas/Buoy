package storage

import (
    "bytes"
    "context"
    "fmt"
    "log"
    "os"
    "time"

    "github.com/minio/minio-go/v7"
    "github.com/minio/minio-go/v7/pkg/credentials"
)

const BucketName = "buoy-images"

type Storage struct {
    client *minio.Client
}

func New(ctx context.Context) (*Storage, error) {
    endpoint  := getEnv("MINIO_ENDPOINT",   "localhost:9000")
    accessKey := getEnv("MINIO_ACCESS_KEY", "admin")
    secretKey := getEnv("MINIO_SECRET_KEY", "password123")

    client, err := minio.New(endpoint, &minio.Options{
        Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
        Secure: false,
    })
    if err != nil {
        return nil, fmt.Errorf("failed to create minio client: %w", err)
    }

    s := &Storage{client: client}
    if err := s.ensureBucket(ctx); err != nil {
        return nil, err
    }

    log.Println("Connected to MinIO")
    return s, nil
}

// UploadImage saves raw image bytes and returns the URL to store in TimescaleDB
func (s *Storage) UploadImage(ctx context.Context, buoyID string, imageData []byte) (string, error) {
    objectName := fmt.Sprintf("images/%s/%s/%s.jpg",
        buoyID,
        time.Now().Format("2006-01-02"),
        time.Now().Format("150405"),
    )

    _, err := s.client.PutObject(ctx,
        BucketName,
        objectName,
        bytes.NewReader(imageData),
        int64(len(imageData)),
        minio.PutObjectOptions{ContentType: "image/jpeg"},
    )
    if err != nil {
        return "", fmt.Errorf("failed to upload image: %w", err)
    }

    url := fmt.Sprintf("http://%s/%s/%s",
        getEnv("MINIO_ENDPOINT", "localhost:9000"),
        BucketName,
        objectName,
    )
    log.Printf("[IMG] Saved %s (%d bytes)", objectName, len(imageData))
    return url, nil
}

func (s *Storage) ensureBucket(ctx context.Context) error {
    exists, err := s.client.BucketExists(ctx, BucketName)
    if err != nil {
        return fmt.Errorf("failed to check bucket: %w", err)
    }
    if !exists {
        if err := s.client.MakeBucket(ctx, BucketName, minio.MakeBucketOptions{}); err != nil {
            return fmt.Errorf("failed to create bucket: %w", err)
        }
        log.Printf("Created MinIO bucket: %s", BucketName)
    }
    return nil
}

func getEnv(key, fallback string) string {
    if val := os.Getenv(key); val != "" {
        return val
    }
    return fallback
}
