from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "postgres"
    minio_secret_key: str = "postgres"
    minio_bucket_raw: str = "bucket-raw"
    minio_bucket_processed: str = "bucket-processed"

    class Config:
        env_file = ".env"

settings = Settings()