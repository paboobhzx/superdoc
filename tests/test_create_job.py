import importlib
import io
import json
import sys
import types
import unittest
import zipfile
from decimal import Decimal
from pathlib import Path


class _FakeTable:
    def __init__(self):
        self.items = {}

    def put_item(self, Item):
        self.items[Item["job_id"]] = dict(Item)


def _load_dynamo_with_fake_table():
    layer_path = Path(__file__).resolve().parents[1] / "layers" / "superdoc_utils"
    if str(layer_path) not in sys.path:
        sys.path.insert(0, str(layer_path))

    fake_table = _FakeTable()
    fake_resource = types.SimpleNamespace(Table=lambda name: fake_table)
    boto3_stub = types.ModuleType("boto3")
    boto3_stub.resource = lambda service: fake_resource
    boto3_stub.client = lambda service: types.SimpleNamespace()

    dynamo_conditions = types.ModuleType("boto3.dynamodb.conditions")

    class _Key:
        def __init__(self, name):
            self.name = name

        def eq(self, value):
            return (self.name, value)

    dynamo_conditions.Key = _Key

    dynamo_pkg = types.ModuleType("boto3.dynamodb")
    dynamo_pkg.conditions = dynamo_conditions
    boto3_stub.dynamodb = dynamo_pkg

    original_modules = {
        name: sys.modules.get(name)
        for name in ("boto3", "boto3.dynamodb", "boto3.dynamodb.conditions", "dynamo")
    }
    sys.modules["boto3"] = boto3_stub
    sys.modules["boto3.dynamodb"] = dynamo_pkg
    sys.modules["boto3.dynamodb.conditions"] = dynamo_conditions
    sys.modules.pop("dynamo", None)
    mod = importlib.import_module("dynamo")
    for name, module in original_modules.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
    return mod, fake_table


def _load_create_job_handler(dynamo_stub, *, validate_params=None):
    repo_root = Path(__file__).resolve().parents[1]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))

    response_stub = types.ModuleType("response")
    response_stub.preflight = lambda: {"statusCode": 200}
    response_stub.ok = lambda body: {"statusCode": 200, "body": body}
    response_stub.error = lambda message, status=400: {"statusCode": status, "body": {"error": message}}

    logger_stub = types.ModuleType("logger")
    logger_stub.get_logger = lambda name: types.SimpleNamespace(exception=lambda *args, **kwargs: None, info=lambda *args, **kwargs: None)

    auth_session_stub = types.ModuleType("auth_session")
    auth_session_stub.current_user_id = lambda event: ""

    circuit_breaker_stub = types.ModuleType("circuit_breaker")
    circuit_breaker_stub.is_open = lambda operation: False

    feature_flags_stub = types.ModuleType("feature_flags")
    feature_flags_stub.get = lambda name, default=None: default

    limits_stub = types.ModuleType("limits")
    limits_stub.storage_ttl_for_user = lambda user_id: 43200
    limits_stub.storage_ttl_for_retention = lambda is_registered, retention_choice: 900 if retention_choice != "extended" else (64800 if is_registered else 43200)

    operations_stub = types.ModuleType("operations")
    operations_stub.OPERATIONS = {"pdf_annotate": {"label": "Add PDF watermark"}}
    operations_stub.is_supported = lambda operation: True
    operations_stub.validate_params = validate_params or (lambda operation, params: types.SimpleNamespace(ok=True, error="", params=dict(params)))

    rate_limit_stub = types.ModuleType("rate_limit")
    rate_limit_stub.check = lambda session_id: True
    rate_limit_stub.check_user = lambda user_id: True

    s3_stub = types.ModuleType("s3")
    s3_stub.presign_post_upload = lambda file_key, max_bytes, expiry: {"url": "https://example.com/upload", "fields": {}, "expiry": expiry}

    original_modules = {
        name: sys.modules.get(name)
        for name in (
            "auth_session",
            "circuit_breaker",
            "feature_flags",
            "limits",
            "operations",
            "rate_limit",
            "response",
            "s3",
            "logger",
            "dynamo",
            "handlers.create_job",
        )
    }
    sys.modules["auth_session"] = auth_session_stub
    sys.modules["circuit_breaker"] = circuit_breaker_stub
    sys.modules["feature_flags"] = feature_flags_stub
    sys.modules["limits"] = limits_stub
    sys.modules["operations"] = operations_stub
    sys.modules["rate_limit"] = rate_limit_stub
    sys.modules["response"] = response_stub
    sys.modules["s3"] = s3_stub
    sys.modules["logger"] = logger_stub
    sys.modules["dynamo"] = dynamo_stub
    sys.modules.pop("handlers.create_job", None)
    mod = importlib.import_module("handlers.create_job")
    for name, module in original_modules.items():
        if module is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = module
    return mod


