# Реализация надежной отправки видео в Telegram

## Краткое описание

Отправка видео в Telegram переведена на фоновую очередь BullMQ с retry логикой и стратегией по размеру файла. Убрано двойное скачивание, добавлен статус отправки в БД.

## Измененные файлы

### 1. База данных
- **`prisma/schema.prisma`**
  - Добавлены поля в модель `Render`:
    - `sendStatus: String?` — статус отправки (queued/sending/sent/failed/too_large)
    - `sendError: String?` — краткая причина ошибки
    - `sendAttempts: Int @default(0)` — количество попыток

### 2. API (apps/api/src/)
- **`lib/queue.ts`**
  - Добавлена очередь `sendTelegramQueue` с retry (exponential backoff: 1m, 2m, 4m, 8m, до 4 попыток)
  - Интерфейс `SendTelegramJobData`: `{ sessionId, telegramUserId, s3Key }`

- **`routes/files.ts`**
  - Endpoint `POST /files/renders/:sessionId/send-to-telegram`:
    - Больше НЕ отправляет видео напрямую
    - Ставит job в очередь и возвращает `{ status: "queued", jobId }` сразу
    - Проверяет, не отправляется ли уже (статус queued/sending)
    - Проверяет, не отправлено ли уже (статус sent)
  - Новый endpoint `GET /files/renders/:sessionId/send-status`:
    - Возвращает `{ status, error, attempts }` из БД
    - Проверяет права участника сессии

### 3. Worker (apps/worker/src/)
- **`send-telegram.ts`** (НОВЫЙ ФАЙЛ)
  - Функция `sendVideoToTelegram()`:
    - Получает размер файла из S3 (HEAD запрос, без скачивания)
    - Выбирает стратегию по размеру:
      - ≤20MB: URL метод (`bot.telegram.sendVideo({ url })`)
      - 20-50MB: Buffer метод (скачивает из S3, отправляет)
      - >50MB: статус "too_large" с ошибкой
    - Обновляет статус в БД (sending → sent/failed/too_large)
    - Логирует размер файла, выбранный метод, результат

- **`index.ts`**
  - Добавлен worker `sendTelegramWorker` для обработки очереди `send_to_telegram`
  - Concurrency: 3 (можно отправлять несколько видео параллельно)
  - Обработчики событий: completed, failed, error

- **`config.ts`**
  - Добавлен `botUsername` в конфиг (нужен для caption)

### 4. Frontend (apps/web/src/)
- **`lib/api.ts`**
  - Обновлен `sendVideoToTelegram()`: возвращает `{ status, jobId?, message?, error? }`
  - Добавлен `getSendStatus()`: возвращает `{ status, error, attempts }`

- **`app/s/[sessionId]/result/page.tsx`**
  - Обновлен `handleSendToTelegram()`:
    - Обрабатывает статус "queued" — запускает polling
    - Polling каждые 3 секунды для статуса отправки
    - Останавливается при статусе "sent", "failed", "too_large"
    - Таймаут polling: 5 минут
  - Добавлен `useRef` для хранения interval polling
  - Cleanup interval при unmount

## Как работает

1. **Пользователь нажимает "Сохранить в Telegram"**
   - Frontend вызывает `POST /files/renders/:sessionId/send-to-telegram`
   - API ставит job в очередь `send_to_telegram`
   - Обновляет `sendStatus = "queued"` в БД
   - Возвращает `{ status: "queued" }` сразу

2. **Worker обрабатывает job**
   - Получает размер файла из S3 (HEAD запрос)
   - Выбирает метод по размеру
   - Обновляет `sendStatus = "sending"`, увеличивает `sendAttempts`
   - Отправляет видео выбранным методом
   - При успехе: `sendStatus = "sent"`
   - При ошибке: `sendStatus = "failed"`, `sendError = "..."` (re-throw для retry)

3. **Frontend опрашивает статус**
   - Polling каждые 3 секунды: `GET /files/renders/:sessionId/send-status`
   - Обновляет UI: "Отправляем..." → "✅ Отправлено в чат!" или ошибка

