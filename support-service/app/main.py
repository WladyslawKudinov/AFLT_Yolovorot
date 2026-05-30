from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from contextlib import asynccontextmanager
import os
import base64

from app.config import settings
from app.minio_client import minio_client
from app.label_studio_client import label_studio_client
from app.polygon_simplifier import simplify_polygon, convert_mask_to_polygon
from app.init_label_studio import init_label_studio, load_project_id


@asynccontextmanager
async def lifespan(app: FastAPI):
    project_id = load_project_id()
    if project_id:
        label_studio_client.project_id = project_id
    else:
        project_id = init_label_studio()
        if project_id:
            label_studio_client.project_id = project_id
    
    yield


app = FastAPI(
    title="Support Service",
    description="Сервис для обработки разметки и отправки данных в Label Studio",
    version="1.0.0",
    lifespan=lifespan
)


class SegmentationObject(BaseModel):
    source_image_key: str
    object_key: str
    class_id: int
    micro_class: str
    confidence: float
    bbox: List[float]
    mask: List[List[float]]
    timestamp: str


class ReannotationDTO(BaseModel):
    imageKey: str
    annotations: Dict[str, str]


@app.get("/", tags=["Health"])
async def root():
    return {
        "service": "Support Service",
        "status": "running",
        "label_studio_url": settings.label_studio_url,
        "label_studio_project_id": label_studio_client.project_id
    }


@app.get("/health", tags=["Health"])
async def health_check():
    return {"status": "healthy"}


@app.post("/reannotation", tags=["Reannotation"])
async def process_markup(dto: ReannotationDTO):
    try:
        print(f"Обработка: imageKey={dto.imageKey}, аннотаций={len(dto.annotations)}")
        
        image, image_bytes = minio_client.get_image(dto.imageKey, bucket=settings.minio_bucket_raw)
        img_width, img_height = image.size
        
        label_studio_predictions = []
        
        for idx, (tool_name, annotation_key) in enumerate(dto.annotations.items()):
            try:
                annotation_data = minio_client.get_json(annotation_key, bucket=settings.minio_bucket_processed)
                seg_obj = SegmentationObject(**annotation_data)
                
                percent_contours = convert_mask_to_polygon(
                    seg_obj.mask,
                    img_width,
                    img_height
                )
                
                simplified_contours = simplify_polygon(
                    percent_contours,
                    epsilon=settings.polygon_epsilon,
                    max_points=settings.polygon_max_points
                )
                
                prediction = {
                    "id": f"result_{idx}",
                    "type": "polygon",
                    "from_name": "polygon",
                    "to_name": "image",
                    "original_width": img_width,
                    "original_height": img_height,
                    "image_rotation": 0,
                    "value": {
                        "points": simplified_contours,
                        "polygonlabels": [tool_name]
                    },
                    "score": seg_obj.confidence
                }
                
                label_studio_predictions.append(prediction)
                print(f"{tool_name}: упрощено с {len(percent_contours)} до {len(simplified_contours)} точек")
                
            except Exception as e:
                print(f"Ошибка при обработке {tool_name}: {e}")
                continue
        
        if not label_studio_predictions:
            raise HTTPException(status_code=400, detail="Не удалось обработать ни одной аннотации")
        
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        image_format = image.format.lower() if image.format else 'jpeg'
        image_url = f"data:image/{image_format};base64,{image_base64}"
        
        existing_task_id = label_studio_client.get_task_by_image(image_url)
        
        if existing_task_id:
            print(f"Задача с изображением уже существует: {existing_task_id}")
            task_id = existing_task_id
        else:
            print("Создание задачи в Label Studio...")
            task_id = label_studio_client.create_task(image_url)
        
        print("Импорт предсказаний в Label Studio...")
        label_studio_client.import_predictions(task_id, label_studio_predictions)
        
        print(f"Обработка завершена. Task ID: {task_id}")
        
        return JSONResponse(
            status_code=200,
            content={
                "status": "success",
                "message": "Разметка успешно обработана и отправлена в Label Studio",
                "task_id": task_id,
                "project_id": label_studio_client.project_id,
                "label_studio_url": f"{label_studio_client.base_url}/projects/{label_studio_client.project_id}/data?task={task_id}",
                "objects_count": len(label_studio_predictions),
                "image_size": f"{img_width}x{img_height}"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Ошибка при обработке запроса: {e}")
        raise HTTPException(status_code=500, detail=f"Внутренняя ошибка сервера: {str(e)}")


@app.post("/init-project", tags=["Admin"])
async def reinit_project():
    try:
        project_id = init_label_studio()
        
        if project_id:
            return JSONResponse(
                status_code=200,
                content={
                    "status": "success",
                    "project_id": project_id,
                    "message": "Проект успешно инициализирован"
                }
            )
        else:
            raise HTTPException(status_code=500, detail="Не удалось инициализировать проект")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка инициализации: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
