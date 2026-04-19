# handlers/stripe_webhook.py - POST /stripe/webhook
#
# Receives events from Stripe. We ONLY care about checkout.session.completed.
# When one fires, we:
#   1. Verify the signature using webhook_secret (Stripe requires this).
#   2. Extract client_reference_id (our payment_id).
#   3. Mark the payment as PAID in DynamoDB.
#   4. Push the job to SQS so workers process it.
#
# Signature verification is CRITICAL: without it, anyone who knows the
# endpoint URL could claim a payment happened. stripe.Webhook.construct_event
# raises on any mismatch (timestamp too old, bad signature, malformed body).

import json as _json
import os
import time

import dynamo
import response
import ssm
from logger import get_logger

log = get_logger(__name__)

_PAYMENTS_TABLE = os.environ.get("PAYMENTS_TABLE_NAME", "superdoc-dev-payments")
_STRIPE_SECRET_PARAM = "/superdoc/stripe/secret_key"
_WEBHOOK_SECRET_PARAM = "/superdoc/stripe/webhook_secret"


def _extract_signature(event):
    """Stripe sends the signature header in lowercase or title case; API
    Gateway normalization is inconsistent, so try common variants."""
    headers = event.get("headers") or {}
    for key in ("Stripe-Signature", "stripe-signature", "STRIPE-SIGNATURE"):
        if key in headers:
            return headers[key]
    # multiValueHeaders fallback
    mvh = event.get("multiValueHeaders") or {}
    for key in ("Stripe-Signature", "stripe-signature"):
        if key in mvh and mvh[key]:
            return mvh[key][0]
    return ""


def _process_completed_session(session):
    """Handle checkout.session.completed - the only event we act on."""
    payment_id = session.get("client_reference_id")
    if not payment_id:
        log.warning("checkout.session.completed without client_reference_id")
        return

    # Pull the payment record we created when the Checkout Session started.
    # If it\'s missing, something desync\'d (manual deletion, expired TTL) and
    # we log but don\'t fail the webhook - Stripe will retry otherwise.
    payment = dynamo.get_payment(_PAYMENTS_TABLE, payment_id)
    if not payment:
        log.warning("Payment record not found", extra={"payment_id": payment_id})
        return

    if payment.get("status") == "PAID":
        log.info("Payment already marked PAID, skipping duplicate",
                 extra={"payment_id": payment_id})
        return

    # Mark PAID. We don\'t create the backend job here because the file
    # hasn\'t been uploaded yet - frontend will call a separate endpoint
    # after checkout.success_url to claim the payment and kick off upload.
    # (Script 3a-3 adds the frontend claim flow.)
    dynamo.update_payment_status(_PAYMENTS_TABLE, payment_id, "PAID")
    log.info("Payment marked PAID", extra={
        "payment_id": payment_id,
        "job_id": payment.get("job_id"),
        "operation": payment.get("operation"),
    })


def handler(event, context):
    try:
        # Stripe wants the RAW body to verify the signature - API Gateway
        # passes it through untouched when content-type is application/json,
        # which is what Stripe sends.
        raw_body = event.get("body") or ""
        signature = _extract_signature(event)

        if not signature:
            log.warning("Webhook received without Stripe-Signature header")
            return response.error("Missing signature", 400)

        try:
            webhook_secret = ssm.get_parameter(_WEBHOOK_SECRET_PARAM, decrypt=True)
        except Exception as exc:
            log.exception("Webhook secret unreachable: %s", exc)
            return response.error("Payments not configured", 503)

        if "REPLACE_ME" in webhook_secret:
            return response.error("Payments not configured", 503)

        # Lazy import so the cold-start cost of stripe is only paid here.
        import stripe as _stripe
        try:
            stripe_event = _stripe.Webhook.construct_event(
                payload=raw_body,
                sig_header=signature,
                secret=webhook_secret,
            )
        except _stripe.error.SignatureVerificationError as exc:
            log.warning("Signature verification failed: %s", exc)
            return response.error("Invalid signature", 400)
        except Exception as exc:
            log.exception("Webhook parse failed: %s", exc)
            return response.error("Bad webhook payload", 400)

        event_type = stripe_event.get("type")

        if event_type == "checkout.session.completed":
            session = stripe_event["data"]["object"]
            _process_completed_session(session)
        else:
            # Not an error - Stripe sends lots of events we don\'t subscribe
            # to. Log and ack so Stripe doesn\'t retry.
            log.info("Ignoring event type", extra={"type": event_type})

        # Stripe needs a 2xx for any event we accept. Body is ignored.
        return response.ok({"received": True})

    except Exception as exc:
        log.exception("stripe_webhook error: %s", exc)
        # Returning 500 means Stripe will retry with exponential backoff,
        # which is what we want for transient infra failures.
        return response.error("Internal error", 500)
