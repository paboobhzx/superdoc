# ── DNS zone (referenced by both ACM and Route53 modules) ────────────────────

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ── ACM certificate for custom CloudFront domain ──────────────────────────────

module "acm" {
  source      = "./modules/acm"
  domain_name = "${var.subdomain}.${var.domain_name}"
  zone_id     = data.aws_route53_zone.main.zone_id
  common_tags = local.common_tags
}

# ── Core services ─────────────────────────────────────────────────────────────

module "s3" {
  source      = "./modules/s3"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
}

module "dynamodb" {
  source      = "./modules/dynamodb"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
}

module "ssm" {
  source      = "./modules/ssm"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
}

module "cognito" {
  source      = "./modules/cognito"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
}

module "api_gateway" {
  source                = "./modules/api_gateway"
  name_prefix           = local.name_prefix
  common_tags           = local.common_tags
  environment           = var.environment
  cognito_user_pool_arn = module.cognito.user_pool_arn
  lambda_integrations = {
    create_job = {
      invoke_arn    = module.lambda_create_job.invoke_arn
      function_name = module.lambda_create_job.function_name
    }
    get_status = {
      invoke_arn    = module.lambda_get_status.invoke_arn
      function_name = module.lambda_get_status.function_name
    }
    process_job = {
      invoke_arn    = module.lambda_process_job.invoke_arn
      function_name = module.lambda_process_job.function_name
    }
    user_files = {
      invoke_arn    = module.lambda_user_files.invoke_arn
      function_name = module.lambda_user_files.function_name
    }
    user_create_file = {
      invoke_arn    = module.lambda_user_create_file.invoke_arn
      function_name = module.lambda_user_create_file.function_name
    }
    user_complete_file = {
      invoke_arn    = module.lambda_user_complete_file.invoke_arn
      function_name = module.lambda_user_complete_file.function_name
    }
    admin_flags = {
      invoke_arn    = module.lambda_admin_flags.invoke_arn
      function_name = module.lambda_admin_flags.function_name
    }
    admin_incidents = {
      invoke_arn    = module.lambda_admin_incidents.invoke_arn
      function_name = module.lambda_admin_incidents.function_name
    }
      list_operations = {
      invoke_arn    = module.lambda_list_operations.invoke_arn
      function_name = module.lambda_list_operations.function_name
    }
      stripe_create_checkout = {
      invoke_arn    = module.lambda_stripe_create_checkout.invoke_arn
      function_name = module.lambda_stripe_create_checkout.function_name
    }
      stripe_webhook = {
      invoke_arn    = module.lambda_stripe_webhook.invoke_arn
      function_name = module.lambda_stripe_webhook.function_name
    }
      presign_download = {
      invoke_arn    = module.lambda_presign_download.invoke_arn
      function_name = module.lambda_presign_download.function_name
    }
  }
}

module "amplify" {
  source               = "./modules/amplify"
  name_prefix          = local.name_prefix
  common_tags          = local.common_tags
  environment          = var.environment
  api_url              = module.api_gateway.invoke_url
  cognito_user_pool_id = module.cognito.user_pool_id
  cognito_client_id    = module.cognito.client_id
}

module "cloudfront" {
  source              = "./modules/cloudfront"
  name_prefix         = local.name_prefix
  common_tags         = local.common_tags
  amplify_app_url     = module.amplify.app_url
  api_invoke_url      = module.api_gateway.invoke_url
  acm_certificate_arn = module.acm.certificate_arn
  domain_name         = var.domain_name
  subdomain           = var.subdomain
}

module "route53" {
  source             = "./modules/route53"
  domain_name        = var.domain_name
  subdomain          = var.subdomain
  cloudfront_domain  = module.cloudfront.domain_name
  cloudfront_zone_id = module.cloudfront.hosted_zone_id
  common_tags        = local.common_tags
}

module "budget" {
  source      = "./modules/budget"
  name_prefix = local.name_prefix
  alert_email = var.alert_email
  common_tags = local.common_tags
}

