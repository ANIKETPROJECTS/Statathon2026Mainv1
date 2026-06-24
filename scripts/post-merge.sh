#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db push
pnpm --filter @workspace/csv-profiler run build
pnpm --filter @workspace/api-server run build
