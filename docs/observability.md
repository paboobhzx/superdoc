# SuperDoc Observability Guide

All handlers emit structured JSON logs via `log_event()` from `layers/superdoc_utils/logger.py`.

## Standard fields (always present)

| Field | Description |
|-------|-------------|
| `level` | INFO, WARNING, ERROR |
| `event` | Machine-readable event name (see vocabulary below) |
| `environment` | prod / dev |
| `logger` | Python module name |

When a `job` dict is passed, these are also injected:

| Field | Description |
|-------|-------------|
| `job_id` | Job UUID |
| `operation` | e.g. `pdf_to_xls`, `pdf_to_docx` |
| `file_size_bytes` | Input file size |
| `file_name_hash` | SHA-256 first 12 chars (PII-safe) |
| `session_id_hash` | SHA-256 first 12 chars |
| `user_id_hash` | SHA-256 first 12 chars |

## Event vocabulary

### Job lifecycle
- `job_started` — handler invoked, SQS message parsed
- `job_completed` — output written to S3, job marked DONE
- `job_failed` — unrecoverable error, job marked FAILED

### Analysis
- `analysis_completed` — pdf_analyze finished successfully
- `analysis_failed` — pdf_analyze threw an exception

### OCR pipeline
- `ocr_started` — OCR triggered for a page (includes `trigger`: upstream / inline_detection)
- `ocr_extract_start` — about to call Tesseract/Textract (includes `tesseract_available`, `tesseract_path`, `tesseract_lang`)
- `ocr_tesseract_tsv_parsed` — Tesseract TSV parsed (includes `tsv_rows_total`, `tsv_rows_above_confidence`)
- `ocr_tesseract_success` — Tesseract returned usable words
- `ocr_fallback_to_textract` — falling through to Textract (includes `tesseract_result`: none / empty_after_filter)
- `ocr_textract_parsed` — Textract response parsed (includes `blocks_total`, `words_returned`)
- `ocr_succeeded` — OCR produced usable rows/paragraphs
- `ocr_no_words` — OCR completed but returned zero usable words
- `ocr_failed` — OCR threw an exception
- `ocr_page_exception` — per-page catch-all fired

### Dispatch (process_job)
- `dispatch_analysis_resolved` — analysis_result source determined (body / dynamo_backfill / none)

### Inline detection
- `inline_scan_detection` — pymupdf detected scanned pages when upstream indices were empty

## CloudWatch Insights queries

### Last 50 jobs across all handlers
```
fields @timestamp, event, job_id, operation, level
| filter event in ["job_started", "job_completed", "job_failed"]
| sort @timestamp desc
| limit 50
```

### All OCR failures in the last 24h
```
fields @timestamp, event, job_id, page_index, tesseract_available, tsv_rows_total, error
| filter event in ["ocr_no_words", "ocr_failed", "ocr_page_exception"]
| sort @timestamp desc
| limit 50
```

### OCR Tesseract vs Textract usage
```
fields @timestamp, event, job_id, page_index, source, word_count
| filter event in ["ocr_tesseract_success", "ocr_fallback_to_textract"]
| stats count() by event
```

### Jobs where analysis_result was missing from SQS payload
```
fields @timestamp, job_id, operation, analysis_source, needs_ocr
| filter event = "dispatch_analysis_resolved" and analysis_source != "body"
| sort @timestamp desc
| limit 20
```

### Jobs that hit OCR daily limit
```
fields @timestamp, job_id, @message
| filter @message like "OCR daily limit"
| sort @timestamp desc
| limit 20
```

### Average duration per operation (last 7 days)
```
fields @timestamp, job_id, operation
| filter event = "job_completed"
| stats count() as jobs by operation
```

### Inline detection triggers (analysis_result was empty, handler self-detected)
```
fields @timestamp, job_id, detected_ocr_indices
| filter event = "inline_scan_detection"
| sort @timestamp desc
| limit 20
```

### Password-protected PDFs
```
fields @timestamp, job_id, is_encrypted, needs_password
| filter event = "analysis_completed" and is_encrypted = 1
| sort @timestamp desc
| limit 20
```

### Digitally-signed PDFs
```
fields @timestamp, job_id, has_signatures, signature_count
| filter event = "analysis_completed" and has_signatures = 1
| sort @timestamp desc
| limit 20
```
