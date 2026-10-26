"""Storage backends: the Vercel layout where requests of one inspection can land on different instances."""

import tempfile

from app.storage.store import SessionRepo, SharedCacheStorage


class FakeRuntimeCache:
    """Stands in for Vercel's regional Runtime Cache (JSON values shared by every function instance)."""

    def __init__(self):
        self.items: dict[str, object] = {}

    def get(self, key):
        return self.items.get(key)

    def set(self, key, value, options=None):
        self.items[key] = value


def test_any_instance_can_continue_an_inspection():
    shared = FakeRuntimeCache()
    a = SharedCacheStorage(tempfile.mkdtemp(), shared=shared)  # two instances: separate /tmp, one shared cache
    b = SharedCacheStorage(tempfile.mkdtemp(), shared=shared)
    a.put("captures/BG-20260101-ABCD/OBS-001.jpg", b"\xff\xd8jpeg-bytes", "image/jpeg")
    assert b.get("captures/BG-20260101-ABCD/OBS-001.jpg") == b"\xff\xd8jpeg-bytes"
    assert b.get("artifacts/BG-20260101-ABCD/missing.png") is None

    repo_a, repo_b = SessionRepo(a), SessionRepo(b)
    s = {"inspection_id": "BG-20260101-ABCD", "state": "CREATED", "trace": []}
    repo_a.save(s)
    s_b = repo_b.load("BG-20260101-ABCD")
    assert s_b["state"] == "CREATED"
    # Instance B advances the inspection; instance A must not serve its own stale copy afterwards.
    s_b["state"] = "TECHNICIAN_REVIEW_REQUIRED"
    repo_b.save(s_b)
    assert repo_a.load("BG-20260101-ABCD")["state"] == "TECHNICIAN_REVIEW_REQUIRED"
