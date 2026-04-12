output "table_name" { value = aws_dynamodb_table.jobs.name }
output "table_arn" { value = aws_dynamodb_table.jobs.arn }
output "api_keys_name" { value = aws_dynamodb_table.api_keys.name }
output "api_keys_arn" { value = aws_dynamodb_table.api_keys.arn }
output "incidents_name" { value = aws_dynamodb_table.incidents.name }
output "incidents_arn" { value = aws_dynamodb_table.incidents.arn }
output "rate_limits_name" { value = aws_dynamodb_table.rate_limits.name }
output "rate_limits_arn" { value = aws_dynamodb_table.rate_limits.arn }
