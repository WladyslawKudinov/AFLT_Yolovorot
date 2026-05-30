from typing import Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket_raw: str = "bucket-raw"
    minio_bucket_processed: str = "bucket-processed"
    minio_secure: bool = False
    
    label_studio_url: str = "http://localhost:8888"
    label_studio_api_token: Optional[str] = None
    label_studio_project_name: str = "Aeroflot_Reannotated"
    label_studio_project_id: Optional[int] = None
    
    polygon_max_points: int = 20
    polygon_epsilon: float = 1.0
    
    port: int = 8003

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
