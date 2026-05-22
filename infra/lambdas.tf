# ── ECR repository (image-mode LibreOffice converter only) ────────────────────

resource "aws_ecr_repository" "office_conversion" {
  # The container-image path only exists when LibreOffice is packaged as a
  # Docker image. Zip-mode handlers do not need this repository at all.
  count = var.office_converter_package_type == "Image" ? 1 : 0

  name                 = "${local.name_prefix}-office-conversion"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

# ── Lambda layers ─────────────────────────────────────────────────────────────

module "layer_utils" {
  source      = "./modules/lambda_layer"
  name_prefix = local.name_prefix
  layer_name  = "superdoc-utils"
  s3_bucket   = var.lambda_handler_s3_bucket
  s3_key      = "layers/superdoc_utils.zip"
  common_tags = local.common_tags
}

module "layer_deps" {
  source      = "./modules/lambda_layer"
  name_prefix = local.name_prefix
  layer_name  = "python-deps"
  s3_bucket   = var.lambda_handler_s3_bucket
  s3_key      = "layers/python_deps.zip"
  common_tags = local.common_tags
}

# ── Shared Lambda config ──────────────────────────────────────────────────────

locals {
  lambda_common_env = {
    RATE_LIMIT_ENABLED  = tostring(var.rate_limit_enabled)
    JOBS_TABLE          = module.dynamodb.table_name
    API_KEYS_TABLE      = module.dynamodb.api_keys_name
    INCIDENTS_TABLE     = module.dynamodb.incidents_name
    RATE_LIMITS_TABLE   = module.dynamodb.rate_limits_name
    AUTH_SESSIONS_TABLE = module.dynamodb.auth_sessions_name
    MEDIA_BUCKET        = module.s3.bucket_name
    CORS_ALLOW_ORIGIN   = "https://${var.subdomain}.${var.domain_name}"
    SQS_QUEUE_URL       = module.sqs.queue_url
    ENVIRONMENT         = var.environment
    COGNITO_CLIENT_ID   = module.cognito.client_id
    # Prod keeps logs at WARNING to cut CloudWatch noise and spend. Non-prod
    # stays verbose so staging/debug sessions do not require redeploys.
    LOG_LEVEL                              = var.environment == "prod" ? "WARNING" : "DEBUG"
    ANON_DAILY_CONVERSION_LIMIT            = "3"
    USER_DAILY_CONVERSION_LIMIT            = "10"
    ANON_PDF_PAGE_LIMIT                    = "100"
    USER_PDF_PAGE_LIMIT                    = "300"
    DEFAULT_TTL_SECONDS                    = "900"
    TTL_SECONDS                            = "43200"
    USER_TTL_SECONDS                       = "64800"
    PAYMENTS_TABLE_NAME                    = aws_dynamodb_table.payments.name
    CREDITS_LEDGER_TABLE                   = aws_dynamodb_table.credits_ledger.name
    CREDITS_BALANCES_TABLE                 = aws_dynamodb_table.credits_balances.name
    CREDITS_TIER_200                       = "2"
    CREDITS_TIER_500                       = "5"
    CREDITS_TIER_1000                      = "10"
    CREDITS_TIER_5000                      = "50"
    REGISTERED_FREE_MULTIMEDIA_DAILY_LIMIT = "1"
    USER_SETTINGS_TABLE                    = aws_dynamodb_table.user_settings.name
  }

  lambda_layer_arns = [
    module.layer_utils.layer_arn,
    module.layer_deps.layer_arn,
  ]

  # Worker Lambdas are the functions the dispatcher is allowed to invoke.
  # The IAM policy later scopes lambda:InvokeFunction to this tag instead of
  # enumerating every worker ARN one by one.
  worker_tags = merge(local.common_tags, { "superdoc:role" = "worker" })

  office_converter_images = {
    # Image mode uses an ECR-baked LibreOffice runtime. Zip mode leaves these
    # blank so Terraform does not try to configure image-only settings.
    docx_to_pdf = var.office_converter_package_type == "Image" ? "${aws_ecr_repository.office_conversion[0].repository_url}:docx_to_pdf-${var.office_converter_image_tag}" : ""
    xlsx_to_pdf = var.office_converter_package_type == "Image" ? "${aws_ecr_repository.office_conversion[0].repository_url}:xlsx_to_pdf-${var.office_converter_image_tag}" : ""
    pdf_to_docx = var.office_converter_package_type == "Image" ? "${aws_ecr_repository.office_conversion[0].repository_url}:pdf_to_docx-${var.office_converter_image_tag}" : ""
  }

  dynamodb_arns = [
    module.dynamodb.table_arn,
    "${module.dynamodb.table_arn}/index/*",
    module.dynamodb.api_keys_arn,
    "${module.dynamodb.api_keys_arn}/index/*",
    module.dynamodb.incidents_arn,
    "${module.dynamodb.incidents_arn}/index/*",
    module.dynamodb.rate_limits_arn,
    module.dynamodb.auth_sessions_arn,
    aws_dynamodb_table.payments.arn,
    aws_dynamodb_table.credits_ledger.arn,
    "${aws_dynamodb_table.credits_ledger.arn}/index/*",
    aws_dynamodb_table.credits_balances.arn,
    aws_dynamodb_table.user_settings.arn,
  ]
}

# ── Core API handlers ─────────────────────────────────────────────────────────

module "lambda_create_job" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "create-job"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 30
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/create_job.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_get_status" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "get-status"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/get_status.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_process_job" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "process-job"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 30
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/process_job.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  extra_iam_statements = [
    { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [module.sqs.queue_arn] },
  ]
}

