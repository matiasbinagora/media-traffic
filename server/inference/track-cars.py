"""Optional Ultralytics YOLO/ByteTrack adapter for Media Traffic analysis runs.

The Python runtime and checkpoint are supplied by the operator, not vendored or
installed as an application dependency. Their license choice is a release gate.
"""

import argparse
import hashlib
import json
import math
import platform
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import ultralytics
import yaml
from ultralytics import YOLO


EXPECTED_CHECKPOINT_SHA256 = "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"
CONFIDENCE = 0.25
IMAGE_SIZE = 640
CLASS_ID = 2


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def frame_timestamps(source: Path, ffprobe: str) -> list[float]:
    completed = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_frames",
         "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(source)],
        check=True, capture_output=True, text=True,
    )
    payload = json.loads(completed.stdout)
    timestamps = [float(frame["best_effort_timestamp_time"]) for frame in payload["frames"]]
    if not timestamps or any(not math.isfinite(timestamp) for timestamp in timestamps):
        raise ValueError("FFprobe did not provide valid source presentation timestamps.")
    if any(current <= previous for previous, current in zip(timestamps, timestamps[1:])):
        raise ValueError("Source presentation timestamps are not strictly increasing.")
    return timestamps


def observe_signal(image, signal_region: dict[str, float]) -> dict[str, object]:
    height, width = image.shape[:2]
    left = max(0, min(width, math.floor(signal_region["x"] * width)))
    top = max(0, min(height, math.floor(signal_region["y"] * height)))
    right = max(0, min(width, math.ceil((signal_region["x"] + signal_region["width"]) * width)))
    bottom = max(0, min(height, math.ceil((signal_region["y"] + signal_region["height"]) * height)))
    if right - left < 3 or bottom - top < 3:
        return {"signalRegionTooSmall": True, "colorScores": {"red": 0.0, "yellow": 0.0, "green": 0.0}}

    hsv = cv2.cvtColor(image[top:bottom, left:right], cv2.COLOR_BGR2HSV)
    pixel_count = (right - left) * (bottom - top)
    red_mask = cv2.bitwise_or(
        cv2.inRange(hsv, np.array([0, 100, 120]), np.array([10, 255, 255])),
        cv2.inRange(hsv, np.array([170, 100, 120]), np.array([179, 255, 255])),
    )
    masks = {
        "red": red_mask,
        "yellow": cv2.inRange(hsv, np.array([12, 100, 120]), np.array([35, 255, 255])),
        "green": cv2.inRange(hsv, np.array([36, 100, 100]), np.array([90, 255, 255])),
    }
    scores = {color: round(cv2.countNonZero(mask) / pixel_count, 6) for color, mask in masks.items()}
    return {"colorScores": scores}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--weights", required=True, type=Path)
    parser.add_argument("--tracker", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--signal-region-json", required=True)
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args()

    if not args.source.is_file():
        raise SystemExit("Uploaded source video is missing.")
    if not args.weights.is_file():
        raise SystemExit("Configured YOLO checkpoint is missing.")
    try:
        signal_region = json.loads(args.signal_region_json)
        region_values = [signal_region[key] for key in ("x", "y", "width", "height")]
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in region_values):
            raise ValueError("Signal-region coordinates must be finite numbers.")
        if signal_region["x"] < 0 or signal_region["y"] < 0 or signal_region["width"] <= 0 or signal_region["height"] <= 0 or signal_region["x"] + signal_region["width"] > 1 or signal_region["y"] + signal_region["height"] > 1:
            raise ValueError("Signal-region coordinates must be a positive normalized rectangle inside the source frame.")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(f"Invalid configured signal region: {error}") from error
    checkpoint_sha256 = sha256_file(args.weights)
    if checkpoint_sha256 != EXPECTED_CHECKPOINT_SHA256:
        raise SystemExit(f"Configured checkpoint SHA-256 does not match the qualified yolo26n model: {checkpoint_sha256}")

    timestamps = frame_timestamps(args.source, args.ffprobe)
    tracker_config = yaml.safe_load(args.tracker.read_text(encoding="utf-8"))
    started = time.perf_counter()
    model = YOLO(str(args.weights))
    capture = cv2.VideoCapture(str(args.source))
    if not capture.isOpened():
        raise SystemExit("OpenCV could not decode the uploaded source video.")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    frames = []
    signal_pixel_observations = []
    frame_index = 0
    try:
        while True:
            ok, image = capture.read()
            if not ok:
                break
            if frame_index >= len(timestamps):
                raise SystemExit("Decoded frame count exceeds the FFprobe presentation timestamp count.")
            result = model.track(
                image,
                persist=True,
                tracker=str(args.tracker),
                conf=CONFIDENCE,
                imgsz=IMAGE_SIZE,
                classes=[CLASS_ID],
                device="cpu",
                verbose=False,
            )[0]
            detections = []
            if result.boxes is not None and result.boxes.id is not None:
                ids = result.boxes.id.int().cpu().tolist()
                boxes = result.boxes.xyxy.cpu().tolist()
                confidences = result.boxes.conf.cpu().tolist()
                for track_id, box, confidence in zip(ids, boxes, confidences):
                    left, top, right, bottom = box
                    left = max(0.0, min(float(width), float(left)))
                    top = max(0.0, min(float(height), float(top)))
                    right = max(0.0, min(float(width), float(right)))
                    bottom = max(0.0, min(float(height), float(bottom)))
                    if right <= left or bottom <= top:
                        continue
                    detections.append({
                        "trackId": track_id,
                        "box": [round(left, 2), round(top, 2), round(right, 2), round(bottom, 2)],
                        "confidence": round(float(confidence), 6),
                    })
            frames.append({
                "frameIndex": frame_index,
                "timeSeconds": timestamps[frame_index],
                "detections": detections,
            })
            signal_pixel_observations.append({
                "frameIndex": frame_index,
                "timeSeconds": timestamps[frame_index],
                **observe_signal(image, signal_region),
            })
            frame_index += 1
    finally:
        capture.release()

    if frame_index != len(timestamps):
        raise SystemExit(f"Decoded {frame_index} frames but FFprobe found {len(timestamps)} presentation timestamps.")

    report = {
        "width": width,
        "height": height,
        "frames": frames,
        "signalPixelObservations": signal_pixel_observations,
        "provenance": {
            "source": "uploaded-original",
            "checkpoint": args.weights.name,
            "checkpointSha256": checkpoint_sha256,
            "runtime": "Ultralytics",
            "runtimeVersion": ultralytics.__version__,
            "pythonVersion": sys.version.split()[0],
            "pytorchVersion": torch.__version__,
            "platform": platform.platform(),
            "device": "cpu",
            "tracker": "ByteTrack",
            "trackerConfigSha256": sha256_file(args.tracker),
            "trackerConfig": tracker_config,
            "sampling": "every decoded frame",
            "timestampSource": "ffprobe.best_effort_timestamp_time",
            "confidenceThreshold": CONFIDENCE,
            "imageSize": IMAGE_SIZE,
            "classFilter": {"id": CLASS_ID, "name": "car"},
            "decodedFrameCount": frame_index,
            "inferenceSeconds": round(time.perf_counter() - started, 3),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "frames"}))


if __name__ == "__main__":
    main()
