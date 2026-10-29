"""Deterministic pixel-level observations from a configured traffic-signal crop."""

from __future__ import annotations

import colorsys
import math
from collections.abc import Sequence


def observe_signal(image: Sequence[Sequence[Sequence[float]]], signal_region: dict[str, float]) -> dict[str, object]:
    """Count saturated lamp-color pixels inside a normalized source-frame rectangle.

    The image uses OpenCV's BGR channel order. HSV bounds mirror the adapter's
    previous OpenCV thresholds, expressed as degrees and normalized S/V values.
    """
    height = len(image)
    width = len(image[0]) if height else 0
    left = max(0, min(width, math.floor(signal_region["x"] * width)))
    top = max(0, min(height, math.floor(signal_region["y"] * height)))
    right = max(0, min(width, math.ceil((signal_region["x"] + signal_region["width"]) * width)))
    bottom = max(0, min(height, math.ceil((signal_region["y"] + signal_region["height"]) * height)))
    crop_width = right - left
    crop_height = bottom - top
    if crop_width < 3 or crop_height < 3:
        return {"signalRegionTooSmall": True, "colorScores": {"red": 0.0, "yellow": 0.0, "green": 0.0}}

    counts = {"red": 0, "yellow": 0, "green": 0}
    for row in image[top:bottom]:
        for blue, green, red in row[left:right]:
            hue, saturation, value = colorsys.rgb_to_hsv(float(red) / 255, float(green) / 255, float(blue) / 255)
            degrees = hue * 360
            if saturation < 100 / 255:
                continue
            if value >= 120 / 255 and (degrees <= 20 or degrees >= 340):
                counts["red"] += 1
            elif value >= 120 / 255 and 24 <= degrees <= 70:
                counts["yellow"] += 1
            elif value >= 100 / 255 and 72 <= degrees <= 180:
                counts["green"] += 1

    pixel_count = crop_width * crop_height
    scores = {color: round(count / pixel_count, 6) for color, count in counts.items()}
    return {"colorScores": scores}
