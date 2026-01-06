#!/bin/bash
# Creates a test scene video for development
# Uploads to MinIO (S3-compatible storage)

set -e

# Config
S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
S3_BUCKET="${S3_BUCKET:-dubdub}"
S3_ACCESS_KEY="${S3_ACCESS_KEY:-minioadmin}"
S3_SECRET_KEY="${S3_SECRET_KEY:-minioadmin123}"

SCENE_KEY="scenes/scene1.mp4"
TMP_FILE="/tmp/scene1.mp4"

echo "Creating test scene video..."

# Generate 16-second test video with visual cues
ffmpeg -y \
  -f lavfi -i "color=c=0x1a1a24:s=720x480:d=16,format=yuv420p" \
  -f lavfi -i "anullsrc=r=44100:cl=stereo" \
  -filter_complex "
    [0:v]
    drawtext=text='DubDub Test Scene':fontsize=36:fontcolor=white:x=(w-tw)/2:y=40,
    drawtext=text='Реплика 1':fontsize=28:fontcolor=0xff4d6d:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,0.8,5.3)',
    drawtext=text='(0.8s - 5.3s)':fontsize=18:fontcolor=0xff4d6d:x=(w-tw)/2:y=(h-th)/2+20:enable='between(t,0.8,5.3)',
    drawtext=text='Реплика 2':fontsize=28:fontcolor=0x845ef7:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,5.6,10.1)',
    drawtext=text='(5.6s - 10.1s)':fontsize=18:fontcolor=0x845ef7:x=(w-tw)/2:y=(h-th)/2+20:enable='between(t,5.6,10.1)',
    drawtext=text='Реплика 3':fontsize=28:fontcolor=0x22c55e:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,10.4,14.9)',
    drawtext=text='(10.4s - 14.9s)':fontsize=18:fontcolor=0x22c55e:x=(w-tw)/2:y=(h-th)/2+20:enable='between(t,10.4,14.9)',
    drawtext=text='%{pts\\:hms}':fontsize=20:fontcolor=white@0.7:x=w-100:y=h-35
    [v]
  " \
  -map "[v]" \
  -map "1:a" \
  -c:v libx264 \
  -preset fast \
  -crf 23 \
  -c:a aac \
  -b:a 128k \
  -t 16 \
  -shortest \
  "$TMP_FILE"

echo "Uploading to S3..."

# Configure mc (MinIO client) and upload
if command -v mc &> /dev/null; then
  mc alias set myminio "$S3_ENDPOINT" "$S3_ACCESS_KEY" "$S3_SECRET_KEY" 2>/dev/null || true
  mc cp "$TMP_FILE" "myminio/$S3_BUCKET/$SCENE_KEY"
  echo "✅ Uploaded to: $S3_BUCKET/$SCENE_KEY"
else
  echo "⚠️  MinIO client (mc) not found. Installing..."
  echo "Download from: https://min.io/download#/linux"
  echo "Or manually upload $TMP_FILE to $S3_BUCKET/$SCENE_KEY"
fi

rm -f "$TMP_FILE"
echo "Done!"

