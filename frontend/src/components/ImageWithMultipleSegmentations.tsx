import { useState, useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { apiService } from "@/lib/api";

interface SegmentationData {
  bbox?: [number, number, number, number];
  mask?: number[][];
  score?: number;
  confidence?: number;
  toolName?: string; // Название инструмента для подписи
}

interface ImageWithMultipleSegmentationsProps {
  imageId: number;
  segmentationFileIds: number[]; // Массив ID файлов сегментации
  showBbox?: boolean; // true = bbox, false = mask
  className?: string;
  preloadedImageUrl?: string; // Опциональный предзагруженный blob URL (оптимизация)
  toolNames?: string[]; // Названия инструментов (в том же порядке что и segmentationFileIds)
}

// Глобальный кэш для загруженных изображений (оптимизация)
const imageCache = new Map<string, HTMLImageElement>();
const simplifiedPolygonCache = new Map<string, number[][]>(); // Кэш упрощенных полигонов

// Функция для очистки кэша изображений (экспортируем для ProcessingWorkspace)
export const clearImageCache = () => {
  console.log('🧹 Clearing image cache');
  imageCache.clear();
  simplifiedPolygonCache.clear();
};

// Упрощение полигона - пропускаем точки для ускорения отрисовки
const simplifyPolygon = (points: number[][], tolerance: number = 2): number[][] => {
  if (points.length <= 50) return points; // Мало точек - не упрощаем
  
  const simplified: number[][] = [points[0]]; // Первая точка всегда берем
  let prev = points[0];
  const toleranceSquared = tolerance * tolerance; // Избегаем sqrt()
  
  for (let i = 1; i < points.length - 1; i++) {
    const curr = points[i];
    
    // Вычисляем квадрат расстояния (быстрее чем sqrt)
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const distanceSquared = dx * dx + dy * dy;
    
    // Добавляем точку только если она достаточно далеко
    if (distanceSquared >= toleranceSquared) {
      simplified.push(curr);
      prev = curr;
    }
  }
  
  // Последняя точка всегда берем
  simplified.push(points[points.length - 1]);
  
  return simplified;
};

export const ImageWithMultipleSegmentations = ({
  imageId,
  segmentationFileIds,
  showBbox = false,
  className = "",
  preloadedImageUrl,
  toolNames = []
}: ImageWithMultipleSegmentationsProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segmentations, setSegmentations] = useState<SegmentationData[]>([]);
  const [isDrawing, setIsDrawing] = useState(false); // Индикатор отрисовки
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null); // Кэш загруженного изображения
  const drawTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Для debounce

  useEffect(() => {
    let cancelled = false;
    
    const loadImageData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        if (!imageId || imageId === undefined || isNaN(imageId)) {
          console.error('Invalid imageId:', imageId);
          setError("Некорректный ID изображения");
          setLoading(false);
          return;
        }

        // Используем предзагруженный URL если есть (ОПТИМИЗАЦИЯ!)
        let imgUrl: string;
        if (preloadedImageUrl) {
          console.log('⚡ Using preloaded image URL (no fetch needed!)');
          imgUrl = preloadedImageUrl;
        } else {
          console.log('🌐 Fetching image from server...');
          imgUrl = await apiService.getFileFromMinIO(imageId);
        }
        
        if (cancelled) return;
        
        setImageUrl(imgUrl);

        // Загружаем все файлы сегментации ПАРАЛЛЕЛЬНО (оптимизация)
        const segmentationPromises = segmentationFileIds.map(async (segFileId, index) => {
          try {
            const segData = await apiService.getPreprocessDataFromMinIO(segFileId);
            if (segData) {
              return {
                bbox: segData.bbox,
                mask: segData.mask,
                score: segData.confidence || segData.score || 0,
                toolName: toolNames[index] // Добавляем название из props
              };
            }
          } catch (err) {
            console.warn(`Failed to load segmentation ${segFileId}:`, err);
          }
          return null;
        });
        
        const segmentationsData = (await Promise.all(segmentationPromises)).filter(Boolean) as SegmentationData[];
        
        if (cancelled) return;
        
        setSegmentations(segmentationsData);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load image:", err);
        setError("Не удалось загрузить изображение");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    loadImageData();
    
    return () => {
      cancelled = true;
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageId, segmentationFileIds]);

  // Единый useEffect с debounce для отрисовки
  useEffect(() => {
    // Отменяем предыдущий таймер
    if (drawTimeoutRef.current) {
      clearTimeout(drawTimeoutRef.current);
    }
    
    // Debounce - отрисовываем через 10ms после последнего изменения
    drawTimeoutRef.current = setTimeout(() => {
      if (imageUrl && canvasRef.current && containerRef.current && segmentations.length > 0) {
        drawImageWithSegmentations();
      }
    }, 10);
    
    return () => {
      if (drawTimeoutRef.current) {
        clearTimeout(drawTimeoutRef.current);
      }
    };
  }, [imageUrl, segmentations, showBbox]);
  
  // Перерисовываем при изменении размера окна (с debounce)
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout;
    
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (imageUrl && canvasRef.current && containerRef.current && segmentations.length > 0) {
          drawImageWithSegmentations();
        }
      }, 100); // 100ms debounce для resize
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('resize', handleResize);
    };
  }, [imageUrl, segmentations, showBbox]);

  const drawImageWithSegmentations = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !imageUrl || segmentations.length === 0) return;

    // Защита от двойной отрисовки
    if (isDrawing) return;

    setIsDrawing(true);

    // Функция отрисовки (вызывается когда изображение готово)
    const performDraw = (img: HTMLImageElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setIsDrawing(false);
        return;
      }

      // Вычисляем масштаб чтобы изображение поместилось в контейнер
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      const scale = Math.min(
        containerWidth / img.width,
        containerHeight / img.height,
        1 // Не увеличиваем, только уменьшаем
      );

      const displayWidth = Math.floor(img.width * scale);
      const displayHeight = Math.floor(img.height * scale);

      // Устанавливаем canvas в ПОЛНЫЙ размер изображения для четкости текста
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Применяем CSS масштабирование для отображения
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;

      // Очищаем контекст
      ctx.clearRect(0, 0, img.width, img.height);
      ctx.save();
      
      ctx.drawImage(img, 0, 0);

      // Рисуем все сегментации
      segmentations.forEach((seg, index) => {
        // Разные оттенки для разных сегментов
        const hue = (index * 137.5) % 360;
        const color = `hsl(${hue}, 70%, 50%)`;
        const fillColor = `hsla(${hue}, 70%, 50%, 0.3)`;

        let labelX = 10;
        let labelY = 10;

        if (showBbox && seg.bbox) {
          // Режим bbox
          const [x1, y1, x2, y2] = seg.bbox;
          
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(4, Math.min(img.width, img.height) / 100);
          ctx.fillStyle = fillColor;
          
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          
          // Позиция label для bbox (увеличен отступ для видимости контура)
          const fontSize = Math.max(16, Math.min(img.width, img.height) / 40);
          const labelPadding = 8;
          const labelHeight = fontSize + labelPadding * 2;
          
          labelX = x1;
          labelY = y1 - labelHeight - 5; // Отступ 5px от верхнего края bbox
        } else if (!showBbox && seg.mask && seg.mask.length > 0) {
          // Режим mask - упрощаем полигон для ускорения отрисовки
          const cacheKey = `${imageId}_${index}_${seg.mask.length}`;
          let simplifiedMask = simplifiedPolygonCache.get(cacheKey);
          
          if (!simplifiedMask) {
            simplifiedMask = simplifyPolygon(seg.mask, 3);
            simplifiedPolygonCache.set(cacheKey, simplifiedMask);
          }
          
          ctx.beginPath();
          ctx.moveTo(simplifiedMask[0][0], simplifiedMask[0][1]);
          for (let i = 1; i < simplifiedMask.length; i++) {
            ctx.lineTo(simplifiedMask[i][0], simplifiedMask[i][1]);
          }
          ctx.closePath();
          
          ctx.fillStyle = fillColor;
          ctx.fill();
          
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(3, Math.min(img.width, img.height) / 200);
          ctx.stroke();
          
          // Позиция label для mask - над контуром (увеличен отступ)
          const fontSize = Math.max(16, Math.min(img.width, img.height) / 40);
          const labelPadding = 8;
          const labelHeight = fontSize + labelPadding * 2;
          
          const xs = seg.mask.map(p => p[0]);
          const ys = seg.mask.map(p => p[1]);
          labelX = Math.min(...xs);
          labelY = Math.min(...ys) - labelHeight - 5; // Отступ 5px от верхнего края контура
        }

        // Рисуем label с названием инструмента (если есть)
        if (seg.toolName) {
          const labelText = `${seg.toolName} ${seg.score ? `(${Math.floor(seg.score * 100)}%)` : ''}`;
          const fontSize = Math.max(16, Math.min(img.width, img.height) / 40);
          const labelPadding = 8;
          const labelHeight = fontSize + labelPadding * 2;
          
          ctx.font = `bold ${fontSize}px Arial`;
          const textWidth = ctx.measureText(labelText).width;
          const labelWidth = textWidth + labelPadding * 2;
          
          // Корректируем позицию если выходит за границы
          if (labelY < 0) labelY = 10;
          if (labelX + labelWidth > img.width) labelX = img.width - labelWidth - 10;
          if (labelX < 0) labelX = 10;
          
          // Рисуем фон label
          ctx.fillStyle = color;
          ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
          
          // Рисуем текст
          ctx.fillStyle = 'white';
          ctx.fillText(labelText, labelX + labelPadding, labelY + fontSize + labelPadding / 2);
        }
      });

      ctx.restore();
      setIsDrawing(false);
    };

    // Проверяем кэш изображений - используем ТОЛЬКО imageUrl, НЕ загружаем заново
    const cachedImg = imageCache.get(imageUrl);
    if (cachedImg && cachedImg.complete) {
      performDraw(cachedImg);
    } else if (loadedImageRef.current && loadedImageRef.current.src === imageUrl && loadedImageRef.current.complete) {
      performDraw(loadedImageRef.current);
    } else {
      // Создаем Image из уже загруженного imageUrl
      const img = new Image();
      img.onload = () => {
        loadedImageRef.current = img;
        imageCache.set(imageUrl, img);
        performDraw(img);
      };
      img.onerror = () => {
        setIsDrawing(false);
      };
      img.src = imageUrl; // imageUrl уже blob URL из loadImageData!
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-muted-foreground">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center relative">
      <canvas
        ref={canvasRef}
      />
      
      {segmentations.length === 0 && !isDrawing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg pointer-events-none">
          <div className="text-white text-center">
            <AlertCircle className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">Нет данных сегментации</p>
          </div>
        </div>
      )}
    </div>
  );
};

