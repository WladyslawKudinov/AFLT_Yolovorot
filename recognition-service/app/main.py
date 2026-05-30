from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from minio import Minio
import imageio.v3 as iio
from app.SeekableMinioStream import SeekableMinioStream
from app.config import settings
from app.prototypical_service_utils import (
    load_prototypes, save_prototypes, classify_segments_with_prototypes,
    seg_model_extract_segments_from_file, EnhancedDINOv2
)
from app.visualization_utils import class_name_manager, VisualizationUtils
from io import BytesIO
from PIL import Image
import cv2
import os
import random
import torch
import json
import logging
from datetime import datetime
from ultralytics import YOLO
import av
import joblib
from sklearn.isotonic import IsotonicRegression
import torchvision.models as models
import torch.nn as nn
import numpy as np
import pickle
from typing import Dict

app = FastAPI()

# Флаг для управления визуализацией и сохранением фоток
ENABLE_IMAGE_VISUALIZATION = False  # Установить False для отключения визуализации

# Настройка логгера для детального логирования распознавания инструментов
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('tool_recognition.log')
    ]
)
logger = logging.getLogger('tool_recognition')

MODEL_PATH = 'model/best.pt'
EMBEDDING_MODEL_PATH = 'model/embed_model.pth'
PROTOTYPES_PATH = 'model/class_prototypes.pkl'
CLASS_NAMES_PATH = 'model/class_names.pkl'

# Загружаем модель с обработкой ошибок совместимости
try:
    yolo_model = YOLO(MODEL_PATH)
except Exception as e:
    print(f"Ошибка загрузки модели: {e}")
    print("Попытка загрузки модели с игнорированием ошибок...")
    import torch
    # Попробуем загрузить модель с map_location и strict=False
    try:
        checkpoint = torch.load(MODEL_PATH, map_location='cpu', weights_only=False)
        yolo_model = YOLO(MODEL_PATH)
    except Exception as e2:
        print(f"Критическая ошибка загрузки модели: {e2}")
        raise e2

# Глобальные переменные для прототипов и модели эмбеддингов
embed_model = None
class_prototypes = {}
class_names = {}  # Словарь для хранения соответствия ID классов и их названий

minio_client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=False
)
class KeyRequest(BaseModel):
    key: str


class SegmentationResponse(BaseModel):
    status: str
    score: float
    bbox: list[float]
    mask: list[list[float]]
    object_key: str
    message: str


class PrototypeKeyPair(BaseModel):
    imageKey: str
    segmentationFileKey: str

class PrototypeAdditionDataDto(BaseModel):
    className: str  # Название класса для нового прототипа
    prototypes: list[PrototypeKeyPair]  # Массив пар ключей изображение-сегментация


def load_class_names(path: str) -> Dict[int, str]:
    """Загружает сохранённые названия классов."""
    if not os.path.exists(path):
        print(f"[Class Names] No class names file found at {path}, starting empty.")
        return {}
    with open(path, "rb") as f:
        data = pickle.load(f)
    print(f"[Class Names] Loaded {len(data)} class names from {path}")
    return data

