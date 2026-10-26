"""AWS Lambda entry point for the zip deployment (Python runtime, no container).

Mangum adapts Lambda Function URL / API Gateway events to the same FastAPI
ASGI app that runs locally, so behaviour is identical in both places.
"""

from mangum import Mangum

from .main import app

handler = Mangum(app, lifespan="off")
