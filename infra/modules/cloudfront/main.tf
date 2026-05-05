locals {
  api_invoke_url_trim = trimsuffix(var.api_invoke_url, "/")
  api_no_proto        = replace(replace(local.api_invoke_url_trim, "https://", ""), "http://", "")
  api_parts           = split("/", local.api_no_proto)
  api_domain          = local.api_parts[0]
  api_origin_path     = "/${local.api_parts[1]}"
}

resource "aws_cloudfront_distribution" "superdoc" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # US + Europe only — cheapest
  aliases             = ["${var.subdomain}.${var.domain_name}"]
  tags                = var.common_tags

  # API origin info extracted from invoke URL:
  #   https://<domain>/<stage>  -> origin domain + origin_path "/<stage>"
  # CloudFront cannot rewrite paths natively, so we strip the /api prefix via a CloudFront Function.
  # The API Gateway origin sees "/<stage>/jobs" etc.
  # Example viewer URL:  https://site/api/jobs  ->  https://api-gw/<stage>/jobs
  #
  # NOTE: CloudFront Functions run at viewer request and are low-latency + low-cost.
  # They do not require Lambda@Edge.
  #
  # This keeps the frontend resilient even if VITE_API_URL is misconfigured to the site origin.
  #
  # HCL string helpers keep this intentionally simple.
  #
  # var.api_invoke_url is required.
  #
  # If parsing fails, the distribution will fail to apply/validate.
  #
  # origin_path must begin with '/'.
  #
  # We rely on API Gateway stage invoke_url always containing "/<stage>".
  #
  # If you switch to a custom API domain later, you can remove the function and point VITE_API_URL to that domain instead.
  #
  # (No complicated ternaries; keep this readable.)
  #
  #
  # locals are not allowed inside resource blocks in older Terraform syntax; we keep expressions inline.

  origin {
    domain_name = local.api_domain
    origin_id   = "api-origin"

    origin_path = local.api_origin_path

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    domain_name = var.amplify_app_url
    origin_id   = "amplify-origin"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    # Serves index.html and any unmatched paths from Amplify.
    # TTL = 0 so CloudFront never caches HTML — every request fetches the latest
    # index.html from Amplify, which always references the current hashed assets.
    # This prevents users from seeing stale HTML after a new Amplify deploy.
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "amplify-origin"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0
  }

  # Hashed static assets are safe to cache for a long time — Vite generates a
  # new content hash on every build, so stale references are impossible as long
  # as index.html is never cached (see default_cache_behavior above).
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "amplify-origin"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    target_origin_id           = "api-origin"
    viewer_protocol_policy     = "redirect-to-https"
    compress                   = true
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    forwarded_values {
      query_string = true
      headers = [
        "Authorization",
        "Content-Type",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
        "X-Api-Key",
      ]
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 0
    max_ttl     = 0

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.strip_api_prefix.arn
    }
  }

  # SPA fallback — all 404s serve index.html
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.name_prefix}-security-headers"
  comment = "Security headers for SuperDoc"

  security_headers_config {
    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }

    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
      override = true
    }
  }
}

resource "aws_cloudfront_function" "strip_api_prefix" {
  name    = "${var.name_prefix}-strip-api-prefix"
  runtime = "cloudfront-js-1.0"
  comment = "Rewrite /api/* requests to /* for the API origin"
  publish = true

  code = <<-JS
function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";
  if (uri.indexOf("/api/") === 0) {
    request.uri = uri.substring(4);
  } else if (uri === "/api") {
    request.uri = "/";
  }
  return request;
}
  JS
}
