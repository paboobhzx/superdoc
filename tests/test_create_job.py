import importlib
import sys
import types
import unittest
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

    operations_stub = types.ModuleType("operations")
    operations_stub.is_supported = lambda operation: True
    operations_stub.validate_params = validate_params or (lambda operation, params: types.SimpleNamespace(ok=True, error="", params=dict(params)))

    rate_limit_stub = types.ModuleType("rate_limit")
    rate_limit_stub.check = lambda session_id: True
    rate_limit_stub.check_user = lambda user_id: True

    s3_stub = types.ModuleType("s3")
    s3_stub.presign_post_upload = lambda file_key, max_bytes: {"url": "https://example.com/upload", "fields": {}}

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


if __name__ == "__main__":
    unittest.main()
