#!/bin/zsh
# Развёртывание и обновление на Linux-сервере (Oracle Cloud Always Free и любом другом с Ubuntu).
# Запускается на Mac из папки проекта:
#
#   ./scripts/deploy-server.sh <IP-сервера> [пользователь, по умолчанию ubuntu]
#
# Переменные окружения:
#   DOMAIN=имя.duckdns.org   — адрес сайта (бесплатный поддомен DuckDNS, указывающий на IP сервера)
#   TRONGRID_API_KEY=…  TELEGRAM_BOT_TOKEN=…  ADMIN_PASSWORD=…   — необязательно, пишутся в .env сервера
# Повторный запуск = обновление кода: секреты и данные сохраняются.
set -euo pipefail

IP="${1:?Укажите IP сервера: ./scripts/deploy-server.sh 1.2.3.4}"
SSH_USER="${2:-ubuntu}"
KEY="${SSH_KEY:-$HOME/.ssh/tronflow_oracle}"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
if [[ "$DOMAIN" == *.sslip.io ]]; then
  # sslip.io нет в Public Suffix List: общий на весь мир лимит Let's Encrypt, сертификат может не выдаться
  print -P "%F{yellow}!%f DOMAIN не задан — используем $DOMAIN. Надёжнее бесплатный поддомен DuckDNS: DOMAIN=имя.duckdns.org"
fi
REMOTE_DIR="tronflow"
cd "${0:A:h}/.."

ssh_opts=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=30)
remote() { ssh "${ssh_opts[@]}" "$SSH_USER@$IP" "$@"; }
step() { print -P "\n%F{blue}==>%f %B$1%b"; }

step "Подключение к $SSH_USER@$IP"
remote "uname -srm && lsb_release -ds 2>/dev/null || true"

step "Подготовка сервера (Docker, порты 80/443)"
remote 'bash -s' <<'BOOT'
set -euo pipefail
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
# Образы Oracle Ubuntu закрывают всё, кроме SSH, правилом REJECT в iptables
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport $port -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 1 -p tcp --dport $port -j ACCEPT
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null 2>&1 || true; fi
sudo systemctl enable --now docker >/dev/null 2>&1 || true
echo "docker: $(sudo docker --version)"
BOOT

step "Копирование проекта"
remote "mkdir -p $REMOTE_DIR/deploy/backups"
rsync -az --delete -e "ssh ${ssh_opts[*]}" \
  --exclude node_modules --exclude .next --exclude src/generated --exclude '*.tsbuildinfo' --exclude .DS_Store \
  --exclude .env --exclude deploy/.env --exclude deploy/backups \
  ./ "$SSH_USER@$IP:$REMOTE_DIR/"

step "Настройки (.env на сервере)"
NEW_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-16)"
remote "DOMAIN='$DOMAIN' NEW_PASSWORD='${ADMIN_PASSWORD:-$NEW_PASSWORD}' TRONGRID_API_KEY='${TRONGRID_API_KEY:-}' TELEGRAM_BOT_TOKEN='${TELEGRAM_BOT_TOKEN:-}' SET_PASSWORD='${ADMIN_PASSWORD:+1}' bash -s" <<'CONF'
set -euo pipefail
ENV_FILE="$HOME/tronflow/deploy/.env"
upsert() { # KEY VALUE — заменить или добавить строку в .env
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s|^$1=.*|$1='$2'|" "$ENV_FILE"; else echo "$1='$2'" >> "$ENV_FILE"; fi
}
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  DB_PASSWORD="$(openssl rand -hex 16)"
  cat > "$ENV_FILE" <<ENV
# Создано scripts/deploy-server.sh $(date '+%F %T'). Секреты — не публикуйте этот файл.
DOMAIN='$DOMAIN'
DB_PASSWORD='$DB_PASSWORD'
DATABASE_URL='postgresql://tronflow:$DB_PASSWORD@db:5432/tronflow'
ADMIN_PASSWORD='$NEW_PASSWORD'
SESSION_SECRET='$(openssl rand -hex 32)'
DASHBOARD_URL='https://$DOMAIN'
TRONGRID_API_KEY=''
TELEGRAM_BOT_TOKEN=''
INGEST_MODE='firehose'
ANALYTICS_TZ='Asia/Yerevan'
ENV
  echo "CREATED_PASSWORD=$NEW_PASSWORD"
else
  echo ".env уже есть — секреты сохранены"
  [ "${SET_PASSWORD:-}" = "1" ] && upsert ADMIN_PASSWORD "$NEW_PASSWORD" && echo "пароль администратора обновлён"
fi
[ -n "${TRONGRID_API_KEY:-}" ] && upsert TRONGRID_API_KEY "$TRONGRID_API_KEY" && echo "ключ TronGrid записан"
[ -n "${TELEGRAM_BOT_TOKEN:-}" ] && upsert TELEGRAM_BOT_TOKEN "$TELEGRAM_BOT_TOKEN" && echo "токен Telegram записан"
exit 0
CONF

step "Сборка и запуск (первый раз 5–10 минут)"
remote "cd $REMOTE_DIR && sudo docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build --remove-orphans && sudo docker image prune -f >/dev/null"

step "Проверка https://$DOMAIN"
for i in {1..60}; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://$DOMAIN/login" || true)
  [[ "$code" == "200" ]] && break
  sleep 5
done
if [[ "$code" == "200" ]]; then
  print -P "%F{green}✓%f Сайт работает: https://$DOMAIN"
else
  print -P "%F{yellow}!%f https://$DOMAIN пока не отвечает (код $code). Проверьте порты 80/443 в Oracle (Security List) и логи:"
  echo "  ssh -i $KEY $SSH_USER@$IP 'cd $REMOTE_DIR && sudo docker compose -f deploy/compose.yml logs --tail 50 caddy web'"
  exit 1
fi
remote "cd $REMOTE_DIR && sudo docker compose -f deploy/compose.yml ps --format 'table {{.Service}}\t{{.Status}}'"
