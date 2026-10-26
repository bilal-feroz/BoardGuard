"""Runtime introspection: proves where and with what the vision workload runs."""

from __future__ import annotations

import os
import platform
import re
import sys
import time

import cv2
import numpy as np

STARTED = time.time()


def environment() -> str:
    # Vercel Functions also expose AWS_* variables; report the platform the deployment actually targets.
    if os.environ.get("VERCEL"):
        return "vercel"
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return "aws-lambda"
    if os.environ.get("ECS_CONTAINER_METADATA_URI_V4"):
        return "aws-ecs"
    if os.environ.get("BOARDGUARD_ENV"):
        return os.environ["BOARDGUARD_ENV"]
    return "local"


def _cpu_features() -> dict:
    info = cv2.getBuildInformation()
    out = {}
    for key in ("Baseline", "Dispatched code generation"):
        m = re.search(rf"{re.escape(key)}:\s*(.+)", info)
        if m:
            out[key.lower().replace(" ", "_")] = m.group(1).strip()
    return out


def runtime_info(storage_desc: dict | None = None) -> dict:
    env = environment()
    info = {
        "service": "boardguard-vision-api",
        "version": os.environ.get("BOARDGUARD_VERSION", "0.1.0"),
        "git_sha": os.environ.get("BOARDGUARD_GIT_SHA") or os.environ.get("VERCEL_GIT_COMMIT_SHA"),
        "environment": env,
        "opencv_version": cv2.__version__,
        "opencv_package": "opencv-python-headless",
        "opencv_build": _cpu_features(),
        "opencv_threads": cv2.getNumThreads(),
        "numpy_version": np.__version__,
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpu_count": os.cpu_count(),
        "uptime_s": round(time.time() - STARTED, 1),
        "storage": storage_desc,
    }
    if env == "vercel":
        info["vercel"] = {
            "region": os.environ.get("VERCEL_REGION"),
            "deployment_env": os.environ.get("VERCEL_ENV"),
            "deployment_url": os.environ.get("VERCEL_URL"),
            "underlying_region": os.environ.get("AWS_REGION"),
        }
    if env.startswith("aws"):
        info["aws"] = {
            "region": os.environ.get("AWS_REGION"),
            "function_name": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
            "function_version": os.environ.get("AWS_LAMBDA_FUNCTION_VERSION"),
            "memory_mb": os.environ.get("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"),
            "log_group": os.environ.get("AWS_LAMBDA_LOG_GROUP_NAME"),
            "log_stream": os.environ.get("AWS_LAMBDA_LOG_STREAM_NAME"),
            "execution_env": os.environ.get("AWS_EXECUTION_ENV"),
        }
    return info
