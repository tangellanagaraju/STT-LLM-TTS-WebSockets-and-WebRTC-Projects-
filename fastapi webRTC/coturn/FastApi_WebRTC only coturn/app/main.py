from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routers import webrtc
from dotenv import load_dotenv
import os
import time
import hmac
import hashlib
import base64

load_dotenv()

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
async def ice_config(request: Request):
    """Return ICE server config with ONLY local Coturn."""
    
    # Credentials for local Coturn
    turn_secret = os.getenv("COTURN_SECRET", "Some-Really-Long-Str0ng-password-Secret")
    timestamp = int(time.time()) + 86400
    turn_username = f"{timestamp}:user"
    mac = hmac.new(turn_secret.encode('utf-8'), turn_username.encode('utf-8'), hashlib.sha1)
    turn_password = base64.b64encode(mac.digest()).decode('utf-8')

    client_host = request.url.hostname or "localhost"
    
    # Only use local Coturn (per user request)
    ice_servers = [
        {
            "urls": [f"turn:{client_host}:3478", f"turn:{client_host}:3478?transport=tcp"],
            "username": turn_username,
            "credential": turn_password
        }
    ]
    
    import logging
    logging.info(f"🚀 ICE Config requested. Serving ONLY Coturn to {client_host}.")
    
    return JSONResponse({"iceServers": ice_servers})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
