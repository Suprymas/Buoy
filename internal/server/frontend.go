package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// FrontendHandler serves the compiled React app and falls back to index.html for SPA routes.
func FrontendHandler(distDir string) http.Handler {
	fileServer := http.FileServer(http.Dir(distDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		indexPath := filepath.Join(distDir, "index.html")
		relativePath := strings.TrimPrefix(pathClean(r.URL.Path), "/")
		requestPath := filepath.Join(distDir, relativePath)

		if _, err := os.Stat(indexPath); err != nil {
			http.Error(w, "frontend build not found; run `npm install` and `npm run build` in ./frontend", http.StatusServiceUnavailable)
			return
		}

		if info, err := os.Stat(requestPath); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		http.ServeFile(w, r, indexPath)
	})
}

func pathClean(requestPath string) string {
	cleaned := filepath.ToSlash(filepath.Clean(requestPath))
	if cleaned == "." {
		return "/"
	}
	return cleaned
}
