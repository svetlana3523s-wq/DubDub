# Current State

## Last updates
- **iOS workaround for inline web_app buttons** — inline кнопки с `web_app` открывают WebView без Telegram SDK; используем ссылки `?startapp=s_sessionId` вместо inline buttons (НЕ ТРОГАТЬ!)
- `getVideoInfo` вынесен в `lib/video-utils.ts` — убрано дублирование в bot.ts и admin.ts
- `onDelete: Cascade` добавлен для Session→Scene — теперь при удалении сцены удаляются связанные сессии
- Health check для worker — HTTP сервер на порту 3002 (`/health`)
- Server-side audio processing — при загрузке видео FFmpeg создаёт версию с вырезанным аудио (`s3KeyCuts`)

## Known issues
- Медленная загрузка видео — возможно связано с FFmpeg обработкой при upload
- URL upload fails for Yandex.Disk/Google Drive sharing links (returns HTML)
- Plyr CSS использует `!important` — может конфликтовать

## Next focus
- Выявить и исправить конкретные баги (спросить пользователя)
- Не трогать логику присоединения через `?startapp=` — она работает!
- Рефакторинг после стабилизации
