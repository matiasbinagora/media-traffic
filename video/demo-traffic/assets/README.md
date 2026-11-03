# Synthetic Demo Asset Provenance

These assets were first assembled for the PER-103 sample. `intersection.png` is a generated fixed-camera intersection without moving traffic; the three sedan PNGs are generated transparent cutouts; the signal overlays are authored SVGs and rasterized PNGs.

The PER-112 `example/demo-traffic-video/source.mp4` was rendered from the HyperFrames composition in `../index.html` (HyperFrames 0.8.206), not from the legacy FFmpeg `render.sh`. The legacy script's red-car orientation and paths differ from the qualified source and must not be used to regenerate or replace it. To render the qualified composition from the repository root, use:

```sh
npx hyperframes render --quality looks --output example/demo-traffic-video/source.mp4
```

Both render paths are synthetic, not captured road footage. The qualified clip and its independent annotations are in `example/demo-traffic-video/`. Do not treat the sample as real-world detection validation.
