# DubDub — Telegram Mini App для озвучки видео

Игроки по очереди озвучивают немое видео, слыша только часть предыдущих реплик.

## Требования

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose
- FFmpeg (для worker)

### Установка FFmpeg

**Windows:**
```powershell
winget install FFmpeg
# или скачать с https://ffmpeg.org/download.html
```

**macOS:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt update && sudo apt install ffmpeg
```

## Локальный запуск

```bash
# 1. Клонировать и установить зависимости
cd DubDub
pnpm install

# 2. Скопировать .env
cp .env.example .env
# Отредактировать .env — особенно BOT_TOKEN

# 3. Запустить инфраструктуру
docker-compose up -d

# 4. Мигрировать БД
pnpm db:generate
pnpm db:push

# 5. Seed (создать тестовую сцену)
pnpm db:seed

# 6. Запустить все сервисы
pnpm dev
```

## Сервисы

| Сервис | URL | Описание |
|--------|-----|----------|
| Web (Next.js) | http://localhost:3000 | Mini App UI |
| API (Fastify) | http://localhost:4000 | REST API + Telegram Bot |
| Worker | — | Фоновый рендер |
| MinIO Console | http://localhost:9001 | S3 UI (minioadmin/minioadmin123) |

## Настройка Telegram Bot

1. Создать бота через [@BotFather](https://t.me/BotFather)
2. Получить токен и вписать в `.env` как `BOT_TOKEN`
3. Настроить Web App:
   - `/setmenubutton` → выбрать бота → отправить URL Mini App
   - Или через BotFather: `/mybots` → Bot Settings → Menu Button

### Deep Links

Формат: `https://t.me/<BOT_USERNAME>?startapp=<sessionId>`

Бот автоматически открывает Mini App с нужной сессией.

## Деплой на продакшн

### Переменные окружения

```env
DATABASE_URL="postgresql://user:pass@your-db-host:5432/dubdub"
REDIS_URL="redis://your-redis-host:6379"
S3_ENDPOINT="https://s3.amazonaws.com"  # или ваш S3-совместимый
S3_REGION="eu-central-1"
S3_BUCKET="your-bucket"
S3_ACCESS_KEY="..."
S3_SECRET_KEY="..."
BOT_TOKEN="..."
BOT_USERNAME="YourBotName"
WEBAPP_URL="https://app.yourdomain.com"
API_BASE_URL="https://api.yourdomain.com"
```

### Nginx reverse proxy

```nginx
# app.yourdomain.com -> Next.js (порт 3000)
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

# api.yourdomain.com -> Fastify (порт 4000)
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Caddy (альтернатива)

```
app.yourdomain.com {
    reverse_proxy localhost:3000
}

api.yourdomain.com {
    reverse_proxy localhost:4000
}
```

### PM2 для запуска

```bash
# Установить PM2
npm i -g pm2

# Запустить сервисы
pm2 start pnpm --name "dubdub-api" -- --filter api start
pm2 start pnpm --name "dubdub-web" -- --filter web start
pm2 start pnpm --name "dubdub-worker" -- --filter worker start

# Сохранить и настроить автозапуск
pm2 save
pm2 startup
```

## Telegram WebApp Валидация

API валидирует `initData` через HMAC-SHA256 согласно [документации Telegram](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Клиент отправляет заголовок:
```
X-TG-INIT-DATA: <window.Telegram.WebApp.initData>
```

API извлекает `user.id` только из валидированных данных.

## Команды

| Команда | Описание |
|---------|----------|
| `pnpm install` | Установить зависимости |
| `pnpm dev` | Запустить все в dev режиме |
| `pnpm build` | Собрать для продакшна |
| `pnpm start` | Запустить продакшн |
| `pnpm db:migrate` | Применить миграции |
| `pnpm db:seed` | Заполнить тестовыми данными |
| `pnpm db:studio` | Открыть Prisma Studio |

