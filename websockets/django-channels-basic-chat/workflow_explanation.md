# Django Channels Chat Workflow and Architecture

This document tracks the workflow, key files, code snippets, and how data moves across the Django stack to create a real-time WebSocket chat.

## 1. Project & ASGI Setup (The Foundation)
To handle WebSockets, the standard Django WSGI is swapped with ASGI. `daphne` and `channels` are used.

**`mywebsite/settings.py`**
- `ASGI_APPLICATION = 'mywebsite.asgi.application'` sets the entry point for async processing.
- `CHANNEL_LAYERS` is configured to use `'channels.layers.InMemoryChannelLayer'`, meaning the server stores active connections in memory (ideal for local testing, replace with Redis for production).

**`mywebsite/asgi.py`**
Controls how traffic is routed based on the protocol. HTTP goes to normal Django views, while WebSocket requests get authenticated and forwarded.
```python
application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    'websocket': AuthMiddlewareStack(
        URLRouter(
            chat.routing.websocket_urlpatterns
        )
    )
})
```

## 2. WebSocket Routing (The Path)
When a WebSocket connection request enters the application, Django Channels checks the `routing.py` file to see where it must be sent.

**`chat/routing.py`**
```python
websocket_urlpatterns = [
    re_path(r'ws/socket-server/', consumers.ChatConsumer.as_asgi())
]
```
This maps the URL `ws://127.0.0.1:8000/ws/socket-server/` to the `ChatConsumer`.

## 3. Frontend Integration (The Client)
The chat interface handles connecting to the server and printing messages.

**`chat/templates/chat/lobby.html`**
- **Connecting:** A randomized `myUsername` is created. JS makes a direct handshake with the python backend.
  ```javascript
  let url = `ws://${window.location.host}/ws/socket-server/`;
  const chatSocket = new WebSocket(url);
  ```
- **Sending Important Data:** When you submit a message, it converts the message and user ID to JSON and sends it.
  ```javascript
  chatSocket.send(JSON.stringify({
      'message': message,
      'sender': myUsername
  }));
  ```
- **Receiving Data:** The `chatSocket.onmessage` event listens for incoming events, parses the JSON, and dynamically adds the HTML bubble into the DOM based on if the user is the sender or receiver.

## 4. WebSockets Consumer (The Backend Brain)
Consumers are the equivalent of views, but for WebSockets. They keep the connection alive over time rather than returning a one-off HTTP response.

**`chat/consumers.py`**
```python
import json
from channels.generic.websocket import AsyncWebsocketConsumer

class ChatConsumer(AsyncWebsocketConsumer):
    # 1. NEW USER CONNECTS
    async def connect(self):
        self.room_group_name = 'test'
        # Add the user to a unified broadcasting group named 'test'
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept() # Accepts handshake
   
    # 2. USER DISCONNECTS
    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # 3. MESSAGE ARRIVES FROM FRONTEND
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']
        sender = text_data_json.get('sender', 'Anonymous')

        # Broadcast message to everyone in the 'test' group
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message', # This calls the function below
                'message': message,
                'sender': sender
            }
        )

    # 4. SEND MESSAGE LOGIC (Executed for each user in the group)
    async def chat_message(self, event):
        message = event['message']
        sender = event.get('sender', 'Anonymous')

        # Sends the text back out the WebSocket downwards to lobby.html
        await self.send(text_data=json.dumps({
            'type': 'chat',
            'message': message,
            'sender': sender
        }))
```

## Summary of Data Flow Topic
1. **Submit:** User types "Hello" and hits 'Send'.
2. **Frontend -> Backend:** Javascript serializes `{message: "Hello", sender: "User-1234"}` and sends it to `ws://.../ws/socket-server/`.
3. **Receive:** The `ChatConsumer.receive()` catches the string, deserializes it, and tells the `channel_layer` to broadcast `{type: 'chat_message', message: "Hello", sender: "User-1234"}` to the `"test"` group.
4. **Broadcast:** The `channel_layer` triggers the `ChatConsumer.chat_message()` method for *every active connection* in the `"test"` group.
5. **Backend -> Frontend:** Each instance converts the dictionary back into a JSON string and pushes it down the pipe to its respective browser using `self.send()`.
6. **Render:** The frontend `chatSocket.onmessage` receives the string, checks sender, and creates the UI message bubble.
