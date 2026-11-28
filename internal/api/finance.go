package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"pocketflow/internal/store"
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
	tx, err := a.store.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save financial record.")
		return
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(r.Context(), `INSERT INTO financial_records(id,user_id,resource,payload) VALUES(?,?,?,?) ON CONFLICT(user_id,resource,id) DO NOTHING`, input.ID, userID, resource, string(payload))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save financial record.")
		return
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save financial record.")
		return
	}
	if inserted == 0 {
		_ = tx.Rollback()
		var existing string
		err := a.store.DB.QueryRowContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource=? AND id=?`, userID, resource, input.ID).Scan(&existing)
		if err != nil || existing != string(payload) {
			writeError(w, http.StatusConflict, "A different record already uses this identifier.")
			return
		}
		writeFinancialRecord(w, r, http.StatusOK, a.store.DB, userID, resource, input.ID)
		return
	}
	if resource == "transactions" {
		if err := a.applyTransactionBalance(r.Context(), tx, userID, input.Data, 1); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to save financial record.")
		return
	}
	status := http.StatusCreated
	writeFinancialRecord(w, r, status, a.store.DB, userID, resource, input.ID)
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
	if resource == "accounts" && a.accountCurrencyIsLocked(r, userID, id, input.Data.Currency) {
		writeError(w, http.StatusConflict, "Account currency cannot change after transactions have been recorded against it.")
		return
	}
	if !a.validateFinancialReferences(r, userID, resource, &input.Data) || !validFinancialPayload(resource, input.Data) {
		writeError(w, http.StatusBadRequest, "One or more financial record fields are invalid or reference an unavailable account or category.")
		return
	}
	if resource == "transactions" {
		a.updateTransactionRecord(w, r, userID, id, input)
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
	if resource == "transactions" {
		a.deleteTransactionRecord(w, r, userID, id)
		return
	}
	if resource == "accounts" && a.accountHasTransactions(r, userID, id) {
		writeError(w, http.StatusConflict, "This account still has transactions. Delete or move those transactions before removing the account.")
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
	if resource == "transactions" && !a.ownsAccount(r, userID, payload) {
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

func (a *API) ownsAccount(r *http.Request, userID string, payload *financialPayload) bool {
	if payload.AccountID == "" || len(payload.AccountID) > 100 {
		return false
	}
	var encoded string
	err := a.store.DB.QueryRowContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource='accounts' AND id=?`, userID, payload.AccountID).Scan(&encoded)
	if err != nil {
		return false
	}
	var account financialPayload
	return json.Unmarshal([]byte(encoded), &account) == nil && account.Currency == payload.Currency
}

