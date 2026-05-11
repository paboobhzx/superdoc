# ── SuperDoc root module ───────────────────────────────────────────────────────
# This file is intentionally minimal. Resources are split by concern:
#
#   versions.tf    — terraform block + provider
#   tags.tf        — common_tags + name_prefix locals
#   variables.tf   — input variables
#   outputs.tf     — output values
#   storage.tf     — S3, DynamoDB tables, SSM module
#   auth.tf        — Cognito, SES DKIM CNAME records
#   networking.tf  — ACM, API Gateway, Amplify, CloudFront, Route53
#   messaging.tf   — SQS
#   monitoring.tf  — CloudWatch alarms, Budget, office warmer
#   billing.tf     — Stripe SSM parameters
#   lambdas.tf     — ECR, Lambda layers, all Lambda functions
