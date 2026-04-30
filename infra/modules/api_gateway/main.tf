data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  # Construído explicitamente pra evitar drift do provider no execution_arn
  api_execution_arn = "arn:aws:execute-api:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:${aws_api_gateway_rest_api.superdoc.id}"
}

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
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  response_templates = {
    "application/json" = "{\"error\":\"$context.error.messageString\"}"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  response_type = "DEFAULT_5XX"

  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  response_templates = {
    "application/json" = "{\"error\":\"$context.error.messageString\"}"
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

# ── Cognito authorizer ───────────────────────────────────────────────────────

resource "aws_api_gateway_authorizer" "cognito" {
  name          = "${var.name_prefix}-cognito"
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [var.cognito_user_pool_arn]
}

# ── Helper locals ─────────────────────────────────────────────────────────────

locals {
  cors_response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = true
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
  }
}

# ── /jobs resource ───────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "jobs" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "jobs"
}

# POST /jobs → create_job
resource "aws_api_gateway_method" "jobs_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.jobs.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "jobs_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.jobs.id
  http_method             = aws_api_gateway_method.jobs_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["create_job"].invoke_arn
}

resource "aws_lambda_permission" "create_job" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["create_job"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "jobs_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_post.http_method
  status_code = "200"
}

# OPTIONS /jobs (CORS)
resource "aws_api_gateway_method" "jobs_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.jobs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "jobs_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "jobs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "jobs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.jobs.id
  http_method = aws_api_gateway_method.jobs_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.jobs_options,
    aws_api_gateway_method_response.jobs_options_200,
  ]
}

# ── /jobs/{jobId} ────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "job_id" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.jobs.id
  path_part   = "{jobId}"
}

# GET /jobs/{jobId} → get_status
resource "aws_api_gateway_method" "job_id_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.job_id.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "job_id_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.job_id.id
  http_method             = aws_api_gateway_method.job_id_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["get_status"].invoke_arn
}

resource "aws_lambda_permission" "get_status" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["get_status"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "job_id_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_id.id
  http_method = aws_api_gateway_method.job_id_get.http_method
  status_code = "200"
}

# OPTIONS /jobs/{jobId} (CORS)
resource "aws_api_gateway_method" "job_id_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.job_id.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "job_id_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_id.id
  http_method = aws_api_gateway_method.job_id_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "job_id_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_id.id
  http_method = aws_api_gateway_method.job_id_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "job_id_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_id.id
  http_method = aws_api_gateway_method.job_id_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.job_id_options,
    aws_api_gateway_method_response.job_id_options_200,
  ]
}

# ── /jobs/{jobId}/process ─────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "job_process" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.job_id.id
  path_part   = "process"
}

resource "aws_api_gateway_method" "job_process_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.job_process.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "job_process_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.job_process.id
  http_method             = aws_api_gateway_method.job_process_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["process_job"].invoke_arn
}

resource "aws_lambda_permission" "process_job" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["process_job"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "job_process_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_process.id
  http_method = aws_api_gateway_method.job_process_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "job_process_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.job_process.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "job_process_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_process.id
  http_method = aws_api_gateway_method.job_process_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "job_process_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_process.id
  http_method = aws_api_gateway_method.job_process_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "job_process_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.job_process.id
  http_method = aws_api_gateway_method.job_process_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.job_process_options,
    aws_api_gateway_method_response.job_process_options_200,
  ]
}

# ── /users/me/files ───────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "users" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "users"
}

resource "aws_api_gateway_resource" "users_me" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.users.id
  path_part   = "me"
}

resource "aws_api_gateway_resource" "users_me_files" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.users_me.id
  path_part   = "files"
}

resource "aws_api_gateway_method" "users_me_files_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "users_me_files_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.users_me_files.id
  http_method             = aws_api_gateway_method.users_me_files_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["user_files"].invoke_arn
}

resource "aws_lambda_permission" "user_files" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["user_files"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "users_me_files_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files.id
  http_method = aws_api_gateway_method.users_me_files_get.http_method
  status_code = "200"
}

# POST /users/me/files → user_create_file
resource "aws_api_gateway_method" "users_me_files_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "users_me_files_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.users_me_files.id
  http_method             = aws_api_gateway_method.users_me_files_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["user_create_file"].invoke_arn
}

