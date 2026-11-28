package server

import (
	"net/http"

	pocketflowapi "pocketflow/internal/api"
	"pocketflow/internal/store"
)

func NewAPIHandler(connectionString string) (http.Handler, error) {
	database, err := store.Open(connectionString)
	if err != nil {
		return nil, err
	}
	return pocketflowapi.New(database), nil
}
