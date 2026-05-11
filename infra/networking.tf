# ── DNS, certificates, API Gateway, frontend distribution ─────────────────────

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

module "acm" {
  source      = "./modules/acm"
  domain_name = "${var.subdomain}.${var.domain_name}"
  zone_id     = data.aws_route53_zone.main.zone_id
  common_tags = local.common_tags
}

module "api_gateway" {
  source                = "./modules/api_gateway"
  name_prefix           = local.name_prefix
  common_tags           = local.common_tags
  environment           = var.environment
  cors_allow_origin     = "https://${var.subdomain}.${var.domain_name}"
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
    auth_session = {
      invoke_arn    = module.lambda_auth_session.invoke_arn
      function_name = module.lambda_auth_session.function_name
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
    billing_create_checkout = {
      invoke_arn    = module.lambda_billing_create_checkout.invoke_arn
      function_name = module.lambda_billing_create_checkout.function_name
    }
    stripe_webhook = {
      invoke_arn    = module.lambda_stripe_webhook.invoke_arn
      function_name = module.lambda_stripe_webhook.function_name
    }
    user_credits = {
      invoke_arn    = module.lambda_user_credits.invoke_arn
      function_name = module.lambda_user_credits.function_name
    }
    user_settings = {
      invoke_arn    = module.lambda_user_settings.invoke_arn
      function_name = module.lambda_user_settings.function_name
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
  app_name             = var.amplify_app_name
  repository           = var.amplify_repository
  # Token is injected by apply.sh via TF_VAR_amplify_oauth_token (read from SSM).
  # Never set this in tfvars — the value is sensitive and lives in SSM only.
  oauth_token = var.amplify_oauth_token
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
