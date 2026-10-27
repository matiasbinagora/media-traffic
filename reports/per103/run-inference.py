"""Record full decoded-frame COCO car detections for the PER-103 asset gate.

Requires OpenCV, PyTorch and Ultralytics installed outside the application runtime.
Set YOLO_MODEL_PATH to an official pretrained checkpoint; no weights are vendored.
"""

import hashlib
import json
import os
import platform
import sys
import time
from pathlib import Path

import cv2
import torch
import ultralytics
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / "example/demo-traffic-video/source.mp4"
GROUND_TRUTH = ROOT / "example/demo-traffic-video/ground-truth.json"
MODEL_PATH = Path(os.environ["YOLO_MODEL_PATH"])
OUTPUT = Path(__file__).with_name("yolo-inference.json")
CONFIDENCE = 0.25
IMAGE_SIZE = 640
EXPECTED_CHECKPOINT_SHA256 = "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


checkpoint_sha256 = sha256(MODEL_PATH)
if checkpoint_sha256 != EXPECTED_CHECKPOINT_SHA256:
    raise SystemExit(
        "YOLO_MODEL_PATH does not match the documented pretrained yolo26n.pt "
        f"checkpoint SHA-256: {checkpoint_sha256}"
    )

model = YOLO(str(MODEL_PATH))
capture = cv2.VideoCapture(str(VIDEO))
frames = []
started = time.perf_counter()
while True:
    ok, image = capture.read()
    if not ok:
        break
    frame_index = len(frames)
    result = model.predict(
        image,
        imgsz=IMAGE_SIZE,
        conf=CONFIDENCE,
        classes=[2],
        device="cpu",
        verbose=False,
    )[0]
    cars = []
    for box in result.boxes:
        x1, y1, x2, y2 = (round(float(value), 1) for value in box.xyxy[0].tolist())
        cars.append(
            {
                "xyxy": [x1, y1, x2, y2],
                "confidence": round(float(box.conf[0]), 4),
            }
        )
    frames.append(
        {
            "frame": frame_index,
            "timeSeconds": round(frame_index / 30, 4),
            "cars": cars,
        }
    )
capture.release()
elapsed = time.perf_counter() - started

stopped_frames = [f for f in frames if 3.0 <= f["timeSeconds"] <= 6.9667]
by_frame = {frame["frame"]: frame for frame in frames}


def detections_in_region(frame_index: int, region: tuple[float, float, float, float]):
    left, top, right, bottom = region
    frame = by_frame[frame_index]
    return [
        car
        for car in frame["cars"]
        if left <= (car["xyxy"][0] + car["xyxy"][2]) / 2 <= right
        and top <= (car["xyxy"][1] + car["xyxy"][3]) / 2 <= bottom
    ]


blue_region = (500, 650, 950, 950)
blue_stopped_frames = [
    frame
    for frame in stopped_frames
    if detections_in_region(frame["frame"], blue_region)
]


def boundary_evidence(before: int, after: int, region: tuple[float, float, float, float]):
    return {
        "before": {
            "frame": before,
            "timeSeconds": round(before / 30, 4),
            "targetDetections": detections_in_region(before, region),
        },
        "after": {
            "frame": after,
            "timeSeconds": round(after / 30, 4),
            "targetDetections": detections_in_region(after, region),
        },
    }


report = {
    "source": "example/demo-traffic-video/source.mp4",
    "sourceSha256": sha256(VIDEO),
    "groundTruth": "example/demo-traffic-video/ground-truth.json",
    "groundTruthSha256": sha256(GROUND_TRUTH),
    "checkpoint": MODEL_PATH.name,
    "checkpointSha256": checkpoint_sha256,
    "checkpointSource": "Ultralytics official assets release v8.4.0",
    "ultralyticsVersion": ultralytics.__version__,
    "pytorchVersion": torch.__version__,
    "pythonVersion": sys.version.split()[0],
    "platform": platform.platform(),
    "device": "CPU",
    "inputSize": IMAGE_SIZE,
    "classFilter": {"id": 2, "name": "car"},
    "confidenceThreshold": CONFIDENCE,
    "decodedFrames": len(frames),
    "wallClockSeconds": round(elapsed, 3),
    "stoppedWindow": {
        "startSeconds": 3,
        "endSeconds": 7,
        "decodedFrames": len(stopped_frames),
        "targetScreenRegion": list(blue_region),
        "framesWithTargetCarDetection": len(blue_stopped_frames),
        "coverage": round(
            len(blue_stopped_frames) / len(stopped_frames), 4
        ),
    },
    "crossingBoundaries": {
        "greenCrossingGold": boundary_evidence(33, 36, (900, 500, 1300, 850)),
        "redCrossingRed": boundary_evidence(178, 179, (1250, 500, 1700, 850)),
    },
    "frames": frames,
}
OUTPUT.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: v for k, v in report.items() if k != "frames"}, indent=2))
