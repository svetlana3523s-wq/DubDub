# Current State

## Last updates
- **Multiplayer replay confirmation** — при нажатии "Ещё раз"/"Новая сцена" второму игроку приходит запрос; игра начинается после согласия обоих
- **Навигация через window.location** — после replay используется `window.location.href` вместо `router.push` (избегает кеширование Next.js)
- **Случайный выбор сцены** — при создании игры выбирается случайная сцена; учитываются ВСЕ сессии (lobby, recording, rendering, ready)
- **User ID сравнение как строки** — `String(replayReq.requestedBy) === String(user.id)` для корректного определения requester
- **Polling для всех игроков** — в мультиплеере polling replayStatus работает для обоих игроков
- **Backup:** `git tag backup-multiplayer-replay-v1`

## Критичные решения (НЕ ТРОГАТЬ!)

### iOS deep links
Inline кнопки с `web_app` открывают WebView без Telegram SDK. Используем ссылки `?startapp=s_sessionId`.

### VideoPlayer
Нативный HTML5 `<video>` без Plyr. Файл: `apps/web/src/components/VideoPlayer.tsx`

### Replay navigation
Использовать `window.location.href` вместо `router.push` для перехода после replay.

## Known issues
- Медленная загрузка видео (FFmpeg обработка при upload)
- "Отправка себе" после рендера не работает (needs review)
- URL upload fails for Yandex.Disk/Google Drive (returns HTML)

## Next focus
- Исправить "Отправка себе" (sendVideoToTelegram)
- Оптимизировать загрузку видео
