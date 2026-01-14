# Project Context

## What this project is

DubDub is a Telegram Mini App for collaborative video dubbing. Players record voice-overs for silent video fragments. In multiplayer mode (2 players), both record simultaneously. The app stitches recordings with the original video and produces a shareable MP4.

Currently supports **1 or 2 players** per session. Solo mode allows one player to record all roles sequentially. Multiplayer mode allows both players to record in parallel (no turn-based restrictions).

## Current MVP scope

**Working features:**
- Telegram bot with persistent menu (`/start`, `/help`, `/scenes`, `/stats`, `/edit_cues`, `/upload_url`)
- Scene management via bot (admins upload video via Telegram file or URL → set title → select category → set cue timings in frames)
- **Admin Web UI** for scene management (upload, list, edit, delete scenes via Mini App interface `/admin/scenes`, `/admin/upload`)
- Session creation: select category (movies/memes/politics) → select game mode (improv/tasks) → select player count (1 or 2)
- Deep linking for session invites (`t.me/BOT?startapp=sessionId`)
- Voice recording with 3-2-1 countdown, one free retake per role, automatic audio trimming to cue duration
- Parallel recording for 2 players (no turn-based restrictions)
- Video rendering with FFmpeg (keeps original audio, replaces only cue ranges, applies loudnorm, adds watermark with player names)
- Result page with Plyr video player, "Save to Telegram" button, and replay buttons (same scene / new scene)
- File proxying through API (no direct S3 access from client)
- Replay functionality: restart session with same scene or new random scene from same category

## Core mechanics

1. **Cue timings stored in FRAMES** (not seconds) in database for precision. Converted to seconds (`startSec`, `durationSec`) for client display using scene FPS.
2. **No audio preview** - players do NOT hear previous player's takes (creates more chaos).
3. **Solo mode (1 player)**: One player records all roles sequentially.
4. **Multiplayer mode (2 players)**: Both players can record simultaneously. Each player records once for their assigned role.
5. **One retake per role** - after retake used, recording is final.
6. **Audio is trimmed** server-side to exact cue duration using `atrim` FFmpeg filter.
7. **Only last player** (who recorded last) can trigger final render in multiplayer mode. In solo mode, creator triggers after all roles recorded.
8. **Scene selection**: System tries to avoid showing same scene twice until all scenes in category are played.
9. **Replay**: After video is ready, players can restart with same scene (same roles) or new random scene from same category (roles shuffled).

## User flow

1. User opens bot → clicks "🎭 Начать игру" → lands on Mini App home page
2. Creates session: picks category (🎬 Кино/сериалы | 😂 Мемы | 🏛️ Политика) → picks mode (🎭 Импровизация | 📝 С заданиями) → picks player count (1 or 2)
3. Gets random scene from selected category (avoids previously played scenes)
4. **Solo mode**: Player records all roles sequentially → clicks "Собрать видео" → render → result page
5. **Multiplayer mode**: Lobby → share code → second player joins → both record simultaneously → last player triggers render → result page
6. Result page: watch video, save to Telegram, replay (same scene / new scene)

## Tech stack

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm workspaces |
| Frontend | Next.js 14 (App Router), Tailwind CSS, Telegram WebApp SDK, Plyr (video player) |
| Backend | Fastify, Telegraf (webhook in prod, polling in dev), @fastify/multipart |
| Worker | BullMQ (Redis), FFmpeg |
| Database | PostgreSQL + Prisma ORM |
| Storage | S3-compatible (MinIO local, AWS S3 prod) |
| Queue | Redis + BullMQ |
| Auth | Telegram initData validation (HMAC SHA-256) |

## Architecture overview

```
DubDub/
├── apps/
│   ├── api/          # Fastify server + Telegram bot
│   │   └── src/
│   │       ├── bot.ts           # Bot commands, scene upload, edit cues, join flow
│   │       ├── routes/
│   │       │   ├── sessions.ts  # Session CRUD, take upload, finish, replay
│   │       │   ├── files.ts     # File proxy, send-to-telegram
│   │       │   ├── admin.ts     # Stats, scene CRUD (multipart upload)
│   │       │   └── health.ts    # Health check
│   │       ├── lib/
│   │       │   ├── bot-state.ts # Redis-backed bot dialogue state
│   │       │   ├── storage.ts   # S3 adapter
│   │       │   └── queue.ts     # BullMQ
│   │       └── middleware/      # Auth (HMAC SHA-256), admin check
│   ├── web/          # Next.js frontend
│   │   └── src/
│   │       ├── app/
│   │       │   ├── admin/       # Admin UI (scenes list, upload, edit)
│   │       │   ├── create/      # Session creation
│   │       │   └── s/[id]/      # Session page, result page
│   │       └── components/
│   │           ├── PlyrVideoPlayer.tsx  # Video player with custom controls
│   │           ├── CueEditor.tsx        # Visual cue timing editor (frames)
│   │           └── VoiceRecorder.tsx    # Audio recording with countdown
│   └── worker/       # BullMQ worker for rendering
│       └── src/
│           ├── index.ts         # Job processor
│           └── render.ts        # FFmpeg pipeline
├── packages/
│   └── shared/       # Types, schemas (Zod), cue utils
├── prisma/
│   └── schema.prisma # Scene, Session, Participant, Take, Render
└── docker-compose.yml # Postgres, Redis, MinIO
```

## Running & deployment

**Local development:**
```bash
docker compose up -d          # Start Postgres, Redis, MinIO
pnpm install
pnpm db:generate && pnpm db:push && pnpm db:seed
pnpm dev                      # All services on localhost
```

**Production (VPS):**
```bash
ssh root@130.49.146.229 "cd /var/www/dubdub && git pull && pnpm install && pnpm db:generate && pnpm db:push && pnpm -r build && pm2 restart dubdub-api dubdub-web dubdub-worker"
```

**Server info:**
- IP: `130.49.146.229`, User: `root`, Path: `/var/www/dubdub`
- PM2 services: `dubdub-api`, `dubdub-web`, `dubdub-worker`
- Nginx reverse proxy for API and web
- Required: Node 20+, FFmpeg, PostgreSQL, Redis, S3-compatible storage

## What is intentionally NOT implemented

- User profiles / accounts
- Feed / discovery
- Settings page
- Payments / monetization
- Video upload by users (admins only)
- Multiple scenes per session
- Audio effects / filters for users
- Real-time collaboration (async only)
- Turn-based recording in multiplayer

## Known risks / fragile parts

| Area | Risk |
|------|------|
| **Cue format** | Old scenes may have `startSec/durationSec`, new have `startFrame/durationFrames`. Both formats handled via `parseCuesFromJson`. Always use frames for new scenes. |
| **FFmpeg filter_complex** | Complex string building in `render.ts`. Syntax error = render fails. Validates cue times before passing. |
| **File proxy** | All S3 access goes through `/files/*`. If API down, no videos. |
| **Multipart uploads** | Admin scene upload uses `request.parts()` streaming. Large files (>500MB) may timeout. Nginx `client_max_body_size` must match. |
| **MediaRecorder codec** | Browser records `audio/webm;codecs=opus`. Some devices may differ. FFmpeg handles conversion. |
| **Bot state** | Stored in Redis (`bot-state.ts`). TTL 30 min. If Redis restarts, pending dialogues lost. |
| **Parallel recording** | No turn checks. Backend uses `upsert` to prevent duplicate takes. Race conditions possible if same player submits twice quickly. |
| **Replay transaction** | Uses Prisma transaction to delete takes/render and update session atomically. |
