from django.shortcuts import render

def index(request):
    return render(request, 'voice_app/index.html')