module "lambda_auth_session" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "auth-session"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/auth_session.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  extra_iam_statements = [
    {
      Effect   = "Allow"
      Action   = ["cognito-idp:InitiateAuth", "cognito-idp:GetUser"]
      Resource = [module.cognito.user_pool_arn]
    },
  ]
}

module "lambda_presign_download" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "presign-download"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 5
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/presign_download.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# Read-only Lambda for GET /operations. Minimal memory/timeout since it
# returns a static dict.
# TODO(round-2.5): add `disable_dynamodb_access` / `disable_s3_access` flags
# to modules/lambda and set them true here.
module "lambda_list_operations" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "list-operations"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 5
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/list_operations.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# ── PDF handlers ──────────────────────────────────────────────────────────────

module "lambda_pdf_to_docx" {
  # LibreOffice-backed conversion: image mode for faithful PDF→DOCX via
  # writer_pdf_import filter; zip mode as a fallback for Zip-only deployments.
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-docx"
  handler               = var.office_converter_package_type == "Image" ? "" : "handler.handler"
  runtime               = var.office_converter_package_type == "Image" ? "" : var.lambda_runtime
  package_type          = var.office_converter_package_type
  image_uri             = local.office_converter_images.pdf_to_docx
  architectures         = var.office_converter_package_type == "Image" ? ["arm64"] : []
  memory_size           = var.office_converter_package_type == "Image" ? 2048 : 512
  timeout               = var.office_converter_package_type == "Image" ? 300 : 120
  s3_bucket             = var.office_converter_package_type == "Image" ? "" : var.lambda_handler_s3_bucket
  s3_key                = var.office_converter_package_type == "Image" ? "" : "handlers/pdf_to_docx.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = var.office_converter_package_type == "Image" ? [] : local.lambda_layer_arns
}

module "lambda_pdf_to_docx_fast" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-docx-fast"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_docx_fast.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_merge" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-merge"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 300
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_merge.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_split" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-split"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_split.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_compress" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-compress"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 300
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_compress.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_rotate" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-rotate"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_rotate.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_annotate" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-annotate"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_annotate.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_rearrange" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-rearrange"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_rearrange.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_svg_annotate" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-svg-annotate"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 180
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_svg_annotate.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_remove_watermark" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-remove-watermark"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 180
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_remove_watermark.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_extract_text" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-extract-text"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_extract_text.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_analyze" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-analyze"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 30
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_analyze.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_repair" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-repair"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_repair.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_to_image" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-image"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 1024
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_image.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_pdf_to_txt" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-txt"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_txt.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  extra_iam_statements = [
    {
      Effect   = "Allow"
      Action   = ["textract:DetectDocumentText"]
      Resource = ["*"]
    },
  ]
}

module "lambda_pdf_to_xls" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-xls"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_xls.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# ── DOCX / XLSX handlers ──────────────────────────────────────────────────────

module "lambda_docx_to_pdf" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "docx-to-pdf"
  handler               = var.office_converter_package_type == "Image" ? "" : "handler.handler"
  runtime               = var.office_converter_package_type == "Image" ? "" : var.lambda_runtime
  package_type          = var.office_converter_package_type
  image_uri             = local.office_converter_images.docx_to_pdf
  architectures         = var.office_converter_package_type == "Image" ? ["arm64"] : []
  memory_size           = var.office_converter_package_type == "Image" ? 2048 : 512
  timeout               = var.office_converter_package_type == "Image" ? 300 : 120
  s3_bucket             = var.office_converter_package_type == "Image" ? "" : var.lambda_handler_s3_bucket
  s3_key                = var.office_converter_package_type == "Image" ? "" : "handlers/docx_to_pdf.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = var.office_converter_package_type == "Image" ? [] : local.lambda_layer_arns
}

