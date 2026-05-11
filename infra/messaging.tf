# ── SQS queue for async job dispatch ─────────────────────────────────────────

module "sqs" {
  source           = "./modules/sqs"
  name_prefix      = local.name_prefix
  common_tags      = local.common_tags
  alerts_topic_arn = module.monitoring.alerts_topic_arn
}