resource "aws_lambda_permission" "user_create_file" {
  statement_id  = "AllowAPIGatewayUserCreateFile"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["user_create_file"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "users_me_files_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files.id
  http_method = aws_api_gateway_method.users_me_files_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "users_me_files_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "users_me_files_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files.id
  http_method = aws_api_gateway_method.users_me_files_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "users_me_files_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files.id
  http_method = aws_api_gateway_method.users_me_files_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "users_me_files_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files.id
  http_method = aws_api_gateway_method.users_me_files_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.users_me_files_options,
    aws_api_gateway_method_response.users_me_files_options_200,
  ]
}

# ── /users/me/files/{jobId} ──────────────────────────────────────────────────

resource "aws_api_gateway_resource" "users_me_files_job" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.users_me_files.id
  path_part   = "{jobId}"
}

resource "aws_api_gateway_method" "users_me_files_job_delete" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files_job.id
  http_method   = "DELETE"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "users_me_files_job_delete" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.users_me_files_job.id
  http_method             = aws_api_gateway_method.users_me_files_job_delete.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["user_files"].invoke_arn
}

resource "aws_api_gateway_method_response" "users_me_files_job_delete_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job.id
  http_method = aws_api_gateway_method.users_me_files_job_delete.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "users_me_files_job_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files_job.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "users_me_files_job_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job.id
  http_method = aws_api_gateway_method.users_me_files_job_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "users_me_files_job_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job.id
  http_method = aws_api_gateway_method.users_me_files_job_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "users_me_files_job_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job.id
  http_method = aws_api_gateway_method.users_me_files_job_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,OPTIONS,DELETE'"
  }

  depends_on = [
    aws_api_gateway_integration.users_me_files_job_options,
    aws_api_gateway_method_response.users_me_files_job_options_200,
  ]
}

# ── /users/me/files/{jobId}/complete ─────────────────────────────────────────

resource "aws_api_gateway_resource" "users_me_files_job_complete" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.users_me_files_job.id
  path_part   = "complete"
}

resource "aws_api_gateway_method" "users_me_files_job_complete_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "users_me_files_job_complete_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method             = aws_api_gateway_method.users_me_files_job_complete_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["user_complete_file"].invoke_arn
}

resource "aws_lambda_permission" "user_complete_file" {
  statement_id  = "AllowAPIGatewayUserCompleteFile"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["user_complete_file"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "users_me_files_job_complete_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method = aws_api_gateway_method.users_me_files_job_complete_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "users_me_files_job_complete_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "users_me_files_job_complete_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method = aws_api_gateway_method.users_me_files_job_complete_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "users_me_files_job_complete_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method = aws_api_gateway_method.users_me_files_job_complete_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "users_me_files_job_complete_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_files_job_complete.id
  http_method = aws_api_gateway_method.users_me_files_job_complete_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.users_me_files_job_complete_options,
    aws_api_gateway_method_response.users_me_files_job_complete_options_200,
  ]
}

# ── /users/me/jobs ───────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "users_me_jobs" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.users_me.id
  path_part   = "jobs"
}

# POST /users/me/jobs → create_job (registered)
resource "aws_api_gateway_method" "users_me_jobs_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_jobs.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "users_me_jobs_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.users_me_jobs.id
  http_method             = aws_api_gateway_method.users_me_jobs_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["create_job"].invoke_arn
}

resource "aws_api_gateway_method_response" "users_me_jobs_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_jobs.id
  http_method = aws_api_gateway_method.users_me_jobs_post.http_method
  status_code = "200"
}

# OPTIONS /users/me/jobs (CORS)
resource "aws_api_gateway_method" "users_me_jobs_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.users_me_jobs.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "users_me_jobs_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_jobs.id
  http_method = aws_api_gateway_method.users_me_jobs_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "users_me_jobs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_jobs.id
  http_method = aws_api_gateway_method.users_me_jobs_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "users_me_jobs_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.users_me_jobs.id
  http_method = aws_api_gateway_method.users_me_jobs_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.users_me_jobs_options,
    aws_api_gateway_method_response.users_me_jobs_options_200,
  ]
}

# ── /admin ────────────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "admin" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "admin"
}

# ── /admin/flags ──────────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "admin_flags" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.admin.id
  path_part   = "flags"
}

resource "aws_lambda_permission" "admin_flags" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["admin_flags"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method" "admin_flags_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_flags.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "admin_flags_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.admin_flags.id
  http_method             = aws_api_gateway_method.admin_flags_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["admin_flags"].invoke_arn
}