class CreateJobTests(unittest.TestCase):
    def test_handler_omits_user_id_for_anonymous_jobs(self):
        captured = {}

        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []

        def create_job(**kwargs):
            captured.update(kwargs)
            return kwargs

        dynamo_stub.create_job = create_job

        mod = _load_create_job_handler(dynamo_stub)
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": '{"operation":"pdf_to_txt","file_name":"sample.pdf","file_size_bytes":123,"session_id":"11111111-1111-1111-1111-111111111111","params":{}}',
            },
            None,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertIsNone(captured["user_id"])
        self.assertEqual(captured["session_id"], "11111111-1111-1111-1111-111111111111")
        self.assertEqual(captured["params"], {})

    def test_handler_persists_validated_high_fidelity_param(self):
        captured = {}

        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []
        dynamo_stub.create_job = lambda **kwargs: captured.update(kwargs)

        def validate_params(operation, params):
            self.assertEqual(operation, "docx_to_pdf")
            self.assertEqual(params, {"high_fidelity": "false"})
            return types.SimpleNamespace(ok=True, error="", params={"high_fidelity": False})

        mod = _load_create_job_handler(dynamo_stub, validate_params=validate_params)
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": '{"operation":"docx_to_pdf","file_name":"sample.docx","file_size_bytes":123,"session_id":"11111111-1111-1111-1111-111111111111","params":{"high_fidelity":"false"}}',
            },
            None,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(captured["params"], {"high_fidelity": False})

    def test_dynamo_create_job_skips_user_id_when_missing(self):
        dynamo, table = _load_dynamo_with_fake_table()

        dynamo.create_job(
            job_id="job-1",
            operation="pdf_to_txt",
            session_id="sess-1",
            file_size_bytes=123,
            file_name="sample.pdf",
            file_key="uploads/job-1/sample.pdf",
        )

        self.assertNotIn("user_id", table.items["job-1"])

        dynamo.create_job(
            job_id="job-2",
            operation="pdf_to_txt",
            session_id="sess-2",
            file_size_bytes=123,
            file_name="sample.pdf",
            file_key="uploads/job-2/sample.pdf",
            user_id="sub-1",
        )

        self.assertEqual(table.items["job-2"]["user_id"], "sub-1")

    def test_dynamo_create_job_converts_float_params_to_decimal(self):
        dynamo, table = _load_dynamo_with_fake_table()

        dynamo.create_job(
            job_id="job-float",
            operation="pdf_annotate",
            session_id="sess-1",
            file_size_bytes=123,
            file_name="sample.pdf",
            file_key="uploads/job-float/sample.pdf",
            params={"opacity": 0.3, "nested": {"confidence_min": 0.6}},
        )

        item = table.items["job-float"]
        self.assertEqual(item["params"]["opacity"], Decimal("0.3"))
        self.assertEqual(item["params"]["nested"]["confidence_min"], Decimal("0.6"))

    def test_handler_uses_default_retention_and_upload_expiry(self):
        captured = {}

        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []

        def create_job(**kwargs):
            captured.update(kwargs)
            return kwargs

        dynamo_stub.create_job = create_job

        mod = _load_create_job_handler(dynamo_stub)
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": '{"operation":"pdf_to_txt","file_name":"sample.pdf","file_size_bytes":123,"session_id":"11111111-1111-1111-1111-111111111111","retention_choice":"default"}',
            },
            None,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(captured["ttl_seconds"], 900)
        self.assertEqual(captured["retention_choice"], "default")
        self.assertEqual(result["body"]["upload"]["expiry"], 900)

    def test_handler_uses_extended_retention_for_registered_jobs(self):
        captured = {}

        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []

        def create_job(**kwargs):
            captured.update(kwargs)
            return kwargs

        dynamo_stub.create_job = create_job

        mod = _load_create_job_handler(dynamo_stub)
        mod.auth_session.current_user_id = lambda event: "user-123"
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": '{"operation":"pdf_to_txt","file_name":"sample.pdf","file_size_bytes":123,"session_id":"11111111-1111-1111-1111-111111111111","retention_choice":"extended"}',
            },
            None,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(captured["ttl_seconds"], 64800)
        self.assertEqual(captured["retention_choice"], "extended")
        self.assertEqual(result["body"]["upload"]["expiry"], 64800)

    def test_handler_returns_extra_upload_for_image_watermark(self):
        captured = {}

        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []
        dynamo_stub.create_job = lambda **kwargs: captured.update(kwargs)

        def validate_params(operation, params):
            return types.SimpleNamespace(ok=True, error="", params={"watermark_type": "image", "opacity": 0.4})

        mod = _load_create_job_handler(dynamo_stub, validate_params=validate_params)
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": json.dumps({
                    "operation": "pdf_annotate",
                    "file_name": "sample.pdf",
                    "file_size_bytes": 123,
                    "session_id": "11111111-1111-1111-1111-111111111111",
                    "params": {"watermark_type": "image", "opacity": 0.4},
                    "extra_files": [{
                        "role": "watermark_image",
                        "file_name": "logo.png",
                        "file_size_bytes": 321,
                        "content_type": "image/png",
                    }],
                }),
            },
            None,
        )

        self.assertEqual(result["statusCode"], 200)
        self.assertIn("extra_uploads", result["body"])
        self.assertEqual(result["body"]["extra_uploads"][0]["role"], "watermark_image")
        self.assertTrue(captured["params"]["watermark_image_key"].endswith("/extras/watermark_image/logo.png"))
        self.assertEqual(captured["operation_label"], "Add PDF watermark")

    def test_handler_rejects_missing_image_watermark_upload(self):
        dynamo_stub = types.ModuleType("dynamo")
        dynamo_stub.query_by_session = lambda session_id: []
        dynamo_stub.create_job = lambda **kwargs: kwargs

        def validate_params(operation, params):
            return types.SimpleNamespace(ok=True, error="", params={"watermark_type": "image"})

        mod = _load_create_job_handler(dynamo_stub, validate_params=validate_params)
        result = mod.handler(
            {
                "httpMethod": "POST",
                "body": '{"operation":"pdf_annotate","file_name":"sample.pdf","file_size_bytes":123,"session_id":"11111111-1111-1111-1111-111111111111","params":{"watermark_type":"image"}}',
            },
            None,
        )

        self.assertEqual(result["statusCode"], 400)


