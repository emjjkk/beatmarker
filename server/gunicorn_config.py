import os
import multiprocessing

# Bind to the port provided by Render
bind = f"0.0.0.0:{os.getenv('PORT', '10000')}"

# Worker configuration
workers = 1  # Use only 1 worker on free tier to save memory
worker_class = "sync"
worker_connections = 1000
timeout = 300  # 5 minutes - increase timeout for audio processing
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"

# Memory management
max_requests = 100  # Restart workers after 100 requests to prevent memory leaks
max_requests_jitter = 10