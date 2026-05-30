import os
import json
import torch
import torch.nn as nn
import numpy as np
from PIL import Image
from torchvision import models, transforms
from typing import Optional, Tuple

class ModelService:
    def __init__(
        self,
        weights_path: str,
        classes_order_path: Optional[str] = None,
        fallback_classes_txt: Optional[str] = None,
        device: Optional[str] = None
    ):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        print(f"Модель использует устройство: {self.device}")

        self.class_names = None
        if classes_order_path and os.path.exists(classes_order_path):
            with open(classes_order_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.class_names = data.get("classes_in_order")
                print(f"Загружено {len(self.class_names)} классов из {classes_order_path}")
        
        if not self.class_names and fallback_classes_txt and os.path.exists(fallback_classes_txt):
            with open(fallback_classes_txt, "r", encoding="utf-8") as f:
                self.class_names = [line.strip() for line in f.readlines()]
            print(f"Загружено {len(self.class_names)} классов из {fallback_classes_txt} (fallback)")
        
        if not self.class_names:
            raise RuntimeError("Не удалось загрузить имена классов. Передайте class_to_idx.json или classes.txt")

        print(f"Загрузка модели ResNet50 из {weights_path}")
        self.model = models.resnet50(weights=None)
        num_ftrs = self.model.fc.in_features
        self.model.fc = nn.Linear(num_ftrs, len(self.class_names))
        
        state = torch.load(weights_path, map_location=self.device)
        self.model.load_state_dict(state)
        self.model.to(self.device)
        self.model.eval()
        print("Модель успешно загружена")

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

        self.name_to_id = {name: idx for idx, name in enumerate(self.class_names, start=1)}

    @torch.no_grad()
    def predict_pil(self, image: Image.Image) -> Tuple[str, int, float]:
        """
        Предсказывает класс для PIL изображения
        
        Args:
            image: PIL изображение
            
        Returns:
            Tuple[str, int, float]: (имя_класса, id_класса, уверенность)
        """
        image = image.convert("RGB")
        x = self.transform(image).unsqueeze(0).to(self.device)
        logits = self.model(x)
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
        top_idx = int(np.argmax(probs))
        top_conf = float(probs[top_idx])
        class_name = self.class_names[top_idx]
        class_id = self.name_to_id[class_name]
        return class_name, class_id, top_conf
