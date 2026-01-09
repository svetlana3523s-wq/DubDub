# Current State

## Last updates
- Added URL upload support for large files (>20MB) via `/upload_url` command
- Fixed bot category selection flow (pending state was lost between steps)
- Improved ffprobe error handling with detailed logging and user-friendly messages
- Added HTML page detection for URL downloads (Yandex.Disk sharing links fail gracefully)
- Fixed cue parsing to support "Игрок N — кадры" format
- Enhanced video file validation before processing (checks file size, content-type)

## Known issues
- URL upload doesn't work with Yandex.Disk sharing links (downloads HTML page instead of video)
- Large files (>20MB) still can't be uploaded directly through Telegram
- No support for other cloud storage services (Google Drive, Dropbox, etc.) - only direct file URLs
- Pending state in bot is stored in memory (lost on server restart) - pendingScenes/pendingEdits/pendingJoins Maps
- Some error messages may not be user-friendly enough (ffprobe failures)

## Next focus
- Add cloud storage API integration (Yandex.Disk, Google Drive) for direct file access
- Consider persistent state storage for bot dialogs (Redis/database)
- Improve error messages for unsupported file formats and network issues
