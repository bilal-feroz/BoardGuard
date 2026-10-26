"""Build a Lambda deployment zip without Docker.

Installs Linux (manylinux_2_28, x86_64, CPython 3.12) wheels with `uv pip
--python-platform`, adds the API code, demo fixtures and the static UI export,
strips caches/tests, and writes dist/boardguard-lambda.zip.

    python infrastructure/aws/package_lambda.py          (after `npx next build` in apps/web)
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "dist" / "lambda-build"
OUT = ROOT / "dist" / "boardguard-lambda.zip"
UNZIPPED_LIMIT_MB = 250

REQS = [
    "opencv-python-headless==5.0.0.93",
    "numpy==2.4.6",
    "fastapi==0.162.0",
    "pydantic==2.14.1",
    "python-multipart==0.0.32",
    "mangum==0.19.0",
]


def main() -> None:
    ui = ROOT / "apps" / "web" / "out"
    if not (ui / "index.html").exists():
        sys.exit("apps/web/out is missing: run `npx next build` in apps/web first (NEXT_PUBLIC_API_BASE empty).")
    if BUILD.exists():
        shutil.rmtree(BUILD)
    BUILD.mkdir(parents=True)
    subprocess.run(["uv", "pip", "install", "--target", str(BUILD), "--python-platform", "x86_64-manylinux_2_28",
                    "--python-version", "3.12", "--only-binary", ":all:", *REQS], check=True)
    # Trim what Lambda never needs.
    for pattern in ("**/__pycache__", "**/tests", "**/*.dist-info/RECORD", "numpy/_core/include", "numpy/f2py", "cv2/data"):
        for p in BUILD.glob(pattern):
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
    shutil.copytree(ROOT / "services" / "vision-api" / "app", BUILD / "app", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(ROOT / "datasets" / "fixtures", BUILD / "fixtures")
    shutil.copytree(ui, BUILD / "ui")
    size_mb = sum(f.stat().st_size for f in BUILD.rglob("*") if f.is_file()) / 1e6
    print(f"unzipped size {size_mb:.1f} MB (Lambda limit {UNZIPPED_LIMIT_MB} MB)")
    if size_mb > UNZIPPED_LIMIT_MB:
        sys.exit("package exceeds the Lambda unzipped limit; use the container deployment instead")
    OUT.unlink(missing_ok=True)
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in sorted(BUILD.rglob("*")):
            if f.is_file():
                info = zipfile.ZipInfo.from_file(f, f.relative_to(BUILD).as_posix())
                info.external_attr = 0o644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, f.read_bytes())
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
