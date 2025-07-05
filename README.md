# ZeroEntropy Zerank MCP Server

A Model Context Protocol (MCP) server for document reranking using the ZeroEntropy Zerank API, now implemented in Node.js.

## Features

- Document reranking using the ZeroEntropy Zerank API
- Input validation with Zod schemas
- Support for both standalone Node.js server and Cloudflare Workers deployment
- MCP protocol compliance for integration with AI assistants

## Installation

```bash
npm install
```

## Usage

### Standalone Node.js Server

Run the MCP server using stdio transport:

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### Cloudflare Workers Deployment

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Login to Cloudflare:
```bash
wrangler login
```

3. Deploy the worker:
```bash
wrangler deploy
```

## API

The server provides one tool:

### `get_reranking`

Reranks a list of documents based on relevance to a query.

**Parameters:**
- `query` (string): The search query (1-10000 characters)
- `documents` (array): Array of documents to rerank (1-1000 items)
- `api_key` (string): ZeroEntropy API key

**Returns:**
- `results` (array): Array of reranked results with `index` and `relevance_score`

**Example:**
```json
{
  "query": "machine learning algorithms",
  "documents": [
    "Neural networks are a type of machine learning model",
    "Cooking recipes for pasta dishes",
    "Supervised learning techniques in AI"
  ],
  "api_key": "your-api-key"
}
```

## Environment

- Node.js 18.0.0 or higher
- ZeroEntropy API access

## License

MIT