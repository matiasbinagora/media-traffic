# PER-86 Inference Readiness Gate

Reviewed: 2026-10-26. Status: **NOT QUALIFIED**. No YOLO inference was run and no model or weights are selected for product use.

## Candidate and license review

YOLOX-S is a candidate for evaluation because the upstream project provides a 640-pixel COCO-pretrained detector and the YOLOX source repository is Apache-2.0 licensed. The upstream README links directly to checkpoint downloads, but the repository does not provide a distinct license notice for those pretrained checkpoint files. The checkpoints are described as COCO-pretrained; COCO's terms distinguish CC BY 4.0 annotations from third-party Flickr image rights. The software license alone is therefore insufficient to conclude that a specific checkpoint is cleared for this project's intended distribution or use. No checkpoint was downloaded or redistributed.

Sources:

- [YOLOX license](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/LICENSE)
- [YOLOX README and checkpoint links](https://github.com/Megvii-BaseDetection/YOLOX/blob/main/README.md#benchmark)
- [COCO terms of use](https://cocodataset.org/#termsofuse)
- [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/)
- [PyTorch MPS backend documentation](https://docs.pytorch.org/docs/stable/notes/mps.html)

Before selection, obtain an explicit license/source statement for the chosen checkpoint, including the model artifact and training-data provenance, and confirm it matches the project's intended use. This is an unresolved rights review, not a legal conclusion.

## Available machine and runtime

Observed locally: Apple M4 Max MacBook Pro, 16 CPU cores, 48 GB unified memory, macOS 27.0.1 ARM64. Python is 3.14.6. `torch`, `torchvision`, `onnxruntime`, `ultralytics`, `yolox`, `cv2`, and `numpy` are not installed in that Python environment. FFmpeg 9.0.2 is available. PyTorch documents an MPS device backend for Apple silicon, so this machine is a plausible hardware candidate, but this is not evidence that YOLOX or a specific checkpoint executes correctly or fast enough here.

No runtime or weight artifact has been exercised. The next gate must record the exact selected package/runtime version, checkpoint URI and SHA-256, device (`mps` or CPU), command/environment, successful real-video output, timings, and limitations. If MPS support or dependencies fail, report the failure and assess CPU separately; do not substitute annotations or fabricated detections.

## Gate decision

OpenSpec task 1.4 remains pending. Consequently, task 2.2's actual YOLO detectability and qualification report also remain pending. Manifest validation can verify the asset identity and independent annotations, but it cannot satisfy either inference gate.