class PdfOperationValidationTests(unittest.TestCase):
    def _validate(self, operation, params):
        layer_path = Path(__file__).resolve().parents[1] / "layers" / "superdoc_utils"
        if str(layer_path) not in sys.path:
            sys.path.insert(0, str(layer_path))
        import operation_validation
        return operation_validation.validate_params(operation, params)

    def test_pdf_annotate_params_are_preserved_and_coerced(self):
        result = self._validate(
            "pdf_annotate",
            {"watermark_type": "text", "watermark_text": "CONFIDENTIAL", "stamp_mode": "footer", "opacity": "0.45", "ignored": "x"},
        )
        self.assertTrue(result.ok)
        self.assertEqual(
            result.params,
            {"watermark_type": "text", "watermark_text": "CONFIDENTIAL", "stamp_mode": "footer", "opacity": 0.45},
        )

    def test_pdf_annotate_rejects_bad_mode_and_opacity(self):
        self.assertFalse(self._validate("pdf_annotate", {"watermark_type": "video"}).ok)
        self.assertFalse(self._validate("pdf_annotate", {"stamp_mode": "middle"}).ok)
        self.assertFalse(self._validate("pdf_annotate", {"opacity": "2"}).ok)

    def test_new_pdf_transform_params_are_preserved(self):
        self.assertEqual(self._validate("pdf_split", {"ranges": "1-2,4"}).params, {"ranges": "1-2,4"})
        self.assertEqual(self._validate("pdf_rearrange", {"page_order": "3,1,2"}).params, {"page_order": "3,1,2"})
        self.assertEqual(self._validate("pdf_svg_annotate", {"flatten": "true"}).params, {"flatten": True})

    def test_pdf_remove_watermark_params_are_preserved_and_coerced(self):
        result = self._validate(
            "pdf_remove_watermark",
            {
                "watermark_text": "DRAFT",
                "dry_run": "false",
                "confidence_min": "0.7",
                "case": "xobject",
            },
        )
        self.assertTrue(result.ok)
        self.assertEqual(
            result.params,
            {
                "watermark_text": "DRAFT",
                "dry_run": False,
                "confidence_min": 0.7,
                "case": "xobject",
            },
        )

    def test_pdf_remove_watermark_rejects_invalid_values(self):
        self.assertFalse(self._validate("pdf_remove_watermark", {"dry_run": "maybe"}).ok)
        self.assertFalse(self._validate("pdf_remove_watermark", {"confidence_min": "0.2"}).ok)
        self.assertFalse(self._validate("pdf_remove_watermark", {"confidence_min": "1.2"}).ok)
        self.assertFalse(self._validate("pdf_remove_watermark", {"case": "upper"}).ok)


