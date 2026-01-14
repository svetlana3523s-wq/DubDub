# Current State

## Last updates
- **Оптимизация rate limit для роста трафика** — убран skip из глобального rate limit, добавлен route-level override (600 req/min) для статусных endpoints
- **Оптимизация polling для отправки видео** — заменен фиксированный интервал на backoff (3s, 3s, 5s, 8s, 13s, потом 15s), таймаут 180 секунд, остановка при финальных статусах
- **Отправка видео в Telegram через очередь BullMQ** — переведена на фоновую очередь с retry логикой (exponential backoff: 1m, 2m, 4m, 8m, до 4 попыток)
- **Стратегия отправки по размеру файла** — ≤20MB: URL метод, 20-50MB: Buffer метод, >50MB: статус "too_large" с ошибкой
- **Статус отправки в БД** — добавлены поля `sendStatus`, `sendError`, `sendAttempts` в модель Render
- **Endpoint статуса отправки** — `GET /files/renders/:sessionId/send-status` для проверки статуса
- **Retry логика для рендера** — при таймауте FFmpeg автоматически перезапускается до 3 попыток (с ожиданием 5s, 10s, 20s)
- **FFmpeg таймаут** — уменьшен до 1.5 минут (было 5 минут)
- **Rate limit** — увеличен до 200 запросов в минуту (для polling и действий пользователей)
- **Backup:** `git tag backup-20260113-161014` (до перевода отправки в очередь)

## Текущее состояние

### Стабильные части (работают хорошо):
- **Игровой процесс** — создание сессий, запись аудио, рендеринг (с retry)
- **Мультиплеер** — подключение по коду, параллельная запись, подтверждение replay
- **Админ-панель** — загрузка/редактирование/удаление сцен
- **VideoPlayer** — кастомный компонент на HTML5 video (заменил Plyr)
- **Рендеринг** — FFmpeg pipeline работает стабильно с retry логикой

### Известные проблемы:

1. **Отправка видео в Telegram** (улучшено, требует тестирования)
   - Теперь через очередь BullMQ с retry логикой
   - Стратегия по размеру файла (URL для малых, Buffer для средних, too_large для больших)
   - Убрано двойное скачивание — выбор метода по размеру до скачивания
   - Polling оптимизирован: backoff интервалы, таймаут 180s
   - Status endpoints исключены из rate limit
   - Требуется тестирование на разных размерах файлов и с 2+ игроками
   - Файлы: `apps/api/src/routes/files.ts`, `apps/worker/src/send-telegram.ts`, `apps/worker/src/index.ts`, `apps/web/src/app/s/[sessionId]/result/page.tsx`

2. **Медленная загрузка видео** (не критично)
   - FFmpeg обработка при загрузке сцены админом занимает время
   - Особенно заметно для больших файлов (>100MB)

3. **Случайный выбор сцен** (не критично)
   - Может выпасть та же сцена несколько раз подряд
   - Нет логики отслеживания "какие сцены уже игрались"

## Критичные решения (НЕ ТРОГАТЬ!)

### iOS deep links
Inline кнопки с `web_app` открывают WebView без Telegram SDK на iOS. Используем текстовые ссылки `?startapp=s_sessionId` вместо inline кнопок.
- Файл: `apps/api/src/bot.ts`
- **Не возвращаться** к inline `web_app` кнопкам

### VideoPlayer
Нативный HTML5 `<video>` без Plyr (заменил из-за проблем с кешированием).
- Файл: `apps/web/src/components/VideoPlayer.tsx`
- **Не возвращаться** к Plyr без серьезной причины

### Replay navigation
Использовать `window.location.href` вместо `router.push` для перехода после replay (обходит кеширование Next.js).
- Файлы: `apps/web/src/app/s/[sessionId]/result/page.tsx`
- **Не менять** на `router.push` без понимания последствий

### Отправка видео (новая реализация через очередь)
Отправка через очередь BullMQ с retry и стратегией по размеру файла.
- Файлы: 
  - `apps/api/src/routes/files.ts` — endpoint ставит job в очередь
  - `apps/worker/src/send-telegram.ts` — логика отправки с выбором метода
  - `apps/worker/src/index.ts` — worker для обработки очереди
  - `apps/api/src/lib/queue.ts` — очередь `send_to_telegram`
