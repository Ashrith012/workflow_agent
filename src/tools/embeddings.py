"""Text embeddings over any OpenAI-compatible provider in config/models.json."""
import asyncio
import hashlib
import logging
import math
import os
import re
from typing import Any, Dict, List

BATCH_SIZE = 100
RATE_LIMIT_RETRIES = 8
logger = logging.getLogger("agent")


def retry_delay(err: Exception) -> float:
    """Seconds the provider asked us to wait (Gemini: 'Please retry in 6.1s' / retryDelay '6s'), else 20."""
    match = re.search(r"retry in ([\d.]+)s|'retryDelay': '(\d+)s'", str(err))
    seconds = float(match.group(1) or match.group(2)) if match else 20.0
    return min(max(seconds, 1.0), 65.0) + 1.0


class EmbeddingsError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class EmbeddingsTool:
    """Embeds lists of texts. `catalog` is the parsed config/models.json."""

    def __init__(self, catalog: Dict[str, Any], timeout: float = 60):
        self.catalog = catalog
        self.timeout = timeout

    def resolve(self, model: str) -> tuple[str, str, int]:
        """Returns (provider, model id, dimensions) for `<provider>:<model id>`; blank uses the catalog default."""
        value = model or self.catalog["default_embedding_model"]
        if ":" not in value:
            raise EmbeddingsError(f"Embedding model '{value}' must look like '<provider>:<model id>'.")
        provider, model_id = value.split(":", 1)
        for entry in self.catalog.get("embedding_models", {}).get(provider, []):
            if entry["id"] == model_id:
                return provider, model_id, int(entry["dimensions"])
        known = ", ".join(
            f"{p}:{m['id']}" for p, models in self.catalog.get("embedding_models", {}).items() for m in models
        )
        raise EmbeddingsError(f"Unknown embedding model '{value}'. Known models: {known}.")

    async def embed(self, texts: List[str], model: str = "", live: bool = True) -> Dict[str, Any]:
        provider, model_id, dimensions = self.resolve(model)
        if not live:
            return {"model": f"{provider}:{model_id}", "dimensions": dimensions, "vectors": [mock_vector(t, dimensions) for t in texts]}

        spec = self.catalog["providers"].get(provider)
        if spec is None:
            raise EmbeddingsError(f"Provider '{provider}' has no entry under 'providers' in config/models.json.")
        # A self-hosted provider (Ollama) has no api_key_env and needs no key; OpenAI clients
        # still require some value, so it gets a placeholder.
        key_env = spec.get("api_key_env")
        api_key = os.getenv(key_env) if key_env else "self-hosted"
        if not api_key:
            raise EmbeddingsError(f"{key_env} is not set; add it to .env and restart the agent service, or run in mock mode.")
        # `base_url_env` lets a self-hosted endpoint move without editing the catalog.
        url_env = spec.get("base_url_env")
        base_url = (url_env and os.getenv(url_env)) or spec["base_url"]

        from openai import AsyncOpenAI, RateLimitError

        # The SDK retries transient 5xx; 429s are handled below with the provider's own retry delay
        # (free tiers allow ~100 texts/minute, so large ingestion runs wait out each window).
        client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=self.timeout, max_retries=2)
        vectors: List[List[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            # The API rejects empty strings; a single space embeds to a neutral vector.
            batch = [t if t.strip() else " " for t in texts[start : start + BATCH_SIZE]]
            for attempt in range(RATE_LIMIT_RETRIES + 1):
                try:
                    response = await client.embeddings.create(model=model_id, input=batch)
                    break
                except RateLimitError as err:
                    # A per-day quota will not recover by waiting; surface it.
                    if attempt == RATE_LIMIT_RETRIES or "PerDay" in str(err):
                        raise
                    delay = retry_delay(err)
                    logger.info("embedding rate limit; retrying in %.0fs (attempt %d)", delay, attempt + 1)
                    await asyncio.sleep(delay)
            # OpenAI sets `index` on each item; Gemini's compatible endpoint leaves it null and keeps input order.
            data = response.data
            if all(item.index is not None for item in data):
                data = sorted(data, key=lambda d: d.index)
            if len(data) != len(batch):
                raise EmbeddingsError(f"The provider returned {len(data)} embeddings for {len(batch)} texts.", 502)
            vectors.extend(item.embedding for item in data)
        return {"model": f"{provider}:{model_id}", "dimensions": dimensions, "vectors": vectors}


def mock_vector(text: str, dimensions: int) -> List[float]:
    """Deterministic unit vector, so mock runs give stable, comparable results."""
    seed = hashlib.sha256(text.encode("utf-8")).digest()
    values = [((seed[i % len(seed)] + i * 31) % 256) / 255.0 - 0.5 for i in range(dimensions)]
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]
