"""Object storage for captures, derived artifacts and session state.

LocalStorage writes under services/vision-api/var/ and serves files through
the API. S3Storage writes to a private bucket and hands out short-lived
presigned URLs; sessions are persisted there too so any Lambda instance can
serve any request.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9/_.\-]{0,200}$")


def _check_key(key: str) -> str:
    if not _KEY_RE.match(key) or ".." in key:
        raise ValueError(f"invalid storage key: {key!r}")
    return key


class LocalStorage:
    backend = "local-filesystem"

    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.root / _check_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def get(self, key: str) -> bytes | None:
        p = self._path(key)
        return p.read_bytes() if p.exists() else None

    def url(self, key: str) -> str:
        return f"/api/artifacts/{_check_key(key)}"

    def describe(self) -> dict:
        return {"backend": self.backend, "root": str(self.root)}


class SharedCacheStorage(LocalStorage):
    """Temp-dir storage mirrored into Vercel's regional Runtime Cache.

    Vercel may route the requests of one inspection to different function instances, each with its own /tmp.
    Every object is also written to the Runtime Cache, which all instances in a region share (JSON values, so
    bytes travel base64-encoded; items up to 2 MB), and reads fall back to it. Session JSON is always read from
    the shared cache first, because another instance may have advanced the inspection since this one saw it.
    """

    backend = "vercel-runtime-cache"
    TTL_S = 24 * 3600

    def __init__(self, root: str | os.PathLike, shared=None):
        super().__init__(root)
        if shared is None:
            from vercel.cache import RuntimeCache  # only installed in the Vercel bundle

            shared = RuntimeCache(namespace="boardguard", key_hash_function=lambda k: hashlib.sha256(k.encode()).hexdigest())
        self.shared = shared

    def put(self, key: str, data: bytes, content_type: str) -> str:
        super().put(key, data, content_type)
        self.shared.set(_check_key(key), base64.b64encode(data).decode("ascii"), {"ttl": self.TTL_S})
        return key

    def get(self, key: str) -> bytes | None:
        mutable = key.startswith("sessions/")
        if not mutable:
            local = super().get(key)
            if local is not None:
                return local
        value = self.shared.get(_check_key(key))
        if isinstance(value, str):
            data = base64.b64decode(value)
            if not mutable:
                super().put(key, data, "")  # keep a local copy for later requests on this instance
            return data
        return super().get(key) if mutable else None

    def describe(self) -> dict:
        try:
            from vercel.cache.runtime_cache import resolve_cache

            impl = type(resolve_cache(sync=True)).__name__
        except Exception:  # noqa: BLE001 - diagnostics only
            impl = type(self.shared).__name__
        return {"backend": self.backend, "root": str(self.root), "shared_cache": impl}


class S3Storage:
    backend = "aws-s3"

    def __init__(self, bucket: str, prefix: str = "boardguard/", region: str | None = None):
        import boto3  # imported lazily so local runs do not need AWS config

        self.bucket = bucket
        self.prefix = prefix
        self.region = region or os.environ.get("AWS_REGION")
        self.s3 = boto3.client("s3", region_name=self.region)

    def put(self, key: str, data: bytes, content_type: str) -> str:
        self.s3.put_object(Bucket=self.bucket, Key=self.prefix + _check_key(key), Body=data,
                           ContentType=content_type, ServerSideEncryption="AES256")
        return key

    def get(self, key: str) -> bytes | None:
        try:
            obj = self.s3.get_object(Bucket=self.bucket, Key=self.prefix + _check_key(key))
        except self.s3.exceptions.NoSuchKey:
            return None
        return obj["Body"].read()

    def url(self, key: str) -> str:
        return self.s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": self.prefix + _check_key(key)}, ExpiresIn=3600)

    def describe(self) -> dict:
        return {"backend": self.backend, "bucket": self.bucket, "prefix": self.prefix, "region": self.region}


def make_storage():
    bucket = os.environ.get("BOARDGUARD_S3_BUCKET")
    if bucket:
        return S3Storage(bucket, os.environ.get("BOARDGUARD_S3_PREFIX", "boardguard/"))
    root = os.environ.get("BOARDGUARD_DATA_DIR")
    if not root:
        # Serverless functions (Vercel, Lambda zip) run from a read-only bundle; only the temp dir is writable.
        serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
        root = str(Path(tempfile.gettempdir()) / "boardguard") if serverless else str(Path(__file__).resolve().parents[2] / "var" / "store")
    if os.environ.get("VERCEL"):
        try:
            return SharedCacheStorage(root)
        except ImportError:
            pass
    return LocalStorage(root)


class SessionRepo:
    """JSON session persistence on top of a storage backend with a small in-process cache."""

    def __init__(self, storage):
        self.storage = storage
        self.cache: dict[str, dict] = {}

    def save(self, session: dict) -> None:
        self.cache[session["inspection_id"]] = session
        self.storage.put(f"sessions/{session['inspection_id']}.json", json.dumps(session).encode(), "application/json")

    def load(self, inspection_id: str) -> dict | None:
        if not re.fullmatch(r"BG-[0-9]{8}-[A-Z0-9]{4,8}", inspection_id):
            return None
        if self.storage.backend == "local-filesystem" and inspection_id in self.cache:
            return self.cache[inspection_id]
        raw = self.storage.get(f"sessions/{inspection_id}.json")
        if raw is None:
            return None
        s = json.loads(raw)
        self.cache[inspection_id] = s
        return s
