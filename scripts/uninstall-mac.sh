#!/bin/zsh
# Останавливает и удаляет сервисы launchd. База данных, бэкапы и .env НЕ удаляются.
for name in web worker backup; do
  launchctl bootout "gui/$UID/com.tronflow.$name" 2>/dev/null && echo "остановлен com.tronflow.$name"
  rm -f "$HOME/Library/LaunchAgents/com.tronflow.$name.plist"
done
echo "Готово. Удалить данные: dropdb tronflow; rm -rf ~/tronflow-backups"
