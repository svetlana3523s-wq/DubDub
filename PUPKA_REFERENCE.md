# PUPKA_REFERENCE.md (канон для “пупка”)
Обновлено: 2026-01-18

Этот файл — единая точка правды для оперативных данных (домены, пути, процессы, S3, команды, проверки).
Правило: если данные меняются — правим сначала здесь, а затем (по необходимости) в `CURRENT_STATE.md` и доках.

Приоритет источников при конфликте: `artifacts/*` (пруфы) → `docs/*` → `CURRENT_STATE.md` → “на словах”.

Как я (пупка) использую этот файл:
- на любой вопрос сначала сверяюсь с `PUPKA_REFERENCE.md`;
- если чего-то нет — ищу в `docs/` и `artifacts/`, затем добавляю сюда (и только потом даю промты CODEX/AUTO).

## 0) Роли и процесс
- CODEX: код/коммиты/изменения в репо.
- AUTO: деплой/диагностика на VPS.
- Пупка (я): читаю репо/артефакты, готовлю точные промты для CODEX/AUTO и чек-лист “пруфов”.
- Запрет: не править файлы на VPS вручную через SSH/PowerShell (риск поломки кавычек/кодировки). Только git-deploy.

## 1) Домены, URL, IP (prod)
- Site (nginx entry): `https://tvotototo.ru`
- WebApp: `https://app.tvotototo.ru`
- API: `https://api.tvotototo.ru`
- CDN (основной): `https://cdn.tvotototo.ru`
- CDN (тест): `https://cdn-test.tvotototo.ru`
- VPS IP: `130.49.146.229`

## 2) Canonical URL (для проверки в iPhone/Telegram)
- Пример сессии для тестов: `cmkivu60m000dzb0ner98ko9t`
- Канонический URL результата:
  - `https://app.tvotototo.ru/s/cmkivu60m000dzb0ner98ko9t/result`
  - Source: `artifacts/tg_webapp_canonical_url.txt`

## 3) VPS: пути и процессы (prod)
- Repo: `/var/www/dubdub`
- API env: `/var/www/dubdub/.env`
- Web env: `/var/www/dubdub/apps/web/.env`
- Артефакты на VPS: `/var/www/dubdub/artifacts`

PM2 процессы:
- `dubdub-api` (id часто 0)
- `dubdub-worker`
- `dubdub-web` (id встречался 4)

Порты:
- API (Fastify): `3001`
- MinIO (legacy/docker): `9000` (и `9001` console)

## 4) Storage / S3 (фактический канон)
Текущая реальность: worker и API читают/пишут медиа в S3-совместимое хранилище (Yandex Object Storage).

S3 параметры (prod, подтверждено логами):
- `S3_ENDPOINT=https://storage.yandexcloud.net`
- `S3_REGION=ru-central1`
- `S3_BUCKET=dubdub-renders-7197`
- Source: `artifacts/files_proxy_storage_mismatch.txt`

Legacy (исторически было):
- MinIO endpoint: `http://127.0.0.1:9000` (через nginx на VPS)
- Бакет MinIO: `dubdub`
- Примечание: старые доки/диагностики могли считать MinIO “источником истины”, но после миграции сцены/рендеры должны быть в Yandex S3.

## 5) Формулы S3 key (канон)
- Scene: `scenes/scene_<timestamp>_<uuid>.mp4` (в БД `Scene.s3Key`, worker использует именно его)
- Take: `uploads/<sessionId>/<roleIndex>.webm` (в БД `Take.s3Key`)
- Render: `renders/<sessionId>.mp4`
- Source: `docs/media_storage_facts.md`

## 6) /files/renders: nginx routing (важный фикс)
Симптом: `GET https://tvotototo.ru/files/renders/<sessionId>.mp4` отдаёт 404 `X-Minio-Error-Code: NoSuchKey`, при этом `http://localhost:3001/files/renders/<sessionId>.mp4` = 200.