resource "aws_api_gateway_method_response" "admin_flags_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_flags.id
  http_method = aws_api_gateway_method.admin_flags_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "admin_flags_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_flags.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "admin_flags_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.admin_flags.id
  http_method             = aws_api_gateway_method.admin_flags_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["admin_flags"].invoke_arn
}

resource "aws_api_gateway_method_response" "admin_flags_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_flags.id
  http_method = aws_api_gateway_method.admin_flags_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "admin_flags_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_flags.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "admin_flags_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_flags.id
  http_method = aws_api_gateway_method.admin_flags_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "admin_flags_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_flags.id
  http_method = aws_api_gateway_method.admin_flags_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "admin_flags_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_flags.id
  http_method = aws_api_gateway_method.admin_flags_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.admin_flags_options,
    aws_api_gateway_method_response.admin_flags_options_200,
  ]
}

# ── /admin/incidents ──────────────────────────────────────────────────────────

resource "aws_api_gateway_resource" "admin_incidents" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.admin.id
  path_part   = "incidents"
}

resource "aws_lambda_permission" "admin_incidents" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["admin_incidents"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method" "admin_incidents_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_incidents.id
  http_method   = "GET"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "admin_incidents_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.admin_incidents.id
  http_method             = aws_api_gateway_method.admin_incidents_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["admin_incidents"].invoke_arn
}

resource "aws_api_gateway_method_response" "admin_incidents_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_incidents.id
  http_method = aws_api_gateway_method.admin_incidents_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "admin_incidents_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_incidents.id
  http_method   = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "admin_incidents_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.admin_incidents.id
  http_method             = aws_api_gateway_method.admin_incidents_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["admin_incidents"].invoke_arn
}

resource "aws_api_gateway_method_response" "admin_incidents_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_incidents.id
  http_method = aws_api_gateway_method.admin_incidents_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "admin_incidents_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.admin_incidents.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "admin_incidents_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_incidents.id
  http_method = aws_api_gateway_method.admin_incidents_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "admin_incidents_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_incidents.id
  http_method = aws_api_gateway_method.admin_incidents_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "admin_incidents_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.admin_incidents.id
  http_method = aws_api_gateway_method.admin_incidents_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.admin_incidents_options,
    aws_api_gateway_method_response.admin_incidents_options_200,
  ]
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


# ── /operations ──────────────────────────────────────────────────────────────
# GET /operations returns the operation catalog; OPTIONS handles CORS preflight.
# Public endpoint (no auth) because the catalog itself contains no secrets.

resource "aws_api_gateway_resource" "operations" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "operations"
}

resource "aws_api_gateway_method" "operations_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.operations.id
  http_method   = "GET"
  authorization = "NONE"

  request_parameters = {
    "method.request.querystring.input_type" = false
  }
}

resource "aws_api_gateway_integration" "operations_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.operations.id
  http_method             = aws_api_gateway_method.operations_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["list_operations"].invoke_arn
}

# Least Privilege: permission is scoped to this specific API Gateway. We use
# local.api_execution_arn (explicitly built from account + region + api id)
# instead of aws_api_gateway_rest_api.superdoc.execution_arn because the
# provider has a drift bug in execution_arn — see Round 1 troubleshooting.
resource "aws_lambda_permission" "list_operations" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["list_operations"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "operations_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "operations_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.operations.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "operations_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "operations_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "operations_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.operations.id
  http_method = aws_api_gateway_method.operations_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  # depends_on defensively prevents the race we hit in the first deploy
  # where integration_response ran before its method_response/integration
  # existed — see Round 1 handoff for details.
  depends_on = [
    aws_api_gateway_integration.operations_options,
    aws_api_gateway_method_response.operations_options_200,
  ]
}



# ── /checkout route (added by round 3a-2) ───────────────────────────────────
# POST /checkout creates a Stripe Checkout Session. No auth - the price id
# controls what's being charged, so anyone can initiate checkout (but Stripe
# collects the actual payment, so misuse is self-limiting).

resource "aws_api_gateway_resource" "checkout" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "checkout"
}

resource "aws_api_gateway_method" "checkout_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.checkout.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "checkout_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.checkout.id
  http_method             = aws_api_gateway_method.checkout_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["stripe_create_checkout"].invoke_arn
}

