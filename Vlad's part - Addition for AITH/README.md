# Vlad's part — Synthetic Dataset Generation (Addition for AITH)

This folder contains my contribution to **YOLOvorot**: the **synthetic data
generation pipeline** used to train the tool-recognition model. It was built
separately during the hackathon and is added here to document and highlight
that part of the work.

The core problem: there was almost no real labelled imagery of the ~87 aviation
tools, and hand-annotating segmentation masks for thousands of photos is not
feasible in a hackathon. So instead of labelling data, I **generated** it —
producing thousands of composited images **with pixel-accurate YOLO
segmentation labels for free**, because the labels come from the compositing
geometry rather than from a human annotator.

## Pipeline overview

```
real tool photos          AI-generated Aeroflot                cut-out tool PNGs
(source_tool_photos/)     workbench backgrounds                (transparent, per class)
        │                 (01_ai_background_generator)                  │
        │                          │                                    │
        └──────────────┬───────────┘                                    │
                       ▼                                                 ▼
        background replacement on real shots          random compositing onto backgrounds
        (preserves existing YOLO boxes)               with scale + rotation + balancing
                       │                                                 │
                       └───────────────────┬─────────────────────────────┘
                                           ▼
                         synthetic images + YOLO labels
                         · labels_seg0  → single "tool" class (segmentation)
                         · labels_cls30 → per-tool class ids (30…86)
                                           ▼
                                 train YOLO seg / detection
```

## What's in here

| Folder | What it is |
| --- | --- |
| `01_ai_background_generator/` | `DataGenerator.ipynb` — generates realistic empty Aeroflot tool-cart / workbench **backgrounds** via the Replicate API, and replaces backgrounds on real tool photos **while preserving their YOLO bounding boxes**. Includes the generated `backgrounds/`. |
| `02_compose_synthetic_dataset/` | The main compositing engine. Pastes transparent tool cut-outs (`photos_wo_background/`) onto backgrounds with random scale, rotation and count, then derives **polygon segmentation labels directly from each cut-out's alpha channel**. Class balancing ensures every tool is represented. |
| `source_tool_photos/` | The original real photographs of the tools (screwdrivers, wrenches, контровка, etc.) used as seeds. |
| `sample_output/` | A 15-image sample of the generated dataset, with both label sets and `class_mapping.json`, so you can see the result without the multi-GB full set. |

### Key code

- **`02_compose_synthetic_dataset/compose_dataset.py`** — standalone, runnable
  version of the compositor. Reads `backgrounds/` + `photos_wo_background/`,
  writes images + `labels_seg0` (class 0) and `labels_cls30` (per-tool ids) in
  YOLO-seg polygon format. Contours are extracted from the alpha mask
  (`cv2.findContours` → `approxPolyDP`) and normalised to `[0,1]`.
- **`02_compose_synthetic_dataset/ComposeDataset.ipynb`** — higher-fidelity
  notebook variant: supersampling, alpha blur + light erosion, adaptive
  contour simplification, rotation rules and per-tool size rules.
- **`RemoveBackground.ipynb` / `Remover20.ipynb`** — turn raw tool photos into
  the transparent PNG cut-outs the compositor consumes.
- **`VisualizeSegmentations.ipynb`** — QA: overlays the generated polygons back
  onto the images to verify label correctness.

## Label format

YOLO segmentation, one object per line, coordinates normalised to image size:

```
<class_id> x1 y1 x2 y2 x3 y3 ...        # polygon, ≥3 points
```

- `labels_seg0/` → every object is class `0` (tool-vs-background segmentation).
- `labels_cls30/` → per-tool class ids starting at `30`; see
  `sample_output/class_mapping.json` for the id → tool-code mapping (87 tools).

## Running the compositor

```bash
cd "02_compose_synthetic_dataset"
pip install opencv-python numpy pillow
python compose_dataset.py        # writes ./dataset_out/{images,labels_seg0,labels_cls30}
```

The AI background notebook additionally needs a Replicate API token. **All API
tokens have been redacted** — set your own where you see
`YOUR_REPLICATE_API_TOKEN_HERE`.

## Notes

- The full generated dataset (~13 GB of images + several GB of intermediate
  zips and raw photos) is intentionally **not** committed; only generation code,
  the lightweight inputs needed to run it, and a small sample of outputs are
  included.
- Tool class codes (e.g. `415qr`, `65325170`, `13110`) follow the customer's
  internal tool catalogue.
