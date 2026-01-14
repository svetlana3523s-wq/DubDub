# Инструкция по деплою

## Быстрый деплой

### Вариант 1: Использование скрипта (рекомендуется)

```bash
# На сервере, в директории проекта
chmod +x scripts/deploy.sh
./scripts/deploy.sh production
```

### Вариант 2: Ручной деплой

```bash
# 1. Обновить код
git pull origin main  # или ваша ветка

# 2. Установить зависимости
pnpm install --frozen-lockfile

# 3. Генерация Prisma клиента
pnpm db:generate

# 4. Применить миграции БД (для продакшена)
pnpm db:migrate
# ИЛИ для dev/staging (если нет миграций)
# pnpm db:push

# 5. Собрать проект
pnpm build

# 6. Перезапустить сервисы через PM2
pm2 restart dubdub-api
pm2 restart dubdub-web
pm2 restart dubdub-worker

# Или если сервисы еще не запущены:
pm2 start pnpm --name "dubdub-api" -- --filter api start
pm2 start pnpm --name "dubdub-web" -- --filter web start
pm2 start pnpm --name "dubdub-worker" -- --filter worker start
pm2 save
```

## Проверка после деплоя

### 1. Проверить статус сервисов
```bash
pm2 status
```

Должны быть запущены:
- `dubdub-api` (порт 4000)
- `dubdub-web` (порт 3000)
- `dubdub-worker` (фоновый процесс)

### 2. Проверить логи
```bash
# Логи всех сервисов
pm2 logs

# Логи конкретного сервиса
pm2 logs dubdub-api
pm2 logs dubdub-web
pmpm logs dubdub-worker

# Следить за логами в реальном времени
pm2 logs --lines 50
```

### 3. Проверить health checks
```bash
# API health check
curl http://localhost:4000/health

# Worker health check (если настроен)
curl http://localhost:3002/health
```

### 4. Проверить работу отправки видео
- Завершить тестовую игру
- Нажать "Сохранить в Telegram"
- Проверить логи worker на наличие таймингов:
  ```
  [SendTelegram:xxx] [Xms] Time from enqueue to start processing
  [SendTelegram:xxx] [Xms] File size checked: X.XXMB
  [SendTelegram:xxx] [Xms] Job completed successfully
  ```

## Откат (rollback)

Если что-то пошло не так:

```bash
# 1. Откатить код к предыдущему коммиту
git checkout <previous-commit-hash>
# или
git reset --hard HEAD~1

# 2. Повторить деплой
./scripts/deploy.sh production
```

Или через PM2:

```bash
# Перезапустить с предыдущей версией (если код не изменился)
pm2 restart all
```

## Важные замечания

### Миграции БД
- **Продакшен**: используйте `pnpm db:migrate` (применяет миграции)
- **Dev/Staging**: можно использовать `pnpm db:push` (синхронизирует схему)

### Переменные окружения
Убедитесь, что файл `.env` на сервере содержит все необходимые переменные:
- `DATABASE_URL`
- `REDIS_URL`
- `S3_*` (endpoint, region, bucket, accessKey, secretKey)
- `BOT_TOKEN`
- `BOT_USERNAME`
- `WEBAPP_URL`
- `API_BASE_URL`

### Nginx
Если используется Nginx как reverse proxy, после деплоя может потребоваться:
```bash
sudo nginx -t  # Проверить конфигурацию
sudo systemctl reload nginx  # Перезагрузить Nginx
```

## Мониторинг

### PM2 Dashboard
```bash
pm2 monit  # Мониторинг в реальном времени
```

### Проверка использования ресурсов
```bash
pm2 list  # Список процессов
pm2 info dubdub-api  # Детальная информация о процессе
```

## Troubleshooting

### Сервис не запускается
1. Проверить логи: `pm2 logs <service-name>`
2. Проверить переменные окружения
3. Проверить, что порты не заняты: `netstat -tulpn | grep :3000` (или :4000)

### Ошибки БД
1. Проверить подключение: `psql $DATABASE_URL`
2. Проверить миграции: `pnpm db:migrate status` (если доступно)
3. При необходимости: `pnpm db:push` (осторожно в продакшене!)

### Worker не обрабатывает задачи
1. Проверить подключение к Redis: `redis-cli ping`
2. Проверить логи worker: `pm2 logs dubdub-worker`
3. Проверить очереди в Redis: `redis-cli KEYS "bull:*"`

## Чеклист после деплоя

- [ ] Все сервисы запущены (`pm2 status`)
- [ ] Нет ошибок в логах (`pm2 logs`)
- [ ] Health checks отвечают (`curl /health`)
- [ ] Тестовая игра работает
- [ ] Отправка видео в Telegram работает
- [ ] Логирование таймингов работает (проверить логи worker)
- [ ] Обработка 429 ошибок работает (если есть возможность протестировать)
