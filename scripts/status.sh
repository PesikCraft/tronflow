#!/bin/zsh
# Состояние сервисов, здоровья и последних строк логов.
cd "${0:A:h}/.."
LOG_DIR="$HOME/Library/Logs/tronflow"
for name in web worker backup; do
  state=$(launchctl print "gui/$UID/com.tronflow.$name" 2>/dev/null | awk -F'= ' '/^\tstate/ {print $2; exit}')
  printf "%-8s %s\n" "$name" "${state:-не установлен}"
done
set -a; source ./.env 2>/dev/null; set +a
echo
echo "health: $(curl -s "http://127.0.0.1:${PORT:-3000}/api/health" || echo 'веб не отвечает')"
echo
echo "--- worker.log (последние 5 строк)"
tail -5 "$LOG_DIR/worker.log" 2>/dev/null
