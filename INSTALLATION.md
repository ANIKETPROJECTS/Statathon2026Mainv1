# AIRAVATA DEA — Installation Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | Tested on Node 20 (LTS) |
| pnpm | 10+ | Required — npm/yarn are blocked |
| PostgreSQL | Any | Provided automatically on Replit |

> **On Replit:** All prerequisites are pre-configured. Skip straight to **Running the App**.

---

## 1. Clone & Install

```bash
# Clone the repository
git clone <your-repo-url>
cd airavata-dea

# Install all workspace dependencies
pnpm install
```

> pnpm workspaces installs dependencies for all packages simultaneously (`artifacts/`, `lib/`, `scripts/`).

---

## 2. Environment Variables

Copy the example below into a `.env` file at the project root (or set them in your hosting environment):

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
PORT=5000
```

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Port for the dev server (default: 5000) |
| `BASE_PATH` | No | URL base path if serving under a sub-path |

> **On Replit:** `DATABASE_URL` and all `PG*` variables are provisioned automatically via the built-in PostgreSQL integration. No manual setup needed.

---

## 3. Database Setup

Push the Drizzle schema to your database:

```bash
pnpm --filter @workspace/db run push
```

This is a no-op when no schema changes are pending.

---

## 4. Running the App

### Development (hot-reload)

```bash
# Start the frontend dev server on port 5000
cd artifacts/csv-profiler && pnpm dev

# Or from the workspace root:
pnpm --filter @workspace/csv-profiler run dev
```

Open `http://localhost:5000` in your browser.

### Production Build

```bash
# 1. Typecheck + build all packages
pnpm run build

# 2. Start the API server (serves the built frontend)
pnpm --filter @workspace/api-server run start
```

The API server will serve the static frontend from `artifacts/csv-profiler/dist/public` and expose `/api/*` routes.

---

## 5. Additional Commands

```bash
# Full typecheck across all packages
pnpm run typecheck

# Regenerate API hooks and Zod schemas from the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (dev only)
pnpm --filter @workspace/db run push
```

---

## 6. Project Structure

```
.
├── artifacts/
│   ├── csv-profiler/       # React 19 + Vite frontend (main app)
│   └── api-server/         # Express 5 API server
├── lib/
│   ├── db/                 # Drizzle ORM schema + migrations
│   ├── api-spec/           # OpenAPI spec (openapi.yaml) + Orval config
│   ├── api-client-react/   # Generated TanStack Query hooks
│   └── api-zod/            # Generated Zod validation schemas
├── scripts/
│   └── post-merge.sh       # Runs after merges: install + db push
├── package.json            # Workspace root
└── pnpm-workspace.yaml     # Workspace + dependency catalog
```

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `vite: not found` | Run `pnpm install` from the workspace root first |
| `DATABASE_URL` missing error | Set the env variable or provision the database |
| Port 5000 already in use | Set `PORT=<other>` in your environment |
| Schema out of sync | Run `pnpm --filter @workspace/db run push` |
| API codegen stale | Run `pnpm --filter @workspace/api-spec run codegen` |
