package mobile

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"pocketflow/internal/api"
	"pocketflow/internal/store"
)

const serverPort = 8765

var (
	mu       sync.Mutex
	server   *http.Server
	database *store.Store
)

func StartServer(dataDir string) string {
	mu.Lock()
	defer mu.Unlock()

	if server != nil {
		return ""
	}

	if dataDir == "" {
		return "Android app data directory was not provided"
	}

	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return err.Error()
	}

	// The API uses a non-Secure session cookie for this local,
	// device-only HTTP connection.
	if err := os.Setenv("APP_ENV", "development"); err != nil {
		return err.Error()
	}

	dbPath := filepath.Join(dataDir, "pocketflow.db")

	db, err := store.Open(dbPath)
	if err != nil {
		return err.Error()
	}

	listener, err := net.Listen("tcp", "127.0.0.1:"+itoa(serverPort))
	if err != nil {
		_ = db.DB.Close()
		return err.Error()
	}

	handler := withLocalCORS(api.New(db))

	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	database = db
	server = srv

	go func() {
		err := srv.Serve(listener)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			// The server can be restarted by calling StopServer
			// and then StartServer again.
		}
	}()

	return ""
}

func StopServer() {
	mu.Lock()
	defer mu.Unlock()

	if server == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_ = server.Shutdown(ctx)

	if database != nil {
		_ = database.DB.Close()
	}

	server = nil
	database = nil
}

func Port() int {
	return serverPort
}

func withLocalCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")

		if origin == "http://localhost" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
		}

		if r.Method == http.MethodOptions {
			if origin != "http://localhost" {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}

	var digits [20]byte
	i := len(digits)

	for value > 0 {
		i--
		digits[i] = byte('0' + value%10)
		value /= 10
	}

	return string(digits[i:])
}
