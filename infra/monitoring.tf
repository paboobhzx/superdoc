# ── Budget, CloudWatch alarms, office warmer ──────────────────────────────────

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

# ── LibreOffice Lambda warmer ─────────────────────────────────────────────────
# Pings container-based Lambdas every 4 minutes to avoid 30–90s cold starts.
# Only active when office_converter_package_type == "Image".

resource "aws_cloudwatch_event_rule" "office_warmer" {
  count               = var.office_converter_package_type == "Image" ? 1 : 0
  name                = "${local.name_prefix}-office-warmer"
  description         = "Ping LibreOffice Lambdas every 4 minutes to prevent cold starts"
  schedule_expression = "rate(4 minutes)"
  tags                = local.common_tags
}

resource "aws_cloudwatch_event_target" "office_warmer_docx_to_pdf" {
  count     = var.office_converter_package_type == "Image" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.office_warmer[0].name
  target_id = "docx-to-pdf-warmer"
  arn       = module.lambda_docx_to_pdf.function_arn
  input     = jsonencode({ _warmup = true })
}

resource "aws_cloudwatch_event_target" "office_warmer_xlsx_to_pdf" {
  count     = var.office_converter_package_type == "Image" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.office_warmer[0].name
  target_id = "xlsx-to-pdf-warmer"
  arn       = module.lambda_xlsx_to_pdf.function_arn
  input     = jsonencode({ _warmup = true })
}

resource "aws_cloudwatch_event_target" "office_warmer_pdf_to_docx" {
  count     = var.office_converter_package_type == "Image" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.office_warmer[0].name
  target_id = "pdf-to-docx-warmer"
  arn       = module.lambda_pdf_to_docx.function_arn
  input     = jsonencode({ _warmup = true })
}

resource "aws_lambda_permission" "office_warmer_docx_to_pdf" {
  count         = var.office_converter_package_type == "Image" ? 1 : 0
  statement_id  = "AllowEventBridgeWarmerDocxToPdf"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_docx_to_pdf.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.office_warmer[0].arn
}

resource "aws_lambda_permission" "office_warmer_xlsx_to_pdf" {
  count         = var.office_converter_package_type == "Image" ? 1 : 0
  statement_id  = "AllowEventBridgeWarmerXlsxToPdf"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_xlsx_to_pdf.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.office_warmer[0].arn
}

resource "aws_lambda_permission" "office_warmer_pdf_to_docx" {
  count         = var.office_converter_package_type == "Image" ? 1 : 0
  statement_id  = "AllowEventBridgeWarmerPdfToDocx"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_pdf_to_docx.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.office_warmer[0].arn
}