resource "aws_lambda_permission" "stripe_create_checkout" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["stripe_create_checkout"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "checkout_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.checkout.id
  http_method = aws_api_gateway_method.checkout_post.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "checkout_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.checkout.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "checkout_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.checkout.id
  http_method = aws_api_gateway_method.checkout_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "checkout_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.checkout.id
  http_method = aws_api_gateway_method.checkout_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "checkout_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.checkout.id
  http_method = aws_api_gateway_method.checkout_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.checkout_options,
    aws_api_gateway_method_response.checkout_options_200,
  ]
}



# ── /stripe/webhook route (added by round 3a-2) ─────────────────────────────
# POST /stripe/webhook receives Stripe events. No auth and no CORS because
# Stripe's servers call this directly - never a browser. Signature lives in
# the body and is verified in the Lambda itself.

resource "aws_api_gateway_resource" "stripe" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "stripe"
}

resource "aws_api_gateway_resource" "stripe_webhook" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.stripe.id
  path_part   = "webhook"
}

resource "aws_api_gateway_method" "stripe_webhook_post" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.stripe_webhook.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "stripe_webhook_post" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.stripe_webhook.id
  http_method             = aws_api_gateway_method.stripe_webhook_post.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["stripe_webhook"].invoke_arn
}

resource "aws_lambda_permission" "stripe_webhook" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["stripe_webhook"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "stripe_webhook_post_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.stripe_webhook.id
  http_method = aws_api_gateway_method.stripe_webhook_post.http_method
  status_code = "200"
}



# ── /files/download route (added by round 3a-3) ─────────────────────────────
# GET /files/download?key=<s3_key> returns a presigned GET URL. Auth NONE:
# the key must already be in an allowed prefix (uploads/, users/), and
# that's enforced in the handler. The actual S3 URL is time-limited.

resource "aws_api_gateway_resource" "files" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_rest_api.superdoc.root_resource_id
  path_part   = "files"
}

resource "aws_api_gateway_resource" "files_download" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  parent_id   = aws_api_gateway_resource.files.id
  path_part   = "download"
}

resource "aws_api_gateway_method" "files_download_get" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.files_download.id
  http_method   = "GET"
  authorization = "NONE"

  request_parameters = {
    "method.request.querystring.key" = true
  }
}

resource "aws_api_gateway_integration" "files_download_get" {
  rest_api_id             = aws_api_gateway_rest_api.superdoc.id
  resource_id             = aws_api_gateway_resource.files_download.id
  http_method             = aws_api_gateway_method.files_download_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_integrations["presign_download"].invoke_arn
}

