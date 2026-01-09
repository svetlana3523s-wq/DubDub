# Current State

## Last updates
- **Implemented parallel recording for 2 players** - Removed turn-based restrictions, both players can record simultaneously
- **Added replay functionality** - Endpoints and UI for replaying same scene or new random scene from same category
- **Fixed bot state management** - Improved active session checks, cancel button always returns main menu, main menu restored after session completion
- **Improved session status validation** - Bot now only searches for active sessions (lobby/recording status)
- Added URL upload support for large files (>20MB) via `/upload_url` command
- Fixed bot category selection flow (pending state was lost between steps)
- Improved ffprobe error handling with detailed logging and user-friendly messages
- Added HTML page detection for URL downloads (Yandex.Disk sharing links fail gracefully)
- Fixed cue parsing to support "Игрок N — кадры" format
- Enhanced video file validation before processing (checks file size, content-type)

## Server Information

**Production Server:**
- SSH: `root@130.49.146.229`
- Project Path: `/var/www/dubdub`
- PM2 Services: `dubdub-api`, `dubdub-web`, `dubdub-worker`
- Last Deployment: `3e4a4e4` - feat: parallel recording, replay functionality, bot state fixes

## Known issues
- URL upload doesn't work with Yandex.Disk sharing links (downloads HTML page instead of video)
- Large files (>20MB) still can't be uploaded directly through Telegram
- No support for other cloud storage services (Google Drive, Dropbox, etc.) - only direct file URLs
- Pending state in bot is stored in memory (lost on server restart) - pendingScenes/pendingEdits/pendingJoins Maps
- Some error messages may not be user-friendly enough (ffprobe failures)

## Deployment

**Quick Deploy:**
```bash
ssh root@130.49.146.229 "cd /var/www/dubdub && git pull && pnpm install && pnpm -r build && pm2 restart dubdub-api dubdub-web dubdub-worker"
```

**Check Services:**
```bash
ssh root@130.49.146.229 "pm2 list | grep dubdub"
ssh root@130.49.146.229 "pm2 logs dubdub-api --lines 20"
```

**Troubleshooting:**
- If git pull fails due to local changes: `git stash && git pull && git stash pop`
- If untracked files conflict: remove them before pull (e.g., `rm -f scripts/upload-videos.js`)
- Check logs: `pm2 logs dubdub-api`, `pm2 logs dubdub-web`, `pm2 logs dubdub-worker`

## Next focus
- Add cloud storage API integration (Yandex.Disk, Google Drive) for direct file access
- Consider persistent state storage for bot dialogs (Redis/database)
- Improve error messages for unsupported file formats and network issues
