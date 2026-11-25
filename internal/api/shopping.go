package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

type shoppingItem struct {
	ID        string `json:"id"`
	Version   int64  `json:"version"`
	Name      string `json:"name"`
	Quantity  int    `json:"quantity"`
	Purchased bool   `json:"purchased"`
	UpdatedAt string `json:"updatedAt"`
}

type shoppingInput struct {
	ID        string `json:"id,omitempty"`
	Version   int64  `json:"version,omitempty"`
	Name      string `json:"name"`
	Quantity  int    `json:"quantity"`
	Purchased bool   `json:"purchased"`
}

func (a *API) listShoppingItems(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userContextKey{}).(string)
	rows, err := a.store.DB.QueryContext(r.Context(), `SELECT id,version,name,quantity,purchased,updated_at FROM shopping_items WHERE user_id=? ORDER BY purchased ASC, updated_at DESC, name COLLATE NOCASE`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load your shopping list.")
		return
	}
	defer rows.Close()
	items := make([]shoppingItem, 0)
	for rows.Next() {
		var item shoppingItem
		var purchased int
		if err := rows.Scan(&item.ID, &item.Version, &item.Name, &item.Quantity, &purchased, &item.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load your shopping list.")
			return
		}
		item.Purchased = purchased == 1
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load your shopping list.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) createShoppingItem(w http.ResponseWriter, r *http.Request) {
	var input shoppingInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 120 || input.Quantity < 1 || input.Quantity > 999 {
		writeError(w, http.StatusBadRequest, "Enter an item name and a quantity from 1 to 999.")
		return
	}
	if input.ID == "" {
		id, err := randomID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to add this item.")
			return
		}
		input.ID = id
	}
	if len(input.ID) > 100 {
		writeError(w, http.StatusBadRequest, "Invalid item identifier.")
		return
	}
	userID := r.Context().Value(userContextKey{}).(string)
	result, err := a.store.DB.ExecContext(r.Context(), `INSERT INTO shopping_items(id,user_id,name,quantity,purchased) VALUES(?,?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING`, input.ID, userID, input.Name, input.Quantity, input.Purchased)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to add this item.")
		return
	}
	created, _ := result.RowsAffected()
	if created == 0 {
		writeError(w, http.StatusConflict, "This item identifier is already in use.")
		return
	}
	writeShoppingItem(w, r, http.StatusCreated, a.store.DB, userID, input.ID)
}

func (a *API) updateShoppingItem(w http.ResponseWriter, r *http.Request) {
	var input shoppingInput
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Version < 1 || input.Name == "" || utf8.RuneCountInString(input.Name) > 120 || input.Quantity < 1 || input.Quantity > 999 {
		writeError(w, http.StatusBadRequest, "Enter an item name and a quantity from 1 to 999.")
		return
	}
	userID, id := r.Context().Value(userContextKey{}).(string), r.PathValue("id")
	result, err := a.store.DB.ExecContext(r.Context(), `UPDATE shopping_items SET name=?,quantity=?,purchased=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=? AND version=?`, input.Name, input.Quantity, input.Purchased, userID, id, input.Version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update this item.")
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		var exists int
		if err := a.store.DB.QueryRowContext(r.Context(), `SELECT 1 FROM shopping_items WHERE user_id=? AND id=?`, userID, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "Shopping item not found.")
			return
		} else if err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to verify this item.")
			return
		}
		writeError(w, http.StatusConflict, "This item changed on another device. Refresh the list before updating it.")
		return
	}
	writeShoppingItem(w, r, http.StatusOK, a.store.DB, userID, id)
}

func (a *API) deleteShoppingItem(w http.ResponseWriter, r *http.Request) {
	userID, id := r.Context().Value(userContextKey{}).(string), r.PathValue("id")
	result, err := a.store.DB.ExecContext(r.Context(), `DELETE FROM shopping_items WHERE user_id=? AND id=?`, userID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to remove this item.")
		return
	}
	deleted, _ := result.RowsAffected()
	if deleted == 0 {
		writeError(w, http.StatusNotFound, "Shopping item not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeShoppingItem(w http.ResponseWriter, r *http.Request, status int, db *sql.DB, userID, id string) {
	var item shoppingItem
	var purchased int
	err := db.QueryRowContext(r.Context(), `SELECT id,version,name,quantity,purchased,updated_at FROM shopping_items WHERE user_id=? AND id=?`, userID, id).Scan(&item.ID, &item.Version, &item.Name, &item.Quantity, &purchased, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Shopping item not found.")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load this item.")
		return
	}
	item.Purchased = purchased == 1
	if item.UpdatedAt == "" {
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	writeJSON(w, status, item)
}
