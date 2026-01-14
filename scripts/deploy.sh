#!/bin/bash
# Скрипт деплоя DubDub
# Использование: ./scripts/deploy.sh [production|staging]

set -e  # Остановить при ошибке

ENV=${1:-production}
echo "🚀 Деплой в окружение: $ENV"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Проверка, что мы в правильной директории
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Ошибка: запустите скрипт из корня проекта${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Шаг 1: Установка зависимостей...${NC}"
pnpm install --frozen-lockfile

echo -e "${YELLOW}🔨 Шаг 2: Генерация Prisma клиента...${NC}"
pnpm db:generate

echo -e "${YELLOW}🗄️  Шаг 3: Применение миграций БД...${NC}"
if [ "$ENV" = "production" ]; then
    pnpm db:migrate
else
    pnpm db:push
fi

echo -e "${YELLOW}🏗️  Шаг 4: Сборка проекта...${NC}"
pnpm build

echo -e "${YELLOW}🔄 Шаг 5: Перезапуск сервисов через PM2...${NC}"

# Остановить существующие процессы
pm2 stop dubdub-api dubdub-web dubdub-worker 2>/dev/null || true

# Удалить старые процессы
pm2 delete dubdub-api dubdub-web dubdub-worker 2>/dev/null || true

# Запустить новые процессы
echo -e "${GREEN}▶️  Запуск API...${NC}"
pm2 start pnpm --name "dubdub-api" -- --filter api start

echo -e "${GREEN}▶️  Запуск Web...${NC}"
pm2 start pnpm --name "dubdub-web" -- --filter web start

echo -e "${GREEN}▶️  Запуск Worker...${NC}"
pm2 start pnpm --name "dubdub-worker" -- --filter worker start

# Сохранить конфигурацию PM2
pm2 save

echo -e "${GREEN}✅ Деплой завершен!${NC}"
echo -e "${YELLOW}📊 Статус сервисов:${NC}"
pm2 status

echo -e "${YELLOW}📝 Полезные команды:${NC}"
echo "  pm2 logs dubdub-api      # Логи API"
echo "  pm2 logs dubdub-web       # Логи Web"
echo "  pm2 logs dubdub-worker    # Логи Worker"
echo "  pm2 restart all           # Перезапуск всех сервисов"
echo "  pm2 monit                 # Мониторинг в реальном времени"
