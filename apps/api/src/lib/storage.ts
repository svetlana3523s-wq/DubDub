import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";
import type { Readable } from "stream";

const s3Client = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKey,
    secretAccessKey: config.s3.secretKey,
  },
  forcePathStyle: true, // Required for MinIO
});

const bucket = config.s3.bucket;

export const storage = {
  /**
   * Upload a file to S3
   */
  async upload(
    key: string,
    body: Buffer | Uint8Array | ReadableStream,
    contentType: string
  ): Promise<void> {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body as any,
        ContentType: contentType,
      })
    );
  },

  /**
   * Get a signed URL for downloading (valid for 1 hour)
   */
  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  },

  /**
   * Get object as stream (for efficient proxying)
   */
  async getStream(key: string): Promise<{ stream: Readable; contentLength?: number }> {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return {
      stream: response.Body as Readable,
      contentLength: response.ContentLength,
    };
  },

  /**
   * Get object as buffer
   */
  async download(key: string): Promise<Buffer> {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    const stream = response.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  },

  /**
   * Check if object exists and get its size
   */
  async head(key: string): Promise<{ exists: boolean; size?: number }> {
    try {
      const response = await s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      );
      return { exists: true, size: response.ContentLength };
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw err;
    }
  },

  /**
   * Delete an object
   */
  async delete(key: string): Promise<void> {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  },

  /**
   * Build S3 key for different file types
   */
  keys: {
    scene: (filename: string) => `scenes/${filename}`,
    upload: (sessionId: string, roleIndex: number) =>
      `uploads/${sessionId}/${roleIndex}.webm`,
    preview: (sessionId: string, forRoleIndex: number) =>
      `previews/${sessionId}/preview_for_${forRoleIndex}.webm`,
    render: (sessionId: string) => `renders/${sessionId}.mp4`,
  },
};

