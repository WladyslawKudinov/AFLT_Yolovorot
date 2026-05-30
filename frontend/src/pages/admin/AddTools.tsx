import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Upload, FileArchive, Loader2, CheckCircle, AlertCircle, RotateCcw, Send, X, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError, AcceptedPrototypeImagesDto } from "@/lib/api";
import { ImageWithSegmentation } from "@/components/ImageWithSegmentation";

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

const AddTools = () => {
  // Step 1: Upload
  const [step, setStep] = useState<"upload" | "results">("upload");
  const [prototypeName, setPrototypeName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  
  // Step 2: Results
  const [uploadResponse, setUploadResponse] = useState<any>(null);
  const [images, setImages] = useState<PrototypeImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Map<number, boolean>>(new Map());
  const [sending, setSending] = useState(false);
  const [selectedImageForPreview, setSelectedImageForPreview] = useState<PrototypeImage | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<number | null>(null);
  const [imageTransitioning, setImageTransitioning] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (file: File) => {
    const isZipFile = file.name.toLowerCase().endsWith('.zip') && 
                     (file.type === 'application/zip' || 
                      file.type === 'application/x-zip-compressed' ||
                      file.type === '');
    
    if (!isZipFile) {
      toast({
        title: "Неподдерживаемый формат",
        description: "Пожалуйста, выберите только ZIP архив (.zip)",
        variant: "destructive",
      });
      return;
    }

    setSelectedFile(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleUpload = async () => {
    if (!selectedFile || !prototypeName.trim()) {
      toast({
        title: "Заполните все поля",
        description: "Пожалуйста, укажите название прототипа и выберите архив",
        variant: "destructive",
      });
      return;
    }

    try {
      setUploading(true);
      
      // Создаем прототип - синхронный запрос, возвращает результаты сегментации
      const result = await apiService.createPrototype(prototypeName.trim(), selectedFile);
      console.log('✅ createPrototype API response:', result);
      
      setUploadResponse(result);
      
      console.log('✅ Upload complete, response:', result);
      console.log('✅ Response keys:', Object.keys(result || {}));
      console.log('✅ PrototypeId:', result?.prototypeId);
      
      toast({
        title: "Успешно",
        description: "Архив загружен и обработан",
      });
      
      // Переходим к результатам
      console.log('📥 Loading images for results page...');
      await loadImages(prototypeName.trim(), result);
      console.log('📥 Images loaded, switching to results step');
      setStep("results");
      
    } catch (error) {
      console.error('Failed to upload prototype:', error);
      
      let errorMessage = "Не удалось загрузить архив";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Ошибка загрузки",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const loadImages = async (name: string, response: any) => {
    try {
      setLoadingImages(true);
      
      console.log('🔍 Loading images for prototype:', name);
      console.log('🔍 Upload response:', response);
      
      // Get all images for this prototype
      const allImages = await apiService.getPrototypeImages(name);
      console.log('🔍 Loaded images from API:', allImages);
      
      // Extract new image IDs from uploadResponse.result
      const newImageIds = new Set<number>();
      if (response && response.result) {
        Object.keys(response.result).forEach(key => {
          const imageId = parseInt(key);
          if (!isNaN(imageId)) {
            newImageIds.add(imageId);
          }
        });
      }
      console.log('🔍 New image IDs:', Array.from(newImageIds));
      
      // Process images and mark new ones
      const processedImages: PrototypeImage[] = allImages.map((img: any) => {
        const imageId = img.image.id;
        const isNew = newImageIds.has(imageId);
        const hasError = img.segmentationFile === null;
        
        let segmentationData = null;
        if (isNew && response.result && response.result[imageId]) {
          segmentationData = response.result[imageId];
        }
        
        console.log(`📷 Processing image ${imageId}:`, {
          fileName: img.image?.fileName,
          isNew,
          hasError,
          hasSegmentation: !!segmentationData
        });
        
        return {
          ...img,
          isNew,
          hasError,
          segmentationData
        };
      });
      
      console.log('📷 Total processed images:', processedImages.length);
      setImages(processedImages);
      
      // Initialize checkboxes: все НЕ выбраны по умолчанию (для ручной проверки)
      const initialSelection = new Map<number, boolean>();
      processedImages.forEach((img: PrototypeImage) => {
        initialSelection.set(img.image.id, false);
      });
      setSelectedImages(initialSelection);
      
      // Auto-select first image for preview
      if (processedImages.length > 0) {
        setSelectedImageForPreview(processedImages[0]);
      }
    } catch (error) {
      console.error('Failed to load prototype images:', error);
      let errorMessage = "Не удалось загрузить изображения прототипа";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      toast({ title: "Ошибка загрузки", description: errorMessage, variant: "destructive" });
    } finally {
      setLoadingImages(false);
    }
  };


  const toggleImageSelection = (imageId: number, isError: boolean) => {
    if (isError) return; // Can't select error images
    
    setSelectedImages(prev => {
      const newMap = new Map(prev);
      newMap.set(imageId, !prev.get(imageId));
      return newMap;
    });
  };

  // Удаление изображения из MinIO
  const handleDeleteImage = async (img: PrototypeImage, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent selecting the image
    
    const imageId = img.image.id;

    try {
      setDeletingImageId(imageId);
      
      // Удаляем файл из MinIO
      await apiService.deleteFile(imageId);
      
      // Также удаляем segmentation файл если есть
      if (img.segmentationFile) {
        try {
          await apiService.deleteFile(img.segmentationFile.id);
        } catch (err) {
          console.warn('Failed to delete segmentation file:', err);
        }
      }
      
      // Убираем из локального state
      setImages(prev => prev.filter(i => i.image.id !== imageId));
      setSelectedImages(prev => {
        const newMap = new Map(prev);
        newMap.delete(imageId);
        return newMap;
      });
      
      // Если это было выбранное изображение - выбираем другое
      if (selectedImageForPreview?.image.id === imageId) {
        const remainingImages = images.filter(i => i.image.id !== imageId && !i.hasError);
        if (remainingImages.length > 0) {
          setSelectedImageForPreview(remainingImages[0]);
        } else {
          setSelectedImageForPreview(null);
        }
      }
      
      toast({
        title: "Изображение удалено",
        description: `${img.image.fileName} удалено из хранилища`,
      });
    } catch (error) {
      console.error('Failed to delete image:', error);
      
      let errorMessage = "Не удалось удалить изображение";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Ошибка удаления",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setDeletingImageId(null);
    }
  };

  // Быстрая проверка: одобрить и перейти к следующему
  const handleApprove = () => {
    if (!selectedImageForPreview || selectedImageForPreview.hasError) return;
    
    const currentImageId = selectedImageForPreview.image.id;
    
    // Отмечаем текущее изображение
    setSelectedImages(prev => {
      const newMap = new Map(prev);
      newMap.set(currentImageId, true);
      return newMap;
    });
    
    // Переходим к следующему непроверенному изображению (пропуская ошибки)
    moveToNextImage(currentImageId);
  };

  // Быстрая проверка: отклонить и перейти к следующему
  const handleReject = () => {
    if (!selectedImageForPreview || selectedImageForPreview.hasError) return;
    
    const currentImageId = selectedImageForPreview.image.id;
    
    // Оставляем текущее изображение невыбранным (или снимаем галочку)
    setSelectedImages(prev => {
      const newMap = new Map(prev);
      newMap.set(currentImageId, false);
      return newMap;
    });
    
    // Переходим к следующему
    moveToNextImage(currentImageId);
  };

  // Найти следующее изображение после текущего с плавным переходом
  const moveToNextImage = (currentImageId: number) => {
    const currentIndex = images.findIndex(img => img.image.id === currentImageId);
    
    if (currentIndex === -1) return;
    
    // Fade out текущее изображение
    setImageTransitioning(true);
    
    setTimeout(() => {
      // Ищем следующее изображение БЕЗ ошибки
      for (let i = currentIndex + 1; i < images.length; i++) {
        if (!images[i].hasError) {
          setSelectedImageForPreview(images[i]);
          
          // Fade in нового изображения
          setTimeout(() => setImageTransitioning(false), 50);
          
          // Автоматическая прокрутка с опережением
          setTimeout(() => {
            const element = document.querySelector(`[data-image-id="${images[i].image.id}"]`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 100);
          
          return;
        }
      }
      
      // Если не нашли после текущего, прокручиваем в начало и ищем с начала
      for (let i = 0; i < currentIndex; i++) {
        if (!images[i].hasError) {
          setSelectedImageForPreview(images[i]);
          
          // Fade in
          setTimeout(() => setImageTransitioning(false), 50);
          
          // Прокручиваем к началу списка
          setTimeout(() => {
            const container = document.querySelector('[data-images-list]');
            if (container) {
              container.scrollTo({ top: 0, behavior: 'smooth' });
            }
            
            // Потом фокусируемся на элементе
            setTimeout(() => {
              const element = document.querySelector(`[data-image-id="${images[i].image.id}"]`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
            }, 100);
          }, 100);
          
          return;
        }
      }
      
      // Если больше нет изображений для проверки - остаемся на текущем
      setImageTransitioning(false);
      toast({
        title: "Проверка завершена",
        description: "Все изображения просмотрены",
      });
    }, 200); // Длительность fade out
  };

  const handleSendToModel = async () => {
    const prototypeId = uploadResponse?.prototypeId;
    
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
        description: "Одобрите хотя бы одно изображение для отправки в модель (нажмите Y или кнопку 'Корректно')",
        variant: "destructive",
      });
      return;
    }
    
    console.log(`📤 Preparing to send: ${acceptedImagesId.length} accepted, ${imagesToDelete.length} to delete`);

    const dto: AcceptedPrototypeImagesDto = {
      prototypeId,
      acceptedImagesId,
      imagesToDelete,
    };

    console.log('📤 Sending DTO to backend:', dto);

    try {
      setSending(true);
      await apiService.sendPrototype(dto);
      
      toast({
        title: "Успешно отправлено",
        description: `Прототип "${prototypeName}" отправлен в модель. Принято: ${acceptedImagesId.length}, удалено: ${imagesToDelete.length}`,
      });
      
      // Reset to upload step
      handleReset();
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

  const handleReset = () => {
    setStep("upload");
    setPrototypeName("");
    setSelectedFile(null);
    setUploadResponse(null);
    setImages([]);
    setSelectedImages(new Map());
    setSelectedImageForPreview(null);
    setDeletingImageId(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Stats for results
  const newImagesCount = images.filter(img => img.isNew).length;
  const oldImagesCount = images.filter(img => !img.isNew).length;
  const errorImagesCount = images.filter(img => img.hasError).length;
  const selectedCount = Array.from(selectedImages.values()).filter(Boolean).length;

  // Keyboard shortcuts for quick review (Y/N)
  useEffect(() => {
    if (step !== "results" || !selectedImageForPreview) return;
    
    const handleKeyPress = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // Support both English (y/n) and Russian (н/т) layouts
      if (key === "y" || key === "н") {
        handleApprove();
      } else if (key === "n" || key === "т") {
        handleReject();
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [step, selectedImageForPreview, images, selectedImages]);

  if (step === "results") {
    return (
      <div className="h-screen overflow-hidden p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Проверка сегментации: {prototypeName}</h2>
          <div className="flex gap-2">
            <Button
              onClick={handleSendToModel}
              disabled={sending || selectedCount === 0}
              size="sm"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Отправить в модель ({selectedCount})
                </>
              )}
            </Button>
            <Button onClick={handleReset} variant="outline" size="sm">
              <RotateCcw className="w-4 h-4 mr-2" />
              Сброс
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-4">
          <Card>
            <CardHeader className="py-3">
              <CardDescription className="text-xs">Всего изображений</CardDescription>
              <CardTitle className="text-2xl">{images.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="py-3">
              <CardDescription className="text-xs">Новых</CardDescription>
              <CardTitle className="text-2xl text-blue-600">{newImagesCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="py-3">
              <CardDescription className="text-xs">Ошибок сегментации</CardDescription>
              <CardTitle className="text-2xl text-red-600">{errorImagesCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="py-3">
              <CardDescription className="text-xs">Выбрано для отправки</CardDescription>
              <CardTitle className="text-2xl text-green-600">{selectedCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Main content */}
        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-240px)]">
          {/* List */}
          <Card className="col-span-4 p-4 overflow-y-auto" data-images-list>
            <h3 className="text-sm font-medium mb-3">Изображения ({images.length})</h3>
            <div className="space-y-2">
              {images.map((img) => {
                const imageId = img.image.id;
                const isSelected = selectedImages.get(imageId);
                const isActive = selectedImageForPreview?.image.id === imageId;

                return (
                  <div
                    key={imageId}
                    data-image-id={imageId}
                    className={`group p-2 border rounded cursor-pointer transition-all duration-200 ${
                      isActive 
                        ? 'border-primary bg-primary/5' 
                        : isSelected 
                          ? 'border-green-500/50 bg-green-50 dark:bg-green-950' 
                          : ''
                    }`}
                    onClick={() => setSelectedImageForPreview(img)}
                  >
                    <div className="flex items-start gap-2">
                      <Checkbox
                        checked={isSelected || false}
                        disabled={img.hasError || deletingImageId === imageId}
                        onClick={(e) => e.stopPropagation()}
                        onCheckedChange={() => toggleImageSelection(imageId, img.hasError)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 mb-1">
                          {img.isNew && (
                            <Badge variant="default" className="text-[9px] h-4 px-1">Новое</Badge>
                          )}
                          {img.hasError && (
                            <Badge variant="destructive" className="text-[9px] h-4 px-1">Ошибка</Badge>
                          )}
                          {!img.hasError && isSelected && (
                            <CheckCircle className="w-3 h-3 text-green-500" />
                          )}
                        </div>
                        <p className="text-xs truncate">{img.image.fileName}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => handleDeleteImage(img, e)}
                        disabled={deletingImageId === imageId}
                      >
                        {deletingImageId === imageId ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Trash2 className="w-3 h-3 text-destructive" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Preview */}
          <div className="col-span-8 flex flex-col">
            {selectedImageForPreview ? (
              <>
                <Card className="mb-3">
                  <CardHeader className="py-3">
                    <CardTitle className="text-base">{selectedImageForPreview.image.fileName}</CardTitle>
                    {(selectedImageForPreview.hasError || selectedImageForPreview.isNew) && (
                      <CardDescription className="text-xs">
                        {selectedImageForPreview.hasError 
                          ? "Сегментация не удалась" 
                          : "Новое изображение с сегментацией"}
                      </CardDescription>
                    )}
                  </CardHeader>
                </Card>
                
                <div className="bg-black rounded-lg overflow-hidden mb-3" style={{ height: 'calc(100vh - 380px)' }}>
                  <div className={`h-full w-full transition-opacity duration-300 ${imageTransitioning ? 'opacity-0' : 'opacity-100'}`}>
                  {!selectedImageForPreview.hasError ? (
                    <ImageWithSegmentation
                      imageId={selectedImageForPreview.image.id}
                      imageName={selectedImageForPreview.image.fileName}
                      mask={selectedImageForPreview.segmentationData?.mask}
                      bbox={selectedImageForPreview.segmentationData?.bbox}
                      score={selectedImageForPreview.segmentationData?.score}
                      segmentationFileId={selectedImageForPreview.segmentationFile?.id}
                      showLabel={false}
                      className="w-full h-full"
                    />
                  ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <div className="text-center">
                          <AlertCircle className="h-12 w-12 mx-auto mb-2 text-red-500" />
                          <p>Ошибка сегментации</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Quick review buttons */}
                {!selectedImageForPreview.hasError && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={handleReject}
                          className="flex-1"
                          size="lg"
                        >
                          <X className="w-4 h-4 mr-2" />
                          Некорректно (N)
                        </Button>
                        <Button
                          onClick={handleApprove}
                          className="flex-1"
                          size="lg"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Корректно (Y)
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card className="flex-1 flex items-center justify-center">
                <CardContent className="text-muted-foreground text-sm">
                  {loadingImages ? "Загрузка..." : "Выберите изображение для просмотра"}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Upload step
  const canUpload = selectedFile && prototypeName.trim() && !uploading;

  return (
    <div className="h-screen overflow-hidden p-6">
      <h2 className="text-xl font-semibold mb-4">Добавление инструментов</h2>

      <div className="space-y-4 max-w-2xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Загрузите <strong>ZIP архив</strong>, содержащий до 100 изображений прототипа инструмента. 
            Поддерживаются форматы JPG, PNG внутри архива.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Название прототипа</CardTitle>
            <CardDescription>
              Укажите уникальное название для класса прототипа
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="prototypeName">Название прототипа *</Label>
              <Input
                id="prototypeName"
                placeholder="Например: ключ-разводной"
                value={prototypeName}
                onChange={(e) => setPrototypeName(e.target.value)}
                disabled={uploading}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Если прототип с таким названием уже существует, изображения будут добавлены к нему
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileArchive className="h-5 w-5" />
              <span>Загрузка архива</span>
            </CardTitle>
            <CardDescription>
              Перетащите ZIP архив (.zip) в область ниже или нажмите для выбора файла
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : selectedFile
                  ? 'border-green-500 bg-green-50 dark:bg-green-950'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileInputChange}
                className="hidden"
                disabled={uploading}
              />
              
              {selectedFile ? (
                <div className="space-y-2">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(selectedFile.size)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <p className="font-medium">Выберите ZIP архив (.zip)</p>
                    <p className="text-sm text-muted-foreground">
                      или перетащите файл сюда
                    </p>
                  </div>
                </div>
              )}
            </div>

            {selectedFile && (
              <div className="mt-4 flex justify-end space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setSelectedFile(null)}
                  disabled={uploading}
                >
                  Отмена
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!canUpload}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Обработка...
                    </>
                  ) : (
                    "Далее"
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AddTools;