def save_class_names(path: str, data: Dict[int, str]):
    """Сохраняет названия классов в pickle."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(data, f)
    print(f"[Class Names] Saved {len(data)} class names to {path}")

@app.on_event("startup")
async def startup_event():
    global iso_calibrator, embed_model, class_prototypes, class_names, viz_utils
    
    logger.info(f"🚀 ЗАПУСК СЕРВИСА РАСПОЗНАВАНИЯ ИНСТРУМЕНТОВ")
    logger.info(f"📂 Загружаем модели и конфигурацию...")
    
    # Инициализируем утилиты визуализации
    viz_utils = VisualizationUtils(class_name_manager)
    logger.info(f"🎨 Инициализированы утилиты визуализации")
    
    logger.info(f"🔄 Загрузка калибратора...")
    iso_calibrator = joblib.load('model/maxprob_isotonic_base11-21.pkl')
    iso_calibrator = iso_calibrator["isotonic"]
    logger.info(f"✅ Калибратор загружен успешно")
    
    # Загружаем модель эмбеддингов
    try:
        logger.info(f"🔄 Загрузка модели эмбеддингов...")
        # Загружаем state_dict
        state_dict = torch.load(EMBEDDING_MODEL_PATH, map_location='cpu')
        
        # Создаем DINOv2 backbone (как в обучении)
        try:
            # Пробуем загрузить DINOv2 (как в вашем коде обучения)
            model_name = "dinov2_vitl14"
            dinov2_base = torch.hub.load('facebookresearch/dinov2', model_name)
            print(f"Загружена модель {model_name}")
        except Exception as e:
            print("Не удалось загрузить vitl14, пробуем vits14...", e)
            model_name = "dinov2_vits14"
            dinov2_base = torch.hub.load('facebookresearch/dinov2', model_name)
            print(f"Загружена модель {model_name}")
        
        # Определяем количество классов из state_dict
        # Ищем ключи classifier.weight чтобы понять размерность
        num_classes = None
        for key in state_dict.keys():
            if key.startswith('classifier.weight'):
                num_classes = state_dict[key].shape[0]
                break
        
        print(f"Detected {num_classes} classes from saved model")
        
        # Создаем полную модель EnhancedDINOv2 с тем же количеством классов
        embed_model = EnhancedDINOv2(
            backbone=dinov2_base,
            projection_dim=256,
            num_classes=num_classes,  # Используем то же количество классов
            unfreeze_last_n_blocks=2,
            use_cls_token=False
        )
        
        # Загружаем сохраненные веса
        embed_model.load_state_dict(state_dict)
        embed_model.eval()
        print(f"[Startup] Loaded DINOv2 embedding model from {EMBEDDING_MODEL_PATH}")
    except Exception as e:
        print(f"[Startup] Error loading embedding model: {e}")
    
    # Загружаем прототипы
    logger.info(f"🔄 Загрузка прототипов...")
    class_prototypes = load_prototypes(PROTOTYPES_PATH)
    logger.info(f"✅ Прототипы загружены: {len(class_prototypes)} классов")
    if class_prototypes:
        logger.info(f"   - Доступные классы: {list(class_prototypes.keys())}")
    
    # Загружаем названия классов
    logger.info(f"🔄 Загрузка названий классов...")
    class_names = load_class_names(CLASS_NAMES_PATH)
    logger.info(f"✅ Названия классов загружены: {len(class_names)} классов")
    if class_names:
        logger.info(f"   - Доступные названия: {list(class_names.items())}")
    
    logger.info(f"🎉 ВСЕ МОДЕЛИ ЗАГРУЖЕНЫ УСПЕШНО!")
    logger.info(f"📊 Статус сервиса:")
    logger.info(f"   - YOLO модель: ✅ Загружена")
    logger.info(f"   - Модель эмбеддингов: {'✅ Загружена' if embed_model is not None else '❌ Не загружена'}")
    logger.info(f"   - Прототипы: ✅ {len(class_prototypes)} классов")
    logger.info(f"   - Названия классов: ✅ {len(class_names)} классов")
    logger.info(f"   - Калибратор: ✅ Загружен")

def calibrate_score(conf):
    cal_score = iso_calibrator.transform([conf])[0]
    return cal_score
    

@app.post("/recognize")
async def recognize(request: KeyRequest):
    key = request.key
    bucket_raw = settings.minio_bucket_raw
    bucket_processed = settings.minio_bucket_processed
    
    # Логирование начала процесса распознавания
    logger.info(f"🔍 НАЧАЛО РАСПОЗНАВАНИЯ ИНСТРУМЕНТОВ")
    logger.info(f"📁 Файл: {key}")
    logger.info(f"🪣 Bucket (raw): {bucket_raw}")
    logger.info(f"🪣 Bucket (processed): {bucket_processed}")
    
    try:
        logger.info(f"📥 Загружаем файл из MinIO...")
        response = minio_client.get_object(bucket_raw, key)
        file_data = response.read()
        response.close()
        response.release_conn()
        
        file_size = len(file_data)
        logger.info(f"✅ Файл загружен успешно. Размер: {file_size:,} байт ({file_size/1024:.1f} KB)")

        print(f"Response: {response}")

        preprocess_results = {}
        sizes = []

        filename = key.split("/")[-1]
        job_id = key.split("/")[0]
        name, ext = os.path.splitext(filename)
        ext = ext.lower()
        
        logger.info(f"📋 Информация о файле:")
        logger.info(f"   - Имя файла: {filename}")
        logger.info(f"   - Job ID: {job_id}")
        logger.info(f"   - Расширение: {ext}")
        logger.info(f"   - Базовое имя: {name}")

        if ext in [".jpg", ".jpeg", ".png"]:
            logger.info(f"🖼️  Обрабатываем изображение...")
            # Сохраняем временный файл для обработки
            temp_image_path = f"/tmp/temp_image_{job_id}_{name}.{ext[1:]}"
            logger.info(f"💾 Сохраняем временный файл: {temp_image_path}")
            with open(temp_image_path, 'wb') as f:
                f.write(file_data)
            
            try:
                # Используем новую функцию для извлечения сегментов
                logger.info(f"🔍 ИЗВЛЕЧЕНИЕ СЕГМЕНТОВ ИЗ ИЗОБРАЖЕНИЯ")
                logger.info(f"📂 Путь к изображению: {temp_image_path}")
                logger.info(f"🎯 Используем YOLO модель для сегментации...")
                
                segments, masks, confs = seg_model_extract_segments_from_file(
                    image_path=temp_image_path,
                    seg_file=None,
                    seg_model=yolo_model,
                    padding=10
                )
                
                logger.info(f"✅ Сегментация завершена!")
                logger.info(f"📊 Найдено сегментов: {len(segments)}")
                logger.info(f"🎭 Найдено масок: {len(masks)}")
                logger.info(f"🎯 Найдено confidence scores: {len(confs)}")
                
                if len(segments) == 0:
                    logger.warning(f"⚠️  ИНСТРУМЕНТЫ НЕ НАЙДЕНЫ!")
                    logger.warning(f"   Модель не обнаружила никаких инструментов в изображении")
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "status": "no_detections",
                            "message": "Model didn't detect any known tool in the image.",
                        }
                    )

                # Классифицируем сегменты с помощью прототипов
                logger.info(f"🧠 КЛАССИФИКАЦИЯ ИНСТРУМЕНТОВ")
                if embed_model is not None and len(class_prototypes) > 0:
                    logger.info(f"🎯 Используем модель прототипов для классификации")
                    logger.info(f"   - Модель эмбеддингов: ✅ Загружена")
                    logger.info(f"   - Количество прототипов: {len(class_prototypes)}")
                    logger.info(f"   - Классы прототипов: {list(class_prototypes.keys())}")
                    
                    predicted_classes, predicted_sims = classify_segments_with_prototypes(
                        segments, embed_model, class_prototypes
                    )
                    
                    logger.info(f"✅ Классификация с прототипами завершена")
                    logger.info(f"   - Предсказанные классы: {predicted_classes}")
                else:
                    logger.info(f"🔄 Fallback к оригинальной YOLO логике")
                    if embed_model is None:
                        logger.warning(f"   - Модель эмбеддингов: ❌ Не загружена")
                    if len(class_prototypes) == 0:
                        logger.warning(f"   - Прототипы: ❌ Не загружены")
                    
                    img = Image.open(BytesIO(file_data)).convert('RGB')
                    results = yolo_model(img, conf=0.5, iou=0.5)
                    predicted_classes = [int(box.cls[0]) for box in results[0].boxes]
                    
                    logger.info(f"✅ YOLO классификация завершена")
                    logger.info(f"   - Предсказанные классы: {predicted_classes}")
                
                # Обрабатываем каждый сегмент
                logger.info(f"🔧 ОБРАБОТКА РАСПОЗНАННЫХ ИНСТРУМЕНТОВ")
                
                # Список для визуализации
                detections_for_viz = []
                
                for i, (segment, mask, conf, pred_class, pred_sim) in enumerate(zip(segments, masks, confs, predicted_classes, predicted_sims)):
                    logger.info(f"🔨 ИНСТРУМЕНТ #{i+1}")
                    logger.info(f"   - Исходный confidence: {conf:.4f}")
                    logger.info(f"   - Предсказанный класс: {pred_class}")
                    logger.info(f"   - Размер сегмента: {segment.shape}")
                    logger.info(f"   - Размер маски: {len(mask) if mask else 0} точек")
                    
                    if embed_model is not None and len(class_prototypes) > 0:
                        # Используем предсказанный класс из прототипов
                        class_id = pred_class
                        
                        # Получаем название класса из сохраненных названий или используем fallback
                        if class_id in class_names:
                            russian_class_name = class_names[class_id]
                            micro_class = russian_class_name
                        else:
                            russian_class_name = class_name_manager.get_russian_name(class_id)
                            micro_class = f"prototype_class_{class_id}" if class_id != -1 else "unknown"
                        
                        pred_sim_calibrated = float(calibrate_score(pred_sim))
                        logger.info(f"   - Используем прототипную классификацию")
                        logger.info(f"   - Класс ID: {class_id}")
                        logger.info(f"   - Название класса: {russian_class_name}")
                        logger.info(f"   - Микро-класс: {micro_class}")
                        logger.info(f"   - Калиброванный confidence: {conf:.4f}")
                    else:
                        # Fallback к оригинальной логике
                        class_id = pred_class
                        russian_class_name = class_name_manager.get_russian_name(class_id)
                        micro_class = yolo_model.names[class_id]
                        conf = float(calibrate_score(conf))
                        logger.info(f"   - Используем YOLO классификацию")
                        logger.info(f"   - Класс ID: {class_id}")
                        logger.info(f"   - Русское название: {russian_class_name}")
                        logger.info(f"   - Микро-класс: {micro_class}")
                        logger.info(f"   - Калиброванный confidence: {conf:.4f}")
                    
                    # Получаем bbox из маски или используем весь сегмент
                    if len(mask) > 0:
                        mask_points = np.array(mask)
                        x_min, y_min = np.min(mask_points, axis=0)
                        x_max, y_max = np.max(mask_points, axis=0)
                        xyxy = [float(x_min), float(y_min), float(x_max), float(y_max)]
                        logger.info(f"   - Bbox из маски: [{x_min:.1f}, {y_min:.1f}, {x_max:.1f}, {y_max:.1f}]")
                    else:
                        # Если маска пустая, используем размеры сегмента
                        h, w = segment.shape[:2]
                        xyxy = [0.0, 0.0, float(w), float(h)]
                        logger.info(f"   - Bbox из сегмента: [0.0, 0.0, {w:.1f}, {h:.1f}]")
                    
                    base_key = os.path.splitext(key)[0]
                    object_key = f"{base_key}/{micro_class}_{i}.json"
                    logger.info(f"   - Object key: {object_key}")

                    detection_obj = {
                        "source_image_key": key,
                        "object_key": object_key,
                        "class_id": class_id,
                        "micro_class": russian_class_name,
                        "confidence": pred_sim_calibrated,
                        "bbox": xyxy,
                        "mask": mask,
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }

                    data_bytes = json.dumps(detection_obj, ensure_ascii=False).encode("utf-8")
                    object_key = detection_obj["object_key"]
                    
                    logger.info(f"   - Размер JSON данных: {len(data_bytes)} байт")
                    logger.info(f"   - Сохраняем в MinIO...")

                    minio_client.put_object(
                        bucket_name=bucket_processed,
                        object_name=object_key,
                        data=BytesIO(data_bytes),
                        length=len(data_bytes),
                        content_type="application/json"
                    )
                    
                    logger.info(f"   ✅ Сохранено в MinIO: {object_key}")

                    preprocess_results[object_key] = {
                        "microClass": russian_class_name,
                        "confidence": pred_sim_calibrated,
                        "bbox": xyxy,
                        "mask": mask,
                    }
                    sizes.append(f"{len(data_bytes) // 1024}KB")
                    
                    # Добавляем данные для визуализации
                    detections_for_viz.append({
                        "class_id": class_id,
                        "confidence": pred_sim_calibrated,
                        "bbox": xyxy,
                        "mask": mask
                    })
                    
                    logger.info(f"   ✅ Инструмент #{i+1} обработан успешно")
                
                # Создаем визуализацию, если есть детекции и включен флаг
                if detections_for_viz and ENABLE_IMAGE_VISUALIZATION:
                    logger.info(f"🎨 СОЗДАНИЕ ВИЗУАЛИЗАЦИИ")
                    try:
                        viz_filename = f"{job_id}_{name}_visualization.jpg"
                        viz_path = viz_utils.visualize_detections(
                            image_path=temp_image_path,
                            detections=detections_for_viz,
                            output_filename=viz_filename
                        )
                        logger.info(f"✅ Визуализация сохранена: {viz_path}")
                        
                        # Добавляем путь к визуализации в результаты
                        preprocess_results["_visualization"] = {
                            "path": viz_path,
                            "filename": viz_filename,
                            "detections_count": len(detections_for_viz)
                        }
                    except Exception as e:
                        logger.error(f"❌ Ошибка создания визуализации: {e}")
                elif detections_for_viz and not ENABLE_IMAGE_VISUALIZATION:
                    logger.info(f"🎨 Визуализация отключена флагом ENABLE_IMAGE_VISUALIZATION")
                    
            finally:
                # Удаляем временный файл
                logger.info(f"🧹 Очистка временных файлов...")
                if os.path.exists(temp_image_path):
                    os.remove(temp_image_path)
                    logger.info(f"   ✅ Временный файл удален: {temp_image_path}")
                else:
                    logger.info(f"   ℹ️  Временный файл не найден: {temp_image_path}")
                    
        else:
            logger.error(f"❌ Неподдерживаемый тип файла: {ext}")
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    except HTTPException as e:
        logger.error(f"❌ HTTP Exception: {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ Неожиданная ошибка: {str(e)}")
        raise HTTPException(status_code=500, detail={"status": "error", "message": str(e)})

    # Итоговая статистика
    logger.info(f"🎉 РАСПОЗНАВАНИЕ ЗАВЕРШЕНО УСПЕШНО!")
    logger.info(f"📊 ИТОГОВАЯ СТАТИСТИКА:")
    # Подсчитываем количество инструментов (исключая визуализацию)
    tool_count = len([k for k in preprocess_results.keys() if k != "_visualization"])
    logger.info(f"   - Всего инструментов найдено: {tool_count}")
    
    # Подсчет по типам инструментов
    tool_types = {}
    for key, result in preprocess_results.items():
        # Пропускаем специальный ключ визуализации
        if key == "_visualization":
            continue
        tool_class = result["microClass"]
        tool_types[tool_class] = tool_types.get(tool_class, 0) + 1
    
    logger.info(f"   - Типы инструментов:")
    for tool_type, count in tool_types.items():
        logger.info(f"     * {tool_type}: {count} шт.")
    
    total_size = sum([int(size.replace("KB", "")) for size in sizes])
    logger.info(f"   - Общий размер данных: {total_size} KB")
    logger.info(f"   - Сохранено файлов: {len(sizes)}")

    return JSONResponse(content={
        "status": "ok",
        "results": preprocess_results,
        "size": sizes,
        "message": "Processed successfully"
    })


@app.post("/video/cut")
async def video_preprocess(request: KeyRequest):
    key = request.key
    bucket_raw = settings.minio_bucket_raw

    try:
        response = minio_client.get_object(bucket_raw, key)
        stream = SeekableMinioStream(response)

        job_id = key.split("/")[0]
        filename = os.path.basename(key)
        name, ext = os.path.splitext(filename)

        if ext.lower() != ".mp4":
            raise HTTPException(status_code=400, detail="Not an mp4 file")

        container = av.open(stream)
        video_stream = container.streams.video[0]

        total_frames = int(video_stream.frames or 0)
        if total_frames == 0:
            raise HTTPException(status_code=400, detail="Video has no frames")

        num_frames = min(3, total_frames)
        frame_indices = sorted(random.sample(range(total_frames), num_frames))
        preprocess_results = {}
        sizes = []

        for idx, target in enumerate(frame_indices):
            container.seek(int(target / video_stream.average_rate * av.time_base))
            frame = next(container.decode(video_stream))
            buffer = BytesIO()
            frame.to_image().save(buffer, format="JPEG", quality=95)
            buffer.seek(0)

            object_key = f"{job_id}/{name}/frame{idx}.jpg"
            minio_client.put_object(
                bucket_name=bucket_raw,
                object_name=object_key,
                data=buffer,
                length=buffer.getbuffer().nbytes,
                content_type="image/jpeg"
            )

            preprocess_results[f"frame_{idx}"] = object_key
            sizes.append(f"{buffer.getbuffer().nbytes // 1024}KB")
            buffer.close()

        container.close()
        response.close()

    except Exception as e:
        raise HTTPException(status_code=500, detail={"status": "error", "message": str(e)})

    return JSONResponse(content={
        "status": "ok",
        "results": preprocess_results,
        "size": sizes,
        "message": f"Extracted {len(preprocess_results)} frames successfully"
    })

def strip_extension(key: str) -> str:
    return os.path.splitext(key)[0]


@app.post("/segmentation", response_model=SegmentationResponse)
async def segmentation(request: KeyRequest):
    key = request.key
    bucket_raw = settings.minio_bucket_raw
    bucket_processed = settings.minio_bucket_processed
    
    # Логирование начала процесса сегментации
    logger.info(f"🔍 НАЧАЛО СЕГМЕНТАЦИИ ИНСТРУМЕНТА")
    logger.info(f"📁 Файл: {key}")
    logger.info(f"🪣 Bucket (raw): {bucket_raw}")
    logger.info(f"🪣 Bucket (processed): {bucket_processed}")
    
    try:
        logger.info(f"📥 Загружаем файл из MinIO...")
        # Get image from MinIO
        response = minio_client.get_object(bucket_raw, key)
        file_data = response.read()
        response.close()
        response.release_conn()
        
        file_size = len(file_data)
        logger.info(f"✅ Файл загружен успешно. Размер: {file_size:,} байт ({file_size/1024:.1f} KB)")

        filename = key.split("/")[-1]
        job_id = key.split("/")[0]
        name, ext = os.path.splitext(filename)
        ext = ext.lower()
        
        logger.info(f"📋 Информация о файле:")
        logger.info(f"   - Имя файла: {filename}")
        logger.info(f"   - Job ID: {job_id}")
        logger.info(f"   - Расширение: {ext}")
        logger.info(f"   - Базовое имя: {name}")

        if ext.lower() not in [".jpg", ".jpeg", ".png"]:
            logger.error(f"❌ Неподдерживаемый тип файла: {ext}")
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

        logger.info(f"🖼️  Обрабатываем изображение...")
        # Load image and run YOLO segmentation
        img = Image.open(BytesIO(file_data)).convert('RGB')
        logger.info(f"🎯 Запускаем YOLO сегментацию...")
        logger.info(f"   - Confidence threshold: 0.5")
        logger.info(f"   - IoU threshold: 0.5")
        
        results = yolo_model(img, conf=0.5, iou=0.5)
        
        logger.info(f"✅ YOLO сегментация завершена!")
        logger.info(f"📊 Найдено детекций: {len(results[0].boxes)}")

        if len(results[0].boxes) == 0:
            logger.warning(f"⚠️  ОБЪЕКТЫ НЕ НАЙДЕНЫ!")
            logger.warning(f"   Модель не обнаружила никаких объектов в изображении")
            raise HTTPException(
                status_code=422,
                detail={
                    "status": "no_detections",
                    "message": "Model didn't detect any objects in the image.",
                }
            )

        logger.info(f"🔧 ОБРАБОТКА ПЕРВОЙ ДЕТЕКЦИИ")
        # Get the first detection
        box = results[0].boxes[0]
        class_id = int(box.cls[0])
        micro_class = yolo_model.names[class_id]
        russian_class_name = class_name_manager.get_russian_name(class_id)
        conf = float(calibrate_score(float(box.conf[0])))
        xyxy = [float(x) for x in box.xyxy[0].tolist()]
        bbox_str = f"[{xyxy[0]}, {xyxy[1]}, {xyxy[2]}, {xyxy[3]}]"
        
        logger.info(f"🎯 Детекция:")
        logger.info(f"   - Класс ID: {class_id}")
        logger.info(f"   - Микро-класс: {micro_class}")
        logger.info(f"   - Русское название: {russian_class_name}")
        logger.info(f"   - Исходный confidence: {float(box.conf[0]):.4f}")
        logger.info(f"   - Калиброванный confidence: {conf:.4f}")
        logger.info(f"   - Bbox: {bbox_str}")
        
        # Extract mask if available
        mask_data = []
        if hasattr(results[0], 'masks') and results[0].masks is not None:
            logger.info(f"🎭 Извлекаем маску...")
            # Get mask for the first detection
            mask = results[0].masks.xy[0]  # Get polygon points
            mask_data = [[float(x), float(y)] for x, y in mask]
            logger.info(f"   ✅ Маска извлечена: {len(mask_data)} точек")
        else:
            logger.info(f"   ℹ️  Маска недоступна")
        
        # Prepare segmentation result
        segmentation_result = {
            "source_image_key": key,
            "class_id": class_id,
            "micro_class": russian_class_name,
            "confidence": conf,
            "bbox": xyxy,
            "mask": mask_data,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        
        logger.info(f"💾 СОХРАНЕНИЕ РЕЗУЛЬТАТА СЕГМЕНТАЦИИ")
        # Save to MinIO: job_id/imagename/segmentation.json
        object_key = f"{job_id}/{name}/segmentation.json"
        data_bytes = json.dumps(segmentation_result, ensure_ascii=False).encode("utf-8")
        
        logger.info(f"   - Object key: {object_key}")
        logger.info(f"   - Размер JSON данных: {len(data_bytes)} байт")
        logger.info(f"   - Сохраняем в MinIO...")
        
        minio_client.put_object(
            bucket_name=bucket_processed,
            object_name=object_key,
            data=BytesIO(data_bytes),
            length=len(data_bytes),
            content_type="application/json"
        )
        
        logger.info(f"   ✅ Результат сегментации сохранен: {object_key}")
        
        # Создаем визуализацию сегментации, если включен флаг
        if ENABLE_IMAGE_VISUALIZATION:
            logger.info(f"🎨 СОЗДАНИЕ ВИЗУАЛИЗАЦИИ СЕГМЕНТАЦИИ")
            try:
                # Сохраняем временный файл для визуализации
                temp_image_path = f"/tmp/segmentation_{job_id}_{name}.{ext[1:]}"
                logger.info(f"💾 Сохраняем временный файл: {temp_image_path}")
                with open(temp_image_path, 'wb') as f:
                    f.write(file_data)
                
                # Подготавливаем данные для визуализации
                detection_for_viz = {
                    "class_id": class_id,
                    "confidence": conf,
                    "bbox": xyxy,
                    "mask": mask_data
                }
                
                viz_filename = f"{job_id}_{name}_segmentation_visualization.jpg"
                viz_path = viz_utils.visualize_detections(
                    image_path=temp_image_path,
                    detections=[detection_for_viz],
                    output_filename=viz_filename
                )
                logger.info(f"✅ Визуализация сегментации сохранена: {viz_path}")
                
            except Exception as e:
                logger.error(f"❌ Ошибка создания визуализации сегментации: {e}")
            finally:
                # Удаляем временный файл
                if os.path.exists(temp_image_path):
                    os.remove(temp_image_path)
                    logger.info(f"🧹 Временный файл удален: {temp_image_path}")
        else:
            logger.info(f"🎨 Визуализация сегментации отключена флагом ENABLE_IMAGE_VISUALIZATION")
        
        # Итоговая статистика
        logger.info(f"🎉 СЕГМЕНТАЦИЯ ЗАВЕРШЕНА УСПЕШНО!")
        logger.info(f"📊 ИТОГОВАЯ СТАТИСТИКА:")
        logger.info(f"   - Найденный класс: {russian_class_name} (ID: {class_id})")
        logger.info(f"   - Confidence: {conf:.4f}")
        logger.info(f"   - Точки маски: {len(mask_data)}")
        logger.info(f"   - Размер данных: {len(data_bytes)} байт")
        
        return SegmentationResponse(
            status="success",
            score=conf,
            bbox=xyxy,
            mask=mask_data,
            object_key=object_key,
            message=f"Segmentation saved successfully ({len(data_bytes)} bytes)"
        )

    except HTTPException as e:
        logger.error(f"❌ HTTP Exception: {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ Неожиданная ошибка при сегментации: {str(e)}")
        raise HTTPException(status_code=500, detail={"status": "error", "message": str(e)})


@app.post("/prototypes/add")
async def add_prototypes(prototype_data: PrototypeAdditionDataDto):
    """
    Добавление прототипа в модель
    """
    global class_prototypes, class_names
    
    # Логирование начала процесса добавления прототипов
    logger.info(f"🔧 НАЧАЛО ДОБАВЛЕНИЯ ПРОТОТИПОВ")
    logger.info(f"📊 Название класса: {prototype_data.className}")
    logger.info(f"📊 Количество прототипов: {len(prototype_data.prototypes)}")
    logger.info(f"🪣 Bucket (raw): {settings.minio_bucket_raw}")
    logger.info(f"🪣 Bucket (processed): {settings.minio_bucket_processed}")
    
    if embed_model is None:
        logger.error(f"❌ Модель эмбеддингов не загружена!")
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "message": "Embedding model not loaded"}
        )
    
    logger.info(f"✅ Модель эмбеддингов: Загружена")
    logger.info(f"📈 Текущее количество прототипов: {len(class_prototypes)}")
    
    bucket_raw = settings.minio_bucket_raw
    bucket_processed = settings.minio_bucket_processed
    added_prototypes = []
    
    try:
        # Собираем все эмбеддинги для класса
        all_embeddings = []
        
        for idx, prototype in enumerate(prototype_data.prototypes):
            logger.info(f"🔨 ОБРАБОТКА ПРОТОТИПА #{idx + 1}")
            logger.info(f"   - Image Key: {prototype.imageKey}")
            logger.info(f"   - Segmentation Key: {prototype.segmentationFileKey}")
            logger.info(f"   - Class Name: {prototype_data.className}")
            
            # Получаем изображение из MinIO
            try:
                logger.info(f"📥 Загружаем изображение из MinIO...")
                response = minio_client.get_object(bucket_raw, prototype.imageKey)
                image_data = response.read()
                response.close()
                response.release_conn()
                
                image_size = len(image_data)
                logger.info(f"✅ Изображение загружено. Размер: {image_size:,} байт ({image_size/1024:.1f} KB)")
                
            except Exception as e:
                logger.error(f"❌ Ошибка загрузки изображения {prototype.imageKey}: {e}")
                continue
            
            # Получаем файл сегментации из MinIO
            try:
                logger.info(f"📥 Загружаем файл сегментации из MinIO...")
                seg_response = minio_client.get_object(bucket_processed, prototype.segmentationFileKey)
                seg_data = seg_response.read()
                seg_response.close()
                seg_response.release_conn()
                
                seg_size = len(seg_data)
                logger.info(f"✅ Файл сегментации загружен. Размер: {seg_size} байт")
                
                # Парсим JSON с данными сегментации
                seg_json = json.loads(seg_data.decode('utf-8'))
                mask_points = seg_json.get('mask', [])
                
                logger.info(f"📋 Данные сегментации:")
                logger.info(f"   - Точки маски: {len(mask_points)}")
                logger.info(f"   - Класс ID: {seg_json.get('class_id', 'N/A')}")
                logger.info(f"   - Confidence: {seg_json.get('confidence', 'N/A')}")
                
                if not mask_points:
                    logger.warning(f"⚠️  Маска пуста в файле {prototype.segmentationFileKey}")
                    continue
                    
            except Exception as e:
                logger.error(f"❌ Ошибка загрузки файла сегментации {prototype.segmentationFileKey}: {e}")
                continue
            
            # Создаем временные файлы
            temp_image_path = f"/tmp/prototype_image_{idx}.jpg"
            temp_seg_path = f"/tmp/prototype_seg_{idx}.json"
            
            logger.info(f"💾 Создаем временные файлы...")
            logger.info(f"   - Изображение: {temp_image_path}")
            logger.info(f"   - Сегментация: {temp_seg_path}")
            
            try:
                # Сохраняем изображение
                with open(temp_image_path, 'wb') as f:
                    f.write(image_data)
                
                # Сохраняем данные сегментации
                with open(temp_seg_path, 'w') as f:
                    json.dump(seg_json, f)
                
                logger.info(f"✅ Временные файлы созданы")
                
                # Извлекаем сегмент по маске
                logger.info(f"🎭 ИЗВЛЕЧЕНИЕ СЕГМЕНТА ПО МАСКЕ")
                img = Image.open(temp_image_path).convert('RGB')
                image_np = np.array(img)
                
                logger.info(f"   - Размер изображения: {image_np.shape}")
                logger.info(f"   - Количество точек маски: {len(mask_points)}")
                
                # Вырезаем сегмент по маске
                from app.prototypical_service_utils import extract_segment_old
                segment = extract_segment_old(image_np, mask_points, padding=10)
                
                logger.info(f"   - Размер извлеченного сегмента: {segment.shape if segment.size > 0 else 'Пустой'}")
                
                if segment.size == 0:
                    logger.warning(f"⚠️  Пустой сегмент извлечен для прототипа {idx + 1}")
                    continue
                
                # Создаем визуализацию извлеченного сегмента, если включен флаг
                if ENABLE_IMAGE_VISUALIZATION:
                    logger.info(f"🎨 СОЗДАНИЕ ВИЗУАЛИЗАЦИИ ИЗВЛЕЧЕННОГО СЕГМЕНТА")
                    try:
                        # Подготавливаем данные для визуализации
                        detection_for_viz = {
                            "class_id": seg_json.get('class_id', 0),
                            "confidence": seg_json.get('confidence', 0.0),
                            "bbox": seg_json.get('bbox', []),
                            "mask": mask_points
                        }
                        
                        viz_filename = f"prototype_{idx+1}_{os.path.basename(prototype.imageKey)}_segment_visualization.jpg"
                        viz_path = viz_utils.visualize_detections(
                            image_path=temp_image_path,
                            detections=[detection_for_viz],
                            output_filename=viz_filename
                        )
                        logger.info(f"✅ Визуализация сегмента сохранена: {viz_path}")
                        
                    except Exception as e:
                        logger.error(f"❌ Ошибка создания визуализации сегмента: {e}")
                else:
                    logger.info(f"🎨 Визуализация сегмента отключена флагом ENABLE_IMAGE_VISUALIZATION")
                
                # Преобразуем сегмент в тензор и получаем эмбеддинг
                logger.info(f"🧠 СОЗДАНИЕ ЭМБЕДДИНГА ПРОТОТИПА")
                from app.prototypical_service_utils import segments_to_batch_tensor, embed_batch
                batch = segments_to_batch_tensor([segment])
                logger.info(f"   - Размер батча: {batch.shape}")
                
                embedding = embed_batch(embed_model, batch)[0]  # Берем первый (и единственный) эмбеддинг
                logger.info(f"   - Размер эмбеддинга: {embedding.shape}")
                
                # Добавляем эмбеддинг в список для усреднения
                all_embeddings.append(embedding)
                
                added_prototypes.append({
                    "image_key": prototype.imageKey,
                    "segmentation_key": prototype.segmentationFileKey,
                    "mask_points": len(mask_points)
                })
                
                logger.info(f"🎉 Прототип #{idx + 1} успешно обработан")
                
            finally:
                # Удаляем временные файлы
                logger.info(f"🧹 Очистка временных файлов...")
                for temp_file in [temp_image_path, temp_seg_path]:
                    if os.path.exists(temp_file):
                        os.remove(temp_file)
                        logger.info(f"   ✅ Удален: {temp_file}")
                    else:
                        logger.info(f"   ℹ️  Файл не найден: {temp_file}")
        
        # Создаем усредненный прототип из всех эмбеддингов
        new_class_id = None
        if all_embeddings:
            logger.info(f"🧠 СОЗДАНИЕ УСРЕДНЕННОГО ПРОТОТИПА")
            import torch
            import torch.nn.functional as F
            
            # Усредняем все эмбеддинги
            stacked_embeddings = torch.stack(all_embeddings)
            mean_embedding = torch.mean(stacked_embeddings, dim=0)
            mean_embedding = F.normalize(mean_embedding, p=2, dim=0)  # Нормализуем
            
            logger.info(f"   - Количество эмбеддингов для усреднения: {len(all_embeddings)}")
            logger.info(f"   - Размер усредненного эмбеддинга: {mean_embedding.shape}")
            
            # Добавляем новый класс
            new_class_id = max(class_prototypes.keys()) + 1 if class_prototypes else 1
            class_prototypes[new_class_id] = mean_embedding
            
            # Сохраняем название класса
            class_names[new_class_id] = prototype_data.className
            
            logger.info(f"✅ Класс добавлен как #{new_class_id} с названием '{prototype_data.className}'")
            
            # Сохраняем обновленные прототипы
            logger.info(f"💾 Сохраняем обновленные прототипы...")
            # save_prototypes(PROTOTYPES_PATH, class_prototypes)
            logger.info(f"✅ Прототипы сохранены в {PROTOTYPES_PATH}")
            
            # Сохраняем обновленные названия классов
            logger.info(f"💾 Сохраняем обновленные названия классов...")
            # save_class_names(CLASS_NAMES_PATH, class_names)
            logger.info(f"✅ Названия классов сохранены в {CLASS_NAMES_PATH}")
        
        # Итоговая статистика
        logger.info(f"🎉 ДОБАВЛЕНИЕ ПРОТОТИПОВ ЗАВЕРШЕНО!")
        logger.info(f"📊 ИТОГОВАЯ СТАТИСТИКА:")
        logger.info(f"   - Название класса: {prototype_data.className}")
        logger.info(f"   - Запрошено прототипов: {len(prototype_data.prototypes)}")
        logger.info(f"   - Успешно обработано: {len(added_prototypes)}")
        logger.info(f"   - Общее количество прототипов: {len(class_prototypes)}")
        
        if not added_prototypes:
            logger.warning(f"⚠️  НИ ОДИН ПРОТОТИП НЕ БЫЛ ДОБАВЛЕН!")
            raise HTTPException(
                status_code=422,
                detail={"status": "error", "message": "No prototypes were successfully added"}
            )
        
        return JSONResponse(content={
            "status": "ok",
            "message": f"Successfully added class '{prototype_data.className}' with {len(added_prototypes)} prototype(s)",
            "class_name": prototype_data.className,
            "class_id": new_class_id if all_embeddings else None,
            "processed_prototypes": added_prototypes,
            "total_prototypes": len(class_prototypes)
        })
        
    except HTTPException as e:
        logger.error(f"❌ HTTP Exception: {e.detail}")
        raise e
    except Exception as e:
        logger.error(f"❌ Неожиданная ошибка при добавлении прототипов: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={"status": "error", "message": f"Error adding prototypes: {str(e)}"}
        )
