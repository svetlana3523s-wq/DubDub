import { z } from "zod";

export const createSessionSchema = z.object({
  maxPlayers: z.number().int().min(1).max(3),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

// Cue JSON structure
export const cueSchema = z.object({
  roleIndex: z.number().int().min(0),
  startSec: z.number().min(0),
  durationSec: z.number().min(0),
});

export const cueArraySchema = z.array(cueSchema);

export type CueArray = z.infer<typeof cueArraySchema>;

