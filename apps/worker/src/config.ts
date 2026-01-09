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
  notifyChannelId: process.env.NOTIFY_CHANNEL_ID || "",
  
  // URLs  
  apiBaseUrl: required("API_BASE_URL"),
} as const;

