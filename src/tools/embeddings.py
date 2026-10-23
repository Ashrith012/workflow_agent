"""Text embeddings over any OpenAI-compatible provider in config/models.json."""
import hashlib
import math
import os
from typing import Any, Dict, List

BATCH_SIZE = 100


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
        api_key = os.getenv(spec["api_key_env"])
        if not api_key:
            raise EmbeddingsError(f"{spec['api_key_env']} is not set; add it to .env and restart the agent service, or run in mock mode.")

        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=api_key, base_url=spec["base_url"], timeout=self.timeout)
        vectors: List[List[float]] = []
        for start in range(0, len(texts), BATCH_SIZE):
            # The API rejects empty strings; a single space embeds to a neutral vector.
            batch = [t if t.strip() else " " for t in texts[start : start + BATCH_SIZE]]
            response = await client.embeddings.create(model=model_id, input=batch)
            vectors.extend(item.embedding for item in sorted(response.data, key=lambda d: d.index))
        return {"model": f"{provider}:{model_id}", "dimensions": dimensions, "vectors": vectors}


def mock_vector(text: str, dimensions: int) -> List[float]:
    """Deterministic unit vector, so mock runs give stable, comparable results."""
    seed = hashlib.sha256(text.encode("utf-8")).digest()
    values = [((seed[i % len(seed)] + i * 31) % 256) / 255.0 - 0.5 for i in range(dimensions)]
    norm = math.sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]
