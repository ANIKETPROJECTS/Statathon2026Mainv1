---
name: Artifact routing in Replit
description: How Replit routes ports for artifact workflows vs the main webview, and how to configure both correctly.
---

## Rule
Replit has two separate preview surfaces:
1. **Main webview** (external port 80, local port 5000): driven by "Start application" workflow
2. **Canvas artifact preview** (e.g. external port 3000, local port 20792): driven by `artifacts/<name>: web` workflows

**Why:** The artifact system injects `PORT=<artifact_port>` into the artifact workflow environment. For `artifacts/csv-profiler: web`, Replit sets PORT=20792 (mapped to external 3000 in `.replit`). The "Start application" workflow is completely separate and serves port 5000 (external 80).

**Key behaviours:**
- Artifact workflows (`artifacts/<name>: web`) CANNOT be reconfigured via `configureWorkflow` — they are managed by the artifact system. Only the underlying npm script (package.json `dev`) can be changed.
- The `waitForPort` on an artifact workflow is set by Replit to the artifact's assigned port (e.g. 20792), not user-configurable.
- Duplicate `externalPort = 80` mappings in `.replit` cause routing ambiguity but cannot be fixed by direct file edit.

## Correct setup for this project (csv-profiler monorepo)

**"Start application" workflow** (main webview, port 5000):
- Command: `PORT=5000 node --enable-source-maps artifacts/api-server/dist/index.mjs`
- Serves production-built frontend + API on port 5000
- Requires dist files to exist (built by post-merge.sh)

**`artifacts/csv-profiler: web` workflow** (canvas artifact, port 20792):
- Command (fixed by system): `pnpm --filter @workspace/csv-profiler run dev`
- The `csv-profiler` dev script: `PORT=3001 pnpm --filter @workspace/api-server run dev & vite --config vite.config.ts --host 0.0.0.0`
- Starts API on port 3001 in background, Vite on PORT=20792 (injected by artifact system) in foreground
- Vite proxies /api → localhost:3001

**post-merge.sh** must build both frontend and backend so "Start application" can start instantly:
```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db push
pnpm --filter @workspace/csv-profiler run build
pnpm --filter @workspace/api-server run build
```

## How to apply
- If canvas shows 502: check that `artifacts/csv-profiler: web` is running (`listWorkflows()`). Restart it with `restartWorkflow`.
- If main webview shows 502: check that "Start application" is running on port 5000. The dist files must exist (run post-merge.sh or builds manually if missing).
- Never put "Start application" on port 3001 or 20792 — those are for the artifact workflows.
- Never put the artifact API server on port 5000 — that conflicts with "Start application".
