#!/usr/bin/env node
/**
 * Upload scene file to S3/MinIO
 * Usage: node scripts/upload-scene.js <path-to-mp4>
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

const config = {
  endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
  region: process.env.S3_REGION || "us-east-1",
  bucket: process.env.S3_BUCKET || "dubdub",
  accessKey: process.env.S3_ACCESS_KEY || "minioadmin",
  secretKey: process.env.S3_SECRET_KEY || "minioadmin123",
};

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.log("Usage: node scripts/upload-scene.js <path-to-mp4>");
    console.log("Example: node scripts/upload-scene.js ./scene1.mp4");
    process.exit(1);
  }

  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const s3Client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
    forcePathStyle: true,
  });

  const fileBuffer = await readFile(filePath);
  const key = "scenes/scene1.mp4";

  console.log(`Uploading ${filePath} to ${config.bucket}/${key}...`);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fileBuffer,
      ContentType: "video/mp4",
    })
  );

  console.log("✅ Upload complete!");
  console.log(`   Bucket: ${config.bucket}`);
  console.log(`   Key: ${key}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

