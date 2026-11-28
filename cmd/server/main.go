package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"pocketflow/internal/api"
	"pocketflow/internal/store"
)

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if os.Getenv("APP_ENV") != "development" {
			w.Header().Set("Strict-Transport-Security", "max-age=63072000")
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	path := os.Getenv("POCKETFLOW_DB_PATH")
	if path == "" {
		path = os.Getenv("DATABASE_URL")
	}
	if path == "" {
		path = "./data/pocketflow.db"
	}
	isPostgres := strings.HasPrefix(path, "postgres://") || strings.HasPrefix(path, "postgresql://")
	if !isPostgres {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			log.Fatalf("create data directory: %v", err)
		}
	}
	database, err := store.Open(path)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.DB.Close()
	if !isPostgres {
		if err := os.Chmod(path, 0600); err != nil {
			log.Fatalf("secure database file: %v", err)
		}
	}

	apiHandler := api.New(database)
	mux := http.NewServeMux()
	mux.Handle("/api/", apiHandler)
	mux.Handle("/health", apiHandler)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		root := "./web/dist"
		requested := strings.TrimPrefix(filepath.Clean("/"+r.URL.Path), string(filepath.Separator))
		candidate := filepath.Join(root, filepath.FromSlash(requested))
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			http.FileServer(http.Dir(root)).ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})

	address := os.Getenv("POCKETFLOW_ADDR")
	if address == "" {
		address = ":8080"
	}
	server := &http.Server{Addr: address, Handler: securityHeaders(mux), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	log.Printf("PocketFlow API and web app listening on %s", address)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve application: %v", err)
	}
}
