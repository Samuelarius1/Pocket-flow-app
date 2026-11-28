package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"

	"pocketflow/internal/store"
)

func TestEmailPasswordSignInCreatesAuthenticatedSession(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	registerTestUser(t, handler, "signin@example.test")

	login := requestJSON(t, handler, nil, http.MethodPost, "/api/auth/login", map[string]string{"email": "SIGNIN@example.test", "password": "a-secure-test-password"})
	if login.Code != http.StatusOK {
		t.Fatalf("login status = %d, body=%s", login.Code, login.Body.String())
	}
	var session *http.Cookie
	for _, cookie := range login.Result().Cookies() {
		if cookie.Name == sessionCookie {
			session = cookie
		}
	}
	if session == nil {
		t.Fatal("login did not set a session cookie")
	}
	profile := requestJSON(t, handler, session, http.MethodGet, "/api/auth/me", nil)
	if profile.Code != http.StatusOK {
		t.Fatalf("authenticated profile status = %d, body=%s", profile.Code, profile.Body.String())
	}
	badPassword := requestJSON(t, handler, nil, http.MethodPost, "/api/auth/login", map[string]string{"email": "signin@example.test", "password": "incorrect-password"})
	if badPassword.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status = %d, want %d", badPassword.Code, http.StatusUnauthorized)
	}
}

func TestPreferenceAccessRequiresSessionAndStaysUserScoped(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	unauthorized := requestJSON(t, handler, nil, http.MethodGet, "/api/preferences", nil)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized preferences status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	first := registerTestUser(t, handler, "preferences-first@example.test")
	second := registerTestUser(t, handler, "preferences-second@example.test")

	var rawToken string
	if err := database.DB.QueryRow(`SELECT token_hash FROM user_sessions WHERE user_id=(SELECT id FROM users WHERE email='preferences-first@example.test')`).Scan(&rawToken); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256([]byte(first.Value))
	if rawToken != hex.EncodeToString(digest[:]) {
		t.Fatal("session table must contain only the SHA-256 token digest")
	}

	empty := requestJSON(t, handler, first, http.MethodGet, "/api/preferences", nil)
	var emptyPayload map[string]any
	if err := json.Unmarshal(empty.Body.Bytes(), &emptyPayload); err != nil {
		t.Fatal(err)
	}
	if len(emptyPayload) != 0 {
		t.Fatalf("new account should receive an empty preference object, got %v", emptyPayload)
	}

	preferences := map[string]any{"displayName": "First User", "email": "preferences-first@example.test", "country": "Uganda", "currency": "UGX", "language": "English", "theme": "system", "notifications": true, "privacyInsights": true, "avatar": nil}
	updated := requestJSON(t, handler, first, http.MethodPut, "/api/preferences", preferences)
	if updated.Code != http.StatusOK {
		t.Fatalf("save preferences status = %d: %s", updated.Code, updated.Body.String())
	}
	otherUser := requestJSON(t, handler, second, http.MethodGet, "/api/preferences", nil)
	var otherPayload map[string]any
	if err := json.Unmarshal(otherUser.Body.Bytes(), &otherPayload); err != nil {
		t.Fatal(err)
	}
	if len(otherPayload) != 0 {
		t.Fatalf("preference data leaked to another user: %v", otherPayload)
	}

	logout := requestJSON(t, handler, first, http.MethodPost, "/api/auth/logout", nil)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout status = %d", logout.Code)
	}
	afterLogout := requestJSON(t, handler, first, http.MethodGet, "/api/preferences", nil)
	if afterLogout.Code != http.StatusUnauthorized {
		t.Fatalf("request after logout status = %d, want %d", afterLogout.Code, http.StatusUnauthorized)
	}
}
