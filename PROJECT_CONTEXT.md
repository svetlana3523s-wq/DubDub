# Project Context

## What this project is

DubDub is a Telegram Mini App for collaborative video dubbing. Players record voice-overs for silent video fragments. In multiplayer mode (2 players), both record simultaneously. The app stitches recordings with the original video and produces a shareable MP4.

Currently supports **1 or 2 players** per session. Solo mode allows one player to record all roles sequentially. Multiplayer mode allows both players to record in parallel (no turn-based restrictions).

## Current MVP scope

**Working features:**
- Telegram bot with persistent menu (`/start`, `/help`, `/scenes`, `/stats`, `/edit_cues`, `/upload_url`)
- Scene management via bot (admins upload video via Telegram file or URL → set title → select category → set cue timings in frames)
- Session creation: select category (movies/memes/politics) → select game mode (improv/tasks) → select player count (1 or 2)
- Deep linking for session invites (`t.me/BOT?startapp=sessionId`)
- Voice recording with 3-2-1 countdown, one free retake per role, automatic audio trimming to cue duration
- **Parallel recording** for 2 players (no turn-based restrictions)
- Video rendering with FFmpeg (keeps original audio, replaces only cue ranges, applies loudnorm, adds watermark with player names)
- Result page with video player, "Save to Telegram" button, and replay buttons (same scene / new scene)
- File proxying through API (no direct S3 access from client)
- Replay functionality: restart session with same scene or new random scene from same category

## Core mechanics

1. **Cue timings stored in FRAMES** (not seconds) in database for precision. Converted to seconds (`startSec`, `durationSec`) for client display using scene FPS.
2. **No audio preview** - players do NOT hear previous player's takes (creates more chaos).
3. **Solo mode (1 player)**: One player records all roles sequentially.
4. **Multiplayer mode (2 players)**: Both players can record simultaneously. No turn-based restrictions. Each player records once for their assigned role.
5. **One retake per role** - after retake used, recording is final.
6. **Audio is trimmed** server-side to exact cue duration (if recorded longer, excess is cut).
7. **Only last player** (who recorded last) can trigger final render in multiplayer mode. In solo mode, creator triggers after all roles recorded.
8. **Scene selection**: System tries to avoid showing same scene twice until all scenes in category are played.
9. **Replay**: After video is ready, players can restart with same scene (same roles) or new random scene from same category (roles shuffled).

## User flow

1. User opens bot → clicks "🎭 Начать игру" → lands on Mini App home page
2. Creates session: picks category (🎬 Кино/сериалы | 😂 Мемы | 🏛️ Политика) → picks mode (🎭 Импровизация | 📝 С заданиями) → picks player count (1 or 2)
3. Gets random scene from selected category (avoids previously played scenes)
4. **Solo mode**: Player records all roles sequentially → clicks "Собрать видео" → render → result page
5. **Multiplayer mode**: 
   - Lobby: first player shares session code (clickable, copyable) or deep link
   - Second player joins via bot ("👥 Присоединиться к игре" → enters code)
   - Both players can record simultaneously (no waiting)
   - Last player to record clicks "Собрать видео" → render → result page
6. Result page: watch video, save to Telegram, replay (same scene / new scene)

