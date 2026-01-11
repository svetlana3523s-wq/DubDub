import { spawn } from "child_process";
import { stat } from "fs/promises";

export interface VideoInfo {
  duration: number;
  fps: number;
}

/**
 * Get video duration and FPS using ffprobe
 * Unified implementation - use this instead of duplicating in bot.ts/admin.ts
 */
export async function getVideoInfo(filePath: string): Promise<VideoInfo> {
  // Check file exists and is not empty
  try {
    const stats = await stat(filePath);
    if (!stats || stats.size === 0) {
      throw new Error(`File not found or empty: ${filePath}`);
    }
  } catch (err: any) {
    throw new Error(`File not found or empty: ${filePath}`);
  }

  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate,width,height,codec_name:format=duration,format_name",
      "-of", "json",
      filePath,
    ]);

    let stdout = "";
    let stderr = "";

    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code === 0) {
        try {
          const json = JSON.parse(stdout);
          const stream = json.streams?.[0];
          const format = json.format;

          if (!stream || !format) {
            console.error(`[VideoUtils] Invalid ffprobe output:`, json);
            reject(new Error("Invalid ffprobe output: missing stream or format. File may not be a valid video."));
            return;
          }

          const duration = parseFloat(format.duration || stream.duration || "0");
          if (isNaN(duration) || duration <= 0) {
            console.error(`[VideoUtils] Invalid duration:`, format.duration, stream.duration);
            reject(new Error(`Invalid video duration: ${format.duration || stream.duration || "unknown"}`));
            return;
          }

          const frameRate = stream.r_frame_rate?.split("/");
          let fps = frameRate && frameRate.length === 2
            ? parseFloat(frameRate[0]) / parseFloat(frameRate[1])
            : 25;

          // Validate FPS
          if (isNaN(fps) || fps <= 0 || fps > 120) {
            console.warn(`[VideoUtils] Invalid FPS (${fps}), defaulting to 25`);
            fps = 25;
          }

          resolve({ duration, fps });
        } catch (parseErr) {
          console.error(`[VideoUtils] Failed to parse ffprobe output:`, parseErr, stdout);
          reject(new Error("Failed to parse video info"));
        }
      } else {
        console.error(`[VideoUtils] ffprobe failed (code ${code}):`, stderr);
        reject(new Error(`ffprobe failed: ${stderr || "unknown error"}`));
      }
    });

    ffprobe.on("error", (err) => {
      console.error(`[VideoUtils] ffprobe spawn error:`, err);
      reject(new Error(`Failed to run ffprobe: ${err.message}. Make sure ffmpeg is installed.`));
    });
  });
}


