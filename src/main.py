"""FastAPI entry point: `uvicorn src.main:app --reload --port 8000` from the project root."""
import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import httpx
import yaml
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent

# Load the project environment; existing shell variables take precedence.
load_dotenv(ROOT / ".env", override=False)

from .agent.prompts import DEFAULT_SYSTEM_PROMPT  # noqa: E402
from .agent.router import AgentRouter  # noqa: E402
from .tools.embeddings import EmbeddingsError, EmbeddingsTool  # noqa: E402
from .tools.parser import ParserError, parse_document  # noqa: E402
from .tools.qdrant import QdrantError, QdrantTool  # noqa: E402
from .tools.sharepoint import DEFAULT_LIMIT, SharePointError, SharePointTool  # noqa: E402
from .tools.sharepoint_mcp import SharePointMCPError, SharePointMCPTool  # noqa: E402

logger = logging.getLogger("agent")


def load_config() -> Dict[str, Any]:
    path = ROOT / "config" / "agent_config.yaml"
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_models() -> Dict[str, Any]:
    """Provider/model catalog, shared with the workflow UI's AI Agent model picker."""
    with (ROOT / "config" / "models.json").open(encoding="utf-8") as f:
        return json.load(f)


CONFIG = load_config()
AGENT_CONFIG = CONFIG.get("agent", {})
TIMEOUT_S = float(AGENT_CONFIG.get("timeout", 60))
MODELS = load_models()
PROVIDERS: Dict[str, Dict[str, Any]] = MODELS["providers"]
PROMPTS_DIR = ROOT / "config" / "prompts"
TEMPLATE_NAME = re.compile(r"^[A-Za-z0-9_-]+$")


def load_prompt_templates(names: List[str]) -> str:
    """Concatenates config/prompts/<name>.md files, in order. Names are restricted to [A-Za-z0-9_-]."""
    parts = []
    for name in names:
        if not TEMPLATE_NAME.match(name):
            raise HTTPException(status_code=400, detail=f"Invalid prompt template name '{name}'.")
        path = PROMPTS_DIR / f"{name}.md"
        if not path.exists():
            known = ", ".join(sorted(p.stem for p in PROMPTS_DIR.glob("*.md")))
            raise HTTPException(status_code=400, detail=f"Unknown prompt template '{name}'. Known templates: {known}.")
        parts.append(path.read_text(encoding="utf-8").strip())
    return "\n\n".join(parts)

app = FastAPI(
    title="SFN Agent Core",
    description="Dedicated Python AI Agent microservice for workflow engine",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = AgentRouter(CONFIG)
sharepoint = SharePointTool.from_env(timeout=TIMEOUT_S)
sharepoint_mcp = SharePointMCPTool.from_env(timeout=TIMEOUT_S)
qdrant = QdrantTool.from_env(timeout=TIMEOUT_S)
embeddings = EmbeddingsTool(MODELS, timeout=TIMEOUT_S)


class ExecuteRequest(BaseModel):
    provider: Optional[str] = Field(default=None, description="Provider key from config/models.json; may instead prefix the model")
    model: Optional[str] = Field(default=None, description="Model id, or '<provider>:<model id>'")
    prompt: str = Field(description="Interpolated prompt to process")
    tools: Optional[List[str]] = Field(default_factory=lambda: ["web_search"], description="Tools available to agent")
    memory: Optional[str] = Field(default="none", description="Memory type or store reference")
    live: bool = Field(default=True, description="False returns a mock answer without calling the LLM")
    system_prompt: str = Field(default="", description="Extra system instructions, appended after any templates")
    prompt_templates: List[str] = Field(default_factory=list, description="config/prompts/<name>.md files used as the system prompt")
    context: str = Field(default="", description="Retrieved context (e.g. Qdrant chunks) given to the model with the prompt")
    history: List[Dict[str, str]] = Field(default_factory=list, description="Earlier turns: [{role: user|assistant, content}]")
    response_format: Literal["text", "json"] = Field(default="text", description="json asks for and parses a JSON object")


class ExecuteResponse(BaseModel):
    text: str
    json_output: Optional[Any] = Field(default=None, serialization_alias="json")


class SharePointRequest(BaseModel):
    operation: str = Field(description="listFiles, getFile, uploadFile or listItems")
    site_url: str = Field(default="", description="e.g. https://contoso.sharepoint.com/sites/Marketing; defaults to SHAREPOINT_SITE_URL")
    path: str = Field(default="", description="Folder (listFiles) or file path (getFile, uploadFile) in the library")
    library: str = Field(default="", description="Document library name; the site's default library when empty")
    list_name: str = Field(default="", description="List name or id (listItems)")
    content: str = Field(default="", description="Text to write (uploadFile)")
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=5000, description="Max files or items returned")
    live: bool = Field(default=True, description="False returns mock data without calling SharePoint")


