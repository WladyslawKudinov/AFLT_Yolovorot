import { useEffect, useRef, useState } from "react";

interface BboxData {
  id: number;
  confidence: number;
  bbox: string; // Format: "[x1, y1, x2, y2]"
  toolName: string;
}

interface ImageWithBboxProps {
  imageUrl: string;
  bboxes: BboxData[];
  selectedToolId?: number | null;
  onBboxClick?: (bboxId: number) => void;
  className?: string;
  confidenceThreshold?: number; // Порог уверенности (0-1)
}

export const ImageWithBbox = ({
  imageUrl, 
  bboxes, 
  selectedToolId, 
  onBboxClick,
  className = "",
  confidenceThreshold = 0.8 // По умолчанию 80%
}: ImageWithBboxProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    if (!imageLoaded || !imageUrl) return;
    
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image) return;

    const ctx = canvas.getContext('2d');
      if (!ctx) return;

    // Set canvas size to match image
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw bounding boxes
    bboxes.forEach((bboxData) => {
      if (selectedToolId && bboxData.id !== selectedToolId) return;

      try {
        // Parse bbox string "[x1, y1, x2, y2]"
        const bboxArray = JSON.parse(bboxData.bbox);
        if (!Array.isArray(bboxArray) || bboxArray.length !== 4) return;

        const [x1, y1, x2, y2] = bboxArray;
        const width = x2 - x1;
        const height = y2 - y1;

        // Determine color based on confidence and threshold
        let color: string;
        if (bboxData.confidence >= confidenceThreshold) {
          color = '#22c55e'; // green - выше или равно порогу
        } else if (bboxData.confidence >= confidenceThreshold * 0.75) {
          color = '#f59e0b'; // yellow - между 75% и 100% от порога
        } else {
          color = '#ef4444'; // red - ниже 75% от порога
        }

        // Draw bounding box - ИДЕАЛЬНО ТОЛСТЫЕ ЛИНИИ
        ctx.strokeStyle = color;
        ctx.lineWidth = 20; // Увеличено с 16 до 20 (идеально толстые линии!)
        ctx.strokeRect(x1, y1, width, height);

        // Draw label background
        const labelText = `${bboxData.toolName} (${(bboxData.confidence * 100).toFixed(0)}%)`;
        ctx.font = 'bold 56px Arial'; // Увеличено с 48px до 56px - ИДЕАЛЬНО КРУПНЫЙ текст!
        const labelWidth = ctx.measureText(labelText).width + 48;
        const labelHeight = 80; // Увеличено с 70 до 80
        
        ctx.fillStyle = color;
        ctx.fillRect(x1, y1 - labelHeight, labelWidth, labelHeight);

        // Draw label text
        ctx.fillStyle = 'white';
        ctx.fillText(labelText, x1 + 24, y1 - 18);
      } catch (error) {
        console.error('Error parsing bbox:', bboxData.bbox, error);
      }
    });
  }, [imageLoaded, bboxes, selectedToolId, confidenceThreshold]);

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onBboxClick) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Scale coordinates to match canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;

    // Find clicked bbox
    for (const bboxData of bboxes) {
      if (selectedToolId && bboxData.id !== selectedToolId) continue;

      try {
        const bboxArray = JSON.parse(bboxData.bbox);
        if (!Array.isArray(bboxArray) || bboxArray.length !== 4) continue;

        const [x1, y1, x2, y2] = bboxArray;
        if (canvasX >= x1 && canvasX <= x2 && canvasY >= y1 && canvasY <= y2) {
          onBboxClick(bboxData.id);
          break;
        }
      } catch (error) {
        console.error('Error parsing bbox for click detection:', bboxData.bbox, error);
      }
    }
  };

    return (
    <div className={`relative ${className}`}>
      <img
        ref={imageRef}
        src={imageUrl}
        alt="Processing"
        className="max-w-full max-h-full object-contain"
        onLoad={() => setImageLoaded(true)}
        style={{ display: imageLoaded ? 'block' : 'none' }}
      />
      {imageLoaded && (
            <canvas
              ref={canvasRef}
          className="absolute top-0 left-0 max-w-full max-h-full object-contain cursor-pointer"
          onClick={handleCanvasClick}
        />
            )}
          </div>
  );
};
