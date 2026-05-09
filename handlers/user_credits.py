import auth_session
import dynamo
import limits
import response
from logger import get_logger

log = get_logger(__name__)


def handler(event, context):
    try:
        if event.get("httpMethod") == "OPTIONS":
            return response.preflight()

        user = auth_session.current_user(event)
        user_id = user.get("user_id") or ""
        if not user_id:
            return response.error("Sign in required", 401)

        balance = dynamo.get_credit_balance(user_id)
        events = dynamo.list_credit_events(user_id, limit=10)
        return response.ok(
            {
                "balance": balance.get("balance", 0),
                "free_multimedia_remaining_today": limits.multimedia_free_remaining(user_id),
                "recent_events": events,
            }
        )
    except Exception as exc:
        log.exception("user_credits error: %s", exc)
        return response.error("Internal error", 500)