def resolve_model(provider: Optional[str], model: Optional[str]) -> tuple[str, str]:
    """Returns (provider, model id). Accepts `groq` + `openai/gpt-oss-20b` or `groq:openai/gpt-oss-20b`."""
    if model and ":" in model and not provider:
        provider, model = model.split(":", 1)
    if not provider:
        provider, model = MODELS["default_model"].split(":", 1)
    provider = provider.strip().lower()
    spec = PROVIDERS.get(provider)
    if spec is None:
        known = ", ".join(PROVIDERS)
        raise HTTPException(status_code=400, detail=f"Unknown provider '{provider}'. Known providers: {known}.")
    return provider, model or spec["models"][0]["id"]


def build_messages(payload: "ExecuteRequest") -> List[Dict[str, str]]:
    system = "\n\n".join(
        part for part in (load_prompt_templates(payload.prompt_templates), payload.system_prompt.strip()) if part
    ) or DEFAULT_SYSTEM_PROMPT
    if payload.response_format == "json":
        system += "\n\nRespond with a single JSON object only, no prose or code fences."
    messages = [{"role": "system", "content": system}]
    messages += [
        {"role": turn["role"], "content": turn.get("content", "")}
        for turn in payload.history
        if turn.get("role") in ("user", "assistant")
    ]
    user = payload.prompt
    if payload.context.strip():
        user = f"Retrieved knowledge source context:\n{payload.context}\n\nRequest:\n{payload.prompt}"
    messages.append({"role": "user", "content": user})
    return messages


def parse_json_reply(text: str) -> Any:
    """Parses the model's JSON reply, tolerating a ```json fence or prose around the object."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        return json.loads(cleaned)
    except ValueError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except ValueError:
                pass
    raise HTTPException(status_code=502, detail=f"The model did not return valid JSON: {text[:300]}")


async def chat(provider: str, api_key: str, model: str, messages: List[Dict[str, str]], json_mode: bool = False) -> str:
    from openai import AsyncOpenAI

    # Every catalog provider speaks the OpenAI chat-completions API at its own base_url.
    client = AsyncOpenAI(api_key=api_key, base_url=PROVIDERS[provider]["base_url"], timeout=TIMEOUT_S)
    kwargs: Dict[str, Any] = {}
    if "temperature" in AGENT_CONFIG:
        kwargs["temperature"] = AGENT_CONFIG["temperature"]
    # Providers without OpenAI's json_object mode rely on the system prompt's JSON instruction + parse_json_reply.
    if json_mode and PROVIDERS[provider].get("json_object_mode", True):
        kwargs["response_format"] = {"type": "json_object"}
    response = await client.chat.completions.create(model=model, messages=messages, **kwargs)
    return response.choices[0].message.content or ""


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "sfn-agent-core"}


@app.get("/models")
def list_models():
    """The catalog, plus whether each provider's API key is configured."""
    return {
        "default_model": MODELS["default_model"],
        "providers": {
            key: {
                "label": spec["label"],
                "configured": bool(os.getenv(spec["api_key_env"])),
                "models": spec["models"],
            }
            for key, spec in PROVIDERS.items()
        },
    }


@app.post("/agent/execute", response_model=ExecuteResponse, response_model_by_alias=True)
async def execute_agent(payload: ExecuteRequest):
    provider, model = resolve_model(payload.provider, payload.model)
    spec = PROVIDERS[provider]
    tools = payload.tools or []

    messages = build_messages(payload)  # validates template names in mock mode too
    if not payload.live:
        text = f"[mock {spec['label']} {model}] {router.process(payload.prompt, tools)}"
        if payload.response_format == "json":
            mock = {"mock": True, "blocks": [{"type": "markdown", "title": "Mock response", "text": text}]}
            return ExecuteResponse(text=json.dumps(mock), json_output=mock)
        return ExecuteResponse(text=text)

    api_key = os.getenv(spec["api_key_env"])
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail=f"{spec['api_key_env']} is not set; add it to .env and restart the agent service, or run in mock mode.",
        )

    json_mode = payload.response_format == "json"
    try:
        text = await chat(provider, api_key, model, messages, json_mode=json_mode)
    except Exception as err:
        logger.warning("%s call with model %s failed: %s", spec["label"], model, err)
        raise HTTPException(status_code=502, detail=f"{spec['label']} API error: {err}")
    return ExecuteResponse(text=text, json_output=parse_json_reply(text) if json_mode else None)


