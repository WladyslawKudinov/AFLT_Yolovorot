import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { apiService } from "@/lib/api";

interface ImageWithSegmentationProps {
  imageId: number;
  imageName: string;
  bbox?: string; // "[x1, y1, x2, y2]" format from uploadResponse (fallback)
  mask?: number[][]; // [[x, y], [x, y], ...] polygon points from uploadResponseф
  score?: number;
  segmentationFileId?: number; // ID of segmentation JSON file to load from
  showBbox?: boolean; // true = показывать bbox, false = показывать mask (по умолчанию)
  showLabel?: boolean; // показывать ли label с названием и score (по умолчанию true)
  className?: string;
}

export const ImageWithSegmentation = ({
  imageId,
  imageName,
  bbox: providedBbox,
  mask: providedMask,
  score: providedScore,
  segmentationFileId,
  showBbox = false,
  showLabel = true,
  className = ""
}: ImageWithSegmentationProps) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [segmentationData, setSegmentationData] = useState<{ bbox?: string; mask?: number[][]; score: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Use provided values or loaded values
  const bbox = providedBbox || segmentationData?.bbox;
  const mask = providedMask || segmentationData?.mask;
  const score = providedScore !== undefined ? providedScore : (segmentationData?.score || 0);

  // Parse bbox from string format "[x1, y1, x2, y2]"
  const parseBbox = (bboxStr: string): [number, number, number, number] | null => {
    try {
      const parsed = JSON.parse(bboxStr);
      if (Array.isArray(parsed) && parsed.length === 4) {
        return [parsed[0], parsed[1], parsed[2], parsed[3]];
      }
      return null;
    } catch (e) {
      console.error('Failed to parse bbox:', e);
      return null;
    }
  };

  // Truncate score (0-1) to percentage with two decimals without rounding
  const formatTruncatedPercent = (value0to1: number): string => {
    const rawPercent = value0to1 * 100;
    const truncated = Math.floor(rawPercent * 100) / 100;
    return truncated.toFixed(2);
  };

  useEffect(() => {
    loadImageData();
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageId, segmentationFileId]);

  const loadImageData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Проверка на валидность imageId
      if (!imageId || imageId === undefined || isNaN(imageId)) {
        console.error('Invalid imageId:', imageId);
        setError("Некорректный ID изображения");
        setLoading(false);
        return;
      }

      const imgUrl = await apiService.getFileFromMinIO(imageId);
      setImageUrl(imgUrl);

      // Load segmentation data from file if not provided directly
      if (segmentationFileId && !providedBbox && !providedMask) {
        try {
          const segData = await apiService.getPreprocessDataFromMinIO(segmentationFileId);
          // segData should have bbox/mask and score
          if (segData) {
            const data: { bbox?: string; mask?: number[][]; score: number } = {
              score: segData.confidence || segData.score || 0
            };
            
            // Приоритет: mask > bbox
            if (segData.mask && Array.isArray(segData.mask)) {
              data.mask = segData.mask;
            } else if (segData.bbox) {
              // Convert bbox array to string format (fallback)
              data.bbox = JSON.stringify(segData.bbox);
            }
            
            setSegmentationData(data);
          }
        } catch (err) {
          console.warn("Failed to load segmentation data:", err);
          // Continue without segmentation data
        }
      }
    } catch (err) {
      console.error("Failed to load image:", err);
      setError("Не удалось загрузить изображение");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (imageUrl && canvasRef.current && (mask || bbox)) {
      drawImageWithSegmentation();
    }
  }, [imageUrl, mask, bbox, showBbox]); // Добавлен showBbox для перерисовки при смене режима

  const drawImageWithSegmentation = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    
    // Приоритет: mask > bbox
    if (!mask && !bbox) return;

    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Устанавливаем canvas в исходный размер изображения
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.drawImage(img, 0, 0);

      // Рисуем bbox или маску в зависимости от showBbox
      if (showBbox && bbox) {
        // Режим bbox - отрисовка прямоугольника
        const parsedBbox = parseBbox(bbox);
        if (parsedBbox) {
          const [x1, y1, x2, y2] = parsedBbox;
          
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = Math.max(4, Math.min(img.width, img.height) / 100);
          ctx.fillStyle = "rgba(16, 185, 129, 0.2)";
          
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        }
      } else if (!showBbox && mask && mask.length > 0) {
        // Режим mask - отрисовка полигона
        ctx.beginPath();
        ctx.moveTo(mask[0][0], mask[0][1]);
        for (let i = 1; i < mask.length; i++) {
          ctx.lineTo(mask[i][0], mask[i][1]);
        }
        ctx.closePath();
        
        // Заливка
        ctx.fillStyle = "rgba(16, 185, 129, 0.3)";
        ctx.fill();
        
        // Контур
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = Math.max(3, Math.min(img.width, img.height) / 200);
        ctx.stroke();
      } else if (bbox) {
        // Fallback: если нет маски или showBbox, показываем bbox
        const parsedBbox = parseBbox(bbox);
        if (parsedBbox) {
          const [x1, y1, x2, y2] = parsedBbox;
          
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = Math.max(4, Math.min(img.width, img.height) / 100);
          ctx.fillStyle = "rgba(16, 185, 129, 0.2)";
          
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        }
      }

      // Рисуем label только если showLabel = true и есть название
      if (showLabel && imageName) {
        // Определяем позицию для label (для маски берем bbox или вычисляем из точек)
        let labelX = 10;
        let labelY = 10;
        
        if (mask && mask.length > 0 && !showBbox) {
          // Вычисляем bounding box из маски для размещения label
          const xs = mask.map(p => p[0]);
          const ys = mask.map(p => p[1]);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          labelX = minX;
          labelY = minY - 40; // Над маской
          
          if (labelY < 0) {
            labelY = minY + 10; // Внутри маски сверху
          }
        } else if (bbox) {
          const parsedBbox = parseBbox(bbox);
          if (parsedBbox) {
            const [x1, y1] = parsedBbox;
            labelX = x1;
            labelY = y1 - 40;
            if (labelY < 0) labelY = y1 + 10;
          }
        }

        const labelText = `${imageName} (${formatTruncatedPercent(score)}%)`;
        const labelPadding = 12;
        const labelHeight = 32;
        const fontSize = Math.max(16, Math.min(img.width, img.height) / 50);
        
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(labelText);
        const labelWidth = textMetrics.width + labelPadding * 2;
        
        // Корректируем позицию label чтобы не выходил за границы
        if (labelX < 0) {
          labelX = 10;
        }
        if (labelX + labelWidth > img.width) {
          labelX = img.width - labelWidth - 10;
        }
        if (labelY < 0) {
          labelY = 10;
        }
        if (labelY + labelHeight > img.height) {
          labelY = img.height - labelHeight - 10;
        }
        
        // Рисуем label
        ctx.fillStyle = "#10b981";
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        
        ctx.fillStyle = "white";
        ctx.fillText(labelText, labelX + labelPadding, labelY + labelHeight - labelPadding);
      }
    };
    
    img.src = imageUrl;
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <Skeleton className="w-full h-64" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="p-4 flex items-center justify-center h-64">
          <div className="flex items-center space-x-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {showLabel && imageName && (
        <Card className="mb-2">
          <CardContent className="p-3">
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">
                Изображение: <span className="font-medium">{imageName}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Оценка сегментации: <span className="font-medium">{formatTruncatedPercent(score)}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      <div className={`relative flex items-center justify-center ${className}`}>
        <canvas
          ref={canvasRef}
          style={{ 
            maxWidth: '100%', 
            maxHeight: '100%',
            width: 'auto',
            height: 'auto'
          }}
        />
        
        {!bbox && !mask && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-lg">
            <div className="text-white text-center">
              <AlertCircle className="h-8 w-8 mx-auto mb-2" />
              <p className="text-sm">Координаты сегментации недоступны</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

