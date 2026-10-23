# RAG Reference Documentation

This directory contains reference documents and knowledge base articles indexed for Retrieval-Augmented Generation (RAG).

## Architecture Overview
The AI Agent microservice operates alongside the Node.js/React workflow platform:
1. React canvas lets users build workflows visually.
2. Fastify/Node backend orchestrates node execution.
3. Node forwards `AIAgent` nodes to `sfn-agent-core` via HTTP POST.
4. Python microservice executes prompts with LLMs (Groq, OpenAI) and tool routines.
