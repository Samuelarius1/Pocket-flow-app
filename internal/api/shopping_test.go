package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"pocketflow/internal/store"
)

func TestShoppingRequiresAuthentication(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()

	response := requestJSON(t, New(database), nil, http.MethodGet, "/api/shopping", nil)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestShoppingItemsArePrivateAndVersioned(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()

	handler := New(database)
	userA := registerTestUser(t, handler, "shopper-a@example.test")
	userB := registerTestUser(t, handler, "shopper-b@example.test")

	created := requestJSON(t, handler, userA, http.MethodPost, "/api/shopping", map[string]any{
		"name": "  Tea  ", "quantity": 2,
	})
	if created.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", created.Code, created.Body)
	}
	var item shoppingItem
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if item.Name != "Tea" || item.Quantity != 2 || item.Version != 1 {
		t.Fatalf("unexpected created item: %+v", item)
	}

	updated := requestJSON(t, handler, userA, http.MethodPut, "/api/shopping/"+item.ID, map[string]any{
		"name": item.Name, "quantity": 3, "purchased": true, "version": item.Version,
	})
	if updated.Code != http.StatusOK {
		t.Fatalf("update status = %d, body = %s", updated.Code, updated.Body)
	}
	var changed shoppingItem
	if err := json.Unmarshal(updated.Body.Bytes(), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Version != 2 || !changed.Purchased || changed.Quantity != 3 {
		t.Fatalf("unexpected updated item: %+v", changed)
	}

	stale := requestJSON(t, handler, userA, http.MethodPut, "/api/shopping/"+item.ID, map[string]any{
		"name": item.Name, "quantity": 4, "purchased": false, "version": item.Version,
	})
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale update status = %d, want %d", stale.Code, http.StatusConflict)
	}

	listFor := func(cookie *http.Cookie) []shoppingItem {
		t.Helper()
		response := requestJSON(t, handler, cookie, http.MethodGet, "/api/shopping", nil)
		if response.Code != http.StatusOK {
			t.Fatalf("list status = %d, body = %s", response.Code, response.Body)
		}
		var result struct {
			Items []shoppingItem `json:"items"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Items
	}
	if got := len(listFor(userA)); got != 1 {
		t.Fatalf("user A item count = %d, want 1", got)
	}
	if got := len(listFor(userB)); got != 0 {
		t.Fatalf("user B item count = %d, want 0", got)
	}

	privateDelete := requestJSON(t, handler, userB, http.MethodDelete, "/api/shopping/"+item.ID, nil)
	if privateDelete.Code != http.StatusNotFound {
		t.Fatalf("cross-account delete status = %d, want %d", privateDelete.Code, http.StatusNotFound)
	}
	deleted := requestJSON(t, handler, userA, http.MethodDelete, "/api/shopping/"+item.ID, nil)
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want %d", deleted.Code, http.StatusNoContent)
	}
	if got := len(listFor(userA)); got != 0 {
		t.Fatalf("user A item count after delete = %d, want 0", got)
	}
}

func TestShoppingRejectsInvalidInput(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()

	handler := New(database)
	user := registerTestUser(t, handler, "shopper-invalid@example.test")
	invalidItems := []map[string]any{
		{"name": "  ", "quantity": 1},
		{"name": "Bread", "quantity": 0},
		{"name": "Bread", "quantity": 1000},
	}
	for _, input := range invalidItems {
		response := requestJSON(t, handler, user, http.MethodPost, "/api/shopping", input)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("payload %#v: status = %d, want %d", input, response.Code, http.StatusBadRequest)
		}
	}
}
