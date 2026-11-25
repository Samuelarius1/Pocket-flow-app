package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"pocketflow/internal/store"
)

func TestFinancialRecordsAreUserScopedAndVersioned(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	first := registerTestUser(t, handler, "first@example.test")
	second := registerTestUser(t, handler, "second@example.test")

	payload := map[string]any{"id": "stable-account-id", "data": map[string]any{"name": "Daily account", "institution": "PocketFlow", "accountType": "checking", "currency": "USD", "balanceMinor": 12345}}
	created := requestJSON(t, handler, first, http.MethodPost, "/api/finance/accounts", payload)
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body=%s", created.Code, created.Body.String())
	}
	var record financialRecord
	if err := json.Unmarshal(created.Body.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record.ID != "stable-account-id" || record.Version != 1 || record.Data.BalanceMinor != 12345 {
		t.Fatalf("unexpected created record: %+v", record)
	}

	updatedPayload := map[string]any{"version": 1, "data": map[string]any{"name": "Updated account", "institution": "PocketFlow", "accountType": "checking", "currency": "USD", "balanceMinor": 22345}}
	updated := requestJSON(t, handler, first, http.MethodPut, "/api/finance/accounts/"+record.ID, updatedPayload)
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d, body=%s", updated.Code, updated.Body.String())
	}
	stale := requestJSON(t, handler, first, http.MethodPut, "/api/finance/accounts/"+record.ID, updatedPayload)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale update status = %d, want %d", stale.Code, http.StatusConflict)
	}
	for _, id := range []string{"account-two", "account-three"} {
		created := requestJSON(t, handler, first, http.MethodPost, "/api/finance/accounts", map[string]any{"id": id, "data": map[string]any{"name": id, "currency": "USD", "balanceMinor": 10}})
		if created.Code != http.StatusCreated {
			t.Fatalf("create pagination record status = %d: %s", created.Code, created.Body.String())
		}
	}
	pageOne := requestJSON(t, handler, first, http.MethodGet, "/api/finance/accounts?limit=1", nil)
	var page struct {
		Items      []financialRecord `json:"items"`
		NextCursor string            `json:"nextCursor"`
	}
	if err := json.Unmarshal(pageOne.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.NextCursor == "" {
		t.Fatalf("expected first page and cursor, got %+v", page)
	}
	pageTwo := requestJSON(t, handler, first, http.MethodGet, "/api/finance/accounts?limit=1&cursor="+page.NextCursor, nil)
	if err := json.Unmarshal(pageTwo.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID == "" {
		t.Fatalf("expected distinct second page: %+v", page)
	}

	list := requestJSON(t, handler, second, http.MethodGet, "/api/finance/accounts", nil)
	if list.Code != http.StatusOK {
		t.Fatalf("other user list status = %d", list.Code)
	}
	var result struct {
		Items []financialRecord `json:"items"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 0 {
		t.Fatalf("another user's record leaked: %+v", result.Items)
	}
}

func TestFinancialRecordValidation(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	cookie := registerTestUser(t, handler, "finance@example.test")
	invalid := map[string]any{"data": map[string]any{"name": "Missing currency", "accountType": "checking", "balanceMinor": 100}}
	response := requestJSON(t, handler, cookie, http.MethodPost, "/api/finance/accounts", invalid)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("invalid payload status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func registerTestUser(t *testing.T, handler http.Handler, email string) *http.Cookie {
	t.Helper()
	body := map[string]string{"email": email, "password": "a-secure-test-password", "displayName": "Test User"}
	response := requestJSON(t, handler, nil, http.MethodPost, "/api/auth/register", body)
	if response.Code != http.StatusCreated {
		t.Fatalf("register status = %d, body=%s", response.Code, response.Body.String())
	}
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == sessionCookie {
			return cookie
		}
	}
	t.Fatal("registration did not set a session cookie")
	return nil
}

func requestJSON(t *testing.T, handler http.Handler, cookie *http.Cookie, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var encoded bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&encoded).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	request := httptest.NewRequest(method, path, &encoded)
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}
