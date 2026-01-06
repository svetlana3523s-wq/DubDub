import { spawn } from "child_process";
import { writeFile, mkdir, rm, readFile } from "fs/promises";
import path from "path";
import os from "os";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { config } from "./config.js";
import type { Cue } from "@dubdub/shared";

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true,
});

async function downloadFromS3(key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
    })
  );
  const stream = response.Body as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function uploadToS3(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
}

function runFFmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    console.log("FFmpeg:", "ffmpeg", args.join(" "));

    const ffmpeg = spawn("ffmpeg", args);
    let stdout = "";
    let stderr = "";

    ffmpeg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        console.error("FFmpeg stderr:", stderr);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
  });
}

export interface RenderInput {
  sessionId: string;
  sceneS3Key: string;
  takes: Array<{
    roleIndex: number;
    s3Key: string;
    displayName: string;
  }>;
  cues: Cue[];
  sceneDuration: number;
}

export async function renderVideo(input: RenderInput): Promise<string> {
  const { sessionId, sceneS3Key, takes, cues, sceneDuration } = input;

  // Create temp directory
  const tmpDir = path.join(os.tmpdir(), `dubdub-render-${sessionId}`);
  await mkdir(tmpDir, { recursive: true });

  console.log(`[${sessionId}] Starting render in ${tmpDir}`);

  try {
    // Download scene
    const sceneBuffer = await downloadFromS3(sceneS3Key);
    const scenePath = path.join(tmpDir, "scene.mp4");
    await writeFile(scenePath, sceneBuffer);
    console.log(`[${sessionId}] Downloaded scene`);

    // Download takes
    const takePaths: string[] = [];
    for (const take of takes) {
      const buffer = await downloadFromS3(take.s3Key);
      const takePath = path.join(tmpDir, `take_${take.roleIndex}.webm`);
      await writeFile(takePath, buffer);
      takePaths.push(takePath);
      console.log(`[${sessionId}] Downloaded take ${take.roleIndex}`);
    }

    // Build FFmpeg command
    const outputPath = path.join(tmpDir, "output.mp4");

    // Input files
    const inputs: string[] = ["-i", scenePath];
    for (const takePath of takePaths) {
      inputs.push("-i", takePath);
    }

    // Build filter complex
    let filterComplex = "";
    const audioMixParts: string[] = [];

    // Process each take
    for (let i = 0; i < takes.length; i++) {
      const take = takes[i];
      if (!take) continue;

      const cue = cues.find((c) => c.roleIndex === take.roleIndex);
      if (!cue) continue;

      const delayMs = Math.floor(cue.startSec * 1000);

      // Delay and normalize audio
      filterComplex += `[${i + 1}:a]adelay=${delayMs}|${delayMs},loudnorm=I=-16:LRA=11:TP=-1.5[a${i}];`;
      audioMixParts.push(`[a${i}]`);
    }

    // Mix all audio
    if (audioMixParts.length > 0) {
      filterComplex += `${audioMixParts.join("")}amix=inputs=${audioMixParts.length}:duration=first:dropout_transition=0[aout];`;
    }

    // Video filter: watermark + CTA
    let videoFilter = "[0:v]";

    // Watermark in corner
    videoFilter += `drawtext=text='@DubDub':fontsize=20:fontcolor=white@0.7:x=w-tw-15:y=15`;

    // Player overlays during their cues
    for (const take of takes) {
      const cue = cues.find((c) => c.roleIndex === take.roleIndex);
      if (!cue) continue;

      const playerNum = take.roleIndex + 1;
      const startTime = cue.startSec;
      const endTime = cue.startSec + cue.durationSec;

      // What they heard
      let heardText = "";
      if (take.roleIndex === 1) {
        heardText = "  слышал 0-50%";
      } else if (take.roleIndex === 2) {
        heardText = "  слышал 50-100%";
      }

      const overlayText = `Игрок ${playerNum}${heardText}`.replace(/:/g, "\\:");

      videoFilter += `,drawtext=text='${overlayText}':fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=6:x=15:y=h-50:enable='between(t,${startTime},${endTime})'`;
    }

    // CTA at end
    const ctaStart = sceneDuration - 1.5;
    const ctaText = `t.me/${config.botUsername}`.replace(/:/g, "\\:");
    videoFilter += `,drawtext=text='${ctaText}':fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=8:x=(w-tw)/2:y=(h-th)/2:enable='gte(t,${ctaStart})'`;

    videoFilter += "[vout]";
    filterComplex += videoFilter;

    const ffmpegArgs = [
      "-y",
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
    ];

    if (audioMixParts.length > 0) {
      ffmpegArgs.push("-map", "[aout]");
    }

    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath
    );

    await runFFmpeg(ffmpegArgs);
    console.log(`[${sessionId}] FFmpeg completed`);

    // Upload result
    const outputBuffer = await readFile(outputPath);
    const s3Key = `renders/${sessionId}.mp4`;
    await uploadToS3(s3Key, outputBuffer, "video/mp4");
    console.log(`[${sessionId}] Uploaded to S3: ${s3Key}`);

    return s3Key;
  } finally {
    // Cleanup temp directory
    try {
      await rm(tmpDir, { recursive: true, force: true });
      console.log(`[${sessionId}] Cleaned up temp directory`);
    } catch (err) {
      console.error(`[${sessionId}] Failed to cleanup:`, err);
    }
  }
}

