from typing import Any
import httpx
from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field, field_validator

mcp = FastMCP("rerank")

ZERANK_API_BASE = "https://api.zeroentropy.dev/v1/models/rerank"


class RerankRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=10000)
    documents: list[str] = Field(..., min_length=1, max_length=1000)
    api_key: str = Field(..., min_length=1)

    @field_validator("documents")
    def validate_documents(cls, v: list[str]) -> list[str]:
        if not all(doc.strip() for doc in v):
            raise ValueError("Documents cannot be empty strings")
        return v


class RerankResult(BaseModel):
    index: int = Field(..., ge=0, le=1000)
    relevance_score: float = Field(..., ge=0, le=1)


class RerankResponse(BaseModel):
    results: list[RerankResult] = Field(..., min_length=1, max_length=1000)


@mcp.tool()
async def get_reranking(request: RerankRequest) -> RerankResponse:
    """Get the reranked document listing
    Args:
        request: The RerankRequest object containing query, documents, and api_key
    Returns:
        The RerankResponse object containing the reranked document listing
    """

    headers = {
        "Authorization": f"Bearer {request.api_key}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                ZERANK_API_BASE,
                json={
                    "query": request.query,
                    "documents": request.documents,
                },
                headers=headers,
            )
            response.raise_for_status()

            result = response.json()
            if "results" not in result:
                raise ValueError("Invalid API response format")

            return RerankResponse(
                results=[RerankResult(**result) for result in result["results"]]
            )

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                raise ValueError("Invalid API key")
            elif e.response.status_code == 429:
                raise ValueError("Rate limit exceeded")
            else:
                raise ValueError(f"API error: {e.response.status_code}")

        except httpx.TimeoutException:
            raise ValueError("Request timed out")

        except httpx.RequestError as e:
            raise ValueError(f"Request error: {str(e)}")

        except Exception as e:
            raise ValueError(f"Reranking failed: {str(e)}")


if __name__ == "__main__":
    mcp.run(transport="stdio")
