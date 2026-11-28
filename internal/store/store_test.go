package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenUpgradesLegacyDatabaseWithoutLosingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pocketflow.db")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := migrationFiles.ReadFile("migrations/001_init.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := legacy.Exec(string(migration)); err != nil {
		t.Fatalf("apply legacy schema: %v", err)
	}
	if _, err := legacy.Exec(`INSERT INTO schema_migrations(version) VALUES(1)`); err != nil {
		t.Fatalf("record legacy schema: %v", err)
	}
	if _, err := legacy.Exec(`INSERT INTO users(id,email,display_name,password_hash) VALUES('legacy-user','legacy@example.test','Legacy User','hash')`); err != nil {
		t.Fatalf("insert legacy user: %v", err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	for attempt := 0; attempt < 2; attempt++ {
		database, err := Open(path)
		if err != nil {
			t.Fatalf("Open() attempt %d: %v", attempt+1, err)
		}
		var applied int
		if err := database.DB.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&applied); err != nil {
			t.Fatalf("read migration count: %v", err)
		}
		if applied != 4 {
			t.Fatalf("expected 4 migrations, got %d", applied)
		}
		var email string
		if err := database.DB.QueryRow(`SELECT email FROM users WHERE id='legacy-user'`).Scan(&email); err != nil {
			t.Fatalf("read legacy user: %v", err)
		}
		if email != "legacy@example.test" {
			t.Fatalf("legacy user changed during migration: %s", email)
		}
		if attempt == 0 {
			if _, err := database.DB.Exec(`INSERT INTO financial_records(id,user_id,resource,payload) VALUES('account','legacy-user','accounts','{}')`); err != nil {
				t.Fatalf("insert financial record: %v", err)
			}
		}
		if err := database.DB.Close(); err != nil {
			t.Fatalf("close db: %v", err)
		}
	}
	database, err := Open(path)
	if err != nil {
		t.Fatalf("reopen after existing records: %v", err)
	}
	defer database.DB.Close()
	var count int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM financial_records`).Scan(&count); err != nil {
		t.Fatalf("read records: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected existing record to survive reopen, got %d", count)
	}
}

func TestPostgresMigrationWhenConfigured(t *testing.T) {
	connectionString := os.Getenv("DATABASE_URL")
	if connectionString == "" {
		t.Skip("DATABASE_URL is not configured")
	}
	database, err := Open(connectionString)
	if err != nil {
		t.Fatalf("open configured postgres database: %v", err)
	}
	defer database.DB.Close()
	var categoryCount int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM financial_categories WHERE id LIKE 'system-%'`).Scan(&categoryCount); err != nil {
		t.Fatalf("read seeded categories: %v", err)
	}
	if categoryCount < 12 {
		t.Fatalf("expected 12 system categories, got %d", categoryCount)
	}
}
