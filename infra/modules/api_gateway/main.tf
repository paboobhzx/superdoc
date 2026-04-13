resource "aws_api_gateway_rest_api" "superdoc" {
  name        = "${var.name_prefix}-api"
  description = "SuperDoc API"
  tags        = var.common_tags

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# ── CORS gateway responses ───────────────────────────────────────────────────

resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  response_type = "DEFAULT_4XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS'"
  }
}

# Custom 429 response
resource "aws_api_gateway_gateway_response" "throttle" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  response_type = "THROTTLED"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin" = "'*'"
  }

  response_templates = {
    "application/json" = "{\"error\":\"Too many requests. Register for higher limits.\",\"register_url\":\"https://superdoc.pablobhz.cloud/register\"}"
  }
}

# ── /health mock endpoint ────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "health" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "health"
}

resource "aws_api_gateway_method" "health_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.health.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "health_mock" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.health.id
  http_method = aws_api_gateway_method.health_get.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "health_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.health.id
  http_method = aws_api_gateway_method.health_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_integration_response" "health_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.health.id
  http_method = aws_api_gateway_method.health_get.http_method
  status_code = "200"

  response_templates = {
    "application/json" = "{\"status\":\"ok\"}"
  }
}

# ── Deployment + Stage ───────────────────────────────────────────────────────

resource "aws_api_gateway_deployment" "superdoc" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_rest_api.superdoc.body,
      aws_api_gateway_resource.health.id,
      aws_api_gateway_method.health_get.id,
      aws_api_gateway_integration.health_mock.id,
      aws_api_gateway_gateway_response.throttle.id,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.health_mock,
    aws_api_gateway_integration_response.health_200,
    aws_api_gateway_method_response.health_200,
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_api_gateway_stage" "superdoc" {
  deployment_id = aws_api_gateway_deployment.superdoc.id
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  stage_name    = var.environment
  tags          = var.common_tags

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format          = "$context.requestId $context.identity.sourceIp $context.identity.userAgent $context.httpMethod $context.resourcePath $context.status $context.identity.apiKeyId"
  }
}

# Stage-level throttling: burst=50 rate=20
resource "aws_api_gateway_method_settings" "all" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  stage_name  = aws_api_gateway_stage.superdoc.stage_name
  method_path = "*/*"

  settings {
    throttling_burst_limit = 50
    throttling_rate_limit  = 20
    logging_level          = "ERROR"
    metrics_enabled        = true
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/api-gateway/${var.name_prefix}"
  retention_in_days = 7
  tags              = var.common_tags
}

# ── Usage Plans ──────────────────────────────────────────────────────────────

resource "aws_api_gateway_usage_plan" "basic" {
  name = "${var.name_prefix}-basic"
  tags = var.common_tags

  api_stages {
    api_id = aws_api_gateway_rest_api.superdoc.id
    stage  = aws_api_gateway_stage.superdoc.stage_name
  }

  throttle_settings {
    burst_limit = 100
    rate_limit  = 10
  }

  quota_settings {
    limit  = 5000
    period = "DAY"
  }
}

resource "aws_api_gateway_usage_plan" "teams" {
  name = "${var.name_prefix}-teams"
  tags = var.common_tags

  api_stages {
    api_id = aws_api_gateway_rest_api.superdoc.id
    stage  = aws_api_gateway_stage.superdoc.stage_name
  }

  throttle_settings {
    burst_limit = 500
    rate_limit  = 50
  }

  quota_settings {
    limit  = 20000
    period = "DAY"
  }
}