@app.get("/prompts")
def list_prompts():
    return {"templates": sorted(p.stem for p in PROMPTS_DIR.glob("*.md"))}


@app.post("/connectors/sharepoint")
async def sharepoint_connector(payload: SharePointRequest) -> Dict[str, Any]:
    try:
        return await sharepoint.run(**payload.model_dump())
    except SharePointError as err:
        raise HTTPException(status_code=err.status_code, detail=str(err))
    except httpx.HTTPError as err:
        logger.warning("SharePoint %s request failed: %s", payload.operation, err)
        raise HTTPException(status_code=502, detail=f"SharePoint request failed: {err}")


def tool_error(err: Exception) -> HTTPException:
    return HTTPException(status_code=getattr(err, "status_code", 400), detail=str(err))


class EmbeddingsRequest(BaseModel):
    texts: List[str] = Field(description="Texts to embed, in order")
    model: str = Field(default="", description="'<provider>:<model id>' from embedding_models; blank uses the default")
    live: bool = True


@app.post("/embeddings")
async def embeddings_endpoint(payload: EmbeddingsRequest) -> Dict[str, Any]:
    try:
        return await embeddings.embed(payload.texts, payload.model, payload.live)
    except EmbeddingsError as err:
        raise tool_error(err)
    except Exception as err:  # provider SDK errors
        logger.warning("Embedding call failed: %s", err)
        raise HTTPException(status_code=502, detail=f"Embedding API error: {err}")


class QdrantSearchRequest(BaseModel):
    operation: Literal["search", "facet"] = "search"
    collection: str
    vector: List[float] = Field(default_factory=list)
    top_k: int = Field(default=8, ge=1, le=1000, description="Search hits, or facet values for operation=facet")
    filter: Dict[str, Any] = Field(default_factory=dict, description="payload field -> value or list of values")
    score_threshold: Optional[float] = None
    text_field: str = "text"
    facet_key: str = ""
    live: bool = True


@app.post("/connectors/qdrant/search")
async def qdrant_search(payload: QdrantSearchRequest) -> Dict[str, Any]:
    try:
        if payload.operation == "facet":
            return await qdrant.facet(payload.collection, payload.facet_key, payload.top_k, payload.live)
        return await qdrant.search(
            payload.collection, payload.vector, payload.top_k, payload.filter, payload.score_threshold, payload.text_field, payload.live
        )
    except QdrantError as err:
        raise tool_error(err)
    except Exception as err:
        logger.warning("Qdrant %s failed: %s", payload.operation, err)
        raise HTTPException(status_code=502, detail=f"Qdrant request failed: {err}")


class QdrantUpsertRequest(BaseModel):
    collection: str
    points: List[Dict[str, Any]] = Field(description="[{id?, vector, payload}]")
    create_if_missing: bool = True
    live: bool = True


@app.post("/connectors/qdrant/upsert")
async def qdrant_upsert(payload: QdrantUpsertRequest) -> Dict[str, Any]:
    try:
        return await qdrant.upsert(payload.collection, payload.points, payload.create_if_missing, payload.live)
    except QdrantError as err:
        raise tool_error(err)
    except Exception as err:
        logger.warning("Qdrant upsert failed: %s", err)
        raise HTTPException(status_code=502, detail=f"Qdrant request failed: {err}")


class SharePointMCPRequest(BaseModel):
    operation: Literal["listTools", "callTool"] = "callTool"
    tool: str = ""
    arguments: Dict[str, Any] = Field(default_factory=dict)
    live: bool = True


@app.post("/connectors/sharepoint-mcp")
async def sharepoint_mcp_connector(payload: SharePointMCPRequest) -> Dict[str, Any]:
    try:
        if payload.operation == "listTools":
            return await sharepoint_mcp.list_tools(payload.live)
        return await sharepoint_mcp.call_tool(payload.tool, payload.arguments, payload.live)
    except SharePointMCPError as err:
        raise tool_error(err)
    except Exception as err:  # transport / protocol errors
        logger.warning("SharePoint MCP %s failed: %s", payload.operation, err)
        raise HTTPException(status_code=502, detail=f"SharePoint MCP request failed: {err}")


class ParseRequest(BaseModel):
    name: str = Field(description="File name; the extension picks the parser")
    content: str
    encoding: Literal["utf-8", "base64"] = "utf-8"


@app.post("/tools/parse")
def parse_endpoint(payload: ParseRequest) -> Dict[str, Any]:
    try:
        return parse_document(payload.name, payload.content, payload.encoding)
    except ParserError as err:
        raise tool_error(err)
    except Exception as err:  # corrupt files
        raise HTTPException(status_code=422, detail=f"Could not parse {payload.name}: {err}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
