import { z } from "zod";

export const categorySchema = z.enum(["movies", "memes", "politics"]);
export const gameModeSchema = z.enum(["improv", "tasks"]);

export const createSessionSchema = z.object({
  maxPlayers: z.number().int().min(1).max(2),  // Only 1 or 2 players now
  category: categorySchema,
  gameMode: gameModeSchema,
});

// CreateSessionInput type is exported from types.ts

// Cue JSON structure (frames - stored in DB)
export const cueFramesSchema = z.object({
  roleIndex: z.number().int().min(0),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(1),
});

// Cue for client (seconds)
export const cueSchema = z.object({
  roleIndex: z.number().int().min(0),
  startSec: z.number().min(0),
  durationSec: z.number().min(0),
});

export const cueArraySchema = z.array(cueSchema);
export const cueFramesArraySchema = z.array(cueFramesSchema);

export type CueArray = z.infer<typeof cueArraySchema>;
export type CueFramesArray = z.infer<typeof cueFramesArraySchema>;
