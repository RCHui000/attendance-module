import json
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

from app.storage import get_agent_settings


@dataclass
class BalanceSnapshot:
    balance: float | None
    currency: str = ""
    provider: str = ""
    error: str = ""


def fetch_agent_balance() -> BalanceSnapshot:
    """Fetch provider balance for the configured OpenAI-compatible agent.

    DeepSeek exposes GET /user/balance outside the /v1 path. Other providers may
    not support this API; callers should treat a missing balance as non-fatal.
    """
    settings = get_agent_settings()
    if not settings.api_key:
        return BalanceSnapshot(balance=None, provider=_provider_from_base(settings.api_base), error="agent api key is not configured")

    provider = _provider_from_base(settings.api_base)
    balance_url = _balance_url(settings.api_base)
    request = urllib.request.Request(
        balance_url,
        headers={
            "Authorization": f"Bearer {settings.api_key}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return _parse_balance(payload, provider)
    except Exception as exc:
        return BalanceSnapshot(balance=None, provider=provider, error=f"{type(exc).__name__}: {exc}")


def _balance_url(api_base: str) -> str:
    parsed = urlparse(api_base)
    if not parsed.scheme or not parsed.netloc:
        return api_base.rstrip("/") + "/user/balance"
    return f"{parsed.scheme}://{parsed.netloc}/user/balance"


def _provider_from_base(api_base: str) -> str:
    netloc = urlparse(api_base).netloc or api_base
    if "deepseek" in netloc:
        return "deepseek"
    if "openai" in netloc:
        return "openai"
    return netloc.replace("api.", "").split("/")[0]


def _parse_balance(payload: dict, provider: str) -> BalanceSnapshot:
    infos = payload.get("balance_infos")
    if isinstance(infos, list) and infos:
        info = infos[0] or {}
        raw_balance = info.get("total_balance")
        currency = str(info.get("currency") or "")
        return BalanceSnapshot(balance=_to_float(raw_balance), currency=currency, provider=provider)

    for key in ("total_balance", "balance", "credit_grants"):
        if key in payload:
            return BalanceSnapshot(balance=_to_float(payload.get(key)), currency=str(payload.get("currency") or ""), provider=provider)

    return BalanceSnapshot(balance=None, provider=provider, error="balance field not found in provider response")


def _to_float(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
