from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    minio_endpoint: str
    minio_access_key: str
    minio_secret_key: str
    minio_bucket_raw: str
    minio_bucket_processed: str
    
    class Config:
        env_file = ".env"

settings = Settings()