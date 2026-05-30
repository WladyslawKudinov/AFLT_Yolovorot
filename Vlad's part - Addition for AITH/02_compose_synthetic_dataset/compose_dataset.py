import os
import json
import random
import uuid
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
from PIL import Image


SUPPORTED_BG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
SUPPORTED_FG_EXTS = {".png"}


def list_images(directory: Path, exts: set) -> List[Path]:
    return [p for p in directory.iterdir() if p.is_file() and p.suffix.lower() in exts]


def load_background(backgrounds_dir: Path) -> Image.Image:
    images = list_images(backgrounds_dir, SUPPORTED_BG_EXTS)
    if not images:
        raise RuntimeError(f"No background images found in: {backgrounds_dir}")
    bg_path = random.choice(images)
    bg = Image.open(bg_path).convert("RGB")
    return bg


def load_foregrounds(foregrounds_dir: Path) -> List[Path]:
    images = list_images(foregrounds_dir, SUPPORTED_FG_EXTS)
    if not images:
        raise RuntimeError(f"No foreground images (transparent PNGs) found in: {foregrounds_dir}")
    return images


def compute_contours_from_alpha(alpha: np.ndarray) -> List[np.ndarray]:
    # alpha: HxW uint8 [0..255]
    _, bin_mask = cv2.threshold(alpha, 0, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(bin_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    simplified: List[np.ndarray] = []
    for cnt in contours:
        if len(cnt) < 3:
            continue
        epsilon = 0.01 * cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, epsilon, True)
        if len(approx) >= 3:
            simplified.append(approx[:, 0, :])  # shape (N,2)
    return simplified


def place_foreground_on_bg(
    bg: Image.Image,
    fg_rgba: Image.Image,
    min_scale: float = 0.12,
    max_scale: float = 0.28,
) -> Tuple[Image.Image, Tuple[int, int], float]:
    bg_w, bg_h = bg.size
    fg_w, fg_h = fg_rgba.size

    scale = random.uniform(min_scale, max_scale)
    target_w = max(1, int(bg_w * scale))
    target_h = max(1, int(fg_h * (target_w / fg_w)))

    fg_resized = fg_rgba.resize((target_w, target_h), resample=Image.LANCZOS)

    max_x = max(0, bg_w - target_w)
    max_y = max(0, bg_h - target_h)
    x = random.randint(0, max_x) if max_x > 0 else 0
    y = random.randint(0, max_y) if max_y > 0 else 0

    return fg_resized, (x, y), scale


def transform_and_normalize_contour(
    contour_xy: np.ndarray,
    offset: Tuple[int, int],
    scale_ratio: float,
    original_fg_width: int,
    bg_size: Tuple[int, int],
) -> List[float]:
    # contour_xy in original fg coordinates
    # We used scaling based on width; compute full scale for both axes
    bg_w, bg_h = bg_size
    scale_x = scale_ratio  # applied to fg width relative to bg width in place_foreground_on_bg
    # But in place_foreground_on_bg we computed scale as target_w = bg_w * scale_ratio
    # So absolute scale from original to placed is target_w / original_fg_width
    abs_scale = (bg_w * scale_ratio) / max(1, original_fg_width)

    tx, ty = offset
    pts = contour_xy.astype(np.float32)
    pts = pts * abs_scale
    pts[:, 0] = (pts[:, 0] + tx) / max(1, bg_w)
    pts[:, 1] = (pts[:, 1] + ty) / max(1, bg_h)

    # Flatten to [x1 y1 x2 y2 ...]
    flat = []
    for x_norm, y_norm in pts:
        # clamp into [0,1]
        x_n = float(min(1.0, max(0.0, x_norm)))
        y_n = float(min(1.0, max(0.0, y_norm)))
        flat.extend([x_n, y_n])
    return flat


def compose_one(
    bg_img: Image.Image,
    fg_paths: List[Path],
    num_foregrounds: int,
) -> Tuple[Image.Image, List[Tuple[str, List[float]]]]:
    """Return composed image and list of (fg_class_name, polygon_flat)."""
    composed = bg_img.copy()
    bg_w, bg_h = composed.size
    placed_polygons: List[Tuple[str, List[float]]] = []

    chosen = random.sample(fg_paths, k=min(num_foregrounds, len(fg_paths)))

    for fg_path in chosen:
        fg = Image.open(fg_path).convert("RGBA")
        fg_resized, (x, y), scale_ratio = place_foreground_on_bg(composed, fg)

        # paste
        composed.paste(fg_resized, (x, y), mask=fg_resized.split()[-1])

        # compute contour from alpha at resized scale by recomputing on resized image
        alpha = np.array(fg_resized.split()[-1])  # HxW
        contours = compute_contours_from_alpha(alpha)
        if not contours:
            continue

        # For each contour, transform to absolute position and normalize
        orig_w, _ = fg.size
        for contour in contours:
            flat = transform_and_normalize_contour(
                contour, (x, y), scale_ratio, orig_w, (bg_w, bg_h)
            )
            # YOLO expects at least 3 points (6 numbers)
            if len(flat) >= 6:
                placed_polygons.append((fg_path.stem, flat))

    return composed, placed_polygons


def write_yolo_seg_labels(
    labels_path: Path,
    objects: List[Tuple[int, List[float]]],
) -> None:
    lines = []
    for cls_id, poly in objects:
        # YOLOv8/YOLOv5-seg format: cls x1 y1 x2 y2 ... (normalized)
        parts = [str(cls_id)] + [f"{v:.6f}" for v in poly]
        lines.append(" ".join(parts))
    labels_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    backgrounds_dir = base_dir / "backgrounds"
    cutouts_dir = base_dir / "photos_wo_background"

    out_images_dir = base_dir / "dataset_out" / "images"
    out_labels_seg0_dir = base_dir / "dataset_out" / "labels_seg0"
    out_labels_cls30_dir = base_dir / "dataset_out" / "labels_cls30"
    mapping_path = base_dir / "dataset_out" / "class_mapping.json"

    out_images_dir.mkdir(parents=True, exist_ok=True)
    out_labels_seg0_dir.mkdir(parents=True, exist_ok=True)
    out_labels_cls30_dir.mkdir(parents=True, exist_ok=True)

    # Load lists
    all_fgs = load_foregrounds(cutouts_dir)

    # Build class mapping (start at 30)
    class_name_to_id: Dict[str, int] = {}
    next_id = 30

    num_to_generate = 5  # stop after 5 composites as requested
    generated = 0

    while generated < num_to_generate:
        bg_img = load_background(backgrounds_dir)
        # Random number of instruments 5..11
        k = random.randint(5, 11)

        composed, placed = compose_one(bg_img, all_fgs, k)

        if not placed:
            # no objects placed, skip
            continue

        # Assign class ids for classification labels
        objects_seg0: List[Tuple[int, List[float]]] = []
        objects_cls30: List[Tuple[int, List[float]]] = []

        for cls_name, poly in placed:
            # segmentation set uses class 0
            objects_seg0.append((0, poly))

            # classification set uses class IDs starting from 30 per class name
            if cls_name not in class_name_to_id:
                class_name_to_id[cls_name] = next_id
                next_id += 1
            objects_cls30.append((class_name_to_id[cls_name], poly))

        # Save image
        img_id = uuid.uuid4().hex
        img_path = out_images_dir / f"{img_id}.jpg"
        # Convert to RGB (already), save JPEG
        composed.save(img_path, format="JPEG", quality=95)

        # Save labels
        seg0_label_path = out_labels_seg0_dir / f"{img_id}.txt"
        cls30_label_path = out_labels_cls30_dir / f"{img_id}.txt"
        write_yolo_seg_labels(seg0_label_path, objects_seg0)
        write_yolo_seg_labels(cls30_label_path, objects_cls30)

        generated += 1
        print(f"Generated {generated}/{num_to_generate}: {img_path.name}")

    # Write mapping
    mapping: Dict[str, str] = {str(v): k for k, v in class_name_to_id.items()}
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved class mapping to: {mapping_path}")


if __name__ == "__main__":
    main()