module "lambda_docx_to_pdf_fast" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "docx-to-pdf-fast"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/docx_to_pdf_fast.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_docx_to_txt" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "docx-to-txt"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/docx_to_txt.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_xlsx_to_pdf" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "xlsx-to-pdf"
  handler               = var.office_converter_package_type == "Image" ? "" : "handler.handler"
  runtime               = var.office_converter_package_type == "Image" ? "" : var.lambda_runtime
  package_type          = var.office_converter_package_type
  image_uri             = local.office_converter_images.xlsx_to_pdf
  architectures         = var.office_converter_package_type == "Image" ? ["arm64"] : []
  memory_size           = var.office_converter_package_type == "Image" ? 2048 : 512
  timeout               = var.office_converter_package_type == "Image" ? 300 : 120
  s3_bucket             = var.office_converter_package_type == "Image" ? "" : var.lambda_handler_s3_bucket
  s3_key                = var.office_converter_package_type == "Image" ? "" : "handlers/xlsx_to_pdf.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = var.office_converter_package_type == "Image" ? [] : local.lambda_layer_arns
}

module "lambda_xlsx_to_pdf_fast" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "xlsx-to-pdf-fast"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/xlsx_to_pdf_fast.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_xlsx_to_csv" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "xlsx-to-csv"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/xlsx_to_csv.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# ── Markdown / HTML handlers ──────────────────────────────────────────────────

module "lambda_markdown_convert" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "markdown-convert"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/markdown_convert.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_html_convert" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "html-convert"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/html_convert.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# ── Document + Image edit handlers ────────────────────────────────────────────

module "lambda_doc_edit" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "doc-edit"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/doc_edit.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_image_to_pdf" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "image-to-pdf"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 60
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/image_to_pdf.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_image_convert" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "image-convert"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/image_convert.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.worker_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  extra_iam_statements = [
    {
      Effect   = "Allow"
      Action   = ["textract:DetectDocumentText"]
      Resource = ["*"]
    },
  ]
}

# ── Video handler ─────────────────────────────────────────────────────────────

module "lambda_video_process" {
  source                         = "./modules/lambda"
  name_prefix                    = local.name_prefix
  function_name                  = "video-process"
  handler                        = "handler.handler"
  runtime                        = var.lambda_runtime
  memory_size                    = 1024
  timeout                        = 900
  s3_bucket                      = var.lambda_handler_s3_bucket
  s3_key                         = "handlers/video_process.zip"
  environment_variables          = merge(local.lambda_common_env, { FFMPEG_LAYER_S3_KEY = "layers/ffmpeg/ffmpeg" })
  common_tags                    = local.worker_tags
  dynamodb_table_arns            = local.dynamodb_arns
  media_bucket_arn               = module.s3.bucket_arn
  layer_arns                     = local.lambda_layer_arns
  reserved_concurrent_executions = -1  # unlimited — was 0 (blocked)
  extra_iam_statements = [
    {
      Effect = "Allow"
      Action = [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
      ]
      Resource = ["*"]
    },
    {
      Effect = "Allow"
      Action = ["translate:TranslateText"]
      Resource = ["*"]
    },
    {
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
      Resource = ["${module.s3.bucket_arn}/transcribe-tmp/*"]
    },
  ]
}

# ── SQS dispatcher ────────────────────────────────────────────────────────────
# Single Lambda reads from the shared queue and invokes the correct worker
# Lambda asynchronously. Avoids the anti-pattern of multiple ESMs competing
# for the same SQS messages.

module "lambda_dispatch_job" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "dispatch-job"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 30
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/dispatch_job.zip"
  environment_variables = merge(local.lambda_common_env, { NAME_PREFIX = local.name_prefix })
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  enable_sqs_trigger    = true
  sqs_event_source_arn  = module.sqs.queue_arn
  extra_iam_statements = [
    {
      Effect = "Allow"
      Action = ["lambda:InvokeFunction"]
      # Tag-scoped wildcard keeps the dispatcher limited to worker Lambdas
      # without maintaining a brittle per-ARN allowlist.
      Resource = ["arn:aws:lambda:*:*:function:${local.name_prefix}-*"]
      Condition = {
        StringEquals = {
          "aws:ResourceTag/superdoc:role" = "worker"
        }
      }
    }
  ]
}

# ── Scheduled + abuse-protection handlers ────────────────────────────────────

module "lambda_sweeper_expired_files" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "sweeper-expired-files"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 300
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/sweeper_expired_files.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  enable_eventbridge    = true
  schedule_expression   = "rate(15 minutes)"
}

