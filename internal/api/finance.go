package api

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type financialPayload struct {
	Name         string `json:"name,omitempty"`
	Institution  string `json:"institution,omitempty"`
	AccountType  string `json:"accountType,omitempty"`
	Currency     string `json:"currency,omitempty"`
	BalanceMinor int64  `json:"balanceMinor,omitempty"`
	AccountID    string `json:"accountId,omitempty"`
	Category     string `json:"category,omitempty"`
	CategoryID   string `json:"categoryId,omitempty"`
	Description  string `json:"description,omitempty"`
	AmountMinor  int64  `json:"amountMinor,omitempty"`
	Kind         string `json:"kind,omitempty"`
	OccurredAt   string `json:"occurredAt,omitempty"`
	PeriodStart  string `json:"periodStart,omitempty"`
	PeriodEnd    string `json:"periodEnd,omitempty"`
	TargetMinor  int64  `json:"targetMinor,omitempty"`
	SavedMinor   int64  `json:"savedMinor,omitempty"`
	TargetDate   string `json:"targetDate,omitempty"`
}

type financialRecord struct {
	ID        string           `json:"id"`
	Version   int64            `json:"version"`
	Data      financialPayload `json:"data"`
	UpdatedAt string           `json:"updatedAt"`
}

type financialMutation struct {
	ID      string           `json:"id"`
	Version int64            `json:"version,omitempty"`
	Data    financialPayload `json:"data"`
}

var financialResources = map[string]bool{
	"accounts": true, "transactions": true, "budgets": true, "goals": true,
}

type financialCursor struct {
	UpdatedAt string `json:"updatedAt"`
	ID        string `json:"id"`
}

func encodeFinancialCursor(cursor financialCursor) string {
	encoded, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func decodeFinancialCursor(value string) (*financialCursor, bool) {
	if value == "" {
		return nil, true
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return nil, false
	}
	var cursor financialCursor
	if err := json.Unmarshal(decoded, &cursor); err != nil || cursor.ID == "" || cursor.UpdatedAt == "" || len(cursor.ID) > 100 {
		return nil, false
	}
	return &cursor, true
}

func (a *API) getFinancialRecords(w http.ResponseWriter, r *http.Request) {
	resource, ok := getFinancialResource(w, r)
	if !ok {
		return
	}
	limit := 50
	if rawLimit := r.URL.Query().Get("limit"); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "Page size must be between 1 and 100.")
			return
		}
		limit = parsed
	}
	cursor, ok := decodeFinancialCursor(r.URL.Query().Get("cursor"))
	if !ok {
		writeError(w, http.StatusBadRequest, "Invalid page cursor.")
		return
	}
	userID := r.Context().Value(userContextKey{}).(string)
	query := `SELECT id, version, payload, updated_at FROM financial_records WHERE user_id=? AND resource=?`
	args := []any{userID, resource}
	if cursor != nil {
		query += ` AND (updated_at < ? OR (updated_at = ? AND id > ?))`
		args = append(args, cursor.UpdatedAt, cursor.UpdatedAt, cursor.ID)
	}
	query += ` ORDER BY updated_at DESC, id ASC LIMIT ?`
	args = append(args, limit+1)
	rows, err := a.store.DB.QueryContext(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load financial records.")
		return
	}
	defer rows.Close()
	records := make([]financialRecord, 0, limit+1)
	for rows.Next() {
		var record financialRecord
		var payload string
		if err := rows.Scan(&record.ID, &record.Version, &payload, &record.UpdatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to load financial records.")
			return
		}
		if err := json.Unmarshal([]byte(payload), &record.Data); err != nil {
			writeError(w, http.StatusInternalServerError, "A saved financial record is invalid.")
			return
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load financial records.")
		return
	}
	nextCursor := ""
	if len(records) > limit {
		records = records[:limit]
		last := records[len(records)-1]
		nextCursor = encodeFinancialCursor(financialCursor{UpdatedAt: last.UpdatedAt, ID: last.ID})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": records, "nextCursor": nextCursor})
}

func (a *API) createFinancialRecord(w http.ResponseWriter, r *http.Request) {
	resource, ok := getFinancialResource(w, r)
	if !ok {
		return
	}
	var input financialMutation
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.ID == "" {
		id, err := randomID()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Unable to create financial record.")
			return
		}
		input.ID = id
	}
	if len(input.ID) > 100 {
		writeError(w, http.StatusBadRequest, "One or more financial record fields are invalid.")
		return
	}
	userID := r.Context().Value(userContextKey{}).(string)
	if !a.validateFinancialReferences(r, userID, resource, &input.Data) || !validFinancialPayload(resource, input.Data) {
		writeError(w, http.StatusBadRequest, "One or more financial record fields are invalid or reference an unavailable account or category.")
		return
	}
	payload, err := json.Marshal(input.Data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid financial record.")
		return
	}
	result, err := a.store.DB.ExecContext(r.Context(), `INSERT INTO financial_records(id,user_id,resource,payload) VALUES(?,?,?,?) ON CONFLICT(user_id,resource,id) DO NOTHING`, input.ID, userID, resource, string(payload))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save financial record.")
		return
	}
	inserted, _ := result.RowsAffected()
	if inserted == 0 {
		var existing string
		err := a.store.DB.QueryRowContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource=? AND id=?`, userID, resource, input.ID).Scan(&existing)
		if err != nil || existing != string(payload) {
			writeError(w, http.StatusConflict, "A different record already uses this identifier.")
			return
		}
		writeFinancialRecord(w, r, http.StatusOK, a.store.DB, userID, resource, input.ID)
		return
	}
	writeFinancialRecord(w, r, http.StatusCreated, a.store.DB, userID, resource, input.ID)
}

func (a *API) updateFinancialRecord(w http.ResponseWriter, r *http.Request) {
	resource, ok := getFinancialResource(w, r)
	if !ok {
		return
	}
	var input financialMutation
	if !decodeJSON(w, r, &input) {
		return
	}
	if input.Version < 1 || len(r.PathValue("id")) > 100 {
		writeError(w, http.StatusBadRequest, "A valid current version and financial record are required.")
		return
	}
	userID, id := r.Context().Value(userContextKey{}).(string), r.PathValue("id")
	if !a.validateFinancialReferences(r, userID, resource, &input.Data) || !validFinancialPayload(resource, input.Data) {
		writeError(w, http.StatusBadRequest, "One or more financial record fields are invalid or reference an unavailable account or category.")
		return
	}
	payload, err := json.Marshal(input.Data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid financial record.")
		return
	}
	result, err := a.store.DB.ExecContext(r.Context(), `UPDATE financial_records SET payload=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND resource=? AND id=? AND version=?`, string(payload), userID, resource, id, input.Version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update financial record.")
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		var exists int
		if err := a.store.DB.QueryRowContext(r.Context(), `SELECT 1 FROM financial_records WHERE user_id=? AND resource=? AND id=?`, userID, resource, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "Financial record not found.")
			return
		}
		writeError(w, http.StatusConflict, "This record changed on another device. Refresh it before saving your changes.")
		return
	}
	writeFinancialRecord(w, r, http.StatusOK, a.store.DB, userID, resource, id)
}

func (a *API) deleteFinancialRecord(w http.ResponseWriter, r *http.Request) {
	resource, ok := getFinancialResource(w, r)
	if !ok {
		return
	}
	userID, id := r.Context().Value(userContextKey{}).(string), r.PathValue("id")
	if id == "" || len(id) > 100 {
		writeError(w, http.StatusBadRequest, "A valid record identifier is required.")
		return
	}
	result, err := a.store.DB.ExecContext(r.Context(), `DELETE FROM financial_records WHERE user_id=? AND resource=? AND id=?`, userID, resource, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete financial record.")
		return
	}
	deleted, _ := result.RowsAffected()
	if deleted == 0 {
		writeError(w, http.StatusNotFound, "Financial record not found.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func getFinancialResource(w http.ResponseWriter, r *http.Request) (string, bool) {
	resource := r.PathValue("resource")
	if !financialResources[resource] {
		writeError(w, http.StatusNotFound, "Financial resource not found.")
		return "", false
	}
	return resource, true
}

func (a *API) validateFinancialReferences(r *http.Request, userID, resource string, payload *financialPayload) bool {
	if resource == "transactions" && !a.ownsAccount(r, userID, payload.AccountID) {
		return false
	}
	if resource != "transactions" && resource != "budgets" {
		return true
	}
	categoryKind := payload.Kind
	if resource == "budgets" {
		categoryKind = "expense"
	}
	name, ok := a.resolveCategory(r, userID, payload.CategoryID, categoryKind)
	if !ok {
		return false
	}
	payload.Category = name
	return true
}

func (a *API) ownsAccount(r *http.Request, userID, accountID string) bool {
	if accountID == "" || len(accountID) > 100 {
		return false
	}
	var exists int
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT 1 FROM financial_records WHERE user_id=? AND resource='accounts' AND id=?`, userID, accountID).Scan(&exists)
	return err == nil
}

