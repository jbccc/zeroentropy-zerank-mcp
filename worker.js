import { z } from "zod";

const ZERANK_API_BASE = "https://api.zeroentropy.dev/v1/models/rerank";

// MCP Error Codes
const MCP_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

// Zod schemas for validation
const RerankRequestSchema = z.object({
  query: z.string().min(1).max(10000),
  documents: z.array(z.string()).min(1).max(1000).refine(
    (docs) => docs.every(doc => doc.trim().length > 0),
    { message: "Documents cannot be empty strings" }
  ),
  api_key: z.string().min(1),
});

const RerankResultSchema = z.object({
  index: z.number().int().min(0).max(1000),
  relevance_score: z.number().min(0).max(1),
});

const RerankResponseSchema = z.object({
  results: z.array(RerankResultSchema).min(1).max(1000),
});

// MCP Server class for Durable Objects
export class MCPServer {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.initialized = false;
  }

  async handleRequest(request) {
    try {
      const body = await request.json();
      
      // Validate JSON-RPC 2.0 structure
      if (!body.jsonrpc || body.jsonrpc !== "2.0") {
        return this.createErrorResponse("Invalid JSON-RPC version", body.id, MCP_ERROR_CODES.INVALID_REQUEST);
      }

      // Handle MCP protocol requests
      if (body.method === "initialize") {
        return this.handleInitialize(body.params, body.id);
      } else if (body.method === "initialized") {
        return this.handleInitialized(body.params);
      } else if (body.method === "ping") {
        return this.handlePing(body.id);
      } else if (body.method === "tools/list") {
        return this.listTools(body.id);
      } else if (body.method === "tools/call") {
        return this.callTool(body.params, body.id);
      } else {
        return this.createErrorResponse("Unknown method", body.id, MCP_ERROR_CODES.METHOD_NOT_FOUND);
      }
    } catch (error) {
      return this.createErrorResponse(error.message, null, MCP_ERROR_CODES.PARSE_ERROR);
    }
  }

  handleInitialize(params, id) {
    this.initialized = true;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "zerank-mcp",
          version: "0.1.0",
        },
      },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  handleInitialized(params) {
    // Initialized notification - no response needed
    return new Response(null, { status: 204 });
  }

  handlePing(id) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      result: {},
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  listTools(id) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: id,
      result: {
        tools: [
          {
            name: "get_reranking",
            description: "Get the reranked document listing",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The search query",
                  minLength: 1,
                  maxLength: 10000,
                },
                documents: {
                  type: "array",
                  description: "Array of documents to rerank",
                  items: {
                    type: "string",
                  },
                  minItems: 1,
                  maxItems: 1000,
                },
                api_key: {
                  type: "string",
                  description: "API key for authentication",
                  minLength: 1,
                },
              },
              required: ["query", "documents", "api_key"],
            },
          },
        ],
      },
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  async callTool(params, id) {
    const { name, arguments: args } = params;

    if (name === "get_reranking") {
      try {
        // Validate input
        const validatedArgs = RerankRequestSchema.parse(args);
        
        // Make API request
        const response = await this.makeRerankRequest(
          validatedArgs.query,
          validatedArgs.documents,
          validatedArgs.api_key
        );

        return new Response(JSON.stringify({
          jsonrpc: "2.0",
          id: id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(response, null, 2),
              },
            ],
          },
        }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return this.createErrorResponse(error.message, id, MCP_ERROR_CODES.INVALID_PARAMS);
      }
    }

    return this.createErrorResponse(`Unknown tool: ${name}`, id, MCP_ERROR_CODES.METHOD_NOT_FOUND);
  }

  async makeRerankRequest(query, documents, apiKey) {
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    const body = JSON.stringify({
      query,
      documents,
    });

    try {
      const response = await fetch(ZERANK_API_BASE, {
        method: "POST",
        headers,
        body,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid API key");
        } else if (response.status === 429) {
          throw new Error("Rate limit exceeded");
        } else {
          throw new Error(`API error: ${response.status}`);
        }
      }

      const result = await response.json();
      
      if (!result.results) {
        throw new Error("Invalid API response format");
      }

      return RerankResponseSchema.parse({
        results: result.results.map(r => ({
          index: r.index,
          relevance_score: r.relevance_score,
        })),
      });

    } catch (error) {
      if (error.name === "TypeError" && error.message.includes("fetch")) {
        throw new Error(`Request error: ${error.message}`);
      }
      throw error;
    }
  }

  createErrorResponse(message, id = null, code = MCP_ERROR_CODES.INTERNAL_ERROR) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: code,
        message: message,
      },
      id: id,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  async fetch(request) {
    return await this.handleRequest(request);
  }
}

// Worker entry point
export default {
  async fetch(request, env, ctx) {
    try {
      // Get or create Durable Object
      const id = env.MCP_SERVER.idFromName("zerank-mcp");
      const mcpServer = env.MCP_SERVER.get(id);
      
      return await mcpServer.fetch(request);
    } catch (error) {
      return new Response(JSON.stringify({
        error: `Worker error: ${error.message}`,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
}; 