import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Loader2, CheckCircle, AlertCircle, FileImage, ChevronDown, ChevronRight, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError, AcceptedPrototypeImagesDto } from "@/lib/api";
import { ImageWithSegmentation } from "@/components/ImageWithSegmentation";

interface PrototypeResultsProps {
  prototypeName: string;
  uploadResponse: any; // Response from createPrototype API
  onBack: () => void;
  onComplete: () => void;
}

interface PrototypeImage {
  id: number;
  image: {
    id: number;
    bucketName: string;
    filePath: string;
    fileName: string;
    createdAt: string;
  };
  segmentationFile: {
    id: number;
    bucketName: string;
    filePath: string;
    fileName: string;
    createdAt: string;
  } | null;
  createDate: string;
  isNew: boolean;
  hasError: boolean;
  segmentationData?: any;
}

export const PrototypeResults = ({ prototypeName, uploadResponse, onBack, onComplete }: PrototypeResultsProps) => {
  const [images, setImages] = useState<PrototypeImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [selectedImages, setSelectedImages] = useState<Map<number, boolean>>(new Map());
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  
  // Extract prototypeId from uploadResponse
  const prototypeId = uploadResponse?.prototypeId;
  
  console.log('🔍 PrototypeResults uploadResponse:', uploadResponse);
  console.log('🔍 Extracted prototypeId:', prototypeId);

  useEffect(() => {
    loadImages();
  }, [prototypeName]);

  const loadImages = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get all images for this prototype
      const allImages = await apiService.getPrototypeImages(prototypeName);
      
      // Extract new image IDs from uploadResponse.result
      const newImageIds = new Set<number>();
      if (uploadResponse && uploadResponse.result) {
        Object.keys(uploadResponse.result).forEach(key => {
          const imageId = parseInt(key);
          if (!isNaN(imageId)) {
            newImageIds.add(imageId);
          }
        });
      }
      
      // Process images and mark new ones
      const processedImages: PrototypeImage[] = allImages.map((img: any) => {
        const imageId = img.image.id;
        const isNew = newImageIds.has(imageId);
        const hasError = img.segmentationFile === null;
        
        let segmentationData = null;
        if (isNew && uploadResponse.result[imageId]) {
          segmentationData = uploadResponse.result[imageId];
        }
        
        return {
          ...img,
          isNew,
          hasError,
          segmentationData
        };
      });
      
      setImages(processedImages);
      
      // Initialize checkboxes: all non-error images selected by default
      const initialSelection = new Map<number, boolean>();
      processedImages.forEach((img: PrototypeImage) => {
        // Only non-error images are selected by default
        initialSelection.set(img.image.id, !img.hasError);
      });
      setSelectedImages(initialSelection);
    } catch (error) {
      console.error('Failed to load prototype images:', error);
      let errorMessage = "Не удалось загрузить изображения прототипа";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      setError(errorMessage);
      toast({ title: "Ошибка загрузки", description: errorMessage, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (id: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const toggleImageSelection = (imageId: number, isError: boolean) => {
    if (isError) return; // Can't select error images
    
    setSelectedImages(prev => {
      const newMap = new Map(prev);
      newMap.set(imageId, !prev.get(imageId));
      return newMap;
    });
  };

  const handleSendToModel = async () => {
    if (!prototypeId) {
      toast({
        title: "Ошибка",
        description: "ID прототипа не найден в ответе сервера",
        variant: "destructive",
      });
      return;
    }

    // Prepare DTO
    const acceptedImagesId: number[] = [];
    const imagesToDelete: number[] = [];

    images.forEach((img) => {
      const imageId = img.image.id;
      const isSelected = selectedImages.get(imageId);
      
      if (isSelected) {
        acceptedImagesId.push(imageId);
      } else {
        imagesToDelete.push(imageId);
      }
    });

    // Validation: at least one image must be selected
    if (acceptedImagesId.length === 0) {
      toast({
        title: "Необходимо выбрать изображения",
        description: "Отметьте хотя бы одно изображение для отправки в модель",
        variant: "destructive",
      });
      return;
    }

    const dto: AcceptedPrototypeImagesDto = {
      prototypeId,
      acceptedImagesId,
      imagesToDelete,
    };

    console.log('📤 Sending DTO to backend:', dto);
    console.log('📤 DTO.prototypeId type:', typeof dto.prototypeId);
    console.log('📤 DTO JSON:', JSON.stringify(dto));

    try {
      setSending(true);
      await apiService.sendPrototype(dto);
      
      toast({
        title: "Успешно отправлено",
        description: `Прототип "${prototypeName}" отправлен в модель. Принято: ${acceptedImagesId.length}, удалено: ${imagesToDelete.length}`,
      });
      
      // Auto return to orders
      onComplete();
    } catch (error) {
      console.error('Failed to send prototype:', error);
      
      let errorMessage = "Не удалось отправить прототип в модель";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Ошибка отправки",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const newImages = images.filter(img => img.isNew);
  const existingImages = images.filter(img => !img.isNew);

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">Загрузка результатов...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="space-y-6">
          <div className="flex items-center space-x-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="p-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Результаты добавления прототипа</h1>
              <p className="text-muted-foreground">Ошибка загрузки результатов</p>
            </div>
          </div>

          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>

          <div className="flex justify-end space-x-3">
            <Button variant="outline" onClick={onBack}>
              Назад
            </Button>
            <Button onClick={onComplete}>
              На главную
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Результаты добавления прототипа</h1>
            <p className="text-muted-foreground">Прототип: <span className="font-medium">{prototypeName}</span></p>
          </div>
        </div>

        {/* Общая статистика */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Всего изображений
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center space-x-2">
                <FileImage className="h-5 w-5" />
                <span>{images.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Загружено сейчас
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span>{newImages.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Загружено ранее
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center space-x-2">
                <FileImage className="h-5 w-5 text-blue-500" />
                <span>{existingImages.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Новые изображения */}
        {newImages.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span>Загруженные изображения ({newImages.length})</span>
              </CardTitle>
              <CardDescription>
                Изображения, загруженные в этот раз
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageList 
                images={newImages} 
                expandedItems={expandedItems} 
                onToggle={toggleExpanded}
                selectedImages={selectedImages}
                onToggleSelection={toggleImageSelection}
                isNewSection={true}
              />
            </CardContent>
          </Card>
        )}

        {/* Существующие изображения */}
        {existingImages.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FileImage className="h-5 w-5 text-blue-500" />
                <span>Ранее загруженные изображения ({existingImages.length})</span>
              </CardTitle>
              <CardDescription>
                Изображения, которые уже были в прототипе
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ImageList 
                images={existingImages} 
                expandedItems={expandedItems} 
                onToggle={toggleExpanded}
                selectedImages={selectedImages}
                onToggleSelection={toggleImageSelection}
                isNewSection={false}
              />
            </CardContent>
          </Card>
        )}

        {/* Кнопки действий */}
        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            Отмечено: {Array.from(selectedImages.values()).filter(v => v).length} из {images.length}
          </div>
          <div className="flex space-x-3">
            <Button variant="outline" onClick={onBack} disabled={sending}>
              Назад
            </Button>
            <Button onClick={handleSendToModel} className="bg-primary hover:bg-primary/90" disabled={sending || !prototypeId}>
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Отправить в модель
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Компонент списка изображений
const ImageList = ({ images, expandedItems, onToggle, selectedImages, onToggleSelection, isNewSection }: {
  images: PrototypeImage[];
  expandedItems: Set<number>;
  onToggle: (id: number) => void;
  selectedImages: Map<number, boolean>;
  onToggleSelection: (imageId: number, isError: boolean) => void;
  isNewSection: boolean;
}) => {
  return (
    <div className="space-y-2">
      {images.map((img) => {
        const imageId = img.image.id;
        const isSelected = selectedImages.get(imageId) || false;
        
        return (
          <div key={img.id} className="border rounded-lg">
            <div 
              className="flex items-center justify-between p-4 hover:bg-muted/50"
            >
              <div className="flex items-center space-x-3 flex-1">
                {/* Checkbox */}
                <Checkbox
                  checked={isSelected}
                  disabled={img.hasError}
                  onCheckedChange={() => onToggleSelection(imageId, img.hasError)}
                  onClick={(e) => e.stopPropagation()}
                />
                
                <div 
                  className="flex items-center space-x-3 flex-1 cursor-pointer"
                  onClick={() => onToggle(img.id)}
                >
                  <div className="flex items-center space-x-2">
                    {expandedItems.has(img.id) ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <FileImage className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{img.image.fileName}</h3>
                    <p className="text-sm text-muted-foreground">
                      Загружено: {new Date(img.createDate).toLocaleString('ru-RU')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {isNewSection && (
                  <Badge className="bg-green-100 text-green-800">
                    Новое
                  </Badge>
                )}
                {img.hasError && (
                  <Badge variant="destructive">
                    Ошибка
                  </Badge>
                )}
                {!img.hasError && (
                  <Badge className="bg-blue-100 text-blue-800">
                    Обработано
                  </Badge>
                )}
              </div>
            </div>
          
          {expandedItems.has(img.id) && !img.hasError && (
            <div className="border-t p-4">
              {img.segmentationFile ? (
                <ImageWithSegmentation
                  imageId={img.image.id}
                  imageName={img.image.fileName}
                  bbox={img.segmentationData?.bbox}
                  score={img.segmentationData?.score}
                  segmentationFileId={img.segmentationFile.id}
                  className="w-full"
                />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                  <p>Данные сегментации недоступны</p>
                </div>
              )}
            </div>
          )}
          
          {expandedItems.has(img.id) && img.hasError && (
            <div className="border-t p-4 bg-destructive/10">
              <div className="text-center py-8 text-destructive">
                <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                <p className="font-medium">Ошибка обработки изображения</p>
                <p className="text-sm mt-2">Файл сегментации не был создан. Изображение будет удалено.</p>
              </div>
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
};

