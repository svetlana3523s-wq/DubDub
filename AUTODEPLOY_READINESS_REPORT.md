# ОТЧЁТ: автодеплой DubDub (VPS + PM2 + GitHub Actions)

**Дата:** 2026-01-18  
**Репозиторий:** DubDub  
**Файл-истина (всегда искать здесь):** `AUTODEPLOY_READINESS_REPORT.md`

## 1) Итог
**STATUS: PASS** — автодеплой работает. Проверка с прод-домена:
- `https://api.tvotototo.ru/meta/version` → `200` и возвращает JSON (minWebBuildId/recommendedAction/messageRu).

## 2) Где что лежит (важные файлы)
- Workflow (CI/CD): `.github/workflows/deploy-prod.yml`
- Скрипт деплоя на сервере: `scripts/deploy_remote.sh`
- PM2 ecosystem: `ecosystem.config.cjs`
- Документация по ручному деплою/контексту: `DEPLOY.md`
- Эндпоинт меты: `apps/api/src/routes/meta.ts` (регистрируется в `apps/api/src/index.ts`)

## 3) Как это работает (коротко)
1) GitHub Actions собирает монорепо (`pnpm -r build`) и пакует `release.tgz`.
2) `release.tgz` загружается на VPS в `/tmp/release.tgz`.
3) По SSH запускается `deploy_remote.sh` (из распакованного релиза), который:
   - создаёт новый релиз: `DEPLOY_PATH/releases/<timestamp>`
   - подхватывает `.env` (см. раздел 5)
   - ставит зависимости (с dev deps для Prisma), делает `db:generate`
   - миграции Prisma выполняет **только если** есть `prisma/migrations` и оно не пустое
   - приводит deps к production (`pnpm install --prod --force`)
   - переключает symlink `DEPLOY_PATH/current` на новый релиз
   - перезапускает процессы через PM2 из `DEPLOY_PATH/current/ecosystem.config.cjs`
   - делает локальный smoke-check (не блокирующий): `/health` и `/meta/version` с ретраями
4) Post-deploy check в GitHub Actions (не блокирующий) проверяет публичные:
   - `${PROD_API_BASE_URL}/health`
   - `${PROD_API_BASE_URL}/meta/version`

## 4) GitHub Secrets (имена + что означают)
Добавляются в GitHub → Settings → Secrets and variables → Actions → Repository secrets.

Обязательные:
- `DEPLOY_HOST` — хост VPS (IP/домен).
- `DEPLOY_USER` — пользователь SSH.
- `DEPLOY_SSH_KEY` — приватный SSH ключ (полный текст, включая BEGIN/END).
- `DEPLOY_PATH` — каталог деплоя на VPS (см. важное ниже).

Опциональные:
- `DEPLOY_PORT` — SSH порт (если не 22).
- `PROD_API_BASE_URL` — публичная база API для post-deploy check (пример: `https://api.tvotototo.ru`).

Важно:
- Значения секретов **не пишем** в репозиторий.
- В логах Actions секреты должны маскироваться `***`.

## 5) Где лежит `.env` на VPS и какие переменные нужны
`scripts/deploy_remote.sh` ищет env так:
1) `DEPLOY_PATH/shared/.env` (предпочтительно)  
2) fallback: `DEPLOY_PATH/.env`

Минимально критичные переменные для запуска (на сервере):
- `DATABASE_URL` (обязательно для Prisma)
- `REDIS_URL`
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `BOT_TOKEN`, `BOT_USERNAME`
- `API_BASE_URL`, `WEBAPP_URL`
- `MIN_WEB_BUILD_ID` (для `/meta/version`; если пусто/нет — проверка версии “выключена”)

Для web-сборки (build-time, в CI):
- `NEXT_PUBLIC_WEB_BUILD_ID` — CI ставит автоматически как `web_<sha12>`

## 6) Важная совместимость путей
В `ecosystem.config.cjs` путь к env зафиксирован как:
- `/var/www/dubdub/shared/.env`

Поэтому **рекомендуется**, чтобы:
- `DEPLOY_PATH` = `/var/www/dubdub`

Если deploy path другой — нужно менять `ecosystem.config.cjs`, иначе PM2 не найдёт env-файл.

## 7) Проверка после деплоя (что считается “ОК”)
Снаружи (публично):
- `${PROD_API_BASE_URL}/health` → `200` (иногда первый запрос после рестарта может быть `502`, ретраи это учитывают)
- `${PROD_API_BASE_URL}/meta/version` → `200` и JSON вида:
  - `minWebBuildId`: строка или `null`
  - `recommendedAction`: `"refresh"`
  - `messageRu`: строка

Локально на VPS (делается автоматически в deploy script):
- `http://127.0.0.1:${API_PORT:-4000}/health`
- `http://127.0.0.1:${API_PORT:-4000}/meta/version`

## 8) Типовые проблемы (и что они значат)
- `DEPLOY_PATH: unbound variable` → переменная не передавалась в ssh-скрипт (исправлено).
- `shared/.env not found` + `DATABASE_URL is not set` → на VPS нет `.env` в ожидаемом месте.
- `prisma: not found` → ставились только prod deps; для Prisma нужен dev deps (исправлено: ставим dev deps, потом возвращаемся к prod).
- `Prisma P3005 (db not empty, no migrations)` → `prisma/migrations` пусто (исправлено: migrate deploy пропускается).
- `Route GET:/meta/version not found` при `health=200` → обычно запущен старый dist/старый PM2 script path; решается перезапуском PM2 из `current` (исправлено: delete+start).

## 9) Откат (rollback) — принцип
Откат делается переключением `DEPLOY_PATH/current` на предыдущий каталог в `DEPLOY_PATH/releases/` и перезапуском PM2.

## 10) Текущее подтверждение “работает”
- `/meta/version` на проде отдаёт `200` (проверено пользователем в браузере).