- **Требует тестирования** на разных размерах файлов

## Что трогать опасно

1. **FFmpeg фильтры в `apps/worker/src/render.ts`**
   - Сложная логика сборки `filter_complex` строки
   - Любое изменение может сломать рендеринг
   - Тестировать на реальных данных перед деплоем

2. **Валидация Telegram initData в `apps/api/src/lib/telegram-auth.ts`**
   - Безопасность — любая ошибка = уязвимость
   - Следует официальной документации Telegram
   - Не менять без понимания HMAC SHA-256

3. **Логика сессий в `apps/api/src/routes/sessions.ts`**
   - Много бизнес-логики
   - Связано с БД и очередью
   - Изменения могут сломать игровой процесс

4. **Логика бота в `apps/api/src/bot.ts`**
   - Много команд и обработчиков
   - Связано с БД и состоянием
   - Изменения могут сломать UX

## Новая реализация отправки видео в Telegram

### Что сделано:
- **Очередь BullMQ** — отправка через фоновую очередь `send_to_telegram` с retry (exponential backoff: 1m, 2m, 4m, 8m, до 4 попыток)
- **Стратегия по размеру** — выбор метода отправки до скачивания:
  - ≤20MB: URL метод (Telegram скачивает сам)
  - 20-50MB: Buffer метод (скачиваем из S3, отправляем)
  - >50MB: статус "too_large" с понятной ошибкой
- **Статус в БД** — поля `sendStatus`, `sendError`, `sendAttempts` в модели Render
- **Endpoint статуса** — `GET /files/renders/:sessionId/send-status` для проверки
- **Polling на фронтенде** — автоматическое опрашивание статуса каждые 3 секунды

### Измененные файлы:
1. `prisma/schema.prisma` — добавлены поля `sendStatus`, `sendError`, `sendAttempts` в Render
2. `apps/api/src/lib/queue.ts` — добавлена очередь `sendTelegramQueue`
3. `apps/api/src/routes/files.ts` — endpoint ставит job в очередь, добавлен endpoint статуса
4. `apps/worker/src/send-telegram.ts` — **НОВЫЙ ФАЙЛ** — логика отправки с выбором метода
5. `apps/worker/src/index.ts` — добавлен worker для обработки очереди `send_to_telegram`
6. `apps/worker/src/config.ts` — добавлен `botUsername` в конфиг
7. `apps/web/src/lib/api.ts` — обновлен `sendVideoToTelegram`, добавлен `getSendStatus`
8. `apps/web/src/app/s/[sessionId]/result/page.tsx` — обновлен `handleSendToTelegram` с polling

### Как тестировать:
1. **Маленькое видео (~10MB)**:
   - Завершить игру, дождаться рендера
   - Нажать "Сохранить в Telegram"
   - Ожидать: статус "queued" → "sending" → "sent"
   - Проверить: видео пришло в личные сообщения
   - В логах worker должно быть: "Using URL method"

2. **Среднее видео (~30MB)**:
   - Аналогично, но видео должно быть 20-50MB
   - Ожидать: статус "queued" → "sending" → "sent"
   - Проверить: видео пришло в личные сообщения
   - В логах worker должно быть: "Using buffer method"

3. **Большое видео (~80MB)**:
   - Аналогично, но видео должно быть >50MB
   - Ожидать: статус "queued" → "sending" → "too_large"
   - Проверить: показывается ошибка "Файл слишком большой"
   - В БД: `sendStatus = "too_large"`, `sendError` содержит размер

4. **Retry при ошибке**:
   - Симулировать ошибку (например, временно отключить интернет)
   - Ожидать: автоматический retry через 1m, 2m, 4m, 8m
   - Проверить: в логах worker видны попытки, в БД `sendAttempts` увеличивается

5. **Polling на фронтенде**:
   - Нажать "Сохранить в Telegram"
   - Проверить: кнопка показывает "Отправляем..." с индикатором
   - Проверить: после отправки кнопка меняется на "✅ Отправлено в чат!"

### Миграция БД:
```bash
pnpm db:generate  # Генерировать Prisma клиент
pnpm db:push      # Применить изменения схемы
```

### Запуск worker:
Worker автоматически обрабатывает обе очереди: `render` и `send_to_telegram`.
