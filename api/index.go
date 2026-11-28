package handler

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"

	"pocketflow/server"
)

var (
	initialize sync.Once
	apiHandler http.Handler
	startupErr error
)

func Handler(w http.ResponseWriter, r *http.Request) {
	initialize.Do(func() {
		connectionString := os.Getenv("DATABASE_URL")
		if connectionString == "" {
			startupErr = fmt.Errorf("DATABASE_URL is not configured")
			return
		}
		handler, err := server.NewAPIHandler(connectionString)
		if err != nil {
			startupErr = err
			return
		}
		apiHandler = handler
	})
	if startupErr != nil {
		http.Error(w, "PocketFlow account service is temporarily unavailable.", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query()
	if route := query.Get("__route"); route != "" {
		query.Del("__route")
		r.URL.Path = "/api/" + strings.TrimLeft(route, "/")
		r.URL.RawQuery = query.Encode()
	}
	apiHandler.ServeHTTP(w, r)
}
