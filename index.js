import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ZERANK_API_BASE = "https://api.zeroentropy.dev/v1/models/rerank";

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

// Helper function to make API request
async function makeRerankRequest(query, documents, apiKey) {
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

// Create MCP server
const server = new Server(
  {
    name: "zerank-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
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
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_reranking") {
    try {
      // Validate input
      const validatedArgs = RerankRequestSchema.parse(args);
      
      // Make API request
      const response = await makeRerankRequest(
        validatedArgs.query,
        validatedArgs.documents,
        validatedArgs.api_key
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Zerank MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
}); 