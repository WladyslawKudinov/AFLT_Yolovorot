#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Тестовый скрипт для демонстрации новой функциональности визуализации
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.visualization_utils import class_name_manager, VisualizationUtils
import numpy as np

def test_class_names():
    """Тестирует загрузку названий классов"""
    print("🔍 Тестирование загрузки названий классов...")
    
    print("Всего классов: {}".format(len(class_name_manager.class_names)))
    print("Русские названия классов:")
    for class_id, name in class_name_manager.get_all_russian_names().items():
        print("  {}: {}".format(class_id, name))
    
    # Тестируем получение конкретных названий
    print("\nТестирование получения названий:")
    for i in range(5):
        name = class_name_manager.get_russian_name(i)
        print("  Класс {}: {}".format(i, name))

def test_visualization():
    """Тестирует создание визуализации"""
    print("\n🎨 Тестирование создания визуализации...")
    
    # Создаем тестовое изображение
    test_image = np.ones((400, 600, 3), dtype=np.uint8) * 255  # Белое изображение
    
    # Создаем тестовые детекции
    test_detections = [
        {
            "class_id": 0,
            "confidence": 0.95,
            "bbox": [50, 50, 200, 150],
            "mask": [[50, 50], [200, 50], [200, 150], [50, 150]]
        },
        {
            "class_id": 1,
            "confidence": 0.87,
            "bbox": [300, 100, 500, 250],
            "mask": [[300, 100], [500, 100], [500, 250], [300, 250]]
        }
    ]
    
    # Инициализируем утилиты визуализации
    viz_utils = VisualizationUtils(class_name_manager)
    
    # Сохраняем тестовое изображение
    import cv2
    test_image_path = "tmp/test_image.jpg"
    os.makedirs("tmp", exist_ok=True)
    cv2.imwrite(test_image_path, test_image)
    
    try:
        # Создаем визуализацию
        viz_path = viz_utils.visualize_detections(
            image_path=test_image_path,
            detections=test_detections,
            output_filename="test_visualization.jpg"
        )
        
        print("✅ Визуализация создана: {}".format(viz_path))
        
        # Проверяем, что файл существует
        if os.path.exists(viz_path):
            file_size = os.path.getsize(viz_path)
            print("   Размер файла: {} байт".format(file_size))
        else:
            print("❌ Файл визуализации не найден")
            
    except Exception as e:
        print("❌ Ошибка создания визуализации: {}".format(e))
    
    finally:
        # Удаляем тестовый файл
        if os.path.exists(test_image_path):
            os.remove(test_image_path)

if __name__ == "__main__":
    print("🚀 Запуск тестов новой функциональности...")
    
    try:
        test_class_names()
        test_visualization()
        print("\n✅ Все тесты завершены успешно!")
        
    except Exception as e:
        print("\n❌ Ошибка во время тестирования: {}".format(e))
        import traceback
        traceback.print_exc()
