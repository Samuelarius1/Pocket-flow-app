package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"pocketflow/internal/store"
)

const sessionCookie = "pocketflow_session"
const sessionDuration = 30 * 24 * time.Hour

type userContextKey struct{}

type API struct {
	store *store.Store
}

type preferences struct {
	DisplayName     string  `json:"displayName"`
	Email           string  `json:"email"`
	Country         string  `json:"country"`
	Currency        string  `json:"currency"`
	Language        string  `json:"language"`
	Theme           string  `json:"theme"`
	Notifications   bool    `json:"notifications"`
	PrivacyInsights bool    `json:"privacyInsights"`
	Avatar          *string `json:"avatar"`
}

func New(database *store.Store) http.Handler {
	a := &API{store: database}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("POST /api/auth/register", a.register)
	mux.HandleFunc("POST /api/auth/login", a.login)
	mux.HandleFunc("POST /api/auth/logout", a.logout)
	mux.Handle("GET /api/auth/me", a.authenticated(http.HandlerFunc(a.me)))
	mux.Handle("GET /api/preferences", a.authenticated(http.HandlerFunc(a.getPreferences)))
	mux.Handle("PUT /api/preferences", a.authenticated(http.HandlerFunc(a.putPreferences)))
	mux.Handle("GET /api/categories", a.authenticated(http.HandlerFunc(a.listCategories)))
	mux.Handle("POST /api/categories", a.authenticated(http.HandlerFunc(a.createCategory)))
	mux.Handle("DELETE /api/categories/{id}", a.authenticated(http.HandlerFunc(a.deleteCategory)))
	mux.Handle("GET /api/finance/{resource}", a.authenticated(http.HandlerFunc(a.getFinancialRecords)))
	mux.Handle("POST /api/finance/{resource}", a.authenticated(http.HandlerFunc(a.createFinancialRecord)))
	mux.Handle("PUT /api/finance/{resource}/{id}", a.authenticated(http.HandlerFunc(a.updateFinancialRecord)))
	mux.Handle("DELETE /api/finance/{resource}/{id}", a.authenticated(http.HandlerFunc(a.deleteFinancialRecord)))
	mux.Handle("POST /api/admin/releases", a.administrator(http.HandlerFunc(a.publishRelease)))
	mux.HandleFunc("GET /api/releases/latest", a.latestRelease)
	return mux
}

func (a *API) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"displayName"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	if len(input.Email) < 5 || len(input.Email) > 254 || !strings.Contains(input.Email, "@") || len(input.Password) < 12 || len(input.Password) > 72 || len(input.DisplayName) > 100 {
		writeError(w, http.StatusBadRequest, "Use a valid email, a display name under 100 characters, and a password of at least 12 characters.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create account.")
		return
	}
	id, err := randomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create account.")
		return
	}
	_, err = a.store.DB.ExecContext(r.Context(), `INSERT INTO users(id,email,display_name,password_hash) VALUES(?,?,?,?)`, id, input.Email, input.DisplayName, string(hash))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeError(w, http.StatusConflict, "An account with that email already exists.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Unable to create account.")
		return
	}
	if !a.createSession(w, r, id) {
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": id, "email": input.Email, "displayName": input.DisplayName})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	var id, hash, displayName string
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT id,password_hash,display_name FROM users WHERE email=?`, strings.ToLower(strings.TrimSpace(input.Email))).Scan(&id, &hash, &displayName)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(input.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "Email or password is incorrect.")
		return
	}
	if !a.createSession(w, r, id) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": id, "email": strings.ToLower(strings.TrimSpace(input.Email)), "displayName": displayName})
}

func (a *API) createSession(w http.ResponseWriter, r *http.Request, userID string) bool {
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to start a secure session.")
		return false
	}
	token := hex.EncodeToString(tokenBytes)
	tokenHash := sha256.Sum256([]byte(token))
	expires := time.Now().UTC().Add(sessionDuration)
	if _, err := a.store.DB.ExecContext(r.Context(), `INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)`, hex.EncodeToString(tokenHash[:]), userID, expires.Format(time.RFC3339)); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to start a secure session.")
		return false
	}
	secure := os.Getenv("APP_ENV") != "development"
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: int(sessionDuration.Seconds())})
	return true
}

func (a *API) authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		digest := sha256.Sum256([]byte(cookie.Value))
		var userID string
		err = a.store.DB.QueryRowContext(r.Context(), `SELECT user_id FROM user_sessions WHERE token_hash=? AND expires_at>?`, hex.EncodeToString(digest[:]), time.Now().UTC().Format(time.RFC3339)).Scan(&userID)
		if err != nil {
			http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: os.Getenv("APP_ENV") != "development", SameSite: http.SameSiteLaxMode, MaxAge: -1})
			writeError(w, http.StatusUnauthorized, "Your session has expired. Sign in again.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, userID)))
	})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userContextKey{}).(string)
	var email, displayName string
	if err := a.store.DB.QueryRowContext(r.Context(), `SELECT email,display_name FROM users WHERE id=?`, userID).Scan(&email, &displayName); err != nil {
		writeError(w, http.StatusUnauthorized, "Account not found.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"id": userID, "email": email, "displayName": displayName})
}

func (a *API) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookie); err == nil && cookie.Value != "" {
		digest := sha256.Sum256([]byte(cookie.Value))
		_, _ = a.store.DB.ExecContext(r.Context(), `DELETE FROM user_sessions WHERE token_hash=?`, hex.EncodeToString(digest[:]))
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", HttpOnly: true, Secure: os.Getenv("APP_ENV") != "development", SameSite: http.SameSiteLaxMode, MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed out"})
}

func (a *API) getPreferences(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userContextKey{}).(string)
	var payload string
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT payload FROM user_preferences WHERE user_id=?`, userID).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load preferences.")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, payload)
}

func (a *API) putPreferences(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userContextKey{}).(string)
	var p preferences
	if !decodeJSON(w, r, &p) {
		return
	}
	if len(p.DisplayName) > 100 || len(p.Email) > 254 || len(p.AvatarValue()) > 2_800_000 || (p.Theme != "light" && p.Theme != "dark" && p.Theme != "system") || len(p.Currency) != 3 || len(p.Language) > 40 || len(p.Country) > 80 {
		writeError(w, http.StatusBadRequest, "One or more preference values are invalid.")
		return
	}
	payload, err := json.Marshal(p)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid preferences.")
		return
	}
	_, err = a.store.DB.ExecContext(r.Context(), `INSERT INTO user_preferences(user_id,payload,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated_at=CURRENT_TIMESTAMP`, userID, string(payload))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save preferences.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func randomID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func (p preferences) AvatarValue() string {
	if p.Avatar == nil {
		return ""
	}
	return *p.Avatar
}

func (a *API) latestRelease(w http.ResponseWriter, r *http.Request) {
	var version, notes, minimum, publishedAt string
	var mandatory bool
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT version,notes,minimum_version,mandatory,published_at FROM releases ORDER BY published_at DESC,version DESC LIMIT 1`).Scan(&version, &notes, &minimum, &mandatory, &publishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"version": "0.1.0", "notes": "PocketFlow is ready.", "minimumVersion": "", "publishedAt": "", "mandatory": false})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to check releases.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "notes": notes, "minimumVersion": minimum, "publishedAt": publishedAt, "mandatory": mandatory})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 3_000_000)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
