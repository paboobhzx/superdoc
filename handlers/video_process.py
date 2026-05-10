"""
video_process — SQS-triggered Lambda that processes video jobs.

Pipeline (sequential):
  1. Download input video from S3 to /tmp/
  2. Ensure FFmpeg binary exists in /tmp/ (download from S3 on cold start)
  3. Apply requested video operations (trim, resize, speed, format_convert, extract_frame)
  4. Upload processed video → output_keys["video"]
  5. If extract_audio:  extract .mp3 → output_keys["audio"]
  6. If transcribe:     Amazon Transcribe → output_keys["transcript_srt"] + ["transcript_txt"]
  7. If translate:      Amazon Translate  → output_keys["translation_txt"]
  8. If burn_subtitles: FFmpeg burn SRT   → output_keys["video_burned"]
  9. dynamo.mark_done_multi(job_id, output_keys)
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import boto3

import dynamo
from logger import get_logger

log = get_logger(__name__)

# ── Config ───────────────────────────────────────────────────────────────────

MEDIA_BUCKET = os.environ.get("MEDIA_BUCKET_NAME", "")
FFMPEG_S3_KEY = os.environ.get("FFMPEG_LAYER_S3_KEY", "layers/ffmpeg/ffmpeg")
FFMPEG_PATH = "/tmp/ffmpeg"

# Max seconds to wait for Transcribe job (leave 3 min buffer in 15-min Lambda)
TRANSCRIBE_POLL_TIMEOUT = 720  # 12 minutes
TRANSCRIBE_POLL_INTERVAL = 10  # seconds

_s3 = None
_transcribe = None
_translate = None


def _s3_client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def _transcribe_client():
    global _transcribe
    if _transcribe is None:
        _transcribe = boto3.client("transcribe")
    return _transcribe


def _translate_client():
    global _translate
    if _translate is None:
        _translate = boto3.client("translate")
    return _translate


# ── FFmpeg bootstrap ─────────────────────────────────────────────────────────

def _ensure_ffmpeg():
    """Download FFmpeg binary from S3 to /tmp on cold start; reuse between invocations."""
    if os.path.isfile(FFMPEG_PATH) and os.access(FFMPEG_PATH, os.X_OK):
        return
    log.info("Downloading FFmpeg binary from S3", extra={"key": FFMPEG_S3_KEY})
    _s3_client().download_file(MEDIA_BUCKET, FFMPEG_S3_KEY, FFMPEG_PATH)
    os.chmod(FFMPEG_PATH, 0o755)
    log.info("FFmpeg ready")


def _run_ffmpeg(args: list[str], timeout: int = 600) -> None:
    cmd = [FFMPEG_PATH, "-y"] + args
    log.info("Running FFmpeg", extra={"cmd": " ".join(cmd)})
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed (rc={result.returncode}): {result.stderr[-1000:]}")


# ── S3 helpers ───────────────────────────────────────────────────────────────

def _download(s3_key: str, local_path: str) -> None:
    _s3_client().download_file(MEDIA_BUCKET, s3_key, local_path)


def _upload(local_path: str, s3_key: str) -> str:
    _s3_client().upload_file(local_path, MEDIA_BUCKET, s3_key)
    return s3_key


def _upload_bytes(data: bytes, s3_key: str, content_type: str = "text/plain") -> str:
    _s3_client().put_object(Bucket=MEDIA_BUCKET, Key=s3_key, Body=data, ContentType=content_type)
    return s3_key


# ── Video operations ─────────────────────────────────────────────────────────

def _apply_video_ops(input_path: str, ops: list[dict], job_id: str) -> str:
    """Apply each operation sequentially, chaining input → output."""
    current = input_path
    ext = Path(input_path).suffix

    for i, op in enumerate(ops):
        out = f"/tmp/{job_id}_op{i}{ext}"
        op_type = op.get("type", "")

        if op_type == "trim":
            start = op.get("start", 0)
            end = op.get("end")
            ffargs = ["-ss", str(start)]
            if end is not None:
                ffargs += ["-to", str(end)]
            ffargs += ["-i", current, "-c", "copy", out]
            _run_ffmpeg(ffargs)

        elif op_type == "resize":
            w = op.get("w", 1280)
            h = op.get("h", 720)
            _run_ffmpeg([
                "-i", current,
                "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                       f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2",
                "-c:a", "copy", out,
            ])

        elif op_type == "speed":
            speed = float(op.get("speed", 1.0))
            pts = 1.0 / speed
            # atempo supports 0.5–2.0; chain for values outside that range
            atempo_filters = _build_atempo_chain(speed)
            vf = f"setpts={pts:.4f}*PTS"
            af = ",".join(atempo_filters)
            _run_ffmpeg(["-i", current, "-filter:v", vf, "-filter:a", af, out])

        elif op_type == "format_convert":
            target_ext = "." + op.get("format", "mp4").lstrip(".")
            out = f"/tmp/{job_id}_op{i}{target_ext}"
            ext = target_ext
            _run_ffmpeg(["-i", current, out])

        elif op_type == "extract_frame":
            ts = op.get("timestamp", 0)
            out = f"/tmp/{job_id}_frame{i}.jpg"
            _run_ffmpeg(["-ss", str(ts), "-i", current, "-frames:v", "1", "-q:v", "2", out])
            # frame extraction ends the pipeline; return immediately
            return out

        else:
            log.warning("Unknown video op, skipping", extra={"op": op_type})
            continue

        current = out

    return current


def _build_atempo_chain(speed: float) -> list[str]:
    """Build a chain of atempo filters for speed outside 0.5–2.0 range."""
    filters = []
    remaining = speed
    while remaining > 2.0:
        filters.append("atempo=2.0")
        remaining /= 2.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining *= 2.0
    filters.append(f"atempo={remaining:.4f}")
    return filters


# ── Audio extraction ─────────────────────────────────────────────────────────

def _extract_audio(video_path: str, job_id: str) -> str:
    out = f"/tmp/{job_id}_audio.mp3"
    _run_ffmpeg(["-i", video_path, "-vn", "-acodec", "libmp3lame", "-b:a", "192k", out])
    return out


# ── Transcription ────────────────────────────────────────────────────────────

def _transcribe_audio(audio_path: str, job_id: str, source_language: str) -> tuple[str, str]:
    """
    Run Amazon Transcribe on audio_path.
    Returns (srt_content, plain_text).
    """
    # Upload audio to a temp S3 prefix for Transcribe access
    tmp_key = f"transcribe-tmp/{job_id}/audio.mp3"
    _upload(audio_path, tmp_key)
    audio_uri = f"s3://{MEDIA_BUCKET}/{tmp_key}"

    job_name = f"superdoc-{job_id}"
    tc = _transcribe_client()

    kwargs: dict = {
        "TranscriptionJobName": job_name,
        "Media": {"MediaFileUri": audio_uri},
        "MediaFormat": "mp3",
        "Subtitles": {"Formats": ["srt"]},
        "OutputBucketName": MEDIA_BUCKET,
        "OutputKey": f"transcribe-tmp/{job_id}/",
    }
    if source_language == "auto":
        kwargs["IdentifyLanguage"] = True
    else:
        kwargs["LanguageCode"] = source_language

    tc.start_transcription_job(**kwargs)

    # Poll until done
    deadline = time.time() + TRANSCRIBE_POLL_TIMEOUT
    while time.time() < deadline:
        resp = tc.get_transcription_job(TranscriptionJobName=job_name)
        status = resp["TranscriptionJob"]["TranscriptionJobStatus"]
        if status == "COMPLETED":
            break
        if status == "FAILED":
            reason = resp["TranscriptionJob"].get("FailureReason", "unknown")
            raise RuntimeError(f"Transcribe job failed: {reason}")
        time.sleep(TRANSCRIBE_POLL_INTERVAL)
    else:
        raise RuntimeError("Transcribe job timed out")

    # Download the SRT file that Transcribe wrote to S3
    srt_key = f"transcribe-tmp/{job_id}/{job_name}.srt"
    srt_local = f"/tmp/{job_id}_transcript.srt"
    _s3_client().download_file(MEDIA_BUCKET, srt_key, srt_local)

    with open(srt_local) as f:
        srt_content = f.read()

    # Build plain text from SRT (strip timestamps and sequence numbers)
    plain_lines = []
    for line in srt_content.splitlines():
        line = line.strip()
        if not line or line.isdigit() or "-->" in line:
            continue
        plain_lines.append(line)
    plain_text = "\n".join(plain_lines)

    # Cleanup temp S3 objects
    for key in [tmp_key, srt_key, f"transcribe-tmp/{job_id}/{job_name}.json"]:
        try:
            _s3_client().delete_object(Bucket=MEDIA_BUCKET, Key=key)
        except Exception:
            pass

    return srt_content, plain_text


# ── Translation ───────────────────────────────────────────────────────────────

def _translate_text(text: str, source_language: str, target_language: str) -> str:
    src = "auto" if source_language == "auto" else source_language.split("-")[0]
    resp = _translate_client().translate_text(
        Text=text[:100_000],  # Translate limit is 100k bytes
        SourceLanguageCode=src,
        TargetLanguageCode=target_language,
    )
    return resp["TranslatedText"]


# ── Subtitle burning ──────────────────────────────────────────────────────────

def _burn_subtitles(video_path: str, srt_path: str, job_id: str) -> str:
    out = f"/tmp/{job_id}_burned.mp4"
    # FFmpeg subtitles filter requires an absolute path
    abs_srt = str(Path(srt_path).resolve())
    _run_ffmpeg(["-i", video_path, "-vf", f"subtitles={abs_srt}", "-c:a", "copy", out])
    return out


# ── Output key builder ────────────────────────────────────────────────────────

def _output_key(job_id: str, filename: str, user_id: str | None) -> str:
    prefix = f"users/{user_id}/outputs" if user_id else "outputs"
    return f"{prefix}/{job_id}/{filename}"


# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event, context):
    body = json.loads(event["Records"][0]["body"])
    job_id = body["job_id"]
    start_ts = time.time()

    try:
        job = dynamo.get_job(job_id)
        if not job:
            log.error("Job not found", extra={"job_id": job_id})
            return

        dynamo.update_job(job_id, status="PROCESSING")

        params = job.get("params") or {}
        file_key = job.get("file_key", "")
        user_id = job.get("user_id")
        video_ops = params.get("video_ops") or []
        extract_audio_flag = bool(params.get("extract_audio"))
        transcribe_flag = bool(params.get("transcribe"))
        source_language = params.get("source_language", "auto")
        translate_flag = bool(params.get("translate"))
        target_language = params.get("target_language", "en")
        burn_subtitles_flag = bool(params.get("burn_subtitles"))

        _ensure_ffmpeg()

        # Determine input extension from file key
        input_ext = Path(file_key).suffix or ".mp4"
        input_local = f"/tmp/{job_id}_input{input_ext}"

        log.info("Downloading input", extra={"job_id": job_id, "file_key": file_key})
        _download(file_key, input_local)

        output_keys: dict[str, str] = {}

        # ── 1. Apply video operations ────────────────────────────────────────
        processed_local = _apply_video_ops(input_local, video_ops, job_id)
        processed_ext = Path(processed_local).suffix or ".mp4"
        video_out_key = _output_key(job_id, f"video{processed_ext}", user_id)
        _upload(processed_local, video_out_key)
        output_keys["video"] = video_out_key
        log.info("Video uploaded", extra={"key": video_out_key})

        # ── 2. Audio extraction ──────────────────────────────────────────────
        audio_local = None
        if extract_audio_flag or transcribe_flag:
            audio_local = _extract_audio(processed_local, job_id)
            if extract_audio_flag:
                audio_out_key = _output_key(job_id, "audio.mp3", user_id)
                _upload(audio_local, audio_out_key)
                output_keys["audio"] = audio_out_key

        # ── 3. Transcription ─────────────────────────────────────────────────
        srt_content = None
        plain_text = None
        srt_local = None
        if transcribe_flag and audio_local:
            log.info("Starting transcription", extra={"job_id": job_id})
            srt_content, plain_text = _transcribe_audio(audio_local, job_id, source_language)

            srt_local = f"/tmp/{job_id}_transcript.srt"
            with open(srt_local, "w") as f:
                f.write(srt_content)

            srt_key = _output_key(job_id, "transcript.srt", user_id)
            txt_key = _output_key(job_id, "transcript.txt", user_id)
            _upload(srt_local, srt_key)
            _upload_bytes(plain_text.encode(), txt_key)
            output_keys["transcript_srt"] = srt_key
            output_keys["transcript_txt"] = txt_key

        # ── 4. Translation ───────────────────────────────────────────────────
        if translate_flag and plain_text:
            log.info("Translating transcript", extra={"target": target_language})
            translated = _translate_text(plain_text, source_language, target_language)
            trans_key = _output_key(job_id, "translation.txt", user_id)
            _upload_bytes(translated.encode(), trans_key)
            output_keys["translation_txt"] = trans_key

        # ── 5. Burn subtitles ────────────────────────────────────────────────
        if burn_subtitles_flag and srt_local and os.path.isfile(srt_local):
            log.info("Burning subtitles", extra={"job_id": job_id})
            burned_local = _burn_subtitles(processed_local, srt_local, job_id)
            burned_key = _output_key(job_id, "video_burned.mp4", user_id)
            _upload(burned_local, burned_key)
            output_keys["video_burned"] = burned_key

        dynamo.mark_done_multi(job_id, output_keys)
        log.info(
            "Video job complete",
            extra={"job_id": job_id, "outputs": list(output_keys.keys()),
                   "elapsed": int(time.time() - start_ts)},
        )

    except Exception as exc:
        log.exception("video_process error: %s", exc, extra={"job_id": job_id})
        dynamo.mark_failed(job_id, str(exc)[:500])
