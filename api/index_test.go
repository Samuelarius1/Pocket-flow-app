package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestVercelFunctionRoutesHealthCheck(t *testing.T) {
	if os.Getenv("DATABASE_URL") == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	request := httptest.NewRequest(http.MethodGet, "/api/index?__route=health", nil)
	response := httptest.NewRecorder()
	Handler(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"status":"ok"`) {
		t.Fatalf("health route status = %d, body=%s", response.Code, response.Body.String())
	}
}
