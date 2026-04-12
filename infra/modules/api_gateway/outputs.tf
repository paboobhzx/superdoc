output "rest_api_id" { value = aws_api_gateway_rest_api.superdoc.id }
output "invoke_url" { value = aws_api_gateway_stage.superdoc.invoke_url }
output "execution_arn" { value = aws_api_gateway_rest_api.superdoc.execution_arn }
output "root_resource_id" { value = aws_api_gateway_rest_api.superdoc.root_resource_id }
output "stage_name" { value = aws_api_gateway_stage.superdoc.stage_name }
