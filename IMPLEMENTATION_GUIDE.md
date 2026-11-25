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

## Local verification

1. Install project dependencies with the repository’s pnpm lockfile workflow, if needed.
2. Run the frontend checks with `pnpm build`.
3. Run backend tests with `go test ./...` from the repository root.
4. Start the application using the existing PocketFlow backend and Vite development server setup. The shopping endpoints need the backend and its configured database; the visual-only Vite server does not provide API persistence.
5. Sign in and verify create, quantity change, purchase toggle, status filters, deletion, and refresh persistence. Sign out and confirm the list shows the sign-in prompt. Use a second account to confirm items stay private.
6. Toggle light/dark from the header, refresh, and verify the preference remains selected; test the System choice in Settings against the OS color preference.

The database migration runner applies `004_shopping_items.sql` on startup as part of the existing ordered migration process. Deploy the backend and migration together; do not manually seed list rows.
