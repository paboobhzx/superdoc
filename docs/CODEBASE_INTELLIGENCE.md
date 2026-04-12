# Codebase Intelligence

> Generated from scanning 8 reference repositories in `Aux/`.
> Last updated: 2026-04-12

---

## Kuiper (ai-chat-doc-processing) — Reusable Patterns

### Libraries Identified

- **boto3** — S3, DynamoDB, Textract, Bedrock (agent + runtime), Step Functions
- **uuid** — document ID generation (UUID v4)
- **base64** — binary encoding for API Gateway file uploads
- **json** — event parsing, response serialization
- **datetime** — ISO8601 timestamps
- **urllib.parse** — S3 key URL decoding
- **traceback** — error logging context
- No third-party Python packages beyond boto3 (all stdlib + AWS SDK)

### DynamoDB Schema

- **Table:** `kuiper-ingestion-locks`
- **Partition Key:** `documentId` (String)
- **TTL:** enabled (attribute: `ttl`)
- **Billing:** PAY_PER_REQUEST (on-demand)
- **Purpose:** lock-and-check before ingestion to prevent duplicate KB syncs
- **Access patterns:** PutItem (lock during ingestion), TTL auto-cleanup

### S3 Patterns

| Prefix | Content | Written By |
|---|---|---|
| `uploads/{documentId}/{filename}` | Raw uploaded file | upload_handler.py |
| `textract/{documentId}.json` | Full Textract JSON response | textract_adapter.py |
| `text/{documentId}.txt` | Extracted plain text (LINE blocks) | extract_text.py |
| `chunks/{documentId}-chunk-{N:03d}.txt` | 1000-char text chunks | chunking.py |

**Metadata on upload:** `document-id`, `language`, `original-filename`, `ingested-at` (ISO8601)

**Buckets:** raw-documents (uploads), processed-documents (textract/text/chunks), kuiper-serverless-chatbot-documents (KB target), frontend (React SPA via CloudFront OAC)

**No lifecycle rules** — files persist indefinitely (a problem).

### Bedrock / Knowledge Base Integration

- **KB ID:** `RTLIZMK4AJ` (hardcoded in handler.py, lambda.tf, sybc_kb.tf)
- **Data Source ID:** `BZ7ZUTXLOW` (hardcoded in sybc_kb.tf, kb_sync.py)
- **Embedding model:** `amazon.titan-embed-text-v1` / `v2:0`
- **Chat model:** `amazon.nova-pro-v1:0`
- **Retrieve config:** `numberOfResults: 5`, vector search, no session filtering
- **Chat config:** temperature 0.1, max_tokens 1000, top_p 0.9
- **System prompt:** instructs model to use provided context only (RAG pattern)

**Integration flow:**
```
extract_text.py → text/{id}.txt
    ↓ S3 notification
kb_sync.py → copies to KB bucket → start_ingestion_job()
    ↓ async
Bedrock KB creates embeddings (Titan)
    ↓
handler.py → retrieve() → Nova Pro generates answer
```

### The Stale Memory Flaw

**Root cause:** All documents from all users/sessions go into the same KB bucket (`kuiper-serverless-chatbot-documents/text/`) with no session isolation. `kb_sync.py` copies objects but never deletes them. No `session_id` concept exists anywhere in the architecture.

**Symptom:** User uploads Document A, chats about it. Later uploads Document B. Queries about Document B return contaminated results from Document A because both remain in the KB's vector index.

**Why deletion alone won't fix it:** Bedrock KB vectors are NOT automatically removed when source files are deleted from S3. The vector index maintains its own copy. Deleting the source file ≠ deleting the embeddings.

**Accumulation path:**
```
Upload 1 → text/doc1.txt → KB bucket → Embedded ✓
Upload 2 → text/doc2.txt → KB bucket → Embedded ✓
Upload 3 → text/doc3.txt → KB bucket → Embedded ✓
Delete Upload 1 locally? Still in KB vectors!
New session? All 3 documents still retrieved!
```

