from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import webrtc
from dotenv import load_dotenv
import os
import httpx
import time

load_dotenv()  # Load .env variables into os.getenv()

# Cache for ICE servers from metered.ca (5 minute TTL)
_ice_cache = {"data": None, "expires": 0}

app = FastAPI(title="WebRTC FastAPI Video Chat")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

static_path = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_path), name="static")

app.include_router(webrtc.router)

@app.get("/")
async def read_root():
    return FileResponse(os.path.join(static_path, "index.html"))

@app.get("/health")
async def health_check():
    return {"status": "healthy", "message": "WebRTC server is running"}

@app.get("/ice-config")
async def ice_config():
    """Return ICE server config from metered.ca API (with STUN fallback)."""
    global _ice_cache

    # Return cached result if still valid
    if _ice_cache["data"] and time.time() < _ice_cache["expires"]:
        return JSONResponse({"iceServers": _ice_cache["data"]})

    metered_api_url = os.getenv("METERED_API_URL")
    metered_api_key = os.getenv("METERED_API_KEY")

    if metered_api_url and metered_api_key:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{metered_api_url}?apiKey={metered_api_key}")
                if resp.status_code == 200:
                    ice_servers = resp.json()
                    _ice_cache["data"] = ice_servers
                    _ice_cache["expires"] = time.time() + 300  # cache 5 mins
                    return JSONResponse({"iceServers": ice_servers})
        except Exception as e:
            import logging
            logging.warning(f"Failed to fetch TURN config from metered.ca: {e}")

    # Fallback: use openrelay project TURN credentials
    turn_username = os.getenv("TURN_USERNAME", "openrelayproject")
    turn_credential = os.getenv("TURN_CREDENTIAL", "openrelayproject")
    fallback = [
        {"urls": "stun:stun.l.google.com:19302"},
        {
            "urls": "turn:openrelay.metered.ca:80",
            "username": "openrelayproject",
            "credential": "openrelayproject",
        },
        {
            "urls": "turn:openrelay.metered.ca:80?transport=tcp",
            "username": "openrelayproject",
            "credential": "openrelayproject",
        },
        {
            "urls": "turn:openrelay.metered.ca:443",
            "username": "openrelayproject",
            "credential": "openrelayproject",
        },
        {
            "urls": "turns:openrelay.metered.ca:443?transport=tcp",
            "username": "openrelayproject",
            "credential": "openrelayproject",
        },
    ]
    return JSONResponse({"iceServers": fallback})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
