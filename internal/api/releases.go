package api

import (
	"database/sql"
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
)

var semverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`)

type releaseInput struct {
	Version        string `json:"version"`
	Notes          string `json:"notes"`
	MinimumVersion string `json:"minimumVersion"`
	Mandatory      bool   `json:"mandatory"`
}

func (a *API) administrator(next http.Handler) http.Handler {
	return a.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID := r.Context().Value(userContextKey{}).(string)
		var email string
		if err := a.store.DB.QueryRowContext(r.Context(), `SELECT email FROM users WHERE id=?`, userID).Scan(&email); err != nil {
			writeError(w, http.StatusUnauthorized, "Account not found.")
			return
		}
		for _, allowed := range strings.Split(os.Getenv("POCKETFLOW_ADMIN_EMAILS"), ",") {
			if strings.EqualFold(strings.TrimSpace(allowed), email) && strings.TrimSpace(allowed) != "" {
				next.ServeHTTP(w, r)
				return
			}
		}
		writeError(w, http.StatusForbidden, "Administrator access is required.")
	}))
}

func (a *API) publishRelease(w http.ResponseWriter, r *http.Request) {
	var input releaseInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Version = strings.TrimSpace(input.Version)
	input.MinimumVersion = strings.TrimSpace(input.MinimumVersion)
	input.Notes = strings.TrimSpace(input.Notes)
	if !validSemver(input.Version) || (input.MinimumVersion != "" && !validSemver(input.MinimumVersion)) || len(input.Notes) == 0 || len(input.Notes) > 10_000 {
		writeError(w, http.StatusBadRequest, "Provide a semantic version, release notes under 10,000 characters, and a valid optional minimum version.")
		return
	}
	var current string
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT version FROM releases ORDER BY published_at DESC, version DESC LIMIT 1`).Scan(&current)
	if err == nil && compareSemver(input.Version, current) <= 0 {
		writeError(w, http.StatusConflict, "A release must have a version newer than the latest published version.")
		return
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "Unable to check the latest release.")
		return
	}
	userID := r.Context().Value(userContextKey{}).(string)
	tx, err := a.store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to publish release.")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO releases(version,notes,minimum_version,mandatory,published_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`, input.Version, input.Notes, input.MinimumVersion, input.Mandatory); err != nil {
		tx.Rollback()
		writeError(w, http.StatusConflict, "This release version already exists.")
		return
	}
	if _, err := tx.ExecContext(r.Context(), `INSERT INTO release_audit(actor_user_id,version,action) VALUES(?,?,'published')`, userID, input.Version); err != nil {
		tx.Rollback()
		writeError(w, http.StatusInternalServerError, "Unable to record the release audit event.")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to publish release.")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"version": input.Version, "notes": input.Notes, "minimumVersion": input.MinimumVersion, "mandatory": input.Mandatory})
}

func validSemver(version string) bool {
	if !semverPattern.MatchString(version) {
		return false
	}
	withoutBuild, _, _ := strings.Cut(version, "+")
	_, prerelease, hasPrerelease := strings.Cut(withoutBuild, "-")
	if !hasPrerelease {
		return true
	}
	for _, identifier := range strings.Split(prerelease, ".") {
		if _, err := strconv.Atoi(identifier); err == nil && len(identifier) > 1 && identifier[0] == '0' {
			return false
		}
	}
	return true
}

func compareSemver(left, right string) int {
	leftCore, leftPre, _ := strings.Cut(left, "-")
	rightCore, rightPre, _ := strings.Cut(right, "-")
	leftCore, _, _ = strings.Cut(leftCore, "+")
	rightCore, _, _ = strings.Cut(rightCore, "+")
	leftParts, rightParts := strings.Split(leftCore, "."), strings.Split(rightCore, ".")
	for i := range leftParts {
		l, _ := strconv.Atoi(leftParts[i])
		r, _ := strconv.Atoi(rightParts[i])
		if l > r {
			return 1
		}
		if l < r {
			return -1
		}
	}
	if leftPre == rightPre {
		return 0
	}
	if leftPre == "" {
		return 1
	}
	if rightPre == "" {
		return -1
	}
	leftIdentifiers, rightIdentifiers := strings.Split(leftPre, "."), strings.Split(rightPre, ".")
	for i := 0; i < len(leftIdentifiers) && i < len(rightIdentifiers); i++ {
		l, leftNumeric := strconv.ParseUint(leftIdentifiers[i], 10, 64)
		r, rightNumeric := strconv.ParseUint(rightIdentifiers[i], 10, 64)
		switch {
		case leftNumeric == nil && rightNumeric == nil:
			if l > r {
				return 1
			}
			if l < r {
				return -1
			}
		case leftNumeric == nil:
			return -1
		case rightNumeric == nil:
			return 1
		case leftIdentifiers[i] > rightIdentifiers[i]:
			return 1
		case leftIdentifiers[i] < rightIdentifiers[i]:
			return -1
		}
	}
	if len(leftIdentifiers) > len(rightIdentifiers) {
		return 1
	}
	return -1
}
