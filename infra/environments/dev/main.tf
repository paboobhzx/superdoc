terraform {
  backend "s3" {
    bucket                      = "superdoc-tfstate-288854271409"
    key                         = "superdoc/dev/terraform.tfstate"
    region                      = "us-east-1"
    encrypt                     = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

module "superdoc" {
  source                   = "../../"
  environment              = "dev"
  aws_region               = "us-east-1"
  project_name             = "superdoc"
  owner                    = "pablo"
  alert_email              = "pablobhz@gmail.com"
  domain_name              = "pablobhz.cloud"
  subdomain                = "superdoc"
  lambda_handler_s3_bucket = var.lambda_handler_s3_bucket
}

variable "lambda_handler_s3_bucket" {
  description = "S3 bucket for Lambda zips (from private repo CI)"
  type        = string
}
