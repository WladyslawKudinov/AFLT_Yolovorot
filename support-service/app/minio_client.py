import json
import io
from typing import Dict, Any, Tuple
from minio import Minio
from PIL import Image
from app.config import settings


class MinioClient:
    def __init__(self):
        self.client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure
        )
    
    def get_image(self, object_key: str, bucket: str = None) -> Tuple[Image.Image, bytes]:
        if bucket is None:
            bucket = settings.minio_bucket_processed
        
        try:
            response = self.client.get_object(bucket, object_key)
            image_bytes = response.read()
            response.close()
            
            image = Image.open(io.BytesIO(image_bytes))
            
            return image, image_bytes
        except Exception as e:
            raise Exception(f"Ошибка при загрузке изображения из MinIO: {e}")
    
    def get_json(self, object_key: str, bucket: str = None) -> Dict[str, Any]:
        if bucket is None:
            bucket = settings.minio_bucket_processed
        
        try:
            response = self.client.get_object(bucket, object_key)
            json_bytes = response.read()
            response.close()
            
            markup_data = json.loads(json_bytes.decode('utf-8'))
            
            return markup_data
        except Exception as e:
            raise Exception(f"Ошибка при загрузке JSON из MinIO: {e}")
    
    def upload_file(self, bucket: str, object_key: str, data: bytes, content_type: str = "application/octet-stream"):
        try:
            self.client.put_object(
                bucket,
                object_key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type
            )
        except Exception as e:
            raise Exception(f"Ошибка при загрузке файла в MinIO: {e}")
    
    def ensure_buckets_exist(self):
        buckets = [settings.minio_bucket_raw, settings.minio_bucket_processed]
        
        for bucket in buckets:
            try:
                if not self.client.bucket_exists(bucket):
                    self.client.make_bucket(bucket)
                    print(f"Создан бакет: {bucket}")
            except Exception as e:
                print(f"Ошибка при проверке/создании бакета {bucket}: {e}")


minio_client = MinioClient()
