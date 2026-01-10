import { redis } from "./redis.js";

const TTL_SECONDS = 30 * 60; // 30 minutes

interface PendingScene {
  userId: number;
  fileId?: string;
  fileUrl?: string;
  duration: number;
  fps: number;
  totalFrames: number;
  step: "awaiting_title" | "awaiting_category" | "awaiting_cues";
  title?: string;
  category?: string;
}

interface PendingEdit {
  userId: number;
  sceneId: string;
  step: "awaiting_sceneId" | "awaiting_new_cues";
  scene?: {
    id: string;
    title: string;
    duration: number;
    fps: number;
    totalFrames: number;
  };
}

export const botState = {
  // Pending scene upload
  async setPendingScene(userId: number, data: PendingScene, ttl: number = TTL_SECONDS): Promise<void> {
    const key = `bot:pending:scene:${userId}`;
    await redis.setex(key, ttl, JSON.stringify(data));
  },

  async getPendingScene(userId: number): Promise<PendingScene | null> {
    const key = `bot:pending:scene:${userId}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as PendingScene;
    } catch {
      return null;
    }
  },

  async deletePendingScene(userId: number): Promise<void> {
    const key = `bot:pending:scene:${userId}`;
    await redis.del(key);
  },

  // Pending edit
  async setPendingEdit(userId: number, data: PendingEdit, ttl: number = TTL_SECONDS): Promise<void> {
    const key = `bot:pending:edit:${userId}`;
    await redis.setex(key, ttl, JSON.stringify(data));
  },

  async getPendingEdit(userId: number): Promise<PendingEdit | null> {
    const key = `bot:pending:edit:${userId}`;
    const data = await redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as PendingEdit;
    } catch {
      return null;
    }
  },

  async deletePendingEdit(userId: number): Promise<void> {
    const key = `bot:pending:edit:${userId}`;
    await redis.del(key);
  },

  // Pending join
  async setPendingJoin(userId: number, ttl: number = TTL_SECONDS): Promise<void> {
    const key = `bot:pending:join:${userId}`;
    await redis.setex(key, ttl, "1");
  },

  async getPendingJoin(userId: number): Promise<boolean> {
    const key = `bot:pending:join:${userId}`;
    const data = await redis.get(key);
    return data !== null;
  },

  async deletePendingJoin(userId: number): Promise<void> {
    const key = `bot:pending:join:${userId}`;
    await redis.del(key);
  },

  // Clear all pending states for a user
  async clearAll(userId: number): Promise<void> {
    const keys = [
      `bot:pending:scene:${userId}`,
      `bot:pending:edit:${userId}`,
      `bot:pending:join:${userId}`,
    ];
    await redis.del(...keys);
  },
};

