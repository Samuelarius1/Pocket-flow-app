# PocketFlow shopping list and theme toggle

## Feature overview

The Shopping list section lets a signed-in person add items and quantities, mark items as picked up, adjust quantities, filter by status, and remove one or all completed items. It displays live completion progress, loading and error states, and a useful empty state. New accounts start with an empty list; no sample or seeded shopping items are created.

## Where the implementation lives

- `web/src/components/ShoppingWorkspace.tsx` — list UI, empty/loading/error/sign-in states, filtering, item controls, and API requests.
- `web/src/App.tsx` — section routing, mobile navigation, and the persistent header theme switch.
- `web/src/components/Sidebar.tsx` — desktop navigation entry.
- `web/src/components/ShoppingWorkspace.css` — responsive shopping UI styles, using the theme tokens defined in `web/src/styles.css`.
- `internal/api/shopping.go` — authenticated list/create/update/delete handlers, input validation, and version checks.
- `internal/api/api.go` — registers the authenticated `/api/shopping` endpoints.
- `internal/store/migrations/004_shopping_items.sql` — per-user, versioned table and list index.

## Data model and API

`shopping_items` stores `id`, `user_id`, `name`, `quantity`, `purchased`, `version`, `created_at`, and `updated_at`. The composite `(user_id, id)` primary key, foreign key cascade, and per-user query predicates prevent one account from reading or editing another account’s items. Database constraints and handler validation enforce a 1–120 character item name and a quantity from 1–999. Updates require the current `version`; a stale update returns a conflict instead of silently overwriting another device’s change.

- `GET /api/shopping` — return the signed-in user’s items.
- `POST /api/shopping` — create a validated item.
- `PUT /api/shopping/{id}` — update name, quantity, or purchased status with optimistic concurrency.
- `DELETE /api/shopping/{id}` — remove an item.

All routes use the existing account authentication middleware. The frontend requests with credentials, uses SWR for cached/revalidated reads, and refreshes server data after mutations. An unauthenticated user sees a sign-in prompt instead of fake or demo content.

## Theme toggle

A Sun/Moon control in the top application bar switches directly between light and dark mode. It calls the same `changePreferences` handler as Settings, so the selection is applied immediately to `document.documentElement.dataset.theme`, saved with the existing offline preference store, and synchronized to the account when available. Theme palettes are already tokenized in `styles.css`; `system` remains an available Settings preference and honors `prefers-color-scheme`. The header control advertises its destination with an accessible label and title.

## Run the app from VS Code

### 1. Install prerequisites

Install VS Code, Git, Go 1.24 or newer, Node.js, and pnpm. In VS Code, open the repository root folder (the folder containing `go.mod` and `package.json`), not the `web` folder. If prompted, install the recommended Go and JavaScript/TypeScript extensions.

### 2. Install frontend packages

Open **Terminal → New Terminal** in VS Code. Confirm the terminal is at the repository root, then run:

```sh
pnpm install
```

### 3. Start the backend

Open a second VS Code terminal at the repository root and run:

```sh
APP_ENV=development go run ./cmd/server
```

This starts the API at `http://localhost:8080`, creates `data/pocketflow.db` if needed, and applies database migrations—including `004_shopping_items.sql`—automatically. `APP_ENV=development` is important for local sign-in cookies over HTTP. Keep this terminal running.

**Windows PowerShell:** use this equivalent command instead:

```powershell
$env:APP_ENV = "development"; go run ./cmd/server
```

### 4. Start the frontend

Open a third VS Code terminal at the repository root and run:

```sh
pnpm dev
```

Open the local URL Vite prints (normally `http://localhost:5173`). The Vite development server proxies `/api` requests to the backend on port 8080, so keep both backend and frontend terminals running.

### 5. Try the features

Create an account or sign in, open **Shopping**, add an item, change its quantity, mark it purchased, and refresh to confirm it remains saved. Use the header control to switch light/dark themes and refresh to confirm the choice persists. The app starts with no demo shopping items; an empty list before adding items is expected.

### Troubleshooting

- **`pnpm` not found:** install/enable pnpm, then restart the VS Code terminal.
- **`go` not found:** install Go 1.24 or newer, restart VS Code, and check that `go version` works in the integrated terminal.
- **API/network errors:** make sure the backend terminal is still running on port 8080. If port 8080 is already occupied, stop the other process or configure `POCKETFLOW_ADDR` to another address and update the proxy in `web/vite.config.ts` to match.
- **Sign-in cookie does not persist locally:** start the backend with `APP_ENV=development` as shown above.
- **Reset local data:** stop the backend and back up or remove `data/pocketflow.db`; restarting creates a fresh local database. This deletes local accounts and app data.

## Local verification

From the repository root in the VS Code terminal:

```sh
pnpm build
go test ./...
```

To verify shopping, sign in and test create, quantity change, purchase toggle, status filters, deletion, and refresh persistence. Sign out and confirm the list shows the sign-in prompt. Use a second account to confirm items stay private. Toggle light/dark from the header, refresh, and test the System choice in Settings against the OS color preference.

The database migration runner applies `004_shopping_items.sql` on startup as part of the existing ordered migration process. Deploy the backend and migration together; do not manually seed list rows.
