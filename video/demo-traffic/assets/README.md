# Synthetic Demo Asset Provenance

These assets were generated for the PER-103 sample. `intersection.png` is a generated fixed-camera intersection without moving traffic; the three sedan PNGs are generated transparent cutouts; the signal overlays are authored SVGs and rasterized PNGs. The 10-second video is a deterministic FFmpeg composition of these sources, not captured road footage. The same vehicle paths and signal timing are represented in `../index.html` and `../render.sh`.

Regenerate the video from the repository root with:

```sh
bash video/demo-traffic/render.sh
```

The generated clip and its independent annotations are in `example/demo-traffic-video/`. Do not treat the synthetic sample as real-world detection validation.
