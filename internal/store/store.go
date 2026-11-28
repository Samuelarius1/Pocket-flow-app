package store

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Store struct {
	DB *DB
}

type DB struct {
	*sql.DB
	dialect string
}

type Tx struct {
	*sql.Tx
	db *DB
}

func Open(path string) (*Store, error) {
	if strings.HasPrefix(path, "postgres://") || strings.HasPrefix(path, "postgresql://") {
		database, err := sql.Open("pgx", path)
		if err != nil {
			return nil, fmt.Errorf("open postgres: %w", err)
		}
		database.SetMaxOpenConns(10)
		database.SetMaxIdleConns(5)
		database.SetConnMaxLifetime(5 * time.Minute)
		wrapped := &DB{DB: database, dialect: "postgres"}
		if err := database.Ping(); err != nil {
			database.Close()
			return nil, fmt.Errorf("connect to postgres: %w", err)
		}
		if err := runPostgresMigrations(wrapped); err != nil {
			database.Close()
			return nil, err
		}
		return &Store{DB: wrapped}, nil
	}

	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	database.SetMaxOpenConns(1)
	if _, err := database.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;`); err != nil {
		database.Close()
		return nil, fmt.Errorf("configure sqlite: %w", err)
	}
	if err := runMigrations(database); err != nil {
		database.Close()
		return nil, err
	}
	return &Store{DB: &DB{DB: database, dialect: "sqlite"}}, nil
}

func (db *DB) rewrite(query string) string {
	if db.dialect != "postgres" {
		return query
	}
	query = strings.ReplaceAll(query, "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP::text")
	var result strings.Builder
	result.Grow(len(query) + 16)
	placeholder := 1
	inSingle, inDouble := false, false
	for i := 0; i < len(query); i++ {
		character := query[i]
		if character == '\'' && !inDouble {
			result.WriteByte(character)
			if inSingle && i+1 < len(query) && query[i+1] == '\'' {
				result.WriteByte(query[i+1])
				i++
				continue
			}
			inSingle = !inSingle
			continue
		}
		if character == '"' && !inSingle {
			inDouble = !inDouble
		}
		if character == '?' && !inSingle && !inDouble {
			fmt.Fprintf(&result, "$%d", placeholder)
			placeholder++
			continue
		}
		result.WriteByte(character)
	}
	return result.String()
}

func (db *DB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return db.DB.ExecContext(ctx, db.rewrite(query), args...)
}

func (db *DB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return db.DB.QueryContext(ctx, db.rewrite(query), args...)
}

func (db *DB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return db.DB.QueryRowContext(ctx, db.rewrite(query), args...)
}

func (db *DB) BeginTx(ctx context.Context, options *sql.TxOptions) (*Tx, error) {
	tx, err := db.DB.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &Tx{Tx: tx, db: db}, nil
}

func (tx *Tx) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return tx.Tx.ExecContext(ctx, tx.db.rewrite(query), args...)
}

func (tx *Tx) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return tx.Tx.QueryContext(ctx, tx.db.rewrite(query), args...)
}

func (tx *Tx) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	return tx.Tx.QueryRowContext(ctx, tx.db.rewrite(query), args...)
}

func (db *DB) ForUpdate(query string) string {
	if db.dialect == "postgres" {
		return query + " FOR UPDATE"
	}
	return query
}

func runPostgresMigrations(db *DB) error {
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text))`); err != nil {
		return fmt.Errorf("initialize postgres migration tracking: %w", err)
	}
	var applied int
	err := db.QueryRowContext(ctx, `SELECT 1 FROM schema_migrations WHERE version=?`, 1).Scan(&applied)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("check postgres migration: %w", err)
	}
	sqlText, err := migrationFiles.ReadFile("migrations/005_postgres_online.sql")
	if err != nil {
		return fmt.Errorf("read postgres migration: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start postgres migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, string(sqlText)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("apply postgres migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES(?)`, 1); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record postgres migration: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit postgres migration: %w", err)
	}
	return nil
}

func runMigrations(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`); err != nil {
		return fmt.Errorf("initialize migration tracking: %w", err)
	}
	files, err := fs.Glob(migrationFiles, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Strings(files)
	for _, file := range files {
		name := strings.TrimSuffix(path.Base(file), ".sql")
		if strings.Contains(name, "_postgres") {
			continue
		}
		versionText, _, ok := strings.Cut(name, "_")
		if !ok {
			return fmt.Errorf("invalid migration filename %q", name)
		}
		version, err := strconv.Atoi(versionText)
		if err != nil {
			return fmt.Errorf("invalid migration version %q: %w", name, err)
		}
		var alreadyApplied int
		err = db.QueryRow(`SELECT 1 FROM schema_migrations WHERE version=?`, version).Scan(&alreadyApplied)
		if err == nil {
			continue
		}
		if err != sql.ErrNoRows {
			return fmt.Errorf("check migration %d: %w", version, err)
		}
		sqlText, err := migrationFiles.ReadFile(file)
		if err != nil {
			return fmt.Errorf("read migration %d: %w", version, err)
		}
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("start migration %d: %w", version, err)
		}
		if _, err = tx.Exec(string(sqlText)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if _, err = tx.Exec(`INSERT INTO schema_migrations(version) VALUES(?)`, version); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", version, err)
		}
		if err = tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", version, err)
		}
	}
	return nil
}
