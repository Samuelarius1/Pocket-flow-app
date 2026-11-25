package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"pocketflow/internal/store"
)

func TestCategoriesAreUserScopedAndReferencedSafely(t *testing.T) {
	database, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer database.DB.Close()
	handler := New(database)
	owner := registerTestUser(t, handler, "category-owner@example.test")
	other := registerTestUser(t, handler, "category-other@example.test")
	account := requestJSON(t, handler, owner, http.MethodPost, "/api/finance/accounts", map[string]any{"id": "owner-account", "data": map[string]any{"name": "Main", "currency": "UGX", "balanceMinor": 0}})
	if account.Code != http.StatusCreated {
		t.Fatalf("create account status = %d: %s", account.Code, account.Body.String())
	}

	created := requestJSON(t, handler, owner, http.MethodPost, "/api/categories", map[string]string{"name": "Pet care", "kind": "expense", "color": "#AABBCC"})
	if created.Code != http.StatusCreated {
		t.Fatalf("create category status = %d: %s", created.Code, created.Body.String())
	}
	var category financialCategory
	if err := json.Unmarshal(created.Body.Bytes(), &category); err != nil {
		t.Fatal(err)
	}
	transaction := map[string]any{"id": "pet-expense", "data": map[string]any{"accountId": "owner-account", "categoryId": category.ID, "description": "Vet visit", "currency": "UGX", "amountMinor": 25000, "kind": "expense", "occurredAt": "2026-11-25T10:00:00Z"}}
	saved := requestJSON(t, handler, owner, http.MethodPost, "/api/finance/transactions", transaction)
	if saved.Code != http.StatusCreated {
		t.Fatalf("create transaction status = %d: %s", saved.Code, saved.Body.String())
	}

	removedInUse := requestJSON(t, handler, owner, http.MethodDelete, "/api/categories/"+category.ID, nil)
	if removedInUse.Code != http.StatusConflict {
		t.Fatalf("delete in-use category status = %d, want %d", removedInUse.Code, http.StatusConflict)
	}
	removedByOther := requestJSON(t, handler, other, http.MethodDelete, "/api/categories/"+category.ID, nil)
	if removedByOther.Code != http.StatusNotFound {
		t.Fatalf("cross-user category delete status = %d, want %d", removedByOther.Code, http.StatusNotFound)
	}

	list := requestJSON(t, handler, other, http.MethodGet, "/api/categories", nil)
	var result struct {
		Items []financialCategory `json:"items"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	for _, item := range result.Items {
		if item.ID == category.ID {
			t.Fatal("custom category leaked to another user")
		}
	}

	wrongAccount := map[string]any{"data": map[string]any{"accountId": "owner-account", "categoryId": "system-salary", "description": "Foreign reference", "currency": "UGX", "amountMinor": 10, "kind": "expense", "occurredAt": "2026-11-25T10:00:00Z"}}
	invalidReference := requestJSON(t, handler, other, http.MethodPost, "/api/finance/transactions", wrongAccount)
	if invalidReference.Code != http.StatusBadRequest {
		t.Fatalf("cross-user or mismatched category status = %d, want %d", invalidReference.Code, http.StatusBadRequest)
	}
}
