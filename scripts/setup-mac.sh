#!/bin/zsh
# Установка и обновление TRON Flow Tracker на Mac (идемпотентно — можно запускать повторно
# после обновления кода: пересоберёт и перезапустит сервисы, данные и .env сохранятся).
#
#   ./scripts/setup-mac.sh
#
# Что делает: Homebrew-пакеты (Node 22, PostgreSQL 17) → база → .env → зависимости →
# миграции → сборка → автозапуск веба, воркера и ежедневного бэкапа через launchd.
set -euo pipefail

APP_DIR="${0:A:h:h}"
cd "$APP_DIR"
LOG_DIR="$HOME/Library/Logs/tronflow"
AGENTS_DIR="$HOME/Library/LaunchAgents"
DB_NAME="tronflow"

step() { print -P "\n%F{blue}==>%f %B$1%b"; }
fail() { print -P "%F{red}✗%f $1" >&2; exit 1; }
ok() { print -P "%F{green}✓%f $1"; }

# --- 0. Расположение ------------------------------------------------------
# Фоновые процессы launchd не имеют доступа к Downloads/Desktop/Documents (защита macOS TCC).
case "$APP_DIR" in
  "$HOME/Downloads"* | "$HOME/Desktop"* | "$HOME/Documents"* | *"/Library/Mobile Documents"*)
    fail "Папка проекта лежит в защищённой macOS директории:
   $APP_DIR
   Фоновые сервисы не смогут её читать. Перенесите проект и запустите снова:
     mv \"$APP_DIR\" ~/tronflow && ~/tronflow/scripts/setup-mac.sh"
    ;;
esac
[[ "$APP_DIR" == *" "* ]] && fail "Путь к проекту не должен содержать пробелов: $APP_DIR"

# --- 1. Homebrew, Node, PostgreSQL ----------------------------------------
step "Проверка Homebrew"
if ! command -v brew >/dev/null; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [[ -x $p ]] && eval "$($p shellenv)"; done
fi
command -v brew >/dev/null || fail "Нужен Homebrew. Установите: https://brew.sh — и запустите скрипт снова."
ok "$(brew --version | head -1)"

step "Node.js"
need_node=1
if command -v node >/dev/null; then
  ver=$(node -p 'process.versions.node')
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)' && need_node=0
fi
if (( need_node )); then
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
NODE_BIN_DIR="$(dirname "$(command -v node)")"
ok "node $(node -v) ($NODE_BIN_DIR)"

step "PostgreSQL 17"
brew list postgresql@17 >/dev/null 2>&1 || brew install postgresql@17
PG_BIN="$(brew --prefix postgresql@17)/bin"
brew services start postgresql@17 >/dev/null 2>&1 || true
for i in {1..30}; do "$PG_BIN/pg_isready" -q -h localhost && break; sleep 1; done
"$PG_BIN/pg_isready" -q -h localhost || fail "PostgreSQL не запустился (brew services list)"
if ! "$PG_BIN/psql" -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  "$PG_BIN/createdb" -h localhost "$DB_NAME"
  ok "создана база $DB_NAME"
else
  ok "база $DB_NAME уже есть"
fi

# --- 2. Конфигурация -------------------------------------------------------
step "Конфигурация (.env)"
if [[ -f .env ]] && grep -q '^ADMIN_PASSWORD=' .env; then
  ok ".env уже есть — оставляем как есть"
