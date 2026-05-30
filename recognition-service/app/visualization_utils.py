# -*- coding: utf-8 -*-
import yaml
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import os
from typing import List, Dict, Tuple, Optional
import logging

logger = logging.getLogger('visualization')

class ClassNameManager:
    """Менеджер для загрузки и управления названиями классов"""
    
    def __init__(self, data_yaml_path: str = "model/data.yaml"):
        self.data_yaml_path = data_yaml_path
        self.class_names = {}
        self.russian_names = {}
        self.load_class_names()
    
    def load_class_names(self):
        """Загружает названия классов из data.yaml"""
        try:
            with open(self.data_yaml_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
            
            names = data.get('names', [])
            
            # Создаем словарь для русских названий (с индексами)
            for idx, name in enumerate(names):
                # Если название содержит кириллицу, считаем его русским
                if any('\u0400' <= char <= '\u04FF' for char in name):
                    self.russian_names[idx] = name
                else:
                    # Для английских названий используем их как есть
                    self.russian_names[idx] = name
            
            self.class_names = {idx: name for idx, name in enumerate(names)}
            
            logger.info(f"Загружены названия классов: {len(self.class_names)} классов")
            logger.info(f"Русские названия: {list(self.russian_names.values())}")
            
        except Exception as e:
            logger.error(f"Ошибка загрузки названий классов: {e}")
            self.class_names = {}
            self.russian_names = {}
    
    def get_russian_name(self, class_id: int) -> str:
        """Возвращает русское название класса по ID"""
        return self.russian_names.get(class_id, f"Класс_{class_id}")
    
    def get_all_russian_names(self) -> Dict[int, str]:
        """Возвращает все русские названия классов"""
        return self.russian_names.copy()

class VisualizationUtils:
    """Утилиты для визуализации масок и классов на изображениях"""
    
    def __init__(self, class_name_manager: ClassNameManager, dev_output_dir: str = "tmp/dev_visualizations"):
        self.class_name_manager = class_name_manager
        self.dev_output_dir = dev_output_dir
        self.ensure_dev_dir()
        
        # Цвета для разных классов (BGR формат для OpenCV)
        self.colors = [
            (255, 0, 0),    # Красный
            (0, 255, 0),    # Зеленый
            (0, 0, 255),    # Синий
            (255, 255, 0),  # Голубой
            (255, 0, 255),  # Пурпурный
            (0, 255, 255),  # Желтый
            (128, 0, 128),  # Фиолетовый
            (255, 165, 0),  # Оранжевый
            (0, 128, 0),    # Темно-зеленый
            (128, 128, 0),  # Оливковый
            (0, 0, 128),    # Темно-синий
            (128, 0, 0),    # Темно-красный
            (255, 192, 203), # Розовый
            (0, 128, 128),  # Темно-голубой
            (128, 128, 128), # Серый
            (192, 192, 192), # Серебристый
            (255, 255, 255), # Белый
            (0, 0, 0),      # Черный
            (139, 69, 19),  # Коричневый
            (75, 0, 130),   # Индиго
            (220, 20, 60),  # Малиновый
            (50, 205, 50),  # Лаймовый
        ]
    
    def ensure_dev_dir(self):
        """Создает папку для сохранения визуализаций"""
        if not os.path.exists(self.dev_output_dir):
            os.makedirs(self.dev_output_dir)
            logger.info(f"Создана папка для визуализаций: {self.dev_output_dir}")
    
    def get_color_for_class(self, class_id: int) -> Tuple[int, int, int]:
        """Возвращает цвет для класса"""
        return self.colors[class_id % len(self.colors)]
    
    def draw_mask_on_image(self, image: np.ndarray, mask_points: List[List[float]], 
                          color: Tuple[int, int, int], alpha: float = 0.3) -> np.ndarray:
        """Рисует маску на изображении"""
        if not mask_points:
            return image
        
        # Создаем копию изображения для маски
        mask_image = image.copy()
        
        # Преобразуем точки маски в numpy массив
        points = np.array(mask_points, dtype=np.int32)
        
        # Рисуем заполненный полигон
        cv2.fillPoly(mask_image, [points], color)
        
        # Накладываем маску с прозрачностью
        result = cv2.addWeighted(image, 1 - alpha, mask_image, alpha, 0)
        
        # Рисуем контур маски
        cv2.polylines(result, [points], isClosed=True, color=color, thickness=2)
        
        return result
    
    def draw_bbox_on_image(self, image: np.ndarray, bbox: List[float], 
                          color: Tuple[int, int, int], thickness: int = 2) -> np.ndarray:
        """Рисует bounding box на изображении"""
        x1, y1, x2, y2 = map(int, bbox)
        cv2.rectangle(image, (x1, y1), (x2, y2), color, thickness)
        return image
    
    def draw_text_on_image(self, image: np.ndarray, text: str, position: Tuple[int, int], 
                          color: Tuple[int, int, int], font_scale: float = 0.7, 
                          thickness: int = 2) -> np.ndarray:
        """Рисует текст на изображении"""
        # Для поддержки русского текста используем PIL
        pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(pil_image)
        
        # Пытаемся загрузить шрифт, поддерживающий кириллицу
        try:
            # На macOS
            font = ImageFont.truetype("/System/Library/Fonts/Arial.ttf", 20)
        except:
            try:
                # Альтернативный шрифт
                font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
            except:
                # Fallback к стандартному шрифту
                font = ImageFont.load_default()
        
        # Рисуем текст с фоном
        x, y = position
        bbox = draw.textbbox((x, y), text, font=font)
        
        # Рисуем фон для текста
        padding = 5
        bg_coords = [
            bbox[0] - padding, bbox[1] - padding,
            bbox[2] + padding, bbox[3] + padding
        ]
        draw.rectangle(bg_coords, fill=(0, 0, 0, 128))  # Полупрозрачный черный фон
        
        # Рисуем текст
        draw.text((x, y), text, fill=(255, 255, 255), font=font)
        
        # Конвертируем обратно в OpenCV формат
        result = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
        return result
    
    def visualize_detections(self, image_path: str, detections: List[Dict], 
                           output_filename: Optional[str] = None) -> str:
        """
        Создает визуализацию всех детекций на изображении
        
        Args:
            image_path: Путь к исходному изображению
            detections: Список детекций с полями: class_id, confidence, bbox, mask
            output_filename: Имя выходного файла (если не указано, генерируется автоматически)
        
        Returns:
            Путь к сохраненному файлу визуализации
        """
        # Загружаем изображение
        image = cv2.imread(image_path)
        if image is None:
            raise ValueError(f"Не удалось загрузить изображение: {image_path}")
        
        logger.info(f"Визуализация {len(detections)} детекций на изображении {image_path}")
        
        # Рисуем каждую детекцию
        for i, detection in enumerate(detections):
            class_id = detection.get('class_id', 0)
            confidence = detection.get('confidence', 0.0)
            bbox = detection.get('bbox', [])
            mask = detection.get('mask', [])
            
            # Получаем цвет и название для класса
            color = self.get_color_for_class(class_id)
            russian_name = self.class_name_manager.get_russian_name(class_id)
            
            logger.info(f"  Детекция {i+1}: {russian_name} (confidence: {confidence:.3f})")
            
            # Рисуем маску, если есть
            if mask:
                image = self.draw_mask_on_image(image, mask, color)
            
            # Рисуем bbox, если есть
            if bbox and len(bbox) == 4:
                image = self.draw_bbox_on_image(image, bbox, color)
            
            # Рисуем текст с названием класса и confidence
            if bbox and len(bbox) == 4:
                x1, y1, x2, y2 = bbox
                text = f"{russian_name}: {confidence:.3f}"
                text_position = (int(x1), int(y1) - 10)
                image = self.draw_text_on_image(image, text, text_position, color)
        
        # Генерируем имя выходного файла
        if output_filename is None:
            import datetime
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            base_name = os.path.splitext(os.path.basename(image_path))[0]
            output_filename = f"{base_name}_visualization_{timestamp}.jpg"
        
        # Сохраняем результат
        output_path = os.path.join(self.dev_output_dir, output_filename)
        cv2.imwrite(output_path, image)
        
        logger.info(f"Визуализация сохранена: {output_path}")
        return output_path

# Глобальный экземпляр менеджера классов
class_name_manager = ClassNameManager()
