# Current State

## Last updates
- Parallel recording for 2 players (no turn-based restrictions, both can record simultaneously)
- Replay functionality added (restart with same scene or new random scene from same category)
- Bot state management improved (active session checks, cancel button always returns main menu)
- Server deployment info documented (SSH access, PM2 services, commands)
- Session code sharing simplified (clickable code, copy/share buttons)
- Bot persistent menu implemented (always visible at bottom)

## Known issues
- Bot pending state in memory (lost on restart) - `pendingScenes`/`pendingEdits`/`pendingJoins` Maps
- URL upload fails for Yandex.Disk sharing links (downloads HTML page instead of video)
- Large files (>20MB) cannot be uploaded directly through Telegram
- No support for cloud storage APIs (only direct file URLs work)
- Error messages for ffprobe failures could be more user-friendly

## Next focus
- Persistent bot state storage (Redis/database instead of in-memory Maps)
- Cloud storage API integration (Yandex.Disk, Google Drive) for direct file access
- Improve error handling and user messages for file upload failures