### Proposed Fix (per-session prefix + EventBridge cleanup)

1. Assign `session_id` (UUID) per browser session, stored in localStorage
2. S3 key becomes: `uploads/{session_id}/{filename}`
3. Bedrock KB data source scoped to session prefix
4. **Cleanup Lambda** (`kb_cleanup`):
   - Trigger: EventBridge rule, every 15 minutes
   - Scan DynamoDB for jobs where `expires_at < now()` AND operation contains `"ai"`
   - For each expired session:
     - Delete all S3 objects under `uploads/{session_id}/`
     - Delete all S3 objects under `outputs/{session_id}/`
     - Call `StartIngestionJob` to re-sync KB (purges deleted docs from vectors)
     - Delete DynamoDB job record

### Bugs Found

| File | Bug | Impact |
|---|---|---|
| `ingestion_handler.py:11` | Variable `KB_ID` referenced but line 6 defines `KD_ID` (typo) | Lambda will crash on every invocation |
| `chunking.py:21` | `"Blocktype"` should be `"BlockType"` (case mismatch) | Silently returns empty chunks — no text extracted |

### Hardcoded Values to Externalize

- KB ID (`RTLIZMK4AJ`) → SSM Parameter or Terraform variable
- Data Source ID (`BZ7ZUTXLOW`) → SSM Parameter or Terraform variable
- Target bucket name (`kuiper-serverless-chatbot-documents`) → Environment variable
- Model ID (`amazon.nova-pro-v1:0`) → Environment variable
- Retrieve numberOfResults (`5`) → Environment variable

---

## Oort Cloud (video-editor) — Reusable Patterns

### FFmpeg Operations Found

| Operation | FFmpeg Command Pattern | Notes |
|---|---|---|
| Resize | `-vf scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2` | Preserves aspect ratio with letterboxing |
| Trim | `-ss {start} -t {duration}` | Re-encodes (not `-c copy`) |
| Speed | `-filter:v setpts={N}*PTS -filter:a atempo={N}` | Chains atempo for >2x (awk calculation) |
| Framerate | `-vf fps={value}` | Simple filter |
| Thumbnail | `-ss {time} -frames:v 1 -q:v 2` | Single JPEG frame, quality 2 |
| Audio extract | `-vn -acodec libmp3lame -b:a {bitrate}` | Default 192k |

**Standard output codec:** `-c:v libx264 -preset medium -crf 23 -c:a aac -b:a 128k`

**Common flags:** `-y` (always overwrite)

### Lambda Layer Approach

No Lambda layers used. FFmpeg runs on EC2 Spot instances via static binary download.

**SuperDoc adaptation:** Move FFmpeg to Lambda layer with static binary compiled for Amazon Linux 2023. Reserve EC2/ECS as dormant fallback (`enabled = false`) for files exceeding Lambda's 15-min timeout or 10GB `/tmp`.

### Video Processing Logic

**Architecture:** S3 → presigned URL upload (10min PUT) → SQS job submission → EC2 worker polls (20s long poll) → FFmpeg processes → S3 upload → presigned URL download (1h GET)

**SQS config:**
- Visibility timeout: 30 minutes (max processing time)
- Message retention: 1 day
- DLQ: 14-day retention, max 3 receive attempts
- CloudWatch alarm on DLQ depth

**Auto-scaling:** CloudWatch alarms on SQS `ApproximateNumberOfMessagesVisible` — scale up if > 0, scale down if = 0.

**S3 lifecycle:** raw videos 3 days, processed videos 1 day.

### Subtitle / Transcript Logic

**Not implemented.** No Whisper, SRT generation, or subtitle burning exists in the codebase.

SuperDoc will add:
- Whisper container Lambda for transcription → SRT output
- Bedrock Haiku post-processing (punctuation, cleanup, translation)
- FFmpeg `burn_subs` operation: `-vf subtitles=subs.srt`

### What Was Unfinished and Why

