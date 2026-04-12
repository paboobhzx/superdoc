output "user_pool_id" { value = aws_cognito_user_pool.superdoc.id }
output "client_id" { value = aws_cognito_user_pool_client.superdoc_web.id }
output "user_pool_arn" { value = aws_cognito_user_pool.superdoc.arn }
