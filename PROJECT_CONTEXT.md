# Project Context

## What this project is

DubDub is a Telegram Mini App for collaborative video dubbing. Players take turns recording voice-overs for silent video fragments. Each player hears only a portion of the previous player's recording (0-50% or 50-100%), creating absurd and funny results. The app stitches all recordings with the original video and produces a shareable MP4.

Currently supports 1-3 players per session. Solo mode (1 player) allows recording all roles sequentially.

## Current MVP scope

**Working features:**
- Telegram bot with `/start`, `/help`, `/scenes`, `/stats`, `/edit_cues` commands
- Scene management via bot (admins upload video → set cue timings in frames)
- Session creation with player count (1/2/3) and random topic selection
- Deep linking for session invites (`t.me/BOT?startapp=sessionId`)
- Voice recording with 3-2-1 countdown, one free retake per role
- Audio trimming to exact cue duration
- Video rendering with FFmpeg (volume boost, loudnorm, watermark, CTA)
- Result page with video player and "Save to Telegram" button
- File proxying through API (no direct S3 access from client)

## Core mechanics

1. **Cue timings stored in FRAMES** (not seconds) for precision. Converted to seconds for client display.
2. **Partial audio preview**: Player 2 hears 0-50% of Player 1's audio. Player 3 hears 50-100% of Player 2's audio.
3. **Solo mode**: One player records all roles sequentially; same partial-hearing rules apply between takes.
4. **One retake per role** - after retake used, recording is final.
5. **Audio is trimmed** server-side to exact cue duration.
6. **Only session creator** can trigger final render.

## User flow

1. User opens bot → clicks "Open DubDub" → lands on home page
2. Creates session: picks player count (1/2/3) → gets random topic and scene
3. Shares invite link (deep link) or plays solo
4. Each player: watches muted fragment → records voice → submits
5. Creator clicks "Assemble Video" → worker renders MP4
6. Result page: watch video, save to Telegram, share link

## Tech stack

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm workspaces |
| Frontend | Next.js 14 (App Router), Tailwind CSS |
| Backend | Fastify, Telegraf |
| Worker | BullMQ (Redis) |
| Database | PostgreSQL + Prisma |
| Storage | S3-compatible (MinIO local, AWS S3 prod) |
| Video | FFmpeg |
| Auth | Telegram initData (HMAC SHA-256) |

## Architecture overview

```
DubDub/
├── apps/
│   ├── api/          # Fastify server + Telegram bot
│   │   ├── src/
│   │   │   ├── bot.ts           # Bot commands, scene upload
│   │   │   ├── routes/          # REST endpoints
│   │   │   ├── lib/             # Storage, queue, auth
│   │   │   └── middleware/      # Auth validation
│   ├── web/          # Next.js frontend
│   │   └── src/
│   │       ├── app/             # Pages (/, /create, /s/[id], /s/[id]/result)
│   │       ├── components/      # TelegramProvider, VideoPlayer, VoiceRecorder
│   │       └── lib/             # API client
│   └── worker/       # BullMQ worker for rendering
│       └── src/
│           ├── index.ts         # Job processor
│           └── render.ts        # FFmpeg pipeline
├── packages/
│   └── shared/       # Types, schemas
├── prisma/
│   ├── schema.prisma # DB models: Scene, Session, Participant, Take, Render
│   └── seed.ts       # Topics list
└── docker-compose.yml # Postgres, Redis, MinIO
```

## Running & deployment

**Local development:**
```bash
docker compose up -d          # Start Postgres, Redis, MinIO
pnpm install
pnpm db:push && pnpm db:seed  # Init database
pnpm dev                      # All services on localhost
```

**Production (VPS):**
```bash
git pull
pnpm install && pnpm -r build
pm2 restart all
```

Required: Node 20+, FFmpeg, PostgreSQL, Redis, S3-compatible storage.

## What is intentionally NOT implemented

- User profiles / accounts
- Feed / discovery
- Settings page
- Payments / monetization
- Video upload by users (admins only via bot)
- Multiple scenes per session
- Audio effects / filters for users
- Real-time collaboration (async only)
- Mobile app (Telegram Mini App only)

## Known risks / fragile parts

| Area | Risk |
|------|------|
| **Cue format migration** | Old scenes may have `startSec/durationSec`, new have `startFrame/durationFrames`. Both formats handled but fragile. |
| **FFmpeg filter_complex** | Complex string building. Any syntax error = render fails. Test after changes. |
| **File proxy routes** | All S3 access goes through `/files/*`. If API down, no videos. |
| **MediaRecorder codec** | Browser records as `audio/webm;codecs=opus`. Some devices may differ. |
| **Solo mode state** | `myRoleIndex` changes between takes. Components use `key` prop to force re-render. |
| **Bot initData validation** | Uses HMAC SHA-256. If `BOT_TOKEN` changes, all sessions break. |
| **Rate limits** | Hardcoded 100 req/min global. No per-user session limits in code (only env var). |


