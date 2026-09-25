#!/usr/bin/env bash
# Render Free: один контейнер (512 МБ) на сайт и воркер.
# Миграции -> воркер в фоне (перезапуск при падении) -> сайт на переднем плане.
set -euo pipefail
cd "$(dirname "$0")/.."

node_modules/.bin/prisma migrate deploy

(
  while true; do
    NODE_OPTIONS="--max-old-space-size=160" node dist/worker.mjs || true
    echo "worker exited, restarting in 5s" >&2
    sleep 5
  done
) &

export NODE_OPTIONS="--max-old-space-size=256"
exec node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-10000}"
