terraform {
  backend "s3" {
    bucket                      = "superdoc-tfstate"
    key                         = "superdoc/prod/terraform.tfstate"
    region                      = "us-east-1"
    encrypt                     = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

module "superdoc" {
  source                               = "../../"
  environment                          = "prod"
  aws_region                           = "us-east-1"
  project_name                         = "superdoc"
  owner                                = "pablo"
  alert_email                          = "pablobhz@gmail.com"
  domain_name                          = "pablobhz.cloud"
  subdomain                            = "superdoc"
  lambda_handler_s3_bucket             = var.lambda_handler_s3_bucket
  enable_media_customer_managed_kms    = var.enable_media_customer_managed_kms
  enable_dynamodb_customer_managed_kms = var.enable_dynamodb_customer_managed_kms
  office_converter_package_type        = "Image"
  office_converter_image_tag           = var.office_converter_image_tag
  amplify_app_name                     = "superdoc"
  amplify_repository                   = "https://github.com/paboobhzx/superdoc"
  amplify_oauth_token                  = var.amplify_oauth_token
}

variable "lambda_handler_s3_bucket" {
  description = "S3 bucket for Lambda zips (from private repo CI)"
  type        = string
}

variable "enable_media_customer_managed_kms" {
  description = "Use customer-managed KMS for media S3 encryption."
  type        = bool
  default     = false
}

variable "enable_dynamodb_customer_managed_kms" {
  description = "Use customer-managed KMS for DynamoDB table encryption."
  type        = bool
  default     = false
}

variable "amplify_oauth_token" {
  description = "GitHub PAT for Amplify auto-build. Injected via TF_VAR_amplify_oauth_token in apply.sh — never set in tfvars."
  type        = string
  default     = ""
  sensitive   = true
}

variable "office_converter_image_tag" {
  description = "Docker image tag for office converter Lambda. Set to a timestamp by apply.sh on each Docker build to force Lambda redeployment."
  type        = string
  default     = "latest"
}

# The previous hotfix attempt created these IAM resources through AWS CLI before
# the deployment was stopped. Import them so the next Terraform apply adopts and
# reconciles them instead of failing on already-existing names.
# ── SES DKIM CNAME records — already exist in Route53, import on first apply ──
# These were created outside Terraform (manually or from a prior state).
# Import blocks are safe to keep; they become no-ops once the resource is in state.
import {
  to = module.superdoc.aws_route53_record.ses_dkim["coeczbhc76at5nald6v7ivf3mlqbrvwj"]
  id = "Z00715662A3EPIVLR1LS_coeczbhc76at5nald6v7ivf3mlqbrvwj._domainkey.pablobhz.cloud_CNAME"
}

import {
  to = module.superdoc.aws_route53_record.ses_dkim["roinmheddkv5joopihufptgulmj5umxs"]
  id = "Z00715662A3EPIVLR1LS_roinmheddkv5joopihufptgulmj5umxs._domainkey.pablobhz.cloud_CNAME"
}

import {
  to = module.superdoc.aws_route53_record.ses_dkim["7dtr3gk4wl5j7nonqzafy25n2jptehje"]
  id = "Z00715662A3EPIVLR1LS_7dtr3gk4wl5j7nonqzafy25n2jptehje._domainkey.pablobhz.cloud_CNAME"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role.lambda
  id = "superdoc-prod-markdown-convert-role"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy_attachment.basic
  id = "superdoc-prod-markdown-convert-role/arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.dynamodb
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-dynamo"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.s3
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-s3"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.ssm
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-ssm"
}