func validFinancialPayload(resource string, p financialPayload) bool {
	if len(p.Currency) != 3 || strings.ToUpper(p.Currency) != p.Currency {
		return false
	}
	switch resource {
	case "accounts":
		return p.Name != "" && len(p.Name) <= 120 && len(p.Institution) <= 120 && len(p.AccountType) <= 40
	case "transactions":
		_, err := time.Parse(time.RFC3339, p.OccurredAt)
		return p.Description != "" && len(p.Description) <= 200 && p.AmountMinor > 0 && p.AccountID != "" && len(p.AccountID) <= 100 && p.CategoryID != "" && (p.Kind == "income" || p.Kind == "expense" || p.Kind == "transfer") && err == nil && len(p.Category) <= 80
	case "budgets":
		start, startErr := time.Parse("2006-01-02", p.PeriodStart)
		end, endErr := time.Parse("2006-01-02", p.PeriodEnd)
		return p.CategoryID != "" && len(p.Category) <= 80 && p.AmountMinor > 0 && startErr == nil && endErr == nil && !end.Before(start)
	case "goals":
		if p.Name == "" || len(p.Name) > 120 || p.TargetMinor <= 0 || p.SavedMinor < 0 {
			return false
		}
		if p.TargetDate == "" {
			return true
		}
		_, err := time.Parse("2006-01-02", p.TargetDate)
		return err == nil
	default:
		return false
	}
}

func writeFinancialRecord(w http.ResponseWriter, r *http.Request, status int, db *sql.DB, userID, resource, id string) {
	var record financialRecord
	var payload string
	if err := db.QueryRowContext(r.Context(), `SELECT id,version,payload,updated_at FROM financial_records WHERE user_id=? AND resource=? AND id=?`, userID, resource, id).Scan(&record.ID, &record.Version, &payload, &record.UpdatedAt); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load saved financial record.")
		return
	}
	if err := json.Unmarshal([]byte(payload), &record.Data); err != nil {
		writeError(w, http.StatusInternalServerError, "A saved financial record is invalid.")
		return
	}
	writeJSON(w, status, record)
}
