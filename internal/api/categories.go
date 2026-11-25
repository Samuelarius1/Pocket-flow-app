package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"
)

type financialCategory struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Kind  string `json:"kind"`
	Color string `json:"color"`
}

var categoryColorPattern = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)

func (a *API) listCategories(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value(userContextKey{}).(string)
	rows, err := a.store.DB.QueryContext(r.Context(), `SELECT id,name,kind,color FROM financial_categories WHERE user_id IS NULL OR user_id=? ORDER BY kind,name`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load categories.")
		return
	}
	defer rows.Close()
	items := make([]financialCategory, 0)
	for rows.Next() {
		var item financialCategory
		if err := rows.Scan(&item.ID, &item.Name, &item.Kind, &item.Color); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load categories.")
			return
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load categories.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) createCategory(w http.ResponseWriter, r *http.Request) {
	var input financialCategory
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len(input.Name) > 60 || (input.Kind != "income" && input.Kind != "expense" && input.Kind != "transfer") {
		writeError(w, http.StatusBadRequest, "Enter a category name and a valid transaction type.")
		return
	}
	if input.Color == "" {
		input.Color = "#0C8B5B"
	}
	if !categoryColorPattern.MatchString(input.Color) {
		writeError(w, http.StatusBadRequest, "Choose a valid six-digit color.")
		return
	}
	userID := r.Context().Value(userContextKey{}).(string)
	var duplicate int
	if err := a.store.DB.QueryRowContext(r.Context(), `SELECT 1 FROM financial_categories WHERE kind=? AND lower(name)=lower(?) AND (user_id IS NULL OR user_id=?) LIMIT 1`, input.Kind, input.Name, userID).Scan(&duplicate); err == nil {
		writeError(w, http.StatusConflict, "A category with that name already exists.")
		return
	}
	id, err := randomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create category.")
		return
	}
	if _, err := a.store.DB.ExecContext(r.Context(), `INSERT INTO financial_categories(id,user_id,name,kind,color) VALUES(?,?,?,?,?)`, id, userID, input.Name, input.Kind, input.Color); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to create category.")
		return
	}
	input.ID = id
	writeJSON(w, http.StatusCreated, input)
}

func (a *API) deleteCategory(w http.ResponseWriter, r *http.Request) {
	userID, id := r.Context().Value(userContextKey{}).(string), r.PathValue("id")
	if id == "" || len(id) > 100 {
		writeError(w, http.StatusBadRequest, "A valid category identifier is required.")
		return
	}
	var payloads []string
	rows, err := a.store.DB.QueryContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource='transactions'`, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to check category usage.")
		return
	}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "Unable to check category usage.")
			return
		}
		payloads = append(payloads, payload)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(w, http.StatusInternalServerError, "Unable to check category usage.")
		return
	}
	rows.Close()
	for _, payload := range payloads {
		var record financialPayload
		if json.Unmarshal([]byte(payload), &record) == nil && record.CategoryID == id {
			writeError(w, http.StatusConflict, "This category is used by a transaction and cannot be removed.")
			return
		}
	}
	result, err := a.store.DB.ExecContext(r.Context(), `DELETE FROM financial_categories WHERE user_id=? AND id=?`, userID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete category.")
		return
	}
	deleted, _ := result.RowsAffected()
	if deleted == 0 {
		writeError(w, http.StatusNotFound, "Custom category not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) resolveCategory(r *http.Request, userID, categoryID, kind string) (string, bool) {
	var name string
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT name FROM financial_categories WHERE id=? AND kind=? AND (user_id IS NULL OR user_id=?)`, categoryID, kind, userID).Scan(&name)
	return name, err == nil
}