def _pdf_deps_available():
    try:
        import pypdf  # noqa: F401
        import reportlab  # noqa: F401
    except Exception:
        return False
    return True


def _stub_pdf_worker_modules():
    layer_path = Path(__file__).resolve().parents[1] / "layers" / "superdoc_utils"
    if str(layer_path) not in sys.path:
        sys.path.insert(0, str(layer_path))
    for name in ("dynamo", "limits", "s3", "logger"):
        sys.modules.pop(name, None)
    sys.modules["dynamo"] = types.ModuleType("dynamo")
    sys.modules["limits"] = types.SimpleNamespace(assert_pdf_page_limit=lambda *args, **kwargs: None)
    sys.modules["s3"] = types.ModuleType("s3")
    logger = types.ModuleType("logger")
    logger.get_logger = lambda name: types.SimpleNamespace(info=lambda *a, **k: None, exception=lambda *a, **k: None)
    sys.modules["logger"] = logger


@unittest.skipUnless(_pdf_deps_available(), "PDF dependencies are not installed")
class PdfAdvancedHandlerTests(unittest.TestCase):
    def setUp(self):
        _stub_pdf_worker_modules()
        from pypdf import PdfWriter

        buf = io.BytesIO()
        writer = PdfWriter()
        for _ in range(3):
            writer.add_blank_page(width=200, height=200)
        writer.write(buf)
        self.pdf_bytes = buf.getvalue()

    def test_pdf_annotate_modes_emit_valid_pdf(self):
        mod = importlib.import_module("handlers.pdf_annotate")
        from pypdf import PdfReader

        for mode in ("watermark", "header", "footer", "corner"):
            output = mod._process(self.pdf_bytes, {"watermark_text": "DRAFT", "stamp_mode": mode, "opacity": 0.4})
            self.assertGreater(len(output), 0)
            self.assertEqual(len(PdfReader(io.BytesIO(output)).pages), 3)

    def test_pdf_annotate_image_watermark_emits_valid_pdf(self):
        mod = importlib.import_module("handlers.pdf_annotate")
        from PIL import Image
        from pypdf import PdfReader

        img = Image.new("RGB", (24, 12), color=(255, 0, 0))
        img_buf = io.BytesIO()
        img.save(img_buf, format="PNG")
        output = mod._process(
            self.pdf_bytes,
            {"watermark_type": "image", "stamp_mode": "watermark", "opacity": 0.35},
            img_buf.getvalue(),
        )
        self.assertGreater(len(output), 0)
        self.assertEqual(len(PdfReader(io.BytesIO(output)).pages), 3)

    def test_pdf_compress_returns_original_when_output_is_larger(self):
        mod = importlib.import_module("handlers.pdf_compress")
        output = mod._process(self.pdf_bytes, {})
        self.assertLessEqual(len(output), len(self.pdf_bytes))

    def test_pdf_rearrange_orders_and_deletes_pages(self):
        mod = importlib.import_module("handlers.pdf_rearrange")
        from pypdf import PdfReader

        default_output = mod._process(self.pdf_bytes, {})
        self.assertEqual(len(PdfReader(io.BytesIO(default_output)).pages), 3)

        output = mod._process(self.pdf_bytes, {"page_order": "3,1"})
        self.assertEqual(len(PdfReader(io.BytesIO(output)).pages), 2)

        with self.assertRaises(ValueError):
            mod._process(self.pdf_bytes, {"page_order": "4"})


