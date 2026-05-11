# ── Cognito user pool + SES email verification ────────────────────────────────

module "cognito" {
  source         = "./modules/cognito"
  name_prefix    = local.name_prefix
  common_tags    = local.common_tags
  ses_source_arn = data.aws_ses_domain_identity.pablobhz.arn
}

# ── SES: DKIM CNAME records for pablobhz.cloud ────────────────────────────────
# Tokens already exist in SES (generated when domain was first verified).
# These CNAMEs enable DKIM signing so email from noreply@pablobhz.cloud
# passes inbox filters and doesn't land in spam.

data "aws_ses_domain_identity" "pablobhz" {
  domain = "pablobhz.cloud"
}

resource "aws_route53_record" "ses_dkim" {
  for_each = toset([
    "coeczbhc76at5nald6v7ivf3mlqbrvwj",
    "roinmheddkv5joopihufptgulmj5umxs",
    "7dtr3gk4wl5j7nonqzafy25n2jptehje",
  ])

  zone_id = "Z00715662A3EPIVLR1LS"
  name    = "${each.value}._domainkey.pablobhz.cloud"
  type    = "CNAME"
  ttl     = 300
  records = ["${each.value}.dkim.amazonses.com"]
}