func (a *API) accountCurrencyIsLocked(r *http.Request, userID, accountID, currency string) bool {
	var encoded string
	if err := a.store.DB.QueryRowContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource='accounts' AND id=?`, userID, accountID).Scan(&encoded); err != nil {
		return false
	}
	var account financialPayload
	if json.Unmarshal([]byte(encoded), &account) != nil || account.Currency == currency {
		return false
	}
	return a.accountHasTransactions(r, userID, accountID)
}

func (a *API) accountHasTransactions(r *http.Request, userID, accountID string) bool {
	rows, err := a.store.DB.QueryContext(r.Context(), `SELECT payload FROM financial_records WHERE user_id=? AND resource='transactions'`, userID)
	if err != nil {
		return true
	}
	defer rows.Close()
	for rows.Next() {
		var transactionJSON string
		var transaction financialPayload
		if rows.Scan(&transactionJSON) != nil || json.Unmarshal([]byte(transactionJSON), &transaction) != nil {
			return true
		}
		if transaction.AccountID == accountID {
			return true
		}
	}
	return rows.Err() != nil
}

func validFinancialPayload(resource string, p financialPayload) bool {
	if len(p.Currency) != 3 || strings.ToUpper(p.Currency) != p.Currency {
		return false
	}
	switch resource {
	case "accounts":
		return p.Name != "" && len(p.Name) <= 120 && len(p.Institution) <= 120 && len(p.AccountType) <= 40 && p.BalanceMinor >= -9_000_000_000_000_000 && p.BalanceMinor <= 9_000_000_000_000_000
	case "transactions":
		_, err := time.Parse(time.RFC3339, p.OccurredAt)
		return p.Description != "" && len(p.Description) <= 200 && p.AmountMinor > 0 && p.AmountMinor <= 9_000_000_000_000_000 && p.AccountID != "" && len(p.AccountID) <= 100 && p.CategoryID != "" && (p.Kind == "income" || p.Kind == "expense" || p.Kind == "transfer") && err == nil && len(p.Category) <= 80
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

func transactionBalanceDelta(payload financialPayload) int64 {
	if payload.Kind == "income" {
		return payload.AmountMinor
	}
	return -payload.AmountMinor
}

func (a *API) applyTransactionBalance(ctx context.Context, tx *store.Tx, userID string, payload financialPayload, direction int64) error {
	return a.applyAccountBalanceChange(ctx, tx, userID, payload.AccountID, payload.Currency, transactionBalanceDelta(payload)*direction)
}

func (a *API) applyAccountBalanceChange(ctx context.Context, tx *store.Tx, userID, accountID, currency string, delta int64) error {
	if delta == 0 {
		return nil
	}
	query := a.store.DB.ForUpdate(`SELECT payload FROM financial_records WHERE user_id=? AND resource='accounts' AND id=?`)
	var encoded string
	if err := tx.QueryRowContext(ctx, query, userID, accountID).Scan(&encoded); err != nil {
		return fmt.Errorf("The account for this transaction is unavailable.")
	}
	var account financialPayload
	if err := json.Unmarshal([]byte(encoded), &account); err != nil {
		return fmt.Errorf("The saved account balance is invalid.")
	}
	if account.Currency != currency {
		return fmt.Errorf("The transaction currency must match the selected account.")
	}
	account.BalanceMinor += delta
	if account.BalanceMinor < -9_000_000_000_000_000 || account.BalanceMinor > 9_000_000_000_000_000 {
		return fmt.Errorf("This transaction would put the account balance outside the supported range.")
	}
	updated, err := json.Marshal(account)
	if err != nil {
		return fmt.Errorf("Unable to update the account balance.")
	}
	_, err = tx.ExecContext(ctx, `UPDATE financial_records SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND resource='accounts' AND id=?`, string(updated), userID, accountID)
	if err != nil {
		return fmt.Errorf("Unable to update the account balance.")
	}
	return nil
}

func (a *API) updateTransactionRecord(w http.ResponseWriter, r *http.Request, userID, id string, input financialMutation) {
	ctx := r.Context()
	tx, err := a.store.DB.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update transaction.")
		return
	}
	defer tx.Rollback()
	query := a.store.DB.ForUpdate(`SELECT payload FROM financial_records WHERE user_id=? AND resource='transactions' AND id=?`)
	var previousPayload string
	if err := tx.QueryRowContext(ctx, query, userID, id).Scan(&previousPayload); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Financial record not found.")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load transaction.")
		return
	}
	var previous financialPayload
	if err := json.Unmarshal([]byte(previousPayload), &previous); err != nil {
		writeError(w, http.StatusInternalServerError, "A saved transaction is invalid.")
		return
	}
	payload, err := json.Marshal(input.Data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid transaction.")
		return
	}
	result, err := tx.ExecContext(ctx, `UPDATE financial_records SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND resource='transactions' AND id=? AND version=?`, string(payload), userID, id, input.Version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update transaction.")
		return
	}
	changed, _ := result.RowsAffected()
	if changed == 0 {
		writeError(w, http.StatusConflict, "This record changed on another device. Refresh it before saving your changes.")
		return
	}
	type accountChange struct {
		currency string
		delta    int64
	}
	changes := map[string]accountChange{}
	addChange := func(accountID, currency string, delta int64) bool {
		change := changes[accountID]
		if change.currency != "" && change.currency != currency {
			return false
		}
		change.currency = currency
		change.delta += delta
		changes[accountID] = change
		return true
	}
	if !addChange(previous.AccountID, previous.Currency, -transactionBalanceDelta(previous)) || !addChange(input.Data.AccountID, input.Data.Currency, transactionBalanceDelta(input.Data)) {
		writeError(w, http.StatusBadRequest, "The account currency must match the transaction currency.")
		return
	}
	accountIDs := make([]string, 0, len(changes))
	for accountID := range changes {
		accountIDs = append(accountIDs, accountID)
	}
	sort.Strings(accountIDs)
	for _, accountID := range accountIDs {
		change := changes[accountID]
		if err := a.applyAccountBalanceChange(ctx, tx, userID, accountID, change.currency, change.delta); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to update transaction.")
		return
	}
	writeFinancialRecord(w, r, http.StatusOK, a.store.DB, userID, "transactions", id)
}

func (a *API) deleteTransactionRecord(w http.ResponseWriter, r *http.Request, userID, id string) {
	ctx := r.Context()
	tx, err := a.store.DB.BeginTx(ctx, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete transaction.")
		return
	}
	defer tx.Rollback()
	query := a.store.DB.ForUpdate(`SELECT payload FROM financial_records WHERE user_id=? AND resource='transactions' AND id=?`)
	var encoded string
	if err := tx.QueryRowContext(ctx, query, userID, id).Scan(&encoded); errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Financial record not found.")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to load transaction.")
		return
	}
	var transaction financialPayload
	if err := json.Unmarshal([]byte(encoded), &transaction); err != nil {
		writeError(w, http.StatusInternalServerError, "A saved transaction is invalid.")
		return
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM financial_records WHERE user_id=? AND resource='transactions' AND id=?`, userID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete transaction.")
		return
	}
	if err := a.applyTransactionBalance(ctx, tx, userID, transaction, -1); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to delete transaction.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeFinancialRecord(w http.ResponseWriter, r *http.Request, status int, db *store.DB, userID, resource, id string) {
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
