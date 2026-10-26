"""Assemble a self-contained Vercel deployment in dist/boardguard/.

Vercel's zero-config FastAPI support picks up the vision API at app/main.py
(a FastAPI instance named `app`) and runs it as one Vercel Function; files in
public/ are served from the CDN at the site root. The UI therefore calls the
API on its own origin (/api/*), exactly as in the container and AWS builds.

    public/            static workstation UI (apps/web/out, built with NEXT_PUBLIC_API_BASE empty)
    app/               vision API package (services/vision-api/app) - the function entrypoint
    fixtures/          demo scenario images
    requirements.txt   runtime dependencies (no boto3/uvicorn/mangum)
    vercel.json        function duration, cache headers

    cd apps/web && npx next build                 (NEXT_PUBLIC_API_BASE unset)
    python infrastructure/vercel/package_vercel.py
    cd dist/boardguard && vercel deploy --prod

The .vercel/ link folder is kept between runs so redeploys update the same project.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "boardguard"

REQS = [
    "opencv-python-headless==5.0.0.93",
    "numpy==2.4.6",
    "fastapi==0.162.0",
    "pydantic==2.14.1",
    "python-multipart==0.0.32",
    "vercel-cache==0.7.6",  # Runtime Cache: shares inspections between function instances (see SharedCacheStorage)
]


def main() -> None:
    ui = ROOT / "apps" / "web" / "out"
    if not (ui / "index.html").exists():
        sys.exit("apps/web/out is missing: run `npx next build` in apps/web first (NEXT_PUBLIC_API_BASE empty).")
    OUT.mkdir(parents=True, exist_ok=True)
    for child in OUT.iterdir():
        if child.name != ".vercel":
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    shutil.copytree(ui, OUT / "public")
    shutil.copytree(ROOT / "services" / "vision-api" / "app", OUT / "app", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "datasets" / "fixtures", OUT / "fixtures")
    shutil.copy(HERE / "vercel.json", OUT / "vercel.json")
    (OUT / "requirements.txt").write_text("\n".join(REQS) + "\n", encoding="utf-8")
    (OUT / ".python-version").write_text("3.12\n", encoding="utf-8")
    size_mb = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file() and ".vercel" not in f.parts) / 1e6
    print(f"wrote {OUT.relative_to(ROOT)} ({size_mb:.1f} MB before dependencies)")
    print("deploy: cd dist/boardguard && vercel deploy --prod")


if __name__ == "__main__":
    main()
