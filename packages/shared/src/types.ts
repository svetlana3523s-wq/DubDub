export type SessionStatus = "lobby" | "recording" | "rendering" | "ready";
export type RenderStatus = "pending" | "rendering" | "ready" | "failed";

// Cue for client (in seconds with milliseconds)
export interface Cue {
  roleIndex: number;
  startSec: number;      // Converted from frames for display
  durationSec: number;   // Converted from frames for display
}

// Cue stored in database (in frames for precision)
export interface CueFrames {
  roleIndex: number;
  startFrame: number;
  durationFrames: number;
}

export interface SceneMeta {
  id: string;
  title: string;
  durationSec: number;
  fps: number;
  rolesCount: number;
  cues: Cue[];  // Already converted to seconds for client
}

export interface TelegramUser {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
}

export interface SessionResponse {
  id: string;
  mode: string;
  topic: string;
  status: SessionStatus;
  maxPlayers: number;
  createdByTgUserId: string;
  sceneMeta: SceneMeta;
}

export interface ParticipantResponse {
  id: string;
  tgUserId: string;
  displayName: string;
  roleIndex: number;
}

export interface TakeResponse {
  roleIndex: number;
  durationSec: number;
}

export interface RenderResponse {
  status: RenderStatus;
  videoUrl: string | null;
}

export interface CreateSessionResponse {
  sessionId: string;
}

export interface JoinSessionResponse {
  participant: ParticipantResponse;
  roleIndex: number;
  topic: string;
  sceneMeta: SceneMeta;
  sceneUrl: string;
  currentTurn: number;
  previewUrl: string | null;
}

export interface SessionStateResponse {
  session: SessionResponse;
  participants: ParticipantResponse[];
  currentTurn: number;
  takes: TakeResponse[];
  render: RenderResponse | null;
  myRoleIndex: number | null;
  previewUrl: string | null;
  sceneUrl: string;
}

export interface UploadTakeResponse {
  ok: boolean;
}

export interface FinishSessionResponse {
  queued: boolean;
}

export interface RenderStatusResponse {
  status: RenderStatus;
  videoUrl: string | null;
}

// API Error
export interface ApiError {
  error: string;
  code?: string;
}

