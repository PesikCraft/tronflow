#!/bin/zsh
# Ежедневный бэкап БД (pg_dump custom format) + ротация логов. Хранит 14 последних дней.
# Восстановление: pg_restore --clean --if-exists --no-owner -d tronflow <файл.dump>
set -euo pipefail
cd "${0:A:h}/.."
if [[ -z "${DATABASE_URL:-}" ]]; then
  set -a; source ./.env; set +a
fi

BACKUP_DIR="${BACKUP_DIR:-$HOME/tronflow-backups}"
LOG_DIR="$HOME/Library/Logs/tronflow"
mkdir -p "$BACKUP_DIR"

PG_DUMP="$(brew --prefix postgresql@17 2>/dev/null)/bin/pg_dump"
[[ -x "$PG_DUMP" ]] || PG_DUMP="$(command -v pg_dump)"

FILE="$BACKUP_DIR/tronflow_$(date +%F_%H%M).dump"
"$PG_DUMP" --format=custom --no-owner --dbname="$DATABASE_URL" --file="$FILE"
echo "$(date '+%F %T') backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
find "$BACKUP_DIR" -name 'tronflow_*.dump' -mtime +14 -delete

# Логи launchd не ротируются сами: > 20 МБ — сохраняем копию и обнуляем
for f in "$LOG_DIR"/*.log(N); do
  if [[ $(stat -f%z "$f") -gt 20000000 ]]; then
    cp "$f" "$f.1" && : > "$f"
  fi
done