- **No Docker/ECS** — pure EC2 Spot ASG with systemd worker
- **No subtitle/transcription pipeline** — only basic video operations
- **No Lambda layers** — FFmpeg binary downloaded directly to EC2
- **Frontend:** Angular 21 with Cognito PKCE OAuth — not reusable (SuperDoc uses React)
- **Empty service stubs:** `upload-api.ts` and `jobs-api.ts` are empty files
- **Single-operation worker:** processes one video at a time per EC2 instance

---

## Additional Reference Repos — Conversion Patterns

### DocumentConverter-main (C# / .NET 8)

- **Tech:** UglyToad.PdfPig (PDF text+image extraction), Aspose.Words (DOCX/ODT/RTF)
- **Operations:** PDF→Markdown, DOCX→Markdown, TXT→Markdown, HTML→Markdown
- **Pattern:** Page-by-page extraction with separate image export
- **Relevance:** Algorithm maps to pypdf + python-docx for `pdf_extract_text`

### Multi-Format-File-Converter-master (Python / Django)

- **Tech:** Pillow (PIL) for all conversions
- **Operations:** JPEG→PDF, JPEG→PNG, PNG→JPEG, PNG→PDF
- **Reusable pattern:** EXIF orientation correction (rotate based on orientation tags 3/6/8)
- **Reusable pattern:** Image→PDF with A4 scaling (2480x3508) and centering on white background
- **Bug to avoid:** `if file_ext == ".jpg" or ".JPG"` — always truthy due to Python string truthiness

### Word_To_Pdf-Converter-main (Python)

- **Tech:** `docx2pdf` library (wraps LibreOffice headless / Word COM)
- **Key insight:** Confirms DOCX→PDF requires LibreOffice. SuperDoc's `docx_to_pdf` Lambda must use a container image with LibreOffice installed.

### convert-master (TypeScript / Vite, browser-based)

- **Tech:** FFmpeg WASM, ImageMagick WASM, Pandoc WASM, Typst, Three.js
- **100+ format** support across image, video, audio, document, 3D, code, music notation
- **Useful patterns:** Error recovery (dimension padding for FFmpeg, sample rate fallback), format detection via muxer introspection, `execSafe()` auto-retry on OOM
- **Not applicable:** WASM approach — SuperDoc uses server-side Lambda

### docling-main (Python / IBM)

- **Tech:** Full document intelligence SDK with PyTorch, Hugging Face, RapidOCR
- **Formats:** PDF, DOCX, PPTX, Excel, HTML, CSV, Markdown, LaTeX, AsciiDoc, images, XML/JATS, XBRL, WebVTT, audio
- **Architecture:** Backend-per-format + pipeline pattern (SimplePipeline vs StandardPdfPipeline), ThreadPoolExecutor
- **Relevance:** Gold standard for format handler architecture. SuperDoc's handler-per-operation approach follows this principle.

### multithread_pdf_converter_backup-master (C# / .NET)

- **Tech:** Microsoft.Office.Interop.Word + PowerPoint COM automation
- **Operations:** DOC/DOCX→PDF, PPT/PPTX→PDF (multithreaded via Task.Run)
- **Key insight:** Office Interop is the most reliable path but requires Windows + Office. Not usable in Lambda — confirms LibreOffice container is the Linux alternative.

---

## Shared Utilities to Extract

Patterns appearing across multiple repos that should become part of the `superdoc_utils` Lambda layer:

| Utility | Source Repo | Target Module | Description |
|---|---|---|---|
| EXIF orientation fix | Multi-Format-File-Converter | `superdoc_utils/image.py` | Rotate images based on EXIF orientation tag |
| Image-to-PDF (A4 scaling) | Multi-Format-File-Converter | `superdoc_utils/image.py` | Scale + center on A4 white background |
| Presigned URL generation | Oort Cloud | `superdoc_utils/s3.py` | PUT (10min) and GET (1h) presigned URLs |
| S3 upload/download helpers | Kuiper + Oort Cloud | `superdoc_utils/s3.py` | put_object, get_object, copy_object wrappers |
| DynamoDB CRUD helpers | Kuiper | `superdoc_utils/dynamo.py` | create_job, get_job, update_job, scan with TTL filter |
| Structured JSON logging | New (required by CLAUDE.md) | `superdoc_utils/logger.py` | CloudWatch-compatible structured logs |
| Retry with circuit breaker | New (tenacity) | `superdoc_utils/retry.py` | Exponential backoff for boto3 ClientError |
| API Gateway response builder | New | `superdoc_utils/response.py` | Standard ok/error with CORS headers |
| Job time estimator | New | `superdoc_utils/estimator.py` | Historical DynamoDB average for operation type |

