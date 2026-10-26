"""The Lambda entry point serves the same app for Function URL (payload v2) events."""

import base64
import json
import os
import tempfile

os.environ.setdefault("BOARDGUARD_DATA_DIR", tempfile.mkdtemp(prefix="bg-lambda-"))

from app.lambda_handler import handler  # noqa: E402
from tests.synth import jpeg, render_board  # noqa: E402


class Ctx:
    function_name = "boardguard-vision"
    aws_request_id = "test"


def event(method, path, body=b"", content_type=None):
    headers = {"host": "example.lambda-url.us-east-1.on.aws", "x-forwarded-for": "203.0.113.5"}
    if content_type:
        headers["content-type"] = content_type
    return {
        "version": "2.0", "routeKey": "$default", "rawPath": path, "rawQueryString": "", "headers": headers,
        "requestContext": {"http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "203.0.113.5",
                                    "userAgent": "pytest"}, "requestId": "id", "stage": "$default",
                           "domainName": "example.lambda-url.us-east-1.on.aws", "accountId": "anonymous"},
        "body": base64.b64encode(body).decode() if body else None, "isBase64Encoded": bool(body),
    }


def test_health_through_lambda_event():
    r = handler(event("GET", "/api/health"), Ctx())
    assert r["statusCode"] == 200
    assert json.loads(r["body"])["opencv_version"].startswith("5.")


def test_multipart_quality_through_lambda_event():
    img, _ = render_board()
    boundary = "bgboundary"
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.jpg\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + jpeg(img) + f"\r\n--{boundary}--\r\n".encode()
    r = handler(event("POST", "/api/vision/quality", body, f"multipart/form-data; boundary={boundary}"), Ctx())
    assert r["statusCode"] == 200, r["body"][:300]
    assert json.loads(r["body"])["quality"]["verdict"] == "ACCEPT"
