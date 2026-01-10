import type { Cue, CueFrames } from "../types.js";

/**
 * Parse cueJson from database format (frames or seconds) to client format (seconds)
 * Supports both old format (seconds) and new format (frames) for backward compatibility
 */
export function parseCuesFromJson(cueJson: string, fps: number): Cue[] {
  const raw = JSON.parse(cueJson) as any[];
  
  return raw.map((cue) => {
    // New format: frames
    if ('startFrame' in cue && typeof cue.startFrame === 'number') {
      return {
        roleIndex: cue.roleIndex,
        startSec: cue.startFrame / fps,
        durationSec: cue.durationFrames / fps,
      };
    }
    // Old format: seconds (backwards compatibility)
    return {
      roleIndex: cue.roleIndex,
      startSec: cue.startSec,
      durationSec: cue.durationSec,
    };
  });
}

/**
 * Convert cues from seconds to frames for database storage
 */
export function cuesToFrames(cues: Cue[], fps: number): CueFrames[] {
  return cues.map((cue) => ({
    roleIndex: cue.roleIndex,
    startFrame: Math.round(cue.startSec * fps),
    durationFrames: Math.round(cue.durationSec * fps),
  }));
}

/**
 * Validate cue timing
 */
export function validateCue(cue: Cue, maxDuration: number): boolean {
  if (
    typeof cue.roleIndex !== 'number' ||
    typeof cue.startSec !== 'number' ||
    typeof cue.durationSec !== 'number'
  ) {
    return false;
  }
  
  if (cue.roleIndex < 0 || cue.startSec < 0 || cue.durationSec <= 0) {
    return false;
  }
  
  if (cue.startSec + cue.durationSec > maxDuration) {
    return false;
  }
  
  return true;
}

/**
 * Validate all cues in array
 */
export function validateCues(cues: Cue[], maxDuration: number): boolean {
  if (!Array.isArray(cues) || cues.length === 0) {
    return false;
  }
  
  return cues.every((cue) => validateCue(cue, maxDuration));
}

