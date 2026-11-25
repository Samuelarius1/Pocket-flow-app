package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"pocketflow/internal/store"
)

func TestReleasePublishingRequiresAdminAndWritesAudit(t *testing.T) {
	t.Setenv("POCKETFLOW_ADMIN_EMAILS", "admin@example.test")
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	admin := registerTestUser(t, handler, "admin@example.test")
	regular := registerTestUser(t, handler, "user@example.test")
	input := map[string]any{"version": "0.2.0", "notes": "Financial records and offline sync.", "minimumVersion": "0.1.0", "mandatory": false}

	denied := requestJSON(t, handler, regular, http.MethodPost, "/api/admin/releases", input)
	if denied.Code != http.StatusForbidden {
		t.Fatalf("regular user publish status = %d, want %d", denied.Code, http.StatusForbidden)
	}
	invalid := requestJSON(t, handler, admin, http.MethodPost, "/api/admin/releases", map[string]any{"version": "latest", "notes": "bad"})
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid release status = %d, want %d", invalid.Code, http.StatusBadRequest)
	}
	published := requestJSON(t, handler, admin, http.MethodPost, "/api/admin/releases", input)
	if published.Code != http.StatusCreated {
		t.Fatalf("publish status = %d, body=%s", published.Code, published.Body.String())
	}
	duplicate := requestJSON(t, handler, admin, http.MethodPost, "/api/admin/releases", input)
	if duplicate.Code != http.StatusConflict {
		t.Fatalf("duplicate version status = %d, want %d", duplicate.Code, http.StatusConflict)
	}

	latest := requestJSON(t, handler, nil, http.MethodGet, "/api/releases/latest", nil)
	var release map[string]any
	if err := json.Unmarshal(latest.Body.Bytes(), &release); err != nil {
		t.Fatal(err)
	}
	if latest.Code != http.StatusOK || release["version"] != "0.2.0" || release["notes"] != input["notes"] {
		t.Fatalf("unexpected latest release: status=%d response=%v", latest.Code, release)
	}
	var audits int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM release_audit WHERE actor_user_id=(SELECT id FROM users WHERE email='admin@example.test')`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 1 {
		t.Fatalf("expected one release audit entry, got %d", audits)
	}
}

func TestCompareSemverOrdersPrereleases(t *testing.T) {
	cases := []struct {
		left, right string
		want        int
	}{
		{"1.0.0", "1.0.0-rc.1", 1},
		{"1.0.0-alpha.10", "1.0.0-alpha.2", 1},
		{"1.0.0-alpha", "1.0.0-beta", -1},
		{"1.1.0", "1.0.9", 1},
	}
	for _, test := range cases {
		if got := compareSemver(test.left, test.right); got != test.want {
			t.Errorf("compareSemver(%q, %q) = %d, want %d", test.left, test.right, got, test.want)
		}
	}
	if validSemver("1.0.0-alpha.01") {
		t.Fatal("numeric prerelease identifier with a leading zero must be invalid")
	}
}
