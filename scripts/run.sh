#!/bin/zsh
# Точка входа для launchd: загружает .env и запускает нужный процесс.
#   scripts/run.sh web | worker | backup
set -euo pipefail
cd "${0:A:h}/.."
set -a
source ./.env
set +a
export NODE_ENV=production

case "${1:-}" in
  web)
    exec ./node_modules/.bin/next start -H "${HOST:-127.0.0.1}" -p "${PORT:-3000}"
    ;;
  worker)
    # Пока воркер жив, Mac не засыпает (на питании от сети). caffeinate следит за PID и завершится вместе с ним.
    /usr/bin/caffeinate -is -w $$ &
    exec ./node_modules/.bin/tsx worker/index.ts
    ;;
  backup)
    exec ./scripts/backup.sh
    ;;
  *)
    echo "usage: $0 web|worker|backup" >&2
    exit 2
    ;;
esac
