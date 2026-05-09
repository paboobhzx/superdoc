import json
import os

import auth_session
import response
import ssm
from logger import get_logger

log = get_logger(__name__)

_STRIPE_SECRET_PARAM = "/superdoc/stripe/secret_key"

# Fixed tier amounts (cents) → credits awarded.
# Override per tier via env vars before credits amounts are finalised.
_TIERS = {
    200:  int(os.environ.get("CREDITS_TIER_200",  "2")),
    500:  int(os.environ.get("CREDITS_TIER_500",  "5")),
    1000: int(os.environ.get("CREDITS_TIER_1000", "10")),
    5000: int(os.environ.get("CREDITS_TIER_5000", "50")),
}

_TIER_LABELS = {
    200:  "Starter",
    500:  "Supporter",
    1000: "Champion",
    5000: "Huge Donation",
}

_CUSTOM_MIN_CENTS = 100      # $1
_CUSTOM_MAX_CENTS = 100_000  # $1 000


def _credits_for(amount_cents: int) -> int:
    if amount_cents in _TIERS:
        return _TIERS[amount_cents]
    # Custom: 1 credit per dollar, minimum 1
    return max(1, amount_cents // 100)


def handler(event, context):
    if event.get("httpMethod") == "OPTIONS":
        return response.preflight()

    try:
        user = auth_session.current_user(event)
        user_id = user.get("user_id") or ""
        if not user_id:
            return response.error("Sign in required", 401)

        body = json.loads(event.get("body") or "{}")
        success_url = (body.get("success_url") or "").strip()
        cancel_url = (body.get("cancel_url") or "").strip()

        try:
            amount_cents = int(body.get("amount_cents") or 0)
        except (TypeError, ValueError):
            return response.error("amount_cents must be an integer", 400)

        if not success_url or not cancel_url:
            return response.error("success_url and cancel_url required", 400)

        if amount_cents in _TIERS:
            pass  # fixed tier
        elif _CUSTOM_MIN_CENTS <= amount_cents <= _CUSTOM_MAX_CENTS:
            pass  # valid custom amount
        else:
            return response.error(
                f"Invalid amount. Use one of {sorted(_TIERS.keys())} cents "
                f"or a custom amount between {_CUSTOM_MIN_CENTS} and {_CUSTOM_MAX_CENTS} cents.",
                400,
            )

        credits_delta = _credits_for(amount_cents)
        label = _TIER_LABELS.get(amount_cents, "Custom Donation")

        try:
            stripe_secret = ssm.get_parameter(_STRIPE_SECRET_PARAM, decrypt=True)
        except Exception as exc:
            log.exception("stripe secret lookup failed: %s", exc)
            return response.error("Payments not configured", 503)

        if "REPLACE_ME" in stripe_secret:
            return response.error("Payments not configured", 503)

        import stripe as _stripe

        _stripe.api_key = stripe_secret
        session = _stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "usd",
                        "unit_amount": amount_cents,
                        "product_data": {
                            "name": f"SuperDoc — {label}",
                            "description": f"{credits_delta} credits",
                        },
                    },
                    "quantity": 1,
                }
            ],
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=user_id,
            customer_email=user.get("email") or None,
            metadata={
                "checkout_type": "credits",
                "user_id": user_id,
                "credits_delta": str(credits_delta),
            },
        )
        return response.ok(
            {
                "checkout_url": session.url,
                "checkout_session_id": session.id,
                "credits_delta": credits_delta,
            }
        )
    except Exception as exc:
        log.exception("billing_create_checkout error: %s", exc)
        return response.error("Internal error", 500)
