from django.db import models
import uuid

class ConversationSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Session {self.id} ({self.created_at})"

class Message(models.Model):
    session = models.ForeignKey(ConversationSession, related_name='messages', on_delete=models.CASCADE)
    role = models.CharField(max_length=20) # 'user', 'assistant', 'system'
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.role}: {self.content[:50]}"