---

## Operations Map

Complete inventory of every file operation found across all repos, mapped to SuperDoc handlers.

### Document Operations

| Operation | Source Repo | SuperDoc Handler | Library | Lambda Memory |
|---|---|---|---|---|
| PDF text extraction | Kuiper (Textract) | `pdf_extract_text` | pypdf | 512MB |
| PDF merge | — | `pdf_merge` | pypdf | 512MB |
| PDF split | — | `pdf_split` | pypdf | 512MB |
| PDF compress | — | `pdf_compress` | pypdf | 512MB |
| PDF rotate | — | `pdf_rotate` | pypdf | 512MB |
| PDF annotate | — | `pdf_annotate` | reportlab | 512MB |
| PDF → DOCX | — | `pdf_to_docx` | pdf2docx | 512MB |
| DOCX → PDF | Word_To_Pdf, multithread_pdf | `docx_to_pdf` | LibreOffice (container) | 512MB |
| Text chunking (1000 char) | Kuiper | Layer utility | Built-in | — |

### Image Operations

| Operation | Source Repo | SuperDoc Handler | Library | Lambda Memory |
|---|---|---|---|---|
| Format conversion (any↔any) | Multi-Format-File-Converter | `image_convert` | Pillow | 128MB |
| Background removal | — | `image_remove_bg` | rembg (container) | 512MB |
| Upscale (bicubic 2x/4x) | — | `image_upscale` | Pillow | 128MB |
| Compress (progressive JPEG) | — | `image_compress` | Pillow | 128MB |
| Crop/rotate/flip/resize | convert-master (client-side) | Client-side (Fabric.js) | — | — |
| Brightness/contrast/filters | convert-master (client-side) | Client-side (CSS + canvas) | — | — |

### Video Operations

| Operation | Source Repo | SuperDoc Handler | FFmpeg Command | Lambda Memory |
|---|---|---|---|---|
| Trim | Oort Cloud | `video_process` | `-ss {start} -to {end} -c copy` | 1024MB |
| Extract clip | Oort Cloud (trim variant) | `video_process` | `-ss {start} -t {duration}` | 1024MB |
| Format convert | — | `video_process` | `-i input.mp4 output.{fmt}` | 1024MB |
| Extract audio | Oort Cloud | `video_process` | `-vn -acodec mp3` | 1024MB |
| Extract frame | Oort Cloud (thumbnail) | `video_process` | `-ss {time} -frames:v 1` | 1024MB |
| Burn subtitles | — (new) | `video_process` | `-vf subtitles=subs.srt` | 1024MB |
| Resize | Oort Cloud | `video_process` | `scale=W:H:force_original_aspect_ratio=decrease` | 1024MB |
| Speed change | Oort Cloud | `video_process` | `setpts={N}*PTS + atempo` | 1024MB |
| Transcribe | — (new) | `video_transcribe` | Whisper (container) | 1024MB |

### AI Operations

| Operation | Source Repo | SuperDoc Handler | Service | Lambda Memory |
|---|---|---|---|---|
| Document analysis | Kuiper | `ai/analyze-doc` | Bedrock + Textract | 512MB |
| Chat with document | Kuiper (RAG) | `ai/chat-with-doc` | Bedrock KB (session-scoped) | 512MB |
| Summarize | — | `ai/summarize` | Bedrock Haiku | 128MB |
| Translate | — | `ai/translate` | Bedrock Haiku | 128MB |
