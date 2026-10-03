"""LLM configuration for Sentinel Agent Layer."""

from langchain_openai import ChatOpenAI

from app.config import settings
from app.exceptions import UnavailableError


def require_llm() -> None:
    """Refuse an AI request up front when no model key is configured.

    Without this, a missing QWEN_API_KEY surfaced as an OpenAI "missing credentials"
    500 deep inside the agent — after a meeting row had already been written and
    marked failed. Callers check before they create anything.
    """
    if not settings.qwen_api_key.strip():
        raise UnavailableError("The AI model is not configured on this server (QWEN_API_KEY).")


def get_llm(temperature: float = 0.1) -> ChatOpenAI:
    """Instantiate the ChatOpenAI client pointing to the Qwen API endpoint."""
    require_llm()
    return ChatOpenAI(
        model=settings.agent_model,
        api_key=settings.qwen_api_key,
        base_url=settings.qwen_api_base,
        temperature=temperature,
        max_retries=2,
    )
