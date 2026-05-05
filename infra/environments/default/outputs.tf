# Re-export root module outputs so `terraform output` works from this directory.
# Used by infra/apply.sh after each apply.

output "amplify_app_id" {
  description = "Amplify app ID"
  value       = module.superdoc.amplify_app_id
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation"
  value       = module.superdoc.cloudfront_distribution_id
}

output "api_gateway_invoke_url" {
  description = "API Gateway invoke URL (VITE_API_URL in Amplify)"
  value       = module.superdoc.api_gateway_invoke_url
}
