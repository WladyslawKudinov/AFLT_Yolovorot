import torch
import numpy as np
from PIL import Image
from PIL import ImageOps
import torch.nn.functional as F
import os
import joblib
import pickle
import logging
from io import BytesIO
from typing import List, Dict, Tuple, Optional
from ultralytics import YOLO
import torch.nn as nn
import torchvision.models as models
from torchvision import transforms
import cv2

# Настройка логгера для утилит
logger = logging.getLogger('prototypical_utils')

# ============================================================
#                МОДЕЛЬ DINOv2 (из обучения)
# ============================================================

class ProjectionHead(nn.Module):
    def __init__(self, input_dim, hidden_dim=512, output_dim=256, dropout=0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.Dropout(dropout),
            nn.LayerNorm(output_dim)
        )
    
    def forward(self, x):
        return nn.functional.normalize(self.net(x), p=2, dim=1)

class EnhancedDINOv2(nn.Module):
    def __init__(self, backbone, projection_dim=256, num_classes=None, unfreeze_last_n_blocks=0, use_cls_token=False):
        super().__init__()
        self.backbone = backbone
        self.num_classes = num_classes
        self.use_cls_token = use_cls_token
        
        # Вычисляем dim фичей
        with torch.no_grad():
            dummy = torch.randn(1,3,224,224)
            out = self.backbone(dummy)
            if out.ndim == 2:
                backbone_out_dim = out.shape[1]
            else:
                if self.use_cls_token:
                    backbone_out_dim = out.shape[-1]
                else:
                    backbone_out_dim = out.mean(dim=1).shape[1]
        
        # Проекционная голова
        self.projection = ProjectionHead(input_dim=backbone_out_dim, output_dim=projection_dim)
        
        # Классификационный head (если нужен)
        if num_classes is not None:
            self.classifier = nn.Linear(projection_dim, num_classes)
        
        # Заморозка backbone
        for p in self.backbone.parameters():
            p.requires_grad = False
        
        # Разморозка последних блоков
        blocks_attr = None
        if hasattr(self.backbone, "blocks"):
            blocks_attr = self.backbone.blocks
        elif hasattr(self.backbone, "transformer") and hasattr(self.backbone.transformer, "blocks"):
            blocks_attr = self.backbone.transformer.blocks
        
        if unfreeze_last_n_blocks > 0 and blocks_attr is not None:
            for block in blocks_attr[-unfreeze_last_n_blocks:]:
                for p in block.parameters():
                    p.requires_grad = True
    
    def forward(self, x, return_logits=False):
        feats = self.backbone(x)
        if feats.ndim > 2:
            if self.use_cls_token:
                feats = feats[:, 0, :]
            else:
                feats = feats.mean(dim=1)
        
        proj = self.projection(feats)
        
        if return_logits and hasattr(self, "classifier"):
            logits = self.classifier(proj)
            return proj, logits
        
        return proj

# ============================================================
#                ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ============================================================

