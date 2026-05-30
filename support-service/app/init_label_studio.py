import os
import json
import time
from app.label_studio_client import label_studio_client
from app.minio_client import minio_client


def init_label_studio():
    try:
        label_studio_client.wait_for_label_studio()
        project_id = label_studio_client.get_or_create_project()
        
        project_info_path = "/label-studio/data/.support_service_project_id.json"
        with open(project_info_path, 'w', encoding='utf-8') as f:
            json.dump({"project_id": project_id}, f)
        
        minio_client.ensure_buckets_exist()
        
        return project_id
        
    except Exception as e:
        print(f"Ошибка инициализации: {e}")
        return None


def load_project_id():
    project_info_path = "/label-studio/data/.support_service_project_id.json"
    
    if os.path.exists(project_info_path):
        try:
            with open(project_info_path, 'r', encoding='utf-8') as f:
                return json.load(f).get("project_id")
        except:
            pass
    
    return None


if __name__ == "__main__":
    init_label_studio()
