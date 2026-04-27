import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from django.urls import path
from core.consumers import VoiceConsumer

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'voice_assistant.settings')

application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter([
            path("ws/voice/", VoiceConsumer.as_asgi()),
        ])
    ),
})
