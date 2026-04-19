# handlers/stripe_create_checkout.py - POST /checkout
#
# Creates a Stripe Checkout Session for a single conversion. The session
# references a pre-created DynamoDB "payment" record whose id we pass to
# Stripe as client_reference_id. When the webhook fires later, we look up
# the payment by id to know what job to start.
#
# Request body:
#   operation:        str (must be a known operation id)
#   file_size_bytes:  int
#   file_name:        str
#   session_id:       str (anonymous session) OR user is authenticated
#   success_url:      str (where Stripe sends user after payment)
#   cancel_url:       str
#
# Response:
#   { payment_id, checkout_url, job_id }
#
# The job is NOT created yet - we only have a payment intent. The webhook
# creates the job after payment confirms. This avoids leaking free
# conversions when users abandon checkout.

import json as _json
import os
import uuid

import dynamo
import operations
import response
import ssm
from logger import get_logger

log = get_logger(__name__)

_PAYMENTS_TABLE = os.environ.get("PAYMENTS_TABLE_NAME", "superdoc-dev-payments")
_STRIPE_SECRET_PARAM = "/superdoc/stripe/secret_key"
_STRIPE_PRICE_PARAM = "/superdoc/stripe/price_id_conversion"
_PAYMENT_TTL_SECONDS = 24 * 3600


def _claims(event):
    return (
        (event.get("requestContext") or {})
        .get("authorizer", {})
        .get("claims", {})
    ) or {}


def handler(event, context):
    """Create a Stripe Checkout Session tied to a pending payment record.

    We deliberately use lazy imports for `stripe` so that cold starts for
    other handlers sharing the python_deps layer are not paid this cost
    unnecessarily.
    """
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        body = _json.loads(event.get("body") or "{}")
        operation = body.get("operation", "")
        file_name = body.get("file_name", "file")
        file_size_bytes = int(body.get("file_size_bytes", 0))
        session_id = body.get("session_id", "anon")
        success_url = body.get("success_url") or ""
        cancel_url = body.get("cancel_url") or ""

        user_id = _claims(event).get("sub") or ""
        if user_id:
            session_id = user_id

        if not operations.is_supported(operation):
            return response.error("Unsupported operation", 400)

        if file_size_bytes <= 0:
            return response.error("file_size_bytes must be > 0", 400)

        if not success_url or not cancel_url:
            return response.error("success_url and cancel_url required", 400)

        # Fetch Stripe config from SSM. If placeholders are still in place
        # (e.g. "REPLACE_ME"), we short-circuit and return 503 so the
        # frontend can surface "not configured yet" rather than a cryptic
        # Stripe error.
        try:
            stripe_secret = ssm.get_parameter(_STRIPE_SECRET_PARAM, decrypt=True)
            price_id = ssm.get_parameter(_STRIPE_PRICE_PARAM, decrypt=False)
        except Exception as exc:
            log.exception("SSM fetch failed: %s", exc)
            return response.error("Payments not configured", 503)

        if "REPLACE_ME" in stripe_secret or "REPLACE_ME" in price_id:
            return response.error("Payments not configured", 503)

        # Create a pending payment record FIRST. We pass its id to Stripe
        # as client_reference_id; the webhook reads it to finish the flow.
        payment_id = str(uuid.uuid4())
        job_id = str(uuid.uuid4())
        now = int(time.time())  # noqa: F821 (imported below)

        dynamo.put_payment(
            table=_PAYMENTS_TABLE,
            payment_id=payment_id,
            status="PENDING",
            job_id=job_id,
            operation=operation,
            file_name=file_name,
            file_size_bytes=file_size_bytes,
            session_id=session_id,
            ttl=now + _PAYMENT_TTL_SECONDS,
        )

        # Lazy-import stripe. This is the first place in the codebase that
        # uses it, so we keep the dependency out of other handlers' cold
        # starts.
        import stripe as _stripe
        _stripe.api_key = stripe_secret

        checkout_session = _stripe.checkout.Session.create(
            mode="payment",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=payment_id,
            metadata={
                "payment_id": payment_id,
                "job_id": job_id,
                "operation": operation,
                "session_id": session_id,
            },
        )

        log.info("Checkout created", extra={
            "payment_id": payment_id, "job_id": job_id, "operation": operation,
        })
        return response.ok({
            "payment_id": payment_id,
            "job_id": job_id,
            "checkout_url": checkout_session.url,
        })

    except Exception as exc:
        log.exception("stripe_create_checkout error: %s", exc)
        return response.error("Internal error", 500)


# time is imported lazily so the handler stays single-file importable.
import time  # noqa: E402
