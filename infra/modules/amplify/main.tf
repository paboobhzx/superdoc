resource "aws_amplify_app" "superdoc" {
  name        = var.app_name != "" ? var.app_name : "${var.name_prefix}-frontend"
  repository  = var.repository != "" ? var.repository : null
  oauth_token = var.oauth_token != "" ? var.oauth_token : null
  tags        = var.common_tags

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - cd frontend
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: frontend/dist
        files:
          - '**/*'
      cache:
        paths:
          - frontend/node_modules/**/*
  EOT

  environment_variables = {
    VITE_API_URL              = var.api_url
    VITE_ENV                  = var.environment
    VITE_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    VITE_COGNITO_CLIENT_ID    = var.cognito_client_id
  }

  custom_rule {
    source = "/<*>"
    status = "404-200"
    target = "/index.html"
  }
}

resource "aws_amplify_branch" "main" {
  app_id           = aws_amplify_app.superdoc.id
  branch_name      = "main"
  enable_auto_build = true
  tags             = var.common_tags

  environment_variables = {
    VITE_API_URL              = var.api_url
    VITE_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
    VITE_COGNITO_CLIENT_ID    = var.cognito_client_id
  }
}
