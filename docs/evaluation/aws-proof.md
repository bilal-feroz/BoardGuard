# AWS runtime proof

Generated 2026-10-27T05:07:09Z against `https://m5fd6rcr67gfrvw3elkxctbcvu0xseam.lambda-url.us-east-1.on.aws` (stack `boardguard`, region `us-east-1`).

## GET /api/health
```json
{"status":"ok","opencv_version":"5.0.0","environment":"aws-lambda","storage":"aws-s3"}
```
## GET /api/runtime
```json
{
    "service": "boardguard-vision-api",
    "version": "0.1.0",
    "git_sha": "935e156",
    "environment": "aws-lambda",
    "opencv_version": "5.0.0",
    "opencv_package": "opencv-python-headless",
    "opencv_build": {
        "baseline": "SSE SSE2 SSE3",
        "dispatched_code_generation": "SSE4_1 SSE4_2 AVX FP16 AVX2 AVX512_SKX"
    },
    "opencv_threads": 2,
    "numpy_version": "2.4.6",
    "python_version": "3.12.14",
    "platform": "Linux-5.10.255-268-309.1092.amzn2.x86_64-x86_64-with-glibc2.34",
    "machine": "x86_64",
    "cpu_count": 2,
    "uptime_s": 41.4,
    "storage": {
        "backend": "aws-s3",
        "bucket": "boardguard-evidencebucket-dlq2f97hzwzd",
        "prefix": "boardguard/",
        "region": "us-east-1"
    },
    "aws": {
        "region": "us-east-1",
        "function_name": "boardguard-vision",
        "function_version": "$LATEST",
        "memory_mb": "3008",
        "log_group": "/aws/lambda/boardguard-vision",
        "log_stream": "2026/10/27/boardguard-vision[$LATEST]6bd980a6ab2841d6b9e7a906abf966a5",
        "execution_env": "AWS_Lambda_python3.12"
    }
}
```
## POST /api/vision/quality (s01_battery_leak.jpg)
```
HTTP/1.1 200 OK
x-process-time-ms: 272.1
x-boardguard-runtime: aws-lambda
curl total time: 5.497290s
```
```json
{
    "quality": {
        "width": 1600,
        "height": 1200,
        "verdict": "ACCEPT",
        "reasons": [],
        "metrics": {
            "largest_glare_blob_fraction": 0.0024,
            "laplacian_variance": 1773.6562,
            "tenengrad": 4977.8847,
            "blur_metric": 0.4315,
            "mean_luminance": 106.7068,
            "median_luminance": 100.0,
            "p01": 12.0,
            "p99": 242.0,
            "clipped_dark_fraction": 0.0005,
            "clipped_bright_fraction": 0.0047,
            "glare_fraction": 0.0277,
            "rms_contrast": 0.2175
        },
        "tiles": {
            "grid_px": 128,
            "count": 108,
            "judged_for_focus": 108,
            "unusable_count": 29,
            "unusable_fraction": 0.2685,
            "unusable": [
                {
                    "x": 266,
                    "y": 0,
                    "w": 134,
                    "h": 133,
                    "reasons": [
                        "BLUR"
                    ]
                },
                {
                    "x": 400,
                    "y": 0,
                    "w": 133,
                    "h": 133,
                    "reasons": [
                        "BLUR"
                    ]
                },
                {
                    "x": 0,
                    "y": 133,
                    "w": 133,
                    "h": 133,
                    "reasons": [
                        "BLUR"
                    ]
                },
                {
                    "x": 400,
                    "y": 133,
                    "w": 133,
                    "h": 133,
                    "reasons": [
```
## CloudWatch log lines (last 10 minutes)
```
[INFO]
2026-10-27T05:06:36.857Z
425bd030-7247-49ae-ac52-00b303b614a1
request POST /api/vision/quality status=200 ms=368.3 env=aws-lambda

[INFO]
2026-10-27T05:07:17.283Z
57ce1f5a-ce31-471c-bc4c-aa82237e2d85
request POST /api/vision/quality status=200 ms=272.1 env=aws-lambda
```