resource "aws_lambda_permission" "presign_download" {
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_integrations["presign_download"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${local.api_execution_arn}/*/*"
}

resource "aws_api_gateway_method_response" "files_download_get_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.files_download.id
  http_method = aws_api_gateway_method.files_download_get.http_method
  status_code = "200"
}

resource "aws_api_gateway_method" "files_download_options" {
  rest_api_id   = aws_api_gateway_rest_api.superdoc.id
  resource_id   = aws_api_gateway_resource.files_download.id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "files_download_options" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.files_download.id
  http_method = aws_api_gateway_method.files_download_options.http_method
  type        = "MOCK"

  request_templates = {
    "application/json" = "{\"statusCode\": 200}"
  }
}

resource "aws_api_gateway_method_response" "files_download_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.files_download.id
  http_method = aws_api_gateway_method.files_download_options.http_method
  status_code = "200"

  response_parameters = local.cors_response_parameters
}

resource "aws_api_gateway_integration_response" "files_download_options_200" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id
  resource_id = aws_api_gateway_resource.files_download.id
  http_method = aws_api_gateway_method.files_download_options.http_method
  status_code = "200"

  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin"  = "'*'"
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,X-Api-Key'"
    "method.response.header.Access-Control-Allow-Methods" = "'GET,POST,DELETE,OPTIONS'"
  }

  depends_on = [
    aws_api_gateway_integration.files_download_options,
    aws_api_gateway_method_response.files_download_options_200,
  ]
}


resource "aws_api_gateway_deployment" "superdoc" {
  rest_api_id = aws_api_gateway_rest_api.superdoc.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.files.id,
      aws_api_gateway_resource.files_download.id,
      aws_api_gateway_method.files_download_get.id,
      aws_api_gateway_integration.files_download_get.id,
      aws_api_gateway_resource.checkout.id,
      aws_api_gateway_method.checkout_post.id,
      aws_api_gateway_integration.checkout_post.id,
      aws_api_gateway_resource.stripe.id,
      aws_api_gateway_resource.stripe_webhook.id,
      aws_api_gateway_method.stripe_webhook_post.id,
      aws_api_gateway_integration.stripe_webhook_post.id,
      aws_api_gateway_resource.operations.id,
      aws_api_gateway_method.operations_get.id,
      aws_api_gateway_integration.operations_get.id,
      aws_api_gateway_rest_api.superdoc.body,
      aws_api_gateway_resource.health.id,
      aws_api_gateway_method.health_get.id,
      aws_api_gateway_integration.health_mock.id,
      aws_api_gateway_gateway_response.throttle.id,
      aws_api_gateway_resource.jobs.id,
      aws_api_gateway_method.jobs_post.id,
      aws_api_gateway_integration.jobs_post.id,
      aws_api_gateway_resource.job_id.id,
      aws_api_gateway_method.job_id_get.id,
      aws_api_gateway_integration.job_id_get.id,
      aws_api_gateway_resource.job_process.id,
      aws_api_gateway_method.job_process_post.id,
      aws_api_gateway_integration.job_process_post.id,
      aws_api_gateway_resource.users_me_files.id,
      aws_api_gateway_method.users_me_files_get.id,
      aws_api_gateway_integration.users_me_files_get.id,
      aws_api_gateway_method.users_me_files_post.id,
      aws_api_gateway_integration.users_me_files_post.id,
      aws_api_gateway_resource.users_me_files_job.id,
      aws_api_gateway_method.users_me_files_job_delete.id,
      aws_api_gateway_integration.users_me_files_job_delete.id,
      aws_api_gateway_resource.users_me_files_job_complete.id,
      aws_api_gateway_method.users_me_files_job_complete_post.id,
      aws_api_gateway_integration.users_me_files_job_complete_post.id,
      aws_api_gateway_resource.users_me_jobs.id,
      aws_api_gateway_method.users_me_jobs_post.id,
      aws_api_gateway_integration.users_me_jobs_post.id,
      aws_api_gateway_resource.admin_flags.id,
      aws_api_gateway_method.admin_flags_get.id,
      aws_api_gateway_integration.admin_flags_get.id,
      aws_api_gateway_method.admin_flags_post.id,
      aws_api_gateway_integration.admin_flags_post.id,
      aws_api_gateway_resource.admin_incidents.id,
      aws_api_gateway_method.admin_incidents_get.id,
      aws_api_gateway_integration.admin_incidents_get.id,
      aws_api_gateway_method.admin_incidents_post.id,
      aws_api_gateway_integration.admin_incidents_post.id,
      aws_api_gateway_authorizer.cognito.id,
    ]))
  }

  depends_on = [
    aws_api_gateway_integration.health_mock,
    aws_api_gateway_integration.files_download_get,
    aws_api_gateway_integration_response.files_download_options_200,
    aws_api_gateway_integration.checkout_post,
    aws_api_gateway_integration_response.checkout_options_200,
    aws_api_gateway_integration.stripe_webhook_post,
    aws_api_gateway_integration.operations_get,
    aws_api_gateway_integration_response.operations_options_200,
    aws_api_gateway_integration_response.health_200,
    aws_api_gateway_method_response.health_200,
    aws_api_gateway_integration.jobs_post,
    aws_api_gateway_integration.job_id_get,
    aws_api_gateway_integration.job_process_post,
    aws_api_gateway_integration.users_me_files_get,
    aws_api_gateway_integration.users_me_files_post,
    aws_api_gateway_integration.users_me_files_job_delete,
    aws_api_gateway_integration.users_me_files_job_complete_post,
    aws_api_gateway_integration.users_me_jobs_post,
    aws_api_gateway_integration.admin_flags_get,
    aws_api_gateway_integration.admin_flags_post,
    aws_api_gateway_integration.admin_incidents_get,
    aws_api_gateway_integration.admin_incidents_post,
    aws_api_gateway_integration_response.jobs_options_200,
    aws_api_gateway_integration_response.job_id_options_200,
    aws_api_gateway_integration_response.job_process_options_200,
    aws_api_gateway_integration_response.users_me_files_options_200,
    aws_api_gateway_integration_response.users_me_files_job_options_200,
    aws_api_gateway_integration_response.users_me_files_job_complete_options_200,
    aws_api_gateway_integration_response.users_me_jobs_options_200,
    aws_api_gateway_integration_response.admin_flags_options_200,
    aws_api_gateway_integration_response.admin_incidents_options_200,
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