class PdfRemoveWatermarkHandlerTests(unittest.TestCase):
    def setUp(self):
        _stub_pdf_worker_modules()
        sys.modules.pop("handlers.pdf_remove_watermark", None)
        self.mod = importlib.import_module("handlers.pdf_remove_watermark")

    def test_dry_run_writes_report_by_default_only_when_requested(self):
        self.mod.detect_watermarks = lambda data, text="", mode="auto": {
            "page_count": 1,
            "mode": mode,
            "detections": 1,
            "confidence": 0.9,
            "annotations": [{"page": 1}],
            "xobjects": [],
            "unsafe_xobjects": [],
        }

        output, name = self.mod._process(b"%PDF", {"dry_run": True, "case": "annot"})

        self.assertEqual(name, "watermark-report.json")
        report = json.loads(output.decode("utf-8"))
        self.assertTrue(report["dry_run"])
        self.assertEqual(report["mode"], "annot")

    def test_no_detection_uses_stable_failure_reason(self):
        self.mod.detect_watermarks = lambda *args, **kwargs: {
            "detections": 0,
            "confidence": 0.0,
            "annotations": [],
            "xobjects": [],
            "unsafe_xobjects": [],
        }

        with self.assertRaisesRegex(ValueError, "no_watermark_detected"):
            self.mod._process(b"%PDF", {})

    def test_unsafe_xobject_uses_stable_failure_reason(self):
        self.mod.detect_watermarks = lambda *args, **kwargs: {
            "detections": 1,
            "confidence": 0.9,
            "annotations": [],
            "xobjects": [],
            "unsafe_xobjects": [{"xref": 7, "reason": "xobject_not_isolated"}],
        }

        with self.assertRaisesRegex(ValueError, "unsafe_xobject_removal"):
            self.mod._process(b"%PDF", {"case": "xobject"})

    def test_annotation_removal_path_returns_pdf(self):
        self.mod.detect_watermarks = lambda *args, **kwargs: {
            "detections": 1,
            "confidence": 0.9,
            "annotations": [{"page": 1}],
            "xobjects": [],
            "unsafe_xobjects": [],
        }
        self.mod.remove_detected_watermarks = lambda *args, **kwargs: (b"%PDF-clean", {"removed_annotations": 1})

        output, name = self.mod._process(b"%PDF", {"case": "annot"})

        self.assertEqual(output, b"%PDF-clean")
        self.assertEqual(name, "watermark-removed.pdf")


class PdfSvgAnnotateContractTests(unittest.TestCase):
    def setUp(self):
        _stub_pdf_worker_modules()
        sys.modules.pop("handlers.pdf_svg_annotate", None)
        self.mod = importlib.import_module("handlers.pdf_svg_annotate")

    def test_svg_data_attribute_contract_is_recognized(self):
        from xml.etree import ElementTree

        element = ElementTree.fromstring(
            '<rect data-annot-type="Square" data-page="2" data-author="Ada" data-color="#ffcc00" />'
        )

        self.assertEqual(self.mod._annotation_type(element), "square")
        self.assertEqual(self.mod._svg_attr(element, "page"), "2")
        self.assertEqual(self.mod._svg_attr(element, "author"), "Ada")
        self.assertEqual(self.mod._svg_attr(element, "color"), "#ffcc00")

    def test_viewbox_parser_accepts_valid_svg_viewbox(self):
        from xml.etree import ElementTree

        root = ElementTree.fromstring('<svg viewBox="0 0 1000 500"></svg>')

        self.assertEqual(self.mod._viewbox(root), (0.0, 0.0, 1000.0, 500.0))

    def test_zip_validation_names_missing_document(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("annotations.svg", "<svg />")

        with self.assertRaisesRegex(ValueError, "document.pdf"):
            self.mod._process(buf.getvalue(), {})

    def test_zip_validation_names_missing_svg(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("document.pdf", b"%PDF")

        with self.assertRaisesRegex(ValueError, "annotations.svg"):
            self.mod._process(buf.getvalue(), {})


if __name__ == "__main__":
    unittest.main()
