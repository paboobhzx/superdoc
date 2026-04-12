# Cognito is created but NOT enforced — auth is optional for now.
# The API Gateway does not require Cognito tokens yet.
# When ready to enforce, add a CognitoUserPoolsAuthorizer to API Gateway.

resource "aws_cognito_user_pool" "superdoc" {
  name = "${var.name_prefix}-users"
  tags = var.common_tags

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    require_uppercase                = false
    temporary_password_validity_days = 7
  }

  auto_verified_attributes = ["email"]

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # No username — sign in with email only
  username_attributes = ["email"]
  username_configuration {
    case_sensitive = false
  }
}

resource "aws_cognito_user_pool_client" "superdoc_web" {
  name         = "${var.name_prefix}-web-client"
  user_pool_id = aws_cognito_user_pool.superdoc.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  access_token_validity  = 60 # minutes
  id_token_validity      = 60
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
