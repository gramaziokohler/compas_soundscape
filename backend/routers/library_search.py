"""
BBC Sound Library Search API

Endpoints for searching and retrieving sounds from the BBC Sound Effects library.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from pathlib import Path

from services.bbc_service import search_sounds, download_sound
from config.constants import MAX_SEARCH_RESULTS, TEMP_LIBRARY_DIR

router = APIRouter(prefix="/api/library", tags=["library"])

# Temporary download directory for library sounds
LIBRARY_DOWNLOADS_DIR = Path(TEMP_LIBRARY_DIR)
LIBRARY_DOWNLOADS_DIR.mkdir(exist_ok=True)


class SearchRequest(BaseModel):
    """Request model for sound library search"""
    prompt: str
    max_results: int = MAX_SEARCH_RESULTS


class SearchResult(BaseModel):
    """Individual search result"""
    location: str
    description: str
    category: str
    duration: str
    score: int


class SearchResponse(BaseModel):
    """Response model for search results"""
    success: bool
    results: List[SearchResult]
    count: int


class DownloadRequest(BaseModel):
    """Request model for downloading a sound"""
    location: str
    description: str


@router.post("/search", response_model=SearchResponse)
async def search_library(request: SearchRequest):
    """
    Search the BBC Sound Effects library via their public API.

    Args:
        request: SearchRequest with prompt and optional max_results

    Returns:
        SearchResponse with list of matching sounds
    """
    try:
        print(f"[Library API] Searching for: {request.prompt}")

        results = search_sounds(request.prompt, request.max_results)

        search_results = [
            SearchResult(
                location=r['location'],
                description=r['description'],
                category=r['category'],
                duration=r['duration'],
                score=r['score']
            )
            for r in results
        ]

        print(f"[Library API] Found {len(search_results)} results")

        return SearchResponse(
            success=True,
            results=search_results,
            count=len(search_results)
        )

    except Exception as e:
        print(f"[Library API] Search error: {e}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


@router.post("/download")
async def download_library_sound(request: DownloadRequest):
    """
    Download a sound from the BBC library.

    Args:
        request: DownloadRequest with location and description

    Returns:
        FileResponse with the downloaded WAV file
    """
    from fastapi.responses import FileResponse

    try:
        print(f"[Library API] Downloading: {request.location} - {request.description}")

        safe_filename = "".join(
            c if c.isalnum() or c in (' ', '-', '_') else '_'
            for c in request.description
        )[:100]

        output_path = LIBRARY_DOWNLOADS_DIR / f"{safe_filename}_{request.location}.wav"

        success = download_sound(request.location, output_path)

        if not success or not output_path.exists():
            raise HTTPException(status_code=404, detail="Sound could not be downloaded")

        print(f"[Library API] Download successful: {output_path}")

        return FileResponse(
            path=str(output_path),
            media_type="audio/wav",
            filename=f"{safe_filename}.wav",
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}.wav"'
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[Library API] Download error: {e}")
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


@router.get("/health")
async def health_check():
    """Health check endpoint for the library search service."""
    return {
        "status": "healthy",
        "search_mode": "bbc_api",
    }
