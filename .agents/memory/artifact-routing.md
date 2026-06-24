---
name: Artifact routing in Replit
description: Why the public preview returned 502 and how the artifact workflow fixed it.
---

## Rule
When a Replit project has artifact-based workflows (named `artifacts/<name>: web`), the public preview URL is routed through Replit's artifact router to THOSE workflows — not to the generic "Start application" workflow.

**Why:** Replit's `REPLIT_ARTIFACT_ROUTER` routes traffic by artifact ID, not just by port number. The "Start application" workflow runs on port 5000 (accessible locally), but the artifact router doesn't know about it. Only artifact-prefixed workflows (e.g. `artifacts/csv-profiler: web`) are registered with the router.

**How to apply:** If the public URL returns 502 but `curl localhost:5000` returns 200, the artifact workflow is probably not running. Start `artifacts/<name>: web` via `restartWorkflow`. Also watch for duplicate `externalPort = 80` mappings in `.replit` — these cause routing ambiguity and can't be fixed by direct file edit (system blocks it); the artifact workflow approach resolves it independently.
