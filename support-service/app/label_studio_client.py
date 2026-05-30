import requests
import time
from typing import Dict, Any, List, Optional
from app.config import settings


class LabelStudioClient:
    def __init__(self):
        self.base_url = settings.label_studio_url.rstrip('/')
        self.api_url = f"{self.base_url}/api"
        self.project_name = settings.label_studio_project_name
        self.token = settings.label_studio_api_token
        self.project_id = settings.label_studio_project_id
    
    def _get_headers(self) -> Dict[str, str]:
        if not self.token:
            raise Exception("LABEL_STUDIO_API_TOKEN не настроен в .env")
        
        return {"Authorization": f"Token {self.token}"}
    
    def wait_for_label_studio(self, max_retries: int = 30, delay: int = 2):
        for i in range(max_retries):
            try:
                response = requests.get(f"{self.base_url}/health", timeout=5)
                if response.status_code == 200:
                    return True
            except:
                pass
            time.sleep(delay)
        
        raise Exception("Label Studio недоступен")
    
    def get_or_create_project(self) -> int:
        if self.project_id:
            return self.project_id
        
        headers = self._get_headers()
        
        response = requests.get(f"{self.api_url}/projects", headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            projects = data if isinstance(data, list) else data.get('results', [])
            
            for project in projects:
                if project.get("title") == self.project_name:
                    self.project_id = project["id"]
                    print(f"Найден проект '{self.project_name}' (ID: {self.project_id})")
                    return self.project_id
            
            print(f"Создание проекта '{self.project_name}'...")
            return self._create_project(headers)
        else:
            raise Exception(f"Ошибка получения проектов: {response.status_code}")
    
    def _create_project(self, headers: Dict[str, str]) -> int:
        label_config = """<View>
  <Image name="image" value="$image"/>
  <PolygonLabels name="polygon" toName="image" strokeWidth="3" pointSize="small" opacity="0.9">
    <Label value="Object" background="red"/>
  </PolygonLabels>
</View>"""
        
        response = requests.post(
            f"{self.api_url}/projects",
            headers=headers,
            json={"title": self.project_name, "label_config": label_config},
            timeout=10
        )
        
        if response.status_code == 201:
            project = response.json()
            self.project_id = project["id"]
            print(f"Проект '{self.project_name}' создан (ID: {self.project_id})")
            return self.project_id
        else:
            raise Exception(f"Ошибка создания проекта: {response.status_code}")
    
    def create_task(self, image_url: str) -> int:
        if not self.project_id:
            self.get_or_create_project()
        
        response = requests.post(
            f"{self.api_url}/projects/{self.project_id}/tasks",
            headers=self._get_headers(),
            json={"data": {"image": image_url}},
            timeout=10
        )
        
        if response.status_code == 201:
            task_id = response.json()["id"]
            print(f"Создана задача {task_id}")
            return task_id
        else:
            raise Exception(f"Ошибка создания задачи: {response.status_code}")
    
    def import_predictions(self, task_id: int, predictions: List[Dict[str, Any]]):
        if not self.project_id:
            self.get_or_create_project()
        
        requests.post(
            f"{self.api_url}/predictions",
            headers=self._get_headers(),
            json={"task": task_id, "result": predictions, "score": 0.85},
            timeout=10
        )
    
    def get_task_by_image(self, image_url: str) -> Optional[int]:
        if not self.project_id:
            self.get_or_create_project()
        
        try:
            response = requests.get(
                f"{self.api_url}/projects/{self.project_id}/tasks",
                headers=self._get_headers(),
                timeout=10
            )
            
            if response.status_code == 200:
                for task in response.json():
                    if task.get("data", {}).get("image") == image_url:
                        return task["id"]
        except:
            pass
            
        return None


label_studio_client = LabelStudioClient()
