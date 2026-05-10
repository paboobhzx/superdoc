#!/usr/bin/env bash
# Downloads a static FFmpeg binary (Amazon Linux 2023 / x86_64) and uploads
# it to the Lambda zips S3 bucket under layers/ffmpeg/ffmpeg.
# The video_process Lambda reads FFMPEG_LAYER_S3_KEY = "layers/ffmpeg/ffmpeg"
# and downloads the binary to /tmp/ffmpeg on cold start.
set -euo pipefail

BUCKET="${LAMBDA_ZIPS_BUCKET:-superdoc-lambda-zips-288854271409}"
S3_KEY="layers/ffmpeg/ffmpeg"
FFMPEG_URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz"
TMP_DIR="$(mktemp -d)"

echo "Downloading FFmpeg static build for x86_64..."
curl -L --progress-bar -o "${TMP_DIR}/ffmpeg.tar.xz" "${FFMPEG_URL}"

echo "Extracting..."
tar -xJf "${TMP_DIR}/ffmpeg.tar.xz" -C "${TMP_DIR}"

# The tarball extracts to a versioned directory; find the ffmpeg binary
FFMPEG_BIN="$(find "${TMP_DIR}" -name ffmpeg -type f | head -1)"
if [[ -z "${FFMPEG_BIN}" ]]; then
  echo "ERROR: ffmpeg binary not found after extraction"
  exit 1
fi

chmod +x "${FFMPEG_BIN}"
echo "FFmpeg version: $(${FFMPEG_BIN} -version 2>&1 | head -1)"

echo "Uploading to s3://${BUCKET}/${S3_KEY} ..."
aws s3 cp "${FFMPEG_BIN}" "s3://${BUCKET}/${S3_KEY}"

echo "Cleaning up..."
rm -rf "${TMP_DIR}"

echo "Done. FFmpeg uploaded to s3://${BUCKET}/${S3_KEY}"