module "monitoring" {
  source            = "./modules/monitoring"
  name_prefix       = local.name_prefix
  common_tags       = local.common_tags
  alert_email       = var.alert_email
  media_bucket_name = module.s3.bucket_name
  api_name          = "${local.name_prefix}-api"
  api_stage         = var.environment
}

module "sqs" {
  source           = "./modules/sqs"
  name_prefix      = local.name_prefix
  common_tags      = local.common_tags
  alerts_topic_arn = module.monitoring.alerts_topic_arn
}

# ── Lambda layers ────────────────────────────────────────────────────────────

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

# ── Lambda shared config ─────────────────────────────────────────────────────

locals {
  lambda_common_env = {
    RATE_LIMIT_ENABLED = tostring(var.rate_limit_enabled)
    JOBS_TABLE        = module.dynamodb.table_name
    API_KEYS_TABLE    = module.dynamodb.api_keys_name
    INCIDENTS_TABLE   = module.dynamodb.incidents_name
    RATE_LIMITS_TABLE = module.dynamodb.rate_limits_name
    MEDIA_BUCKET      = module.s3.bucket_name
    SQS_QUEUE_URL     = module.sqs.queue_url
    ENVIRONMENT       = var.environment
    LOG_LEVEL         = var.environment == "prod" ? "WARNING" : "DEBUG"
    TTL_SECONDS       = "43200"
  }

  lambda_layer_arns = [
    module.layer_utils.layer_arn,
    module.layer_deps.layer_arn,
  ]

  dynamodb_arns = [
    module.dynamodb.table_arn,
    "${module.dynamodb.table_arn}/index/*",
    module.dynamodb.api_keys_arn,
    "${module.dynamodb.api_keys_arn}/index/*",
    module.dynamodb.incidents_arn,
    "${module.dynamodb.incidents_arn}/index/*",
    module.dynamodb.rate_limits_arn,
  ]
}

# ── Core API handlers ────────────────────────────────────────────────────────

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

# ── PDF handlers ─────────────────────────────────────────────────────────────

module "lambda_pdf_to_docx" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "pdf-to-docx"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 300
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/pdf_to_docx.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}
# Lambda: presign_download. Read-only, lightweight. No DynamoDB access needed
# (doesn't look up job records; trusts the caller to have the key).
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

# Lambda: stripe_webhook. Signature-verifies incoming Stripe events and
# flips payment status on checkout.session.completed. Needs SSM read and
# DynamoDB write to payments table.
module "lambda_stripe_webhook" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "stripe-webhook"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/stripe_webhook.zip"
  environment_variables = merge(local.lambda_common_env, {
    PAYMENTS_TABLE_NAME = aws_dynamodb_table.payments.name
  })
  common_tags           = local.common_tags
  dynamodb_table_arns   = concat(local.dynamodb_arns, [aws_dynamodb_table.payments.arn])
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# Lambda: stripe_create_checkout. Creates Checkout Session and persists
# pending payment record. Needs SSM read for Stripe keys and DynamoDB write
# for payments table.
module "lambda_stripe_create_checkout" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "stripe-create-checkout"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 256
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/stripe_create_checkout.zip"
  environment_variables = merge(local.lambda_common_env, {
    PAYMENTS_TABLE_NAME = aws_dynamodb_table.payments.name
  })
  common_tags           = local.common_tags
  dynamodb_table_arns   = concat(local.dynamodb_arns, [aws_dynamodb_table.payments.arn])
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_xlsx_to_pdf" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "xlsx-to-pdf"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/xlsx_to_pdf.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

module "lambda_docx_to_pdf" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "docx-to-pdf"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 512
  timeout               = 120
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/docx_to_pdf.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# Worker Lambda for pdf_to_txt. Matches pdf_extract_text's shape (256MB,
# 120s timeout) since the underlying pypdf work is identical.
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# Read-only Lambda for GET /operations. Minimal memory/timeout since it
# returns a static dict. The lambda module still attaches DynamoDB/S3
# policies by default — that's a known over-grant. We accept it for now
# because fixing the module is out of scope for this task; the blast radius
# is bounded because the handler code never uses those permissions.
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