def _pad_to_square_pil(pil_img: Image.Image, fill=(0, 0, 0)) -> Image.Image:
    w, h = pil_img.size
    max_side = max(w, h)
    delta_w = max_side - w
    delta_h = max_side - h
    padding = (delta_w // 2, delta_h // 2, delta_w - delta_w // 2, delta_h - delta_h // 2)
    return ImageOps.expand(pil_img, padding, fill=fill)


imagenet_preprocess = transforms.Compose([
    lambda img: _pad_to_square_pil(img, fill=(0, 0, 0)),
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def extract_segment_old(image_np: np.ndarray, mask_points: List[List[float]], padding: int = 10) -> np.ndarray:
    """
    Вырезает сегмент объекта по маске (списку точек) из изображения,
    зануляя фон за пределами полигона. Возвращает RGB массив.
    """
    if len(mask_points) == 0:
        return image_np

    h, w = image_np.shape[:2]

    pts = np.array(mask_points, dtype=np.float32)
    pts = np.round(pts).astype(np.int32)

    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [pts], 255)

    x, y, bw, bh = cv2.boundingRect(pts)
    x1 = max(0, x - padding)
    y1 = max(0, y - padding)
    x2 = min(w, x + bw + padding)
    y2 = min(h, y + bh + padding)

    roi = image_np[y1:y2, x1:x2]
    mask_roi = mask[y1:y2, x1:x2]

    if roi.ndim == 2:
        roi = cv2.cvtColor(roi, cv2.COLOR_GRAY2RGB)
    elif roi.shape[2] == 4:
        roi = cv2.cvtColor(roi, cv2.COLOR_RGBA2RGB)

    foreground = np.zeros_like(roi)
    foreground[mask_roi == 255] = roi[mask_roi == 255]
    return foreground


def segments_to_batch_tensor(segments: List[np.ndarray], device: str = "cpu") -> torch.Tensor:
    """
    Преобразует список numpy-сегментов в батч тензоров, используя torchvision-пайплайн
    (pad-to-square -> Resize(224) -> ToTensor -> Normalize ImageNet).
    """
    imgs_t = []
    for seg in segments:
        pil = Image.fromarray(seg).convert("RGB")
        img_t = imagenet_preprocess(pil)
        imgs_t.append(img_t)
    batch = torch.stack(imgs_t, dim=0).to(device)
    return batch


def embed_batch(embed_model, batch: torch.Tensor) -> torch.Tensor:
    """
    Прогоняет батч сегментов через модель эмбеддингов.
    Возвращает L2-нормированные эмбеддинги.
    """
    with torch.no_grad():
        embeddings = embed_model(batch)
        embeddings = F.normalize(embeddings, p=2, dim=1)
    return embeddings


def cosine_similarity(a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
    """
    Косинусная близость между эмбеддингами.
    a: (N, D)
    b: (M, D)
    Возвращает (N, M)
    """
    return torch.mm(a, b.T)


# ============================================================
#                РАБОТА С ПРОТОТИПАМИ
# ============================================================

def load_prototypes(path: str) -> Dict[int, torch.Tensor]:
    """
    Загружает сохранённые прототипы (torch.Tensor) и нормализует их по L2.
    """
    if not os.path.exists(path):
        print(f"[Prototypes] No prototype file found at {path}, starting empty.")
        return {}
    with open(path, "rb") as f:
        data = pickle.load(f)
    print(f"[Prototypes] Loaded {len(data)} prototypes from {path}")

    for k, v in data.items():
        if not isinstance(v, torch.Tensor):
            v = torch.tensor(v, dtype=torch.float32)
        data[k] = F.normalize(v, p=2, dim=0)

    print(f"[Prototypes] Normalized all prototype vectors (L2 = 1)")
    return data



def save_prototypes(path: str, data: Dict[int, torch.Tensor]):
    """
    Сохраняет прототипы в pickle.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(data, f)
    print(f"[Prototypes] Saved {len(data)} prototypes to {path}")


def classify_segments_with_prototypes(
    segments: List[np.ndarray],
    embed_model,
    class_prototypes: Dict[int, torch.Tensor],
    normalize: bool = True
) -> List[int]:
    """
    Сравнивает каждый сегмент с прототипами, возвращает предсказанные классы.
    """
    logger.info(f"🧠 КЛАССИФИКАЦИЯ СЕГМЕНТОВ С ПРОТОТИПАМИ")
    logger.info(f"   - Количество сегментов: {len(segments)}")
    logger.info(f"   - Количество прототипов: {len(class_prototypes)}")
    
    if len(class_prototypes) == 0:
        logger.warning("[Prototypes] Warning: No prototypes loaded!")
        return [-1 for _ in segments]

    logger.info(f"🔄 Преобразование сегментов в батч тензоров...")
    batch = segments_to_batch_tensor(segments)
    logger.info(f"   - Размер батча: {batch.shape}")
    
    logger.info(f"🔄 Получение эмбеддингов...")
    embeds = embed_batch(embed_model, batch)
    logger.info(f"   - Размер эмбеддингов: {embeds.shape}")

    proto_ids = list(class_prototypes.keys())
    proto_embs = torch.stack([class_prototypes[i] for i in proto_ids])
    logger.info(f"   - Размер прототипных эмбеддингов: {proto_embs.shape}")
    
    logger.info(f"🔄 Вычисление косинусной близости...")
    sims = cosine_similarity(embeds, proto_embs)
    logger.info(f"   - Размер матрицы близости: {sims.shape}")

    preds_idx = torch.argmax(sims, dim=1)
    preds = [proto_ids[i.item()] for i in preds_idx]
    
    logger.info(f"📊 РЕЗУЛЬТАТЫ КЛАССИФИКАЦИИ:")
    predicted_sims = []
    for i, (pred, sim_scores) in enumerate(zip(preds, sims)):
        max_sim = torch.max(sim_scores).item()
        sim_softmax = torch.softmax(sim_scores, dim=0).cpu().numpy().reshape(1, -1)
        predicted_sims.append(sim_softmax.max(axis=1))
        logger.info(f"   - Сегмент #{i+1}: класс {pred}, максимальная близость: {max_sim:.4f}, softmax: {sim_softmax}")
        # Показываем все оценки близости
        sim_dict = {proto_ids[j]: sim_scores[j].item() for j in range(len(proto_ids))}
        logger.info(f"     Все оценки: {sim_dict}")
    
    return preds, predicted_sims


# ============================================================
#                СЕГМЕНТАЦИЯ С YOLOv11
# ============================================================

def seg_model_extract_segments_from_file(
    image_path: Optional[str],
    seg_file: Optional[str],
    seg_model: YOLO,
    padding: int = 10
) -> Tuple[List[np.ndarray], List[List[float]], List[float]]:
    """
    Получает сегменты объектов с помощью YOLOv11-сегментационной модели.

    Возвращает:
        segments: List[np.ndarray] — список вырезанных фрагментов (RGB)
        masks: List[List[float]] — списки точек масок
        confs: List[float] — confidence каждого объекта
    """
    logger.info(f"🔍 ИЗВЛЕЧЕНИЕ СЕГМЕНТОВ С ПОМОЩЬЮ YOLO")
    
    if image_path is None and seg_file is None:
        raise ValueError("Either image_path or seg_file must be provided")

    if image_path:
        logger.info(f"   - Загружаем изображение: {image_path}")
        img = Image.open(image_path).convert("RGB")
    else:
        logger.info(f"   - Загружаем изображение: {seg_file}")
        img = Image.open(seg_file).convert("RGB")

    logger.info(f"   - Размер изображения: {img.size}")
    logger.info(f"   - Режим изображения: {img.mode}")

    logger.info(f"🔄 Запуск YOLO модели...")
    results = seg_model(img)
    
    logger.info(f"   - Количество обнаруженных объектов: {len(results[0].boxes)}")
    
    if len(results[0].boxes) == 0:
        logger.warning(f"   ⚠️  Объекты не обнаружены!")
        return [], [], []

    image_np = np.array(img)
    masks_out = []
    confs = []
    segments = []

    logger.info(f"🔄 Обработка обнаруженных объектов...")
    for i, box in enumerate(results[0].boxes):
        conf = float(box.conf[0].cpu())
        confs.append(conf)
        logger.info(f"   - Объект #{i+1}: confidence = {conf:.4f}")

        if results[0].masks is not None:
            mask_xy = results[0].masks.xy[i].tolist()
            masks_out.append(mask_xy)
            logger.info(f"     - Найдена маска с {len(mask_xy)} точками")
            seg = extract_segment_old(image_np, mask_xy, padding=padding)
            segments.append(seg)
            logger.info(f"     - Размер сегмента: {seg.shape}")
        else:
            xyxy = [int(x) for x in box.xyxy[0].tolist()]
            x1, y1, x2, y2 = xyxy
            cropped = image_np[y1:y2, x1:x2]
            segments.append(cropped)
            masks_out.append([])
            logger.info(f"     - Bbox: [{x1}, {y1}, {x2}, {y2}]")
            logger.info(f"     - Размер сегмента: {cropped.shape}")

    logger.info(f"✅ Извлечение сегментов завершено")
    logger.info(f"   - Всего сегментов: {len(segments)}")
    logger.info(f"   - Всего масок: {len(masks_out)}")
    logger.info(f"   - Всего confidence scores: {len(confs)}")

    return segments, masks_out, confs


# ============================================================
#                ДОБАВЛЕНИЕ НОВЫХ КЛАССОВ
# ============================================================

def add_new_class_from_folder(
    folder_path: str,
    embed_model,
    class_prototypes: Dict[int, torch.Tensor],
    normalize: bool = True
):
    """
    Добавляет новый класс по изображениям из папки.
    Усредняет эмбеддинги для всех изображений.
    """
    imgs = []
    for fname in os.listdir(folder_path):
        if not fname.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        path = os.path.join(folder_path, fname)
        img = np.array(Image.open(path).convert("RGB"))
        imgs.append(img)

    if not imgs:
        print(f"[Prototypes] No valid images found in {folder_path}")
        return

    batch = segments_to_batch_tensor(imgs)
    embeds = embed_batch(embed_model, batch)
    mean_proto = torch.mean(embeds, dim=0)
    if normalize:
        mean_proto = F.normalize(mean_proto, p=2, dim=0)

    new_class_id = len(class_prototypes) + 1
    class_prototypes[new_class_id] = mean_proto
    print(f"[Prototypes] Added new class #{new_class_id} from {len(imgs)} images")

    return new_class_id
