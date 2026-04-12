resource "aws_amplify_app" "superdoc" {
  name       = "${var.name_prefix}-frontend"
  repository = var.github_repo
  tags       = var.common_tags

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
    VITE_API_URL = var.api_url
    VITE_ENV     = var.environment
  }

  # Redirect all routes to index.html for SPA
  custom_rule {
    source = "/<*>"
    status = "404-200"
    target = "/index.html"
  }
}

resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.superdoc.id
  branch_name = "main"
  tags        = var.common_tags

  environment_variables = {
    VITE_API_URL = var.api_url
  }
}
