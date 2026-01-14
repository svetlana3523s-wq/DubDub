# Чеклист тестирования отправки видео в Telegram

## Быстрый чеклист (минимум)

### ✅ 1. Одиночная игра (1 игрок)
- [ ] Завершить игру, дождаться рендера
- [ ] Нажать "Сохранить в Telegram"
- [ ] Проверить: кнопка показывает "Отправляем..." с индикатором
- [ ] Проверить: видео пришло в личные сообщения
- [ ] Проверить: кнопка меняется на "✅ Отправлено в чат!"
- [ ] Проверить в логах worker: тайминги логируются корректно

### ✅ 2. Мультиплеер (2 игрока одновременно)
- [ ] Завершить игру в режиме на двоих, дождаться рендера
- [ ] Оба игрока нажимают "Сохранить в Telegram" одновременно
- [ ] Проверить: каждый игрок видит свой статус отправки (не зависят друг от друга)
- [ ] Проверить: оба видео успешно отправляются в личные сообщения соответствующих игроков
- [ ] Проверить: нет конфликтов между статусами игроков

### ✅ 3. Двойной клик (идемпотентность)
- [ ] Завершить игру, дождаться рендера
- [ ] Нажать "Сохранить в Telegram" дважды быстро (в течение 1-2 секунд)
- [ ] Проверить: второй запрос возвращает статус "queued" или "sending" (не создает новую job)
- [ ] Проверить: в логах API нет дублирующих job'ов
- [ ] Проверить: в логах worker только одна job обрабатывается
- [ ] Проверить: видео отправляется только один раз

### ✅ 4. Обработка 429 (rate limit)
- [ ] Симулировать 429 ошибку (или дождаться реальной при большой нагрузке)
- [ ] Проверить: статус меняется на "rate_limited"
- [ ] Проверить: показывается сообщение "Telegram ограничил скорость, повторим через ~N сек" (желтым цветом, не красным)
- [ ] Проверить: обратный отсчет работает корректно
- [ ] Проверить в логах worker: "Rate limited, delaying job for Ns (until ISO timestamp)"
- [ ] Проверить в логах worker: "Job moved to delayed queue, will retry at ISO timestamp"
- [ ] Проверить: после задержки job автоматически повторяется и видео успешно отправляется

## Расширенный чеклист

### Размеры файлов
- [ ] Маленькое видео (~10MB): используется URL метод
- [ ] Среднее видео (~30MB): используется Buffer метод
- [ ] Большое видео (~80MB): показывается ошибка "Файл слишком большой"

### Логирование таймингов
- [ ] В логах API: `[Xms] Queued send job` (время постановки в очередь)
- [ ] В логах worker: `[Xms] Time from enqueue to start processing` (время от постановки до начала обработки)
- [ ] В логах worker: `[Xms] File size checked` (время HEAD запроса к S3)
- [ ] В логах worker: `[Xms] URL send completed` или `[Xms] Download + [Xms] Send = [Xms] Total buffer send`
- [ ] В логах worker: `[Xms] Job completed successfully` (общее время выполнения job)

### Мультиплеер с 429
- [ ] Завершить игру в режиме на двоих, дождаться рендера
- [ ] Оба игрока нажимают "Сохранить в Telegram"
- [ ] Симулировать 429 для одного игрока
- [ ] Проверить: только у этого игрока показывается "rate_limited" статус и таймер
- [ ] Проверить: второй игрок не видит rate_limited (если у него нет 429)
- [ ] Проверить: каждый игрок получает свой retryAfterSeconds из API
- [ ] Проверить: после retry_after секунд только у первого игрока повторяется отправка
- [ ] Проверить: статусы не конфликтуют между игроками

## Что проверить в логах

### API (apps/api)
```
[SendVideo] [Xms] Queued send job {jobId} (send:{renderId}:{telegramUserId}) for session {sessionId}, user {userId}
```

### Worker (apps/worker)
```
[SendTelegram:{sessionId}] [Xms] Time from enqueue to start processing
[SendTelegram:{sessionId}] [Xms] Starting send job for user {telegramUserId}
[SendTelegram:{sessionId}] [Xms] Render data fetched
[SendTelegram:{sessionId}] [Xms] File size checked: {size}MB
[SendTelegram:{sessionId}] Using URL method ({size}MB)  // или "Using buffer method"
[SendTelegram:{sessionId}] [Xms] URL send completed  // или "[Xms] Download + [Xms] Send = [Xms] Total buffer send"
[SendTelegram:{sessionId}] [Xms] Successfully sent video to {telegramUserId}
[SendTelegram:{sessionId}] [Xms] Job completed successfully
```

### При 429 ошибке:
```
[SendTelegram:{sessionId}] Rate limit detected. Error structure: { ... }
[SendTelegram:{sessionId}] Rate limited, retry after {N}s (will delay job)
[SendTelegram:{sessionId}] Rate limited, delaying job for {N}s (until {ISO timestamp})
[SendTelegram:{sessionId}] Job moved to delayed queue, will retry at {ISO timestamp}
```

## Критерии успеха

✅ Отправка быстрая (< 10 секунд для малых файлов, < 30 секунд для средних)  
✅ 429 ошибки обрабатываются корректно, не показываются как ошибка пользователю  
✅ Идемпотентность работает: двойной клик не создает дублирующие job'ы  
✅ Мультиплеер работает: каждый игрок получает свое видео независимо  
✅ Логирование таймингов помогает выявить узкие места  
