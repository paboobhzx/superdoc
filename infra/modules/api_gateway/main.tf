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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
  source_arn    = "${aws_api_gateway_rest_api.superdoc.execution_arn}/*/*"
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
