from fastapi import FastAPI
from fastapi.responses import JSONResponse
from minio import Minio
from pydantic import BaseModel
from typing import Optional, Tuple, Any, Dict
from io import BytesIO
import json
import os
import re
from datetime import datetime

from PIL import Image
import torch
from transformers import AutoProcessor, AutoModelForCausalLM

from app.config import settings

app = FastAPI()

# MinIO client
minio_client = Minio(
    settings.minio_endpoint,
    access_key=settings.minio_access_key,
    secret_key=settings.minio_secret_key,
    secure=False
)

# DTO
class EnrichmentRequest(BaseModel):
    raw_file_key: str
    processed_file_key: str

# Патч для отключения flash_attn в динамических импортерах HF (Florence-2)
def _patch_hf_dynamic_imports():
    try:
        import transformers.dynamic_module_utils as dmu
        _orig_get_imports = dmu.get_imports

        def patched_get_imports(filename):
            imports = _orig_get_imports(filename)
            try:
                fn = str(filename)
            except Exception:
                fn = ""
            if fn.endswith("modeling_florence2.py") and "flash_attn" in imports:
                imports = [imp for imp in imports if imp != "flash_attn"]
            return imports

        dmu.get_imports = patched_get_imports
    except Exception:
        # Если что-то пошло не так — просто продолжаем без патча (на CPU обычно ок)
        pass

# OCR сервис-обертка
class OCRService:
    def __init__(self, model_id: str = "microsoft/Florence-2-large"):
        _patch_hf_dynamic_imports()

        self.model = AutoModelForCausalLM.from_pretrained(
            model_id,
            trust_remote_code=True,
            torch_dtype=torch.float32  # CPU
        ).eval()

        self.processor = AutoProcessor.from_pretrained(
            model_id,
            trust_remote_code=True
        )

    def _process_model_output(self, text: str) -> Optional[str]:
        """
        Извлекает и форматирует коды вида:
        - AT-XXXXXXX
        - AT-XXXXXX-X
        Возвращает строку в формате AT-XXXXXX-X.
        """
        match = re.search(r"AT-\d{6}-\d", text)
        if match:
            return match.group()
        
        match = re.search(r"AT-\d{6}", text)
        if match:
            return match.group()

        match = re.search(r"AT-\d{7}", text)
        if match:
            code = match.group()
            return code[:-1] + "-" + code[-1]

        return None


    def run_ocr(self, image: Image.Image) -> Tuple[Optional[str], str]:
        """
        Возвращает (processed_marking, raw_output)
        processed_marking может быть None, если ничего не найдено.
        """
        prompt = "<OCR>"
        inputs = self.processor(text=prompt, images=image.convert("RGB"), return_tensors="pt")

        with torch.no_grad():
            generated_ids = self.model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=1024,
                early_stopping=False,
                do_sample=False,
                num_beams=3,
            )

        raw_output = self.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        processed = self._process_model_output(raw_output)
        return processed, raw_output


def get_image_from_minio(bucket: str, object_name: str) -> Image.Image:
    resp = None
    try:
        resp = minio_client.get_object(bucket, object_name)
        data = resp.read()
        img = Image.open(BytesIO(data)).convert("RGB")
        return img
    finally:
        if resp is not None:
            resp.close()
            resp.release_conn()

def get_json_from_minio(bucket: str, object_name: str) -> Dict[str, Any]:
    resp = None
    try:
        resp = minio_client.get_object(bucket, object_name)
        data = resp.read()
        meta = json.loads(data.decode("utf-8"))
        return meta
    finally:
        if resp is not None:
            resp.close()
            resp.release_conn()

def extract_bbox(meta: Dict[str, Any]) -> Optional[Tuple[int, int, int, int]]:
    """
    Пытается извлечь bbox из meta.
    Поддерживает форматы:
    - {"bbox": [x1, y1, x2, y2]}
    - {"bbox": {"x1":..., "y1":..., "x2":..., "y2":...}}
    - {"bboxes": [[x1, y1, x2, y2], ...]} — берём первый
    """
    if "bbox" in meta:
        bbox = meta["bbox"]
        if isinstance(bbox, list) and len(bbox) == 4:
            return tuple(int(v) for v in bbox)
        if isinstance(bbox, dict):
            keys = ["x1", "y1", "x2", "y2"]
            if all(k in bbox for k in keys):
                return tuple(int(bbox[k]) for k in keys)
    if "bboxes" in meta and isinstance(meta["bboxes"], list) and meta["bboxes"]:
        first = meta["bboxes"][0]
        if isinstance(first, list) and len(first) == 4:
            return tuple(int(v) for v in first)
    return None

@app.on_event("startup")
def load_model_on_startup():
    app.state.ocr_service = OCRService()
    print("OCR модель успешно загружена и готова к работе")

@app.post("/enrich")
async def enrich(request: EnrichmentRequest):
    import traceback

    print("\n--- /enrich called ---")
    print("Request:", request.dict())

    raw_bucket = getattr(settings, "minio_bucket_raw")
    processed_bucket = getattr(settings, "minio_bucket_processed")

    try:
        print(f"Step 1: Fetching image from minio: bucket={raw_bucket}, key={request.raw_file_key}")
        img = get_image_from_minio(raw_bucket, request.raw_file_key)
        print(f"Step 1: Image loaded. Size: {img.size}")

        print(f"Step 2: Fetching meta from minio: bucket={processed_bucket}, key={request.processed_file_key}")
        meta = get_json_from_minio(processed_bucket, request.processed_file_key)
        print(f"Step 2: Meta loaded: {meta}")
        bbox = extract_bbox(meta)
        print(f"Step 2: Extracted bbox: {bbox}")

        cropped_img = img
        if bbox is not None:
            x1, y1, x2, y2 = bbox
            w, h = img.size
            x1 = max(0, min(x1, w))
            x2 = max(0, min(x2, w))
            y1 = max(0, min(y1, h))
            y2 = max(0, min(y2, h))
            print(f"Step 3: Crop coords cleaned: ({x1}, {y1}, {x2}, {y2}), img.size: {img.size}")
            if x2 > x1 and y2 > y1:
                cropped_img = img.crop((x1, y1, x2, y2))
                print(f"Step 3: Image cropped. New size: {cropped_img.size}")
            else:
                print("Step 3: Invalid bbox, skip crop.")
        else:
            print("Step 3: No bbox, skipping crop.")

        print("Step 4: Running Florence OCR on cropped image.")
        ocr_service: OCRService = app.state.ocr_service
        marking, _raw = ocr_service.run_ocr(cropped_img)
        print("Step 4: OCR result - marking:", marking)
        print("Step 4: OCR result - raw_output:", _raw)

        print("--- /enrich completed OK ---\n")
        return JSONResponse(content={
            "marking": marking,
            "raw_output": _raw,
            "bbox": bbox,
            "meta": meta
        })
    except Exception as e:
        print("!!! /enrich EXCEPTION:", str(e))
        print(traceback.format_exc())
        print("--- /enrich failed ---\n")
        return JSONResponse(content={
            "marking": None,
            "error": str(e),
            "trace": traceback.format_exc()
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8002, reload=True)