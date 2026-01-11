# Current State

## Last updates
- **Случайный выбор сцены** — теперь при создании игры выбирается СЛУЧАЙНАЯ сцена из неиспользованных; учитываются ВСЕ сессии (не только завершённые)
- **Кнопка "Начать игру" исправлена** — заменена inline web_app кнопка на текстовую ссылку (iOS баг)
- **VideoPlayer заменён на простой без Plyr** — убрали Plyr библиотеку (вызывала ошибки при переключении режимов), используем нативный HTML5 video с кастомными контролами
- **iOS workaround for inline web_app buttons** — inline кнопки с `web_app` открывают WebView без Telegram SDK; используем ссылки `?startapp=s_sessionId` вместо inline buttons (НЕ ТРОГАТЬ!)
- Server-side audio processing — при загрузке видео FFmpeg создаёт версию с вырезанным аудио (`s3KeyCuts`)

## VideoPlayer решение (НЕ ТРОГАТЬ!)
**Файл:** `apps/web/src/components/VideoPlayer.tsx`

**Как работает:**
- Принимает `src` (оригинал) и `srcCuts` (с вырезанным аудио)
- Переключатель "С вырезами / Оригинал" меняет `currentSrc` между ними
- Нативный HTML5 `<video>` без сторонних библиотек
- Кастомные контролы: ползунок перемотки, кнопка play/pause, кнопка mute
- Поддержка `startTime`/`endTime` для фрагментов

**Почему не Plyr:**
- Plyr падал при переключении src (race condition при destroy/create)
- Сложная инициализация вызывала проблемы с кешированием

**Использование на странице сессии:**
```tsx
// Полное видео с переключателем
<VideoPlayer
  src={session.sceneUrl}
  srcCuts={session.sceneUrlCuts}
  showAudioModeSwitch={true}
/>

// Фрагмент (тоже с переключателем)
<VideoPlayer
  src={session.sceneUrl}
  srcCuts={session.sceneUrlCuts}
  startTime={myCue.startSec}
  endTime={myCue.startSec + myCue.durationSec}
  showAudioModeSwitch={true}
/>
```

## Known issues
- Медленная загрузка видео — возможно связано с FFmpeg обработкой при upload
- URL upload fails for Yandex.Disk/Google Drive sharing links (returns HTML)

## Next focus
- Исправить оставшиеся баги по запросу пользователя
- Не трогать логику присоединения через `?startapp=` — она работает!
- Не трогать VideoPlayer — он работает!