Root cause:
- nginx проксировал `/files/renders/` на MinIO `9000`, минуя API `3001`.

Фикс:
- `/files/renders/` → `http://127.0.0.1:3001/files/renders/`
- отключить кэш для renders (`Cache-Control: no-cache, no-store, must-revalidate`)
- Source: `docs/files_proxy_routing_rootcause.md`, `docs/files_proxy_routing_fix.md`

## 7) Version Gate (P0 фича)
Идея: принудительно обновлять фронт в Telegram WebView.

Переменные:
- Web: `NEXT_PUBLIC_WEB_BUILD_ID` (в `/var/www/dubdub/apps/web/.env`)
- API: `MIN_WEB_BUILD_ID` (в `/var/www/dubdub/.env`)

Эндпоинт:
- `GET /meta/version` (API) должен возвращать `minWebBuildId`.

Код (API):
- `apps/api/src/config.ts`: `minWebBuildId: process.env.MIN_WEB_BUILD_ID || "",`
- `apps/api/src/routes/meta.ts`: `GET /meta/version`
- `apps/api/src/index.ts`: `await fastify.register(metaRoutes);`

Пруфы:
- `artifacts/version_gate_env_proof.txt`
- `artifacts/version_gate_deploy_proof.txt`
- `docs/version_gate_deploy_status.md`

Git (origin):
- `origin/main` сейчас указывает на `cd1d7a8ff5c6ae7a83dfbae2598cb8706b96c71a` (добавляет `/meta/version`).
- История: `8b8111c56c0c1c8091fdbb930ee8d7a1ec037a16` — фикс `minWebBuildId` (до этого `/meta/version` мог быть `404` из-за отсутствия регистрации routes).

## 8) Telegram send-to-telegram (суть и узкие места)
- API: `POST /files/renders/:sessionId/send-to-telegram`
- Polling: `GET /files/renders/:sessionId/send-status`
- Worker отправляет видео:
  - маленькие файлы: URL-метод (`sendVideo(... { url })`)
  - средние: Buffer-метод (`sendVideo(... { source })`)
- Важно: URL, который уходит в Telegram, исторически был `https://api.tvotototo.ru/files/renders/${sessionId}.mp4`.
- Source: `TELEGRAM_SEND_DIAGNOSTIC.md`

CDN-опция:
- План: если CDN совместим (HEAD=200, Range=206, Content-Type `video/mp4`) — отправлять по CDN URL, иначе fallback.
- Риск: “код есть в src, но нет в dist” из-за неправильной сборки worker; см. `artifacts/cdn_config_runtime.txt`.

## 9) Git-deploy: каноничные команды (для AUTO)
Чистый обновляющий деплой (без локальных правок на VPS):
```bash
cd /var/www/dubdub
git fetch origin
git reset --hard origin/main
pnpm install
cd apps/api && pnpm build
pm2 restart dubdub-api --update-env
```

Проверки (минимум):
```bash
curl -sS http://127.0.0.1:3001/meta/version
curl -sS -D - https://api.tvotototo.ru/meta/version
pm2 status
```

## 10) Что держать актуальным (минимальный набор “секретов без секретов”)
Обновлять здесь при изменениях:
- домены (`tvotototo.ru`, `api.*`, `app.*`, `cdn.*`)
- IP VPS
- пути `/var/www/dubdub/...`
- PM2 имена/ids
- S3 endpoint/region/bucket
- текущий тестовый `sessionId` для воспроизведения проблем

## 11) Кандидаты на “сжать/удалить” (только по подтверждению)
Дубли по CDN уже удалены:
- удалено: `docs/cdn_verification.md`, `docs/cdn_verification_report.md`

По “rootcause vs fix”:
- оставляем оба, но считаем resolved: `docs/files_proxy_routing_rootcause.md`, `docs/files_proxy_routing_fix.md`