## Tech stack

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm workspaces |
| Frontend | Next.js 14 (App Router), Tailwind CSS, Telegram WebApp SDK |
| Backend | Fastify, Telegraf (webhook in prod, polling in dev) |
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
│   │   ├── src/
│   │   │   ├── bot.ts           # Bot commands, scene upload (file/URL), edit cues, join flow
│   │   │   ├── routes/          # REST endpoints
│   │   │   │   ├── sessions.ts  # POST /sessions, POST /sessions/:id/join, GET /sessions/:id, POST /sessions/:id/take, POST /sessions/:id/finish, POST /sessions/:id/replay
│   │   │   │   ├── files.ts     # GET /files/scenes/:filename, GET /files/renders/:sessionId, POST /files/renders/:sessionId/send-to-telegram
│   │   │   │   ├── renders.ts   # GET /renders/:sessionId
│   │   │   │   ├── admin.ts     # GET /admin/stats, GET /admin/health, GET /admin/sessions
│   │   │   │   └── health.ts    # GET /health
│   │   │   ├── lib/             # Storage, queue, auth, bot instance
│   │   │   └── middleware/      # Auth validation (HMAC SHA-256)
│   ├── web/          # Next.js frontend
│   │   └── src/
│   │       ├── app/             # Pages (/, /create, /s/[id], /s/[id]/result)
│   │       ├── components/      # TelegramProvider, VideoPlayer (with audio mode switch), VoiceRecorder
│   │       └── lib/             # API client
│   └── worker/       # BullMQ worker for rendering
│       └── src/
│           ├── index.ts         # Job processor
│           └── render.ts        # FFmpeg pipeline (keeps original audio, replaces cue ranges)
├── packages/
│   └── shared/       # Types, schemas (Zod validation)
├── prisma/
│   ├── schema.prisma # DB models: Scene, Session, Participant, Take, Render
│   └── seed.ts       # Sample scene and tasks
└── docker-compose.yml # Postgres, Redis, MinIO
```

## Running & deployment

**Local development:**
```bash
docker compose up -d          # Start Postgres, Redis, MinIO
pnpm install
pnpm db:generate && pnpm db:push && pnpm db:seed  # Init database
pnpm dev                      # All services on localhost
```

**Production (VPS):**
```bash
git pull
pnpm install && pnpm -r build
pm2 restart dubdub-api dubdub-web dubdub-worker
```

### Server Access

**SSH Connection:**
- Server IP: `130.49.146.229`
- User: `root`
- Project Path: `/var/www/dubdub`
- PM2 Services: `dubdub-api`, `dubdub-web`, `dubdub-worker`

**Deployment Command:**
```bash
ssh root@130.49.146.229 "cd /var/www/dubdub && git pull && pnpm install && pnpm -r build && pm2 restart dubdub-api dubdub-web dubdub-worker"
```

**Check Status:**
```bash
ssh root@130.49.146.229 "pm2 list | grep dubdub"
ssh root@130.49.146.229 "pm2 logs dubdub-api --lines 20"
```

Required: Node 20+, FFmpeg, PostgreSQL, Redis, S3-compatible storage.

## What is intentionally NOT implemented

- User profiles / accounts
- Feed / discovery
- Settings page
- Payments / monetization
- Video upload by users (admins only via bot)
- Multiple scenes per session (one scene per session)
- Audio effects / filters for users
- Real-time collaboration (async only)
- Mobile app (Telegram Mini App only)
- Turn-based recording in multiplayer (parallel only)
- Audio preview of previous player's take

## Known risks / fragile parts

| Area | Risk |
|------|------|
| **Cue format migration** | Old scenes may have `startSec/durationSec` in cueJson, new have `startFrame/durationFrames`. Both formats handled but fragile. Always use frames for new scenes. |
| **FFmpeg filter_complex** | Complex string building in `render.ts`. Any syntax error = render fails. Test after changes. Validates cue times before passing to FFmpeg. |
| **File proxy routes** | All S3 access goes through `/files/*`. If API down, no videos. No direct S3 URLs for security. |
| **MediaRecorder codec** | Browser records as `audio/webm;codecs=opus`. Some devices may differ. FFmpeg handles conversion. |
| **Solo mode state** | `myRoleIndex` changes between takes. Components use `key` prop to force re-render. |
| **Bot initData validation** | Uses HMAC SHA-256. If `BOT_TOKEN` changes, all sessions break. Token must match between bot and validation. |
| **Bot state in memory** | `pendingScenes`, `pendingEdits`, `pendingJoins` Maps are lost on server restart. Not persistent. |
| **Parallel recording** | No turn checks in multiplayer mode. Backend only checks if take already exists. Race conditions possible if same player submits twice quickly. |
| **Replay transaction** | Uses Prisma transaction to delete takes/render and update session atomically. If fails, session may be in inconsistent state. |