else
  print "Пароль администратора для входа в дашборд (минимум 10 символов, без апострофа ')."
  while true; do
    read -rs "ADMIN_PASSWORD?Пароль: "; print
    read -rs "ADMIN_PASSWORD2?Повторите: "; print
    [[ ${#ADMIN_PASSWORD} -ge 10 && "$ADMIN_PASSWORD" != *"'"* && "$ADMIN_PASSWORD" == "$ADMIN_PASSWORD2" ]] && break
    print -P "%F{yellow}Пароли не совпадают, короче 10 символов или содержат апостроф — ещё раз.%f"
  done
  read -r "TRONGRID_API_KEY?TronGrid API key (https://www.trongrid.io, Enter — без ключа): "
  read -r "LAN?Открыть дашборд для других устройств в локальной сети? [y/N]: "
  HOST=127.0.0.1
  DASHBOARD_URL="http://127.0.0.1:3000"
  if [[ "$LAN" == [yYдД]* ]]; then
    HOST=0.0.0.0
    DASHBOARD_URL="http://$(ipconfig getifaddr en0 2>/dev/null || hostname):3000"
  fi
  print "Уведомления в Telegram: создайте бота у @BotFather (/newbot) и вставьте токен."
  read -r "TELEGRAM_BOT_TOKEN?Токен бота (Enter — настроить позже): "

  umask 077
  cat > .env <<ENV
# Создано scripts/setup-mac.sh $(date '+%F %T'). Права 600 — файл содержит секреты.
DATABASE_URL='postgresql://$(whoami)@localhost:5432/$DB_NAME'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
SESSION_SECRET='$(openssl rand -hex 32)'
TRONGRID_API_KEY='$TRONGRID_API_KEY'
HOST='$HOST'
PORT='3000'
INGEST_MODE='firehose'
ANALYTICS_TZ='Asia/Yerevan'
# Уведомления: чат выбирается в дашборде, раздел «Уведомления»
TELEGRAM_BOT_TOKEN='$TELEGRAM_BOT_TOKEN'
# Адрес дашборда для ссылок в сообщениях Telegram
DASHBOARD_URL='$DASHBOARD_URL'
ENV
  umask 022
  ok ".env создан"
fi

# --- 3. Сборка --------------------------------------------------------------
step "Зависимости"
npm ci --no-audit --no-fund
step "Миграции базы"
set -a; source ./.env; set +a
npx prisma migrate deploy
step "Сборка"
npm run build
step "Тесты"
npm test

# --- 4. Автозапуск -----------------------------------------------------------
step "Сервисы launchd"
mkdir -p "$LOG_DIR" "$AGENTS_DIR"
SVC_PATH="$NODE_BIN_DIR:$PG_BIN:$(brew --prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin"
for name in web worker backup; do
  label="com.tronflow.$name"
  plist="$AGENTS_DIR/$label.plist"
  sed -e "s|__APP_DIR__|$APP_DIR|g" -e "s|__LOG_DIR__|$LOG_DIR|g" -e "s|__PATH__|$SVC_PATH|g" \
    "scripts/launchd/$label.plist" > "$plist"
  launchctl bootout "gui/$UID/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID" "$plist"
  ok "$label"
done

step "Проверка"
URL="http://127.0.0.1:${PORT:-3000}"
for i in {1..30}; do curl -s -o /dev/null "$URL/login" && break; sleep 1; done
curl -s -o /dev/null "$URL/login" || fail "Веб-сервер не отвечает. Лог: $LOG_DIR/web.log"
ok "Дашборд: $URL"
[[ "${HOST:-}" == "0.0.0.0" ]] && ok "В локальной сети: http://$(ipconfig getifaddr en0 2>/dev/null || hostname):${PORT:-3000}"

print -P "
%BГотово.%b Сервисы стартуют автоматически при входе в систему и перезапускаются при сбое.
Логи:     $LOG_DIR/{web,worker,backup}.log
Бэкапы:   ~/tronflow-backups (ежедневно в 04:00, хранятся 14 дней)
Статус:   ./scripts/status.sh

%BЧтобы мониторинг работал круглосуточно%b (однократно, нужен пароль macOS):
  sudo pmset -c sleep 0 disksleep 0     # не засыпать от сети
  Системные настройки → Пользователи и группы → Автоматический вход (для запуска после перезагрузки)
  Держите MacBook на зарядке; с закрытой крышкой без внешнего монитора он всё равно уснёт.
"