4. **Retry при ошибке**
   - BullMQ автоматически retry через 1m, 2m, 4m, 8m
   - До 4 попыток (1 исходная + 3 retry)
   - После всех попыток: `sendStatus = "failed"`

## Чеклист тестов

### Тест 1: Маленькое видео (~10MB)
- [ ] Завершить игру, дождаться рендера
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: кнопка показывает "Отправляем..." с индикатором
- [ ] Проверить: через несколько секунд кнопка меняется на "✅ Отправлено в чат!"
- [ ] Проверить: видео пришло в личные сообщения в Telegram
- [ ] Проверить логи worker: должно быть `[SendTelegram:...] Using URL method (X.XXMB)`
- [ ] Проверить БД: `sendStatus = "sent"`, `sendAttempts = 1`

### Тест 2: Среднее видео (~30MB)
- [ ] Завершить игру с видео 20-50MB, дождаться рендера
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: статус меняется queued → sending → sent
- [ ] Проверить: видео пришло в личные сообщения
- [ ] Проверить логи worker: должно быть `[SendTelegram:...] Using buffer method (X.XXMB)`
- [ ] Проверить БД: `sendStatus = "sent"`, `sendAttempts = 1`

### Тест 3: Большое видео (~80MB)
- [ ] Завершить игру с видео >50MB, дождаться рендера
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: статус меняется queued → sending → too_large
- [ ] Проверить: показывается ошибка "Файл слишком большой (X.XXMB). Максимум 50MB."
- [ ] Проверить БД: `sendStatus = "too_large"`, `sendError` содержит размер
- [ ] Проверить: видео НЕ пришло в Telegram

### Тест 4: Retry при ошибке
- [ ] Завершить игру, дождаться рендера
- [ ] Временно отключить интернет или симулировать ошибку Telegram API
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: статус queued → sending → failed (после всех retry)
- [ ] Проверить логи worker: видны попытки с задержками 1m, 2m, 4m, 8m
- [ ] Проверить БД: `sendAttempts = 4` (все попытки), `sendError` содержит причину

### Тест 5: Повторная отправка
- [ ] После успешной отправки (статус "sent")
- [ ] Нажать "Сохранить в Telegram" еще раз
- [ ] Проверить: сразу возвращается `{ status: "sent", message: "Видео уже отправлено" }`
- [ ] Проверить: новый job НЕ создается

### Тест 6: Отправка в процессе
- [ ] Нажать "Сохранить в Telegram"
- [ ] Пока статус "queued" или "sending", нажать еще раз
- [ ] Проверить: возвращается `{ status: "queued"/"sending", message: "Отправка уже в процессе" }`
- [ ] Проверить: новый job НЕ создается

### Тест 7: Polling на фронтенде
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: кнопка показывает "Отправляем..." с индикатором
- [ ] Проверить Network tab: запросы `GET /files/renders/:sessionId/send-status` каждые 3 секунды
- [ ] Проверить: после отправки polling останавливается
- [ ] Проверить: кнопка меняется на "✅ Отправлено в чат!"

## Миграция БД

```bash
# 1. Сгенерировать Prisma клиент с новыми полями
pnpm db:generate

# 2. Применить изменения схемы
pnpm db:push

# 3. Перезапустить сервисы
pm2 restart dubdub-api dubdub-worker
```

## Важные моменты

1. **Размер файла определяется ДО скачивания** — используется HEAD запрос к S3
2. **Нет двойного скачивания** — выбор метода по размеру, один способ отправки
3. **Retry автоматический** — BullMQ обрабатывает retry с exponential backoff
4. **Статус в БД** — можно проверить статус отправки через API
5. **Polling на фронтенде** — автоматическое обновление UI при изменении статуса

## Возможные проблемы

1. **Worker не обрабатывает очередь** — проверить, что worker запущен и подключен к Redis
2. **Статус не обновляется** — проверить логи worker на ошибки
3. **Polling не останавливается** — проверить cleanup в useEffect
4. **Большие файлы все равно отправляются** — проверить, что SIZE_THRESHOLD_LARGE = 50MB

## Откат изменений

Если нужно откатиться к старой версии:
```bash
git checkout backup-20260113-161014
pnpm db:push  # Откатить схему БД
pm2 restart dubdub-api dubdub-worker
```

