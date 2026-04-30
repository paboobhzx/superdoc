#!/usr/bin/env python3
"""Local contract smoke tests for the public Stage 1 SuperDoc flow.

The script intentionally avoids real AWS and heavy document-conversion work.
It imports the same Lambda modules prod packages, then replaces S3/Dynamo/SQS
edges with small fakes so catalog shape, API validation, queue payloads, and
worker success wiring can be checked quickly before deploy.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "handlers"))
sys.path.insert(0, str(ROOT / "layers" / "superdoc_utils"))

os.environ.setdefault("AWS_EC2_METADATA_DISABLED", "true")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "local")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "local")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("SQS_QUEUE_URL", "https://sqs.local/superdoc")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")


class FakeBotoClient:
    def __init__(self):
        self.messages: list[dict] = []

    def send_message(self, **kwargs):
        self.messages.append(kwargs)
        return {"MessageId": "local-message"}

    def get_parameter(self, **kwargs):
        raise RuntimeError("no local SSM")

    def generate_presigned_post(self, **kwargs):
        return {"url": "https://uploads.local", "fields": {"key": kwargs["Key"]}}

    def generate_presigned_url(self, *_args, **_kwargs):
        return "https://download.local/file"


class FakeTable:
    def put_item(self, **_kwargs):
        return {}

    def get_item(self, **_kwargs):
        return {}

    def update_item(self, **_kwargs):
        return {"Attributes": {"count": 1}}

    def query(self, **_kwargs):
        return {"Items": []}


class FakeBotoResource:
    def Table(self, _name):
        return FakeTable()


def _install_import_fakes() -> FakeBotoClient:
    import boto3

    sqs = FakeBotoClient()
    boto3.client = lambda *_args, **_kwargs: sqs
    boto3.resource = lambda *_args, **_kwargs: FakeBotoResource()

    if "docx" not in sys.modules:
        docx = types.ModuleType("docx")
        docx.Document = lambda *_args, **_kwargs: None
        sys.modules["docx"] = docx

    if "pypdf" not in sys.modules:
        pypdf = types.ModuleType("pypdf")
        pypdf.PdfReader = lambda *_args, **_kwargs: None
        sys.modules["pypdf"] = pypdf

    return sqs


SQS = _install_import_fakes()


def api_body(resp: dict) -> dict:
    return json.loads(resp["body"])


def sqs_event(job_id: str, operation: str, file_key: str = "uploads/job/file.bin", **extra):
    body = {
        "job_id": job_id,
        "operation": operation,
        "file_key": file_key,
        "file_name": file_key.rsplit("/", 1)[-1],
        "file_size_bytes": 10,
    }
    body.update(extra)
    return {"Records": [{"body": json.dumps(body)}]}


class FakeDynamo:
    def __init__(self):
        self.created: list[dict] = []
        self.updates: list[tuple[str, dict]] = []
        self.done: list[tuple[str, str]] = []
        self.failed: list[tuple[str, str]] = []
        self.jobs: dict[str, dict] = {}

    def create_job(self, **kwargs):
        self.created.append(kwargs)
        self.jobs[kwargs["job_id"]] = {
            "job_id": kwargs["job_id"],
            "operation": kwargs["operation"],
            "status": kwargs.get("status", "PENDING"),
            "file_key": kwargs["file_key"],
            "file_name": kwargs["file_name"],
            "file_size_bytes": kwargs["file_size_bytes"],
            "params": kwargs.get("params") or {},
        }
        return self.jobs[kwargs["job_id"]]

    def query_by_session(self, _session_id):
        return []

    def get_job(self, job_id):
        return dict(self.jobs.get(job_id, {}))

    def update_job(self, job_id, **kwargs):
        self.updates.append((job_id, kwargs))
        self.jobs.setdefault(job_id, {"job_id": job_id}).update(kwargs)

    def mark_done(self, job_id, output_key):
        self.done.append((job_id, output_key))

    def mark_failed(self, job_id, error):
        self.failed.append((job_id, error))


class FakeS3:
    def __init__(self):
        self.writes: list[tuple[str, bytes]] = []

    def presign_post_upload(self, file_key, max_bytes=0):
        return {"url": "https://uploads.local", "fields": {"key": file_key, "max": str(max_bytes)}}

    def presign_download(self, key):
        return f"https://download.local/{key}"

    def get_bytes(self, _file_key):
        return b"input"

    def make_output_key(self, job_id, _file_key, filename):
        return f"outputs/{job_id}/{filename}"

    def put_bytes(self, key, data):
        self.writes.append((key, data))


class Stage1LocalSmoke(unittest.TestCase):
    def test_public_catalog_is_stage1_only(self):
        operations = importlib.import_module("operations")
        public = operations.list_operations()
        ids = {item["operation"] for item in public}
        self.assertEqual(
            ids,
            {
                "pdf_edit",
                "doc_edit",
                "xlsx_edit",
                "image_edit",
                "pdf_to_docx",
                "pdf_to_txt",
                "pdf_to_image",
                "image_to_pdf",
                "image_convert",
                "docx_to_txt",
                "docx_to_pdf",
                "xlsx_to_csv",
                "xlsx_to_pdf",
            },
        )
        hidden = {
            "video_process",
            "pdf_merge",
            "pdf_split",
            "pdf_compress",
            "pdf_rotate",
            "pdf_annotate",
            "pdf_extract_text",
            "ppt_to_pdf",
        }
        self.assertTrue(ids.isdisjoint(hidden))
        for item in public:
            for key in ("intent", "kind", "targets", "editor_route", "requires_multiple", "params_schema"):
                self.assertIn(key, item)
            self.assertFalse(item["requires_multiple"])

    def test_create_job_validates_and_persists_clean_params(self):
        create_job = importlib.import_module("create_job")
        fake_dynamo = FakeDynamo()
        create_job.dynamo = fake_dynamo
        create_job.s3 = FakeS3()
        create_job.feature_flags.get = lambda _flag, default=True: default
        create_job.circuit_breaker.is_open = lambda _operation: False
        create_job.rate_limit.check = lambda _session_id: True
        create_job.rate_limit.check_user = lambda _user_id: True

        missing_target = create_job.handler({
            "httpMethod": "POST",
            "body": json.dumps({
                "operation": "image_convert",
                "file_size_bytes": 10,
                "file_name": "photo.png",
                "session_id": "local",
            }),
        }, None)
        self.assertEqual(missing_target["statusCode"], 400)
        self.assertIn("target_format is required", api_body(missing_target)["error"])

        ok = create_job.handler({
            "httpMethod": "POST",
            "body": json.dumps({
                "operation": "pdf_to_image",
                "file_size_bytes": 10,
                "file_name": "doc.pdf",
                "session_id": "local",
                "params": {},
            }),
        }, None)
        self.assertEqual(ok["statusCode"], 200)
        self.assertEqual(fake_dynamo.created[-1]["params"], {"dpi": 150})

    def test_process_job_flattens_params_for_workers(self):
        process_job = importlib.import_module("process_job")
        fake_dynamo = FakeDynamo()
        fake_dynamo.jobs["job-1"] = {
            "job_id": "job-1",
            "operation": "pdf_to_image",
            "status": "PENDING",
            "file_key": "uploads/job-1/doc.pdf",
            "file_name": "doc.pdf",
            "file_size_bytes": 10,
            "params": {"dpi": 200},
        }
        process_job.dynamo = fake_dynamo
        SQS.messages.clear()
        process_job._sqs = SQS

        resp = process_job.handler({"httpMethod": "POST", "pathParameters": {"jobId": "job-1"}}, None)
        self.assertEqual(resp["statusCode"], 202)
        payload = json.loads(SQS.messages[-1]["MessageBody"])
        self.assertEqual(payload["dpi"], 200)
        self.assertNotIn("params", payload)

    def test_get_status_adds_download_url_and_hides_ttl(self):
        get_status = importlib.import_module("get_status")
        fake_dynamo = FakeDynamo()
        fake_dynamo.jobs["job-1"] = {
            "job_id": "job-1",
            "status": "DONE",
            "output_key": "outputs/job-1/out.txt",
            "expires_at": 123,
        }
        get_status.dynamo = fake_dynamo
        get_status.s3 = FakeS3()
        resp = get_status.handler({"httpMethod": "GET", "pathParameters": {"jobId": "job-1"}}, None)
        self.assertEqual(resp["statusCode"], 200)
        body = api_body(resp)
        self.assertEqual(body["download_url"], "https://download.local/outputs/job-1/out.txt")
        self.assertNotIn("expires_at", body)

    def test_public_worker_contracts_mark_done(self):
        workers = [
            ("pdf_to_docx", lambda mod: setattr(mod, "_process", lambda _data, _body: b"docx"), "converted.docx", {}),
            ("pdf_to_txt", lambda mod: setattr(mod, "_extract_plain_text", lambda _data: b"text"), "output.txt", {}),
            ("pdf_to_image", lambda mod: setattr(mod, "_render_pdf_to_zip", lambda _data, dpi: f"zip-{dpi}".encode()), "pages.zip", {"dpi": 175}),
            ("image_to_pdf", lambda mod: setattr(mod, "_image_to_pdf", lambda _data: b"pdf"), "output.pdf", {}),
            ("image_convert", lambda mod: setattr(mod, "_process", lambda _data, _body: (b"webp", _body["target_format"])), "converted.webp", {"target_format": "webp"}),
            ("docx_to_txt", lambda mod: setattr(mod, "_extract_docx_text", lambda _data: b"text"), "output.txt", {}),
            ("docx_to_pdf", lambda mod: setattr(mod, "_docx_to_pdf", lambda _data: b"pdf"), "output.pdf", {}),
            ("xlsx_to_csv", lambda mod: setattr(mod, "_xlsx_to_csv", lambda _data, sheet_name: f"csv-{sheet_name}".encode()), "output.csv", {"sheet": "Sheet1"}),
            ("xlsx_to_pdf", lambda mod: setattr(mod, "_xlsx_to_pdf", lambda _data, sheet_name: f"pdf-{sheet_name}".encode()), "output.pdf", {"sheet": "Sheet1"}),
        ]

        for module_name, patch_core, expected_name, extra in workers:
            with self.subTest(module=module_name):
                mod = importlib.import_module(module_name)
                fake_dynamo = FakeDynamo()
                fake_s3 = FakeS3()
                mod.dynamo = fake_dynamo
                mod.s3 = fake_s3
                patch_core(mod)
                mod.handler(sqs_event("job-1", module_name, **extra), None)
                self.assertEqual(fake_dynamo.updates[0], ("job-1", {"status": "PROCESSING"}))
                self.assertEqual(fake_dynamo.done[-1], ("job-1", f"outputs/job-1/{expected_name}"))
                self.assertEqual(fake_dynamo.failed, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
