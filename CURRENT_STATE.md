# Current State

## Last updates
- Fixed multipart parsing in admin scene upload - switched from `request.file()` + `request.parts()` to single `request.parts()` loop
- Plyr video player integrated - seeking, pause, custom controls (no volume/settings/pip)
- Admin Web UI for scene management - `/admin/scenes`, `/admin/upload`, `/admin/scenes/[id]/edit`
- CueEditor component - frame-based navigation, frame inputs, 1-frame step slider
- Bot state migrated to Redis (`bot-state.ts`) - persistent across restarts
- Nginx/Fastify timeouts increased to 10 min for large uploads

## Known issues
- URL upload fails for Yandex.Disk/Google Drive sharing links (returns HTML instead of video)
- Large files (>50MB) cannot be uploaded directly through Telegram bot (use direct URL or Admin UI)
- Plyr CSS overrides use `!important` - may conflict with future styling
- `getVideoInfo` duplicate code in `bot.ts` and `admin.ts` - should be unified

## Next focus
- Test admin scene upload with various file sizes
- Improve error messages for upload failures
- Deduplicate `getVideoInfo` helper (move to shared lib)
