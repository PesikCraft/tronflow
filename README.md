# TRON Flow Tracker

Приватная платформа мониторинга USDT TRC-20 по списку кошельков: адресная книга с метками,
балансы и переводы в реальном времени, давление на курс по потокам обменников и OTC,
аналитика оборота (объём, средний/медианный перевод, контрагенты, пиковые часы по Еревану),
поиск рассылок, сбора средств и колец, уведомления в Telegram и интерактивный граф связей.

Архитектура, модель данных, эвристики и дорожная карта — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Установка на сервер (Oracle Cloud Always Free, $0 в месяц)

Сайт, воркер, база и ежедневный бэкап работают в Docker на бесплатном сервере Oracle; HTTPS выдаёт Caddy
(Let's Encrypt) на бесплатный поддомен DuckDNS. Всё разворачивается с Mac одной командой:

```bash
DOMAIN=имя.duckdns.org TRONGRID_API_KEY=… TELEGRAM_BOT_TOKEN=… ./scripts/deploy-server.sh <IP-сервера>
```

Скрипт ставит Docker, открывает порты 80/443, копирует проект, создаёт секреты в `~/tronflow/deploy/.env` на
сервере, собирает и запускает всё и проверяет HTTPS. Повторный запуск — обновление кода (данные и секреты
сохраняются). SSH-ключ по умолчанию — `~/.ssh/tronflow_oracle`.

Полезное на сервере (`ssh -i ~/.ssh/tronflow_oracle ubuntu@<IP>`):

```bash
cd ~/tronflow
sudo docker compose -f deploy/compose.yml ps                 # состояние
sudo docker compose -f deploy/compose.yml logs -f worker     # логи воркера
sudo docker compose -f deploy/compose.yml restart web worker # перезапуск после правки deploy/.env
ls deploy/backups                                            # ежедневные бэкапы (14 дней)
```

Восстановление из бэкапа:
`sudo docker compose -f deploy/compose.yml exec -T db pg_restore --clean --if-exists -U tronflow -d tronflow < deploy/backups/<файл>.dump`

## Установка на Mac, где платформа будет работать

Нужно: macOS 13+, интернет, права администратора (для Homebrew).

### 1. Перенесите проект

Скопируйте папку проекта **без** `node_modules`, `.next`, `src/generated` и `.env` (они
создаются заново на месте). Например, архивом с этого Mac:

```bash
cd "<папка проекта>"
zip -r ~/Desktop/tronflow.zip . -x "node_modules/*" ".next/*" "src/generated/*" ".env" "*.tsbuildinfo"
```

На целевом Mac распакуйте **в домашнюю папку**, не в Загрузки/Рабочий стол/Документы
(macOS не даёт фоновым сервисам читать эти папки):

```bash
mkdir ~/tronflow && cd ~/tronflow && unzip ~/Downloads/tronflow.zip
```

### 2. Получите ключ TronGrid (бесплатно, 2 минуты)

https://www.trongrid.io → Sign up → Dashboard → Create API Key. Без ключа TronGrid разрешает
лишь 1 запрос в секунду — хватит для проверки, но не для 200 кошельков.

### 3. Установите Homebrew (если его нет)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 4. Запустите установку

```bash
cd ~/tronflow
./scripts/setup-mac.sh
```

Скрипт спросит пароль администратора, ключ TronGrid и нужен ли доступ из локальной сети, затем
установит Node.js и PostgreSQL 17, создаст базу, соберёт приложение, прогонит тесты и
поставит три сервиса в автозапуск:

| Сервис | Что делает |
|---|---|
| `com.tronflow.web` | дашборд на http://127.0.0.1:3000 |
| `com.tronflow.worker` | загрузка переводов и балансов из TronGrid; пока работает — Mac не засыпает от сети |
| `com.tronflow.backup` | ежедневно в 04:00 бэкап базы в `~/tronflow-backups` (14 дней) |

### 5. Настройте Mac для работы 24/7

```bash
sudo pmset -c sleep 0 disksleep 0
```

- Системные настройки → Пользователи и группы → **Автоматический вход** — чтобы сервисы
  поднимались после перезагрузки/отключения питания.
- MacBook держите на зарядке. С закрытой крышкой без внешнего монитора он уснёт.
- После простоя воркер сам догонит пропущенные переводы.

---

## Работа

1. Откройте http://127.0.0.1:3000 и войдите паролем администратора.
2. **Кошельки → Импорт списка**: вставьте строки `адрес, метка, категория, теги…`
   (можно прямо из Excel/Google Sheets). Категории: `EXCHANGE, OTC, TRADER, WHALE, SUSPICIOUS, UNKNOWN`.
3. Воркер загрузит историю за 30 дней (у очень активных адресов — последние 20 000 переводов;
   в карточке видно «история с …») и начнёт следить за новыми переводами с задержкой ~1 мин.
4. **Дашборд** — оборот и активность за 1d/7d/30d/90d, таблица кошельков, строка состояния
   (жив ли воркер, отставание, расход лимита TronGrid). Выгрузки в CSV.
5. **Ликвидность** — прибор давления на курс (продажи/покупки USDT у обменников и OTC за 1, 4, 24 ч),
   приток и отток по часам, скорость обращения, кошельки, которые двигают рынок.
6. **Паттерны** — раз в час воркер ищет рассылки, сбор мелочи и кольца; подтвердите находку — адреса
   получат метку.
7. **Уведомления** — подключите Telegram по трём шагам на странице и настройте правила: крупный перевод,
   всплеск объёма, новый адрес, новый паттерн.
8. **Граф связей** — фильтры по сумме, датам, глубине (1–3 степени), размер узла по обороту или
   балансу, раскладка «кластеры» или «иерархия». Клик — детали узла; двойной клик или
   «Раскрыть связи» — загрузить контрагентов узла (2-я степень); найденный узел можно
   сразу добавить в адресную книгу — теги паттернов добавятся автоматически.

## Обслуживание

```bash
./scripts/status.sh                      # состояние сервисов, health, хвост лога воркера
tail -f ~/Library/Logs/tronflow/worker.log

# перезапуск сервиса
launchctl kickstart -k gui/$UID/com.tronflow.web
launchctl kickstart -k gui/$UID/com.tronflow.worker

# обновление кода: замените файлы проекта (кроме .env) и запустите установку повторно —
# она идемпотентна: применит миграции, пересоберёт и перезапустит сервисы
./scripts/setup-mac.sh

# ручной бэкап и восстановление
./scripts/run.sh backup
pg_restore --clean --if-exists --no-owner -d tronflow ~/tronflow-backups/tronflow_YYYY-MM-DD_HHMM.dump

./scripts/uninstall-mac.sh               # убрать сервисы (база и бэкапы остаются)
```

`GET /api/health` (без авторизации) отвечает 200, если база доступна и воркер отчитывался в
последние 5 минут, иначе 503 — можно подключить внешний мониторинг (например, UptimeRobot через туннель).

## Настройки (`.env`)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `DATABASE_URL` | — | PostgreSQL |
| `ADMIN_PASSWORD` | — | пароль входа (≥ 10 символов) |
| `SESSION_SECRET` | — | ключ подписи сессий (≥ 32 символов); смена разлогинит всех |
| `SESSION_TTL_HOURS` | 168 | срок сессии |
| `HOST` / `PORT` | 127.0.0.1 / 3000 | `HOST=0.0.0.0` — доступ из локальной сети |
| `TRONGRID_API_KEY` | пусто | ключ TronGrid |
| `TRONGRID_RPS` | 10 | запросов/с с ключом (без ключа всегда 1) |
| `TRONGRID_DAILY_BUDGET` | 90000 | при достижении — пауза бэкфилла и раскрытий, живой поток работает |
| `INGEST_MODE` | firehose | `poll` — опрос каждого адреса (только для < ~30 кошельков) |
| `WORKER_TICK_SEC` | 15 | период цикла воркера |
| `BACKFILL_DAYS` / `BACKFILL_MAX_PAGES` | 30 / 100 | глубина истории нового кошелька (страница = 200 переводов) |
| `BALANCE_SWEEP_HOURS` | 6 | плановое обновление всех балансов |
| `ANALYTICS_TZ` | Asia/Yerevan | часовой пояс «пиковых часов» |
| `DATABASE_POOL_MAX` | 10 | соединений к БД на процесс |
| `TELEGRAM_BOT_TOKEN` | пусто | токен бота от @BotFather; чат выбирается в разделе «Уведомления» |
| `DASHBOARD_URL` | http://127.0.0.1:3000 | адрес дашборда для ссылок в сообщениях (для телефона — IP Mac в сети) |
| `PATTERN_SCAN_MIN` / `PATTERN_SCAN_DAYS` | 60 / 7 | как часто и за сколько дней искать паттерны |

После изменения `.env`: `launchctl kickstart -k` для web и worker.

## Разработка

```bash
npm install
npm run dev             # веб в режиме разработки
npm run worker          # воркер
npm test                # юнит-тесты: адреса, суммы, авторизация, CSV, граф и эвристики
TEST_DATABASE_URL=postgresql://localhost/tronflow_test npm run test:integration   # SQL-аналитика (очищает БД!)
npm run smoke:tron      # живая проверка TronGrid (без БД)
npm run typecheck
```

Структура:

```
prisma/schema.prisma, migrations/   схема и миграции PostgreSQL
src/lib/tron/        TronGrid: клиент (rate limit, ретраи), адреса base58/hex, USDT (балансы, переводы, firehose)
src/lib/ingest.ts    загрузка в БД: бэкфилл, firehose, poll, балансы, очередь задач, учёт лимита
src/lib/analytics.ts SQL-агрегаты для дашборда, карточки, графа
src/lib/graph/       построение графа и структурные роли узлов (чистые функции)
src/lib/patterns/    рассылка / сбор / кольца по времени и суммам + скан и разметка
src/lib/liquidity.ts потоки рынка, давление на курс, скорость обращения
src/lib/alerts/      правила, шаблоны сообщений и движок уведомлений; src/lib/telegram.ts — Bot API
src/components/FlowGraph.tsx   граф на Cytoscape.js
src/app/             страницы и API (Next.js 16), src/proxy.ts — проверка сессии
worker/index.ts      фоновый воркер
scripts/             установка, запуск, бэкап, статус
```
