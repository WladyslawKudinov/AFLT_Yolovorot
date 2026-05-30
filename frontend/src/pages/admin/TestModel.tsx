import { useState, useEffect, useRef, useMemo } from "react";
import { Upload, ChevronDown, HelpCircle, RotateCcw, Loader2, AlertCircle, CheckCircle, FileImage } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { apiService, ApiError } from "@/lib/api";
import { ImageWithMultipleSegmentations } from "@/components/ImageWithMultipleSegmentations";

// Интерфейс для результата классификации
interface ClassificationResult {
  id: number;
  job: {
    id: number;
    status: string;
    createDate: string;
    lastModified: string | null;
  };
  tool: {
    id: number;
    name: string;
  };
  file: {
    id: number;
    packageId: any;
    createdAt: string;
    bucketName: string;
    filePath: string;
    fileName: string;
  };
  originalFile: {
    id: number;
    packageId: any;
    createdAt: string | null;
    bucketName: string;
    filePath: string;
    fileName: string;
  };
  confidence: number;
  createdAt: string;
  marking: string | null;
}

interface RawFile {
  id: number;
  packageId: any;
  createdAt: string | null;
  bucketName: string;
  filePath: string;
  fileName: string;
}

const TestModel = () => {
  const [step, setStep] = useState<"upload" | "results">("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [recognizeMarking, setRecognizeMarking] = useState(false);
  
  // Results state
  const [jobId, setJobId] = useState<number | null>(null);
  const [results, setResults] = useState<ClassificationResult[]>([]);
  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [selectedImage, setSelectedImage] = useState<RawFile | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [modelThreshold, setModelThreshold] = useState<number | null>(null);
  const [showBbox, setShowBbox] = useState(false); // true = bbox, false = mask
  const [imageUrlCache, setImageUrlCache] = useState<Map<number, string>>(new Map()); // Кэш загруженных URL
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<number | null>(null);
  const { toast } = useToast();

  // Helper function to truncate confidence to 2 decimal places
  const truncateConfidence = (confidence: number): number => {
    return Math.floor(confidence * 10000) / 100;
  };

  // Helper function to check if confidence is below threshold
  const isLowConfidence = (confidence: number): boolean => {
    if (modelThreshold === null) return false;
    return truncateConfidence(confidence) < truncateConfidence(modelThreshold);
  };

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
    if (!selectedFile) return;

    try {
      setUploading(true);
      
      const result = await apiService.testModel(selectedFile, recognizeMarking);
      console.log('API testModel result:', result);
      
      if (!result || typeof result.jobId !== 'number') {
        throw new Error('Неверный формат ответа: отсутствует jobId');
      }

      const newJobId = result.jobId;
      setJobId(newJobId);
      
      // Начинаем опрос статуса
      let intervalId: number | null = null;

      const poll = async () => {
        try {
          const statusResp = await apiService.getJobStatus(newJobId);
          const status = (statusResp?.status || statusResp || '').toString();
          
          if (status.toUpperCase() === 'FINISHED') {
            if (intervalId) {
              window.clearInterval(intervalId);
              intervalId = null;
            }
            setProcessing(false);
            setUploading(false);
            
            // Загружаем результаты
            await loadResults(newJobId);
          } else {
            setProcessing(true);
            setUploading(false);
          }
        } catch (e) {
          console.error('Failed to poll job status:', e);
          if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          setUploading(false);
          setProcessing(false);
          
          let errorMessage = 'Не удалось получить статус задачи';
          if (e instanceof ApiError) errorMessage = e.message;
          toast({ title: 'Ошибка', description: errorMessage, variant: 'destructive' });
        }
      };

      await poll();
      intervalId = window.setInterval(poll, 3000);
      pollingRef.current = intervalId;
      
    } catch (error) {
      console.error('Failed to upload archive:', error);
      
      let errorMessage = "Не удалось загрузить архив";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Ошибка загрузки",
        description: errorMessage,
        variant: "destructive",
      });
      setUploading(false);
      setProcessing(false);
    }
  };

  const loadResults = async (targetJobId: number) => {
    try {
      console.log('Loading results for jobId:', targetJobId);
      
      // Загружаем порог модели
      const threshold = await apiService.getModelThreshold();
      setModelThreshold(threshold);
      
      // Загружаем результаты классификации
      const classificationResults = await apiService.getJobClassificationResults(targetJobId);
      setResults(classificationResults || []);
      
      // Загружаем RAW файлы
      const files = await apiService.getJobFiles(targetJobId, 'RAW');
      setRawFiles(files || []);
      
      // Автовыбор первого файла
      if (files && files.length > 0) {
        setSelectedImage(files[0]);
        
        // Предзагружаем изображения в фоне для быстрого переключения (оптимизация)
        console.log(`🚀 Prefetching ${files.length} images...`);
        files.forEach((file, index) => {
          setTimeout(() => {
            apiService.getFileFromMinIO(file.id).then(url => {
              setImageUrlCache(prev => new Map(prev).set(file.id, url));
            }).catch(() => {
              // Игнорируем ошибки предзагрузки
            });
          }, index * 100); // 100ms задержка между запросами
        });
      }
      
      console.log('Loaded results:', classificationResults?.length);
      console.log('Loaded files:', files?.length);
      
      setStep("results");
      
      toast({
        title: "Тестирование завершено",
        description: `Обработано ${files?.length || 0} изображений`,
      });
    } catch (error) {
      console.error('Failed to load results:', error);
      toast({
        title: "Ошибка загрузки результатов",
        description: error instanceof Error ? error.message : "Не удалось загрузить результаты",
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    setStep("upload");
    setSelectedFile(null);
    setJobId(null);
    setResults([]);
    setRawFiles([]);
    setSelectedImage(null);
    setSelectedResultId(null);
    setModelThreshold(null);
    setShowBbox(false);
  };

  // Очистка интервала при размонтировании
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Группируем результаты по файлам
  const getResultsByFile = (fileId: number) => {
    return results.filter(r => r.originalFile.id === fileId);
  };

  // Вычисляем среднюю уверенность для файла
  const getAvgConfidence = (fileId: number): number => {
    const fileResults = getResultsByFile(fileId);
    if (fileResults.length === 0) return 0;
    const sum = fileResults.reduce((acc, r) => acc + r.confidence, 0);
    return Math.floor((sum / fileResults.length) * 100);
  };

  // Общая средняя уверенность
  const avgConfidence = results.length > 0 
    ? Math.floor(results.reduce((sum, r) => sum + r.confidence, 0) / results.length * 100) 
    : 0;

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (step === "results") {
    const selectedFileResults = selectedImage ? getResultsByFile(selectedImage.id) : [];
    
    // Фильтруем результаты: если выбран конкретный результат, показываем только его
    const resultsToDisplay = selectedResultId 
      ? selectedFileResults.filter(r => r.id === selectedResultId)
      : selectedFileResults;
    
    // Получаем предзагруженный URL изображения (оптимизация)
    const preloadedImageUrl = selectedImage ? imageUrlCache.get(selectedImage.id) : undefined;
    
    return (
      <div className="h-screen overflow-hidden p-6">
        <h2 className="text-xl font-semibold mb-4">Тестирование модели</h2>

        <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)]">
          {/* Список изображений */}
          <Card className="col-span-3 p-4 overflow-y-auto">
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full mb-3" 
              onClick={handleReset}
            >
              <RotateCcw className="w-3 h-3 mr-2" />
              Заново
            </Button>

            <div className="p-3 bg-muted rounded mb-3">
              <p className="text-xs text-muted-foreground mb-1">Средняя уверенность</p>
              <p className="text-xl font-semibold mb-2">{avgConfidence}%</p>
              <div className="w-full bg-background rounded-full h-2">
                <div 
                  className="h-2 rounded-full bg-primary transition-all duration-300" 
                  style={{ width: `${avgConfidence}%` }} 
                />
              </div>
            </div>
            
            {/* Переключатель bbox/mask */}
            <div className="p-3 bg-muted rounded mb-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="show-bbox" className="text-xs">Отображение</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Контур</span>
                  <Switch 
                    id="show-bbox" 
                    checked={showBbox} 
                    onCheckedChange={setShowBbox}
                  />
                  <span className="text-xs text-muted-foreground">Рамка</span>
                </div>
              </div>
            </div>

            <p className="text-xs font-medium text-muted-foreground mb-2">Изображения ({rawFiles.length})</p>
            <div className="space-y-1">
              {rawFiles.map((file) => {
                const fileResults = getResultsByFile(file.id);
                const fileConfidence = getAvgConfidence(file.id);
                const isActive = selectedImage?.id === file.id;

                return (
                  <div
                    key={file.id}
                    className={`p-2 rounded border cursor-pointer text-xs transition-colors ${
                      isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                    onClick={() => {
                      setSelectedImage(file);
                      setSelectedResultId(null); // Сброс выбора конкретного результата
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="truncate flex-1">{file.fileName}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{fileResults.length} инструментов</span>
                      <span className="font-semibold text-primary">{fileConfidence}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Превью изображения */}
          <Card className="col-span-6 flex flex-col overflow-hidden">
            {selectedImage ? (
              <>
                <CardHeader className="py-3 border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base truncate flex-1">{selectedImage.fileName}</CardTitle>
                    <Badge className="ml-2">
                      {getAvgConfidence(selectedImage.id)}%
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden">
                  <div className="h-full bg-black flex items-center justify-center">
                    {resultsToDisplay.length > 0 ? (
                      <ImageWithMultipleSegmentations
                        imageId={selectedImage.id}
                        segmentationFileIds={resultsToDisplay.map(r => r.file.id)}
                        showBbox={showBbox}
                        preloadedImageUrl={preloadedImageUrl}
                        toolNames={resultsToDisplay.map(r => r.tool.name)}
                        className="w-full h-full p-4"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center text-muted-foreground">
                          <AlertCircle className="h-12 w-12 mx-auto mb-2" />
                          <p>Нет результатов сегментации</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Выберите изображение для просмотра
              </div>
            )}
          </Card>

          {/* Результаты распознавания */}
          <Card className="col-span-3 p-4 overflow-y-auto">
            <h3 className="text-sm font-medium mb-3">Результаты</h3>
            {selectedImage && selectedFileResults.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-3">Найдено: {selectedFileResults.length}</p>
                {selectedFileResults.map((result) => {
                  const isLow = isLowConfidence(result.confidence);
                  const isSelected = selectedResultId === result.id;
                  
                  return (
                    <div 
                      key={result.id} 
                      className={`p-2 rounded border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 ring-2 ring-primary'
                          : isLow 
                            ? 'bg-yellow-50 border-yellow-500 dark:bg-yellow-950 hover:border-yellow-600' 
                            : 'bg-green-50 border-green-500 dark:bg-green-950 hover:border-green-600'
                      }`}
                      onClick={() => setSelectedResultId(isSelected ? null : result.id)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-medium truncate flex-1">{result.tool.name}</p>
                        <Badge 
                          variant={isLow ? "secondary" : "default"}
                          className="text-[10px] h-4 px-1 ml-1"
                        >
                          {truncateConfidence(result.confidence)}%
                        </Badge>
                      </div>
                      {result.marking && (
                        <p className="text-xs text-muted-foreground mt-1 truncate">
                          {result.marking}
                        </p>
                      )}
                      <div className={`w-full rounded-full h-1 mt-1 ${
                        isLow ? 'bg-yellow-200 dark:bg-yellow-900' : 'bg-green-200 dark:bg-green-900'
                      }`}>
                        <div 
                          className={`h-1 rounded-full ${
                            isLow ? 'bg-yellow-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${truncateConfidence(result.confidence)}%` }} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-8">
                {selectedImage ? "Нет результатов" : "Выберите изображение"}
              </p>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // Upload step
  return (
    <div className="h-screen overflow-hidden p-6">
      <h2 className="text-xl font-semibold mb-4">Тестирование модели</h2>

      <div className="space-y-4 max-w-2xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Для тестирования модели загрузите <strong>только ZIP архив</strong>, содержащий до 100 фотографий инструментов. 
            Поддерживаются форматы JPG, PNG внутри архива.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>Обработка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <TooltipProvider>
              <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                <CollapsibleTrigger className="flex items-center justify-between w-full py-2">
                  <span className="text-sm font-medium">Дополнительные настройки</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                
                <CollapsibleContent className="space-y-4 mt-4">
                  <div className="flex items-center justify-between p-3 bg-muted rounded">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="recognize-marking" className="text-sm">Распознавание маркировок</Label>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="w-4 h-4 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Включить распознавание серийных номеров и маркировок на инструментах</p>
                          <p className="text-xs text-muted-foreground mt-1">⚠️ Время обработки значительно увеличится</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <Switch id="recognize-marking" checked={recognizeMarking} onCheckedChange={setRecognizeMarking} />
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </TooltipProvider>

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
              onClick={() => !uploading && !processing && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileInputChange}
                className="hidden"
                disabled={uploading || processing}
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
                    <p className="font-medium">Загрузите ZIP архив</p>
                    <p className="text-sm text-muted-foreground">
                      Перетащите архив сюда или нажмите для выбора
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
                  disabled={uploading || processing}
                >
                  Отмена
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={uploading || processing}
                >
                  {uploading || processing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      {uploading ? 'Загрузка...' : 'Обработка...'}
                    </>
                  ) : (
                    "Загрузить и тестировать"
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

export default TestModel;
