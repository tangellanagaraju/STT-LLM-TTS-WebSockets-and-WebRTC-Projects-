import os
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from typing import List, Dict, Any

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

# Store connected client information
# Each entry will be: { "userName": str, "websocket": WebSocket }
connected_clients: Dict[str, WebSocket] = {}

# Store active offers
# Each entry will be: { "offererUserName": str, "offer": dict, "offerIceCandidates": list, "answererUserName": str, "answer": dict, "answererIceCandidates": list }
offers: List[Dict[str, Any]] = []

@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await websocket.accept()
    connected_clients[username] = websocket
    logger.info(f"Client connected: {username}")

    try:
        # Send available offers to the newly connected client
        if offers:
            await websocket.send_json({"type": "availableOffers", "data": offers})

        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            message_type = message.get("type")
            payload = message.get("data")

            if message_type == "newOffer":
                # Create a new offer entry
                new_offer = {
                    "offererUserName": username,
                    "offer": payload,
                    "offerIceCandidates": [],
                    "answererUserName": None,
                    "answer": None,
                    "answererIceCandidates": []
                }
                offers.append(new_offer)
                
                # Broadcast to all other connected clients
                for client_name, client_ws in connected_clients.items():
                    if client_name != username:
                        await client_ws.send_json({"type": "newOfferAwaiting", "data": [new_offer]})

            elif message_type == "newAnswer":
                offer_obj = payload
                offerer_name = offer_obj.get("offererUserName")
                
                # Find the offer to update
                for offer in offers:
                    if offer["offererUserName"] == offerer_name:
                        offer["answer"] = offer_obj.get("answer")
                        offer["answererUserName"] = username
                        
                        # Send the answer back to the offerer
                        if offerer_name in connected_clients:
                            # Also send back existing ice candidates in a direct response (emulating ack)
                            await websocket.send_json({
                                "type": "answerAck",
                                "data": offer["offerIceCandidates"]
                            })
                            
                            await connected_clients[offerer_name].send_json({
                                "type": "answerResponse",
                                "data": offer
                            })
                        break

            elif message_type == "sendIceCandidateToSignalingServer":
                ice_obj = payload
                did_i_offer = ice_obj.get("didIOffer")
                ice_user_name = username
                ice_candidate = ice_obj.get("iceCandidate")

                if did_i_offer:
                    # Offerer sending ice candidates
                    for offer in offers:
                        if offer["offererUserName"] == ice_user_name:
                            offer["offerIceCandidates"].append(ice_candidate)
                            if offer["answererUserName"] and offer["answererUserName"] in connected_clients:
                                await connected_clients[offer["answererUserName"]].send_json({
                                    "type": "receivedIceCandidateFromServer",
                                    "data": ice_candidate
                                })
                            break
                else:
                    # Answerer sending ice candidates
                    for offer in offers:
                        if offer["answererUserName"] == ice_user_name:
                            offer["answererIceCandidates"].append(ice_candidate)
                            if offer["offererUserName"] and offer["offererUserName"] in connected_clients:
                                await connected_clients[offer["offererUserName"]].send_json({
                                    "type": "receivedIceCandidateFromServer",
                                    "data": ice_candidate
                                })
                            break

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {username}")
        if username in connected_clients:
            del connected_clients[username]
    except Exception as e:
        logger.error(f"Error in websocket for {username}: {e}")
        if username in connected_clients:
            del connected_clients[username]

# Mount static files after websocket route to avoid interference if root is used
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8180)
