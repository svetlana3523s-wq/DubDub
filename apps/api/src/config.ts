function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Server
  port: parseInt(optional("API_PORT", "4000")),
  host: optional("API_HOST", "0.0.0.0"),

  // Database
  databaseUrl: required("DATABASE_URL"),

  // Redis
  redisUrl: optional("REDIS_URL", "redis://localhost:6379"),

  // S3
  s3: {
    endpoint: optional("S3_ENDPOINT", "http://localhost:9000"),
    region: optional("S3_REGION", "us-east-1"),
    bucket: optional("S3_BUCKET", "dubdub"),
    accessKey: required("S3_ACCESS_KEY"),
    secretKey: required("S3_SECRET_KEY"),
  },

  // Telegram
  botToken: required("BOT_TOKEN"),
  botUsername: required("BOT_USERNAME"),
  notifyChannelId: process.env.NOTIFY_CHANNEL_ID || "",  // Channel for notifications

  // URLs
  webappUrl: required("WEBAPP_URL"),
  apiBaseUrl: required("API_BASE_URL"),

  // Limits
  rateLimitSessionsPerHour: parseInt(optional("RATE_LIMIT_SESSIONS_PER_HOUR", "10")),
  maxAudioSizeMb: parseInt(optional("MAX_AUDIO_SIZE_MB", "5")),

  // Admin
  adminSecretKey: optional("ADMIN_SECRET_KEY", "change-me-in-production"),
  adminTgUserIds: optional("ADMIN_TG_USER_IDS", "").split(",").filter(Boolean),
} as const;

export type Config = typeof config;