module "lambda_disable_anonymous" {
  source        = "./modules/lambda"
  name_prefix   = local.name_prefix
  function_name = "disable-anonymous"
  handler       = "handler.handler"
  runtime       = var.lambda_runtime
  memory_size   = 128
  timeout       = 60
  s3_bucket     = var.lambda_handler_s3_bucket
  s3_key        = "handlers/disable_anonymous.zip"
  environment_variables = merge(local.lambda_common_env, {
    ALERTS_TOPIC_ARN = module.monitoring.alerts_topic_arn
    API_GATEWAY_ID   = module.api_gateway.rest_api_id
    API_STAGE        = var.environment
  })
  common_tags         = local.common_tags
  dynamodb_table_arns = local.dynamodb_arns
  media_bucket_arn    = module.s3.bucket_arn
  layer_arns          = local.lambda_layer_arns
  enable_sns_trigger  = true
  sns_trigger_arn     = module.monitoring.auto_disable_topic_arn
  extra_iam_statements = [
    { Effect = "Allow", Action = ["sns:Publish"], Resource = [module.monitoring.alerts_topic_arn] },
    { Effect = "Allow", Action = ["apigateway:PATCH", "apigateway:GET"], Resource = ["arn:aws:apigateway:*::/restapis/${module.api_gateway.rest_api_id}/*"] },
    { Effect = "Allow", Action = ["events:PutRule", "events:PutTargets"], Resource = ["arn:aws:events:*:*:rule/${local.name_prefix}-restore-*"] },
    { Effect = "Allow", Action = ["logs:StartQuery", "logs:GetQueryResults"], Resource = ["arn:aws:logs:*:*:log-group:/aws/api-gateway/${local.name_prefix}:*"] },
  ]
}

module "lambda_restore_anonymous" {
  source        = "./modules/lambda"
  name_prefix   = local.name_prefix
  function_name = "restore-anonymous"
  handler       = "handler.handler"
  runtime       = var.lambda_runtime
  memory_size   = 128
  timeout       = 30
  s3_bucket     = var.lambda_handler_s3_bucket
  s3_key        = "handlers/restore_anonymous.zip"
  environment_variables = merge(local.lambda_common_env, {
    API_GATEWAY_ID = module.api_gateway.rest_api_id
    API_STAGE      = var.environment
  })
  common_tags         = local.common_tags
  dynamodb_table_arns = local.dynamodb_arns
  media_bucket_arn    = module.s3.bucket_arn
  layer_arns          = local.lambda_layer_arns
  extra_iam_statements = [
    { Effect = "Allow", Action = ["apigateway:PATCH", "apigateway:GET"], Resource = ["arn:aws:apigateway:*::/restapis/${module.api_gateway.rest_api_id}/*"] },
  ]
}

# ── User / Admin / Billing handlers ──────────────────────────────────────────

module "lambda_user_files" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "user-files"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/user_files.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_user_create_file" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "user-create-file"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 20
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/user_create_file.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_user_complete_file" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "user-complete-file"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/user_complete_file.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_user_settings" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "user-settings"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/user_settings.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_user_credits" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "user-credits"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/user_credits.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_admin_flags" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "admin-flags"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/admin_flags.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_admin_incidents" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "admin-incidents"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/admin_incidents.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_stripe_webhook" {
  source        = "./modules/lambda"
  name_prefix   = local.name_prefix
  function_name = "stripe-webhook"
  handler       = "handler.handler"
  runtime       = var.lambda_runtime
  memory_size   = 256
  timeout       = 10
  s3_bucket     = var.lambda_handler_s3_bucket
  s3_key        = "handlers/stripe_webhook.zip"
  environment_variables = merge(local.lambda_common_env, {
    PAYMENTS_TABLE_NAME = aws_dynamodb_table.payments.name
  })
  common_tags         = local.common_tags
  dynamodb_table_arns = concat(local.dynamodb_arns, [aws_dynamodb_table.payments.arn])
  media_bucket_arn    = module.s3.bucket_arn
  layer_arns          = local.lambda_layer_arns
}

module "lambda_stripe_create_checkout" {
  source        = "./modules/lambda"
  name_prefix   = local.name_prefix
  function_name = "stripe-create-checkout"
  handler       = "handler.handler"
  runtime       = var.lambda_runtime
  memory_size   = 256
  timeout       = 10
  s3_bucket     = var.lambda_handler_s3_bucket
  s3_key        = "handlers/stripe_create_checkout.zip"
  environment_variables = merge(local.lambda_common_env, {
    PAYMENTS_TABLE_NAME = aws_dynamodb_table.payments.name
  })
  common_tags         = local.common_tags
  dynamodb_table_arns = concat(local.dynamodb_arns, [aws_dynamodb_table.payments.arn])
  media_bucket_arn    = module.s3.bucket_arn
  layer_arns          = local.lambda_layer_arns
}

module "lambda_billing_create_checkout" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "billing-create-checkout"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/billing_create_checkout.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}
