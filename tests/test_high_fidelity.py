"""Tests for high-fidelity toggle: dispatcher routing and operations schema."""
import importlib
import json
import sys
import types
import unittest
from pathlib import Path


def _setup_sys_path():
    repo_root = Path(__file__).resolve().parents[1]
    layer_path = repo_root / "layers" / "superdoc_utils"
    for p in (str(repo_root), str(layer_path)):
        if p not in sys.path:
            sys.path.insert(0, p)


def _install_stubs():
    _setup_sys_path()
    for mod in ("dynamo", "s3", "logger", "limits"):
        sys.modules.pop(mod, None)
    sys.modules["dynamo"] = types.SimpleNamespace(
        update_job=lambda *a, **kw: None,
        mark_done=lambda *a, **kw: None,
        mark_failed=lambda *a, **kw: None,
    )
    sys.modules["s3"] = types.SimpleNamespace(
        get_bytes=lambda key: b"",
        put_bytes=lambda key, data: None,
        make_output_key=lambda job_id, file_key, filename: f"outputs/{job_id}/{filename}",
    )
    sys.modules["logger"] = types.SimpleNamespace(
        get_logger=lambda name: types.SimpleNamespace(
            info=lambda *a, **kw: None,
            error=lambda *a, **kw: None,
            exception=lambda *a, **kw: None,
        )
    )
    sys.modules["limits"] = types.SimpleNamespace(
        assert_pdf_page_limit=lambda *a, **kw: None,
    )


def _import_operations():
    _setup_sys_path()
    sys.modules.pop("operations", None)
    sys.modules.pop("operation_constants", None)
    sys.modules.pop("operation_validation", None)
    return importlib.import_module("operations")


def _import_operation_validation():
    _setup_sys_path()
    sys.modules.pop("operation_validation", None)
    sys.modules.pop("operation_constants", None)
    return importlib.import_module("operation_validation")



class OperationsSchemaTests(unittest.TestCase):
    def setUp(self):
        self.ops = _import_operations()

    def test_high_fidelity_in_schema_for_docx_to_pdf(self):
        schema = self.ops.OPERATIONS["docx_to_pdf"]["params_schema"]
        self.assertIn("high_fidelity", schema)
        self.assertEqual(schema["high_fidelity"]["default"], True)
        self.assertEqual(schema["high_fidelity"]["type"], "boolean")

    def test_high_fidelity_in_schema_for_xlsx_to_pdf(self):
        schema = self.ops.OPERATIONS["xlsx_to_pdf"]["params_schema"]
        self.assertIn("high_fidelity", schema)

    def test_high_fidelity_in_schema_for_pdf_to_docx(self):
        schema = self.ops.OPERATIONS["pdf_to_docx"]["params_schema"]
        self.assertIn("high_fidelity", schema)

    def test_page_range_in_schema_for_pdf_to_docx(self):
        schema = self.ops.OPERATIONS["pdf_to_docx"]["params_schema"]
        self.assertIn("page_range", schema)
        self.assertEqual(schema["page_range"]["type"], "string")
        self.assertFalse(schema["page_range"]["required"])

    def test_high_fidelity_not_in_schema_for_pdf_to_image(self):
        schema = self.ops.OPERATIONS["pdf_to_image"]["params_schema"]
        self.assertNotIn("high_fidelity", schema)

    def test_has_fast_variant_contains_correct_ops(self):
        self.assertEqual(
            self.ops.HAS_FAST_VARIANT,
            frozenset({"docx_to_pdf", "xlsx_to_pdf", "pdf_to_docx"}),
        )

    def test_list_operations_exposes_high_fidelity_in_params_schema(self):
        result = {item["operation"]: item for item in self.ops.list_operations("docx")}
        self.assertIn("high_fidelity", result["docx_to_pdf"]["params_schema"])