# ── Document + Image handlers ────────────────────────────────────────────────

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
  common_tags           = local.common_tags
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
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
}

# ── Video handler ────────────────────────────────────────────────────────────

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
  common_tags                    = local.common_tags
  dynamodb_table_arns            = local.dynamodb_arns
  media_bucket_arn               = module.s3.bucket_arn
  layer_arns                     = local.lambda_layer_arns
  reserved_concurrent_executions = 0
}

# ── SQS dispatcher ───────────────────────────────────────────────────────────
# Single Lambda reads from the shared queue and invokes the correct operation
# Lambda asynchronously. This avoids the anti-pattern of multiple ESMs competing
# for the same SQS messages (non-matching filters silently delete messages).

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
      Resource = [
        module.lambda_pdf_compress.function_arn,
        module.lambda_pdf_merge.function_arn,
        module.lambda_pdf_split.function_arn,
        module.lambda_pdf_to_docx.function_arn,
        module.lambda_xlsx_to_csv.function_arn,
        module.lambda_xlsx_to_pdf.function_arn,
        module.lambda_docx_to_txt.function_arn,
        module.lambda_docx_to_pdf.function_arn,
        module.lambda_image_to_pdf.function_arn,
        module.lambda_pdf_to_image.function_arn,
        module.lambda_pdf_to_txt.function_arn,
        module.lambda_pdf_rotate.function_arn,
        module.lambda_pdf_annotate.function_arn,
        module.lambda_pdf_extract_text.function_arn,
        module.lambda_image_convert.function_arn,
        module.lambda_doc_edit.function_arn,
        module.lambda_video_process.function_arn,
      ]
    }
  ]
}

# ── Scheduled handlers ───────────────────────────────────────────────────────

module "lambda_kb_cleanup" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "kb-cleanup"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 300
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/kb_cleanup.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
  layer_arns            = local.lambda_layer_arns
  enable_eventbridge    = true
  schedule_expression   = "rate(15 minutes)"
}

# ── Abuse protection ─────────────────────────────────────────────────────────

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

# ── User / Admin handlers ────────────────────────────────────────────────────

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
  environment_variables = merge(local.lambda_common_env, { USER_TTL_SECONDS = "604800" })
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
  environment_variables = merge(local.lambda_common_env, { USER_TTL_SECONDS = "604800" })
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

# ── Payments table (added by round 3a-2) ────────────────────────────────────
# TTL=24h handles abandoned checkouts without manual cleanup.
# On-demand billing keeps cost at zero when idle (no active payments yet).
resource "aws_dynamodb_table" "payments" {
  name         = "${local.name_prefix}-payments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "payment_id"

  attribute {
    name = "payment_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = local.common_tags
}

# ── Stripe SSM parameters (placeholders, added by round 3a-2) ───────────────
# Replace values in the AWS Systems Manager console when ready to go live.
# The "lifecycle.ignore_changes" on value keeps Terraform from trying to
# reset them to REPLACE_ME on later applies.
resource "aws_ssm_parameter" "stripe_secret_key" {
  name        = "/superdoc/stripe/secret_key"
  description = "Stripe secret key (sk_live_... or sk_test_...)"
  type        = "SecureString"
  value       = "REPLACE_ME_STRIPE_SECRET_KEY"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_webhook_secret" {
  name        = "/superdoc/stripe/webhook_secret"
  description = "Stripe webhook signing secret (whsec_...)"
  type        = "SecureString"
  value       = "REPLACE_ME_STRIPE_WEBHOOK_SECRET"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "stripe_price_id_conversion" {
  name        = "/superdoc/stripe/price_id_conversion"
  description = "Stripe price id for per-conversion charge (price_...)"
  type        = "String"
  value       = "REPLACE_ME_STRIPE_PRICE_ID"
  tags        = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}
