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
  source      = "./modules/api_gateway"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
  environment = var.environment
}

module "amplify" {
  source      = "./modules/amplify"
  name_prefix = local.name_prefix
  common_tags = local.common_tags
  environment = var.environment
}

module "cloudfront" {
  source          = "./modules/cloudfront"
  name_prefix     = local.name_prefix
  common_tags     = local.common_tags
  amplify_app_url = module.amplify.app_url
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

# ── Lambda shared config ─────────────────────────────────────────────────────

locals {
  lambda_common_env = {
    JOBS_TABLE        = module.dynamodb.table_name
    API_KEYS_TABLE    = module.dynamodb.api_keys_name
    INCIDENTS_TABLE   = module.dynamodb.incidents_name
    RATE_LIMITS_TABLE = module.dynamodb.rate_limits_name
    MEDIA_BUCKET      = module.s3.bucket_name
    ENVIRONMENT       = var.environment
    LOG_LEVEL         = var.environment == "prod" ? "WARNING" : "DEBUG"
    TTL_SECONDS       = "43200"
  }

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
}

module "lambda_presign_download" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "presign-download"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 128
  timeout               = 10
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/presign_download.zip"
  environment_variables = local.lambda_common_env
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
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
}

# ── Video handler ────────────────────────────────────────────────────────────

module "lambda_video_process" {
  source                = "./modules/lambda"
  name_prefix           = local.name_prefix
  function_name         = "video-process"
  handler               = "handler.handler"
  runtime               = var.lambda_runtime
  memory_size           = 1024
  timeout               = 900
  s3_bucket             = var.lambda_handler_s3_bucket
  s3_key                = "handlers/video_process.zip"
  environment_variables = merge(local.lambda_common_env, { FFMPEG_LAYER_S3_KEY = "layers/ffmpeg/ffmpeg" })
  common_tags           = local.common_tags
  dynamodb_table_arns   = local.dynamodb_arns
  media_bucket_arn      = module.s3.bucket_arn
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
}
