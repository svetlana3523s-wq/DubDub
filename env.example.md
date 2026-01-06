# Environment Variables

Create a `.env` file in the root with these variables:

```bash
# === Database ===
DATABASE_URL="postgresql://dubdub:dubdub_secret@localhost:5432/dubdub"

# === Redis ===
REDIS_URL="redis://localhost:6379"

# === S3 / MinIO ===
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_BUCKET="dubdub"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin123"

# === Telegram Bot ===
BOT_TOKEN="YOUR_BOT_TOKEN_FROM_BOTFATHER"
BOT_USERNAME="DubDubBot"

# === URLs ===
WEBAPP_URL="http://localhost:3000"
API_BASE_URL="http://localhost:4000"

# === API Server ===
API_PORT=4000
API_HOST="0.0.0.0"

# === Limits ===
RATE_LIMIT_SESSIONS_PER_HOUR=10
MAX_AUDIO_SIZE_MB=5

# === Admin ===
ADMIN_SECRET_KEY="your-super-secret-key-here"
ADMIN_TG_USER_IDS="123456789,987654321"
```

## Production values

```bash
S3_ENDPOINT="https://s3.amazonaws.com"
S3_REGION="eu-central-1"
WEBAPP_URL="https://app.yourdomain.com"
API_BASE_URL="https://api.yourdomain.com"
```

