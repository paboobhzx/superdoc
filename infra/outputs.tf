output "api_gateway_invoke_url" {
  description = "Direct API Gateway stage URL — this is VITE_API_URL in Amplify"
  value       = module.api_gateway.invoke_url
}

output "amplify_app_id" {
  description = "Amplify app ID (needed to trigger manual builds or set env vars)"
  value       = module.amplify.app_id
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain (superdoc.pablobhz.cloud resolves here)"
  value       = module.cloudfront.domain_name
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID — used for cache invalidation after each deploy"
  value       = module.cloudfront.distribution_id
}
