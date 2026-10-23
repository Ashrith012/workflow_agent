"""Unit tests for agent router and FastAPI endpoints."""
from fastapi.testclient import TestClient
from src.main import app
from src.agent.router import AgentRouter

client = TestClient(app)


def test_agent_router_process():
    router = AgentRouter()
    res = router.process("Hello AI", ["web_search"])
    assert res == "Processed by Python Agent: Hello AI"


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "sfn-agent-core"}


def test_models_endpoint_lists_catalog():
    response = client.get("/models")
    assert response.status_code == 200
    providers = response.json()["providers"]
    assert {"groq", "openai"} <= set(providers)
    assert all(p["models"] for p in providers.values())


def test_execute_mock_mode_skips_llm():
    response = client.post(
        "/agent/execute",
        json={"provider": "groq", "model": "openai/gpt-oss-20b", "prompt": "Test prompt", "live": False},
    )
    assert response.status_code == 200
    assert response.json()["text"] == "[mock Groq openai/gpt-oss-20b] Processed by Python Agent: Test prompt"


def test_execute_accepts_provider_prefixed_model():
    response = client.post("/agent/execute", json={"model": "openai:gpt-4o", "prompt": "Hi", "live": False})
    assert response.status_code == 200
    assert response.json()["text"].startswith("[mock OpenAI gpt-4o]")


def test_execute_unknown_provider_is_rejected():
    response = client.post("/agent/execute", json={"provider": "nope", "prompt": "Hi"})
    assert response.status_code == 400
    assert "Known providers" in response.json()["detail"]


def test_execute_live_without_api_key_is_rejected(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    response = client.post("/agent/execute", json={"provider": "groq", "prompt": "Hi"})
    assert response.status_code == 400
    assert "GROQ_API_KEY is not set" in response.json()["detail"]
