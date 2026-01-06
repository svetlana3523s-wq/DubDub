# PowerShell: Creates a test scene video for development
# Uploads to MinIO (S3-compatible storage)

$ErrorActionPreference = "Stop"

# Config
$S3_ENDPOINT = if ($env:S3_ENDPOINT) { $env:S3_ENDPOINT } else { "http://localhost:9000" }
$S3_BUCKET = if ($env:S3_BUCKET) { $env:S3_BUCKET } else { "dubdub" }
$S3_ACCESS_KEY = if ($env:S3_ACCESS_KEY) { $env:S3_ACCESS_KEY } else { "minioadmin" }
$S3_SECRET_KEY = if ($env:S3_SECRET_KEY) { $env:S3_SECRET_KEY } else { "minioadmin123" }

$SCENE_KEY = "scenes/scene1.mp4"
$TMP_FILE = "$env:TEMP\scene1.mp4"

Write-Host "Creating test scene video..." -ForegroundColor Cyan

# Generate 16-second test video
$filter = @"
[0:v]drawtext=text='DubDub Test Scene':fontsize=36:fontcolor=white:x=(w-tw)/2:y=40,drawtext=text='Replika 1':fontsize=28:fontcolor=0xff4d6d:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,0.8,5.3)',drawtext=text='Replika 2':fontsize=28:fontcolor=0x845ef7:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,5.6,10.1)',drawtext=text='Replika 3':fontsize=28:fontcolor=0x22c55e:x=(w-tw)/2:y=(h-th)/2-20:enable='between(t,10.4,14.9)'[v]
"@

ffmpeg -y `
  -f lavfi -i "color=c=0x1a1a24:s=720x480:d=16,format=yuv420p" `
  -f lavfi -i "anullsrc=r=44100:cl=stereo" `
  -filter_complex $filter `
  -map "[v]" `
  -map "1:a" `
  -c:v libx264 `
  -preset fast `
  -crf 23 `
  -c:a aac `
  -b:a 128k `
  -t 16 `
  -shortest `
  $TMP_FILE

Write-Host "Video created at: $TMP_FILE" -ForegroundColor Green

# Try to upload via AWS CLI or mc
Write-Host "Uploading to S3..." -ForegroundColor Cyan

try {
    # Check if mc (MinIO client) is available
    $mcPath = Get-Command mc -ErrorAction SilentlyContinue
    if ($mcPath) {
        mc alias set myminio $S3_ENDPOINT $S3_ACCESS_KEY $S3_SECRET_KEY 2>$null
        mc cp $TMP_FILE "myminio/$S3_BUCKET/$SCENE_KEY"
        Write-Host "Uploaded to: $S3_BUCKET/$SCENE_KEY" -ForegroundColor Green
    } else {
        Write-Host "MinIO client (mc) not found." -ForegroundColor Yellow
        Write-Host "Download from: https://min.io/download" -ForegroundColor Yellow
        Write-Host "Or upload manually: $TMP_FILE -> $S3_BUCKET/$SCENE_KEY" -ForegroundColor Yellow
        
        # Keep the file for manual upload
        $destPath = ".\scene1.mp4"
        Copy-Item $TMP_FILE $destPath
        Write-Host "Saved locally to: $destPath" -ForegroundColor Green
    }
} catch {
    Write-Host "Upload failed: $_" -ForegroundColor Red
    Write-Host "File saved at: $TMP_FILE" -ForegroundColor Yellow
}

Write-Host "Done!" -ForegroundColor Green