class ParamsValidationTests(unittest.TestCase):
    def setUp(self):
        self.validation = _import_operation_validation()

    def test_accepts_boolean_high_fidelity_false(self):
        result = self.validation.validate_params("docx_to_pdf", {"high_fidelity": False})
        self.assertTrue(result.ok)
        self.assertEqual(result.params, {"high_fidelity": False})

    def test_accepts_string_high_fidelity_false(self):
        result = self.validation.validate_params("pdf_to_docx", {"high_fidelity": "false"})
        self.assertTrue(result.ok)
        self.assertEqual(result.params, {"high_fidelity": False})

    def test_rejects_invalid_high_fidelity_value(self):
        result = self.validation.validate_params("xlsx_to_pdf", {"high_fidelity": "maybe"})
        self.assertFalse(result.ok)
        self.assertIn("high_fidelity must be a boolean", result.error)

    def test_accepts_valid_page_range(self):
        result = self.validation.validate_params("pdf_to_docx", {"page_range": "1-5,8,10-12"})
        self.assertTrue(result.ok)
        self.assertEqual(result.params.get("page_range"), "1-5,8,10-12")

    def test_page_range_not_included_when_empty(self):
        result = self.validation.validate_params("pdf_to_docx", {"page_range": ""})
        self.assertTrue(result.ok)
        self.assertNotIn("page_range", result.params)

    def test_rejects_page_range_exceeding_max_length(self):
        result = self.validation.validate_params("pdf_to_docx", {"page_range": "1" * 201})
        self.assertFalse(result.ok)
        self.assertIn("page_range is too long", result.error)


def _make_dispatch_module(invocations: list) -> types.ModuleType:
    """Import dispatch_job with a stubbed boto3 lambda client."""
    _setup_sys_path()
    handlers_path = Path(__file__).resolve().parents[1] / "handlers"
    if str(handlers_path) not in sys.path:
        sys.path.insert(0, str(handlers_path))

    class _MockLambdaClient:
        def invoke(self, **kwargs):
            invocations.append(kwargs)
            return {}

    boto3_stub = types.ModuleType("boto3")
    boto3_stub.client = lambda service: _MockLambdaClient()

    to_clear = ("boto3", "dispatch_job", "operations", "operation_constants", "operation_validation")
    saved = {k: sys.modules.get(k) for k in to_clear}

    sys.modules["boto3"] = boto3_stub
    sys.modules.pop("dispatch_job", None)
    sys.modules.pop("operations", None)
    sys.modules.pop("operation_constants", None)
    sys.modules.pop("operation_validation", None)

    try:
        mod = importlib.import_module("dispatch_job")
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

    return mod


class DispatcherRoutingTests(unittest.TestCase):
    def setUp(self):
        _install_stubs()
        self.invocations: list[dict] = []
        self.dispatch = _make_dispatch_module(self.invocations)

    def _make_event(self, operation: str, params: dict | None = None) -> dict:
        body = {"operation": operation, "job_id": "test-job", "file_key": "uploads/test.docx"}
        if params is not None:
            body["params"] = params
        return {"Records": [{"body": json.dumps(body)}]}

    def test_routes_to_fast_when_high_fidelity_false(self):
        event = self._make_event("docx_to_pdf", {"high_fidelity": False})
        self.dispatch.handler(event, None)
        self.assertEqual(len(self.invocations), 1)
        self.assertIn("-docx-to-pdf-fast", self.invocations[0]["FunctionName"])

    def test_keeps_container_when_high_fidelity_true(self):
        event = self._make_event("docx_to_pdf", {"high_fidelity": True})
        self.dispatch.handler(event, None)
        self.assertEqual(len(self.invocations), 1)
        fn = self.invocations[0]["FunctionName"]
        self.assertIn("-docx-to-pdf", fn)
        self.assertNotIn("-fast", fn)

    def test_keeps_container_when_param_absent(self):
        event = self._make_event("docx_to_pdf")
        self.dispatch.handler(event, None)
        self.assertEqual(len(self.invocations), 1)
        fn = self.invocations[0]["FunctionName"]
        self.assertNotIn("-fast", fn)

    def test_routes_xlsx_to_pdf_fast(self):
        event = self._make_event("xlsx_to_pdf", {"high_fidelity": False})
        self.dispatch.handler(event, None)
        self.assertIn("-xlsx-to-pdf-fast", self.invocations[0]["FunctionName"])

    def test_routes_pdf_to_docx_fast(self):
        event = self._make_event("pdf_to_docx", {"high_fidelity": False})
        self.dispatch.handler(event, None)
        self.assertIn("-pdf-to-docx-fast", self.invocations[0]["FunctionName"])

    def test_non_fast_variant_unaffected(self):
        # pdf_to_image is not in HAS_FAST_VARIANT — high_fidelity=False has no effect
        event = self._make_event("pdf_to_image", {"high_fidelity": False, "dpi": 150, "target_format": "png"})
        self.dispatch.handler(event, None)
        fn = self.invocations[0]["FunctionName"]
        self.assertNotIn("-fast", fn)
        self.assertIn("pdf-to-image", fn)


if __name__ == "__main__":
    unittest.main()
