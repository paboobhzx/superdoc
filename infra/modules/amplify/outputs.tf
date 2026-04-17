output "app_id" { value = aws_amplify_app.superdoc.id }
output "app_url" { value = "main.${aws_amplify_app.superdoc.default_domain}" }
