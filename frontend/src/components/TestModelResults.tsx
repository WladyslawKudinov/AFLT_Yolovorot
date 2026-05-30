import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Loader2, CheckCircle, AlertCircle, BarChart3, FileImage, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError } from "@/lib/api";
import { ImageWithBbox } from "@/components/ImageWithBbox";

interface TestModelResultsProps {
  jobId: number;
  searchMarking: boolean;
  onBack: () => void;
  onComplete: () => void;
}

// Интерфейс для результата классификации (как в основном API)
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
    packageId: {
      id: number;
      status: string;
      createDate: string;
      lastModified: string | null;
    };
    createdAt: string;
    bucketName: string;
    filePath: string;
    fileName: string;
  };
  originalFile: {
    id: number;
    packageId: {
      id: number;
      status: string;
      createDate: string;
      lastModified: string | null;
    };
    createdAt: string | null;
    bucketName: string;
    filePath: string;
    fileName: string;
  };
  confidence: number;
  createdAt: string;
  marking: string | null;
}

// Интерфейс для сырых файлов
interface RawFile {
  id: number;
  packageId: {
    id: number;
    status: string;
    createDate: string;
    lastModified: string | null;
  };
  createdAt: string | null;
  bucketName: string;
  filePath: string;
  fileName: string;
}

// API возвращает массив результатов напрямую
type TestModelResponse = ClassificationResult[];

export const TestModelResults = ({ jobId, searchMarking, onBack, onComplete }: TestModelResultsProps) => {
  const [results, setResults] = useState<TestModelResponse | null>(null);
  const [rawFiles, setRawFiles] = useState<RawFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [jobStatus, setJobStatus] = useState<string>("STARTED");
  const [isPolling, setIsPolling] = useState<boolean>(true);
  const [modelThreshold, setModelThreshold] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);
  const { toast } = useToast();

  // Helper function to truncate confidence to 2 decimal places
  const truncateConfidence = (confidence: number): number => {
    return Math.floor(confidence * 100) / 100;
  };

  // Helper function to check if confidence is below threshold
  const isLowConfidence = (confidence: number): boolean => {
    if (modelThreshold === null) return false;
    return truncateConfidence(confidence) < truncateConfidence(modelThreshold);
  };

  useEffect(() => {
    let cancelled = false;

    const fetchResults = async () => {
      try {
        setLoading(true);
        setError(null);
        const [classificationData, rawFilesData, threshold] = await Promise.all([
          apiService.getClassificationResults(jobId),
          apiService.getJobFiles(jobId, 'RAW'),
          apiService.getModelThreshold().catch(() => null)
        ]);
        if (cancelled) return;
        setResults(classificationData);
        setRawFiles(rawFilesData);
        setModelThreshold(threshold);
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to fetch test results:', error);
        let errorMessage = "Не удалось загрузить результаты тестирования";
        if (error instanceof ApiError) {
          errorMessage = error.message;
        }
        setError(errorMessage);
        toast({ title: "Ошибка загрузки", description: errorMessage, variant: "destructive" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const pollStatus = async () => {
      try {
        const statusResp = await apiService.getJobStatus(jobId);
        const status = (statusResp?.status || statusResp) as string;
        setJobStatus(status);
        if (status === 'FINISHED') {
          setIsPolling(false);
          if (pollRef.current) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
          await fetchResults();
        }
      } catch (e) {
        console.error('Failed to poll job status:', e);
        // Если задача удалена/не найдена — прекращаем и показываем ошибку
        setIsPolling(false);
        if (pollRef.current) {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
        let msg = 'Не удалось получить статус задачи';
        if (e instanceof ApiError) msg = e.message;
        setError(msg);
        setLoading(false);
      }
    };

    // Немедленный первый опрос
    pollStatus();
    // Периодический опрос каждые 3 секунды
    pollRef.current = window.setInterval(pollStatus, 3000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId, toast]);

  const getConfidenceColor = (confidence: number) => {
    if (isLowConfidence(confidence)) return "bg-orange-100 text-orange-800";
    if (confidence >= 0.8) return "bg-green-100 text-green-800";
    if (confidence >= 0.6) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getConfidenceBadge = (confidence: number) => {
    if (isLowConfidence(confidence)) return "Ниже порога";
    if (confidence >= 0.8) return "Высокая";
    if (confidence >= 0.6) return "Средняя";
    return "Низкая";
  };

  // Группируем результаты по оригинальным файлам
  const groupedResults = results ? results.reduce((acc, result) => {
    const originalFileId = result.originalFile.id;
    if (!acc[originalFileId]) {
      acc[originalFileId] = {
        originalFile: result.originalFile,
        results: []
      };
    }
    acc[originalFileId].results.push(result);
    return acc;
  }, {} as Record<number, { originalFile: any; results: ClassificationResult[] }>) : {};

  // Получаем файлы без результатов
  const filesWithoutResults = rawFiles.filter(rawFile => 
    !groupedResults[rawFile.id]
  );

  const toggleExpanded = (fileId: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(fileId)) {
      newExpanded.delete(fileId);
    } else {
      newExpanded.add(fileId);
    }
    setExpandedItems(newExpanded);
  };

  if (loading || (isPolling && !results && !error)) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">
              {isPolling ? `Идет обработка архива. Статус: ${jobStatus || 'WAITING'}...` : 'Загрузка результатов тестирования...'}
            </p>
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
              <h1 className="text-2xl font-bold">Результаты тестирования</h1>
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
              Завершить
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Результаты не найдены</h3>
          <p className="text-muted-foreground mb-4">
            Результаты тестирования модели пока недоступны
          </p>
          <div className="flex justify-center space-x-3">
            <Button variant="outline" onClick={onBack}>
              Назад
            </Button>
            <Button onClick={onComplete}>
              Завершить
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
            <h1 className="text-2xl font-bold">Результаты тестирования модели</h1>
            <p className="text-muted-foreground">Анализ классификации инструментов</p>
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
                <span>{rawFiles.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Обработано успешно
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span>{Object.keys(groupedResults).length}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Без результатов
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center space-x-2">
                <AlertCircle className="h-5 w-5 text-orange-500" />
                <span>{filesWithoutResults.length}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Результаты по изображениям */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <BarChart3 className="h-5 w-5" />
              <span>Результаты по изображениям</span>
            </CardTitle>
            <CardDescription>
              Детальные результаты классификации для каждого изображения
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Изображения с результатами */}
              {Object.entries(groupedResults).map(([fileId, group]) => (
                <div key={fileId} className="border rounded-lg">
                  <div 
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpanded(parseInt(fileId))}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-2">
                        {expandedItems.has(parseInt(fileId)) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <FileImage className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <h3 className="font-semibold">{group.originalFile.fileName}</h3>
                        <p className="text-sm text-muted-foreground">
                          Найдено объектов: {group.results.length}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge className="bg-green-100 text-green-800">
                        Обработано
                      </Badge>
                    </div>
                  </div>
                  
                  {expandedItems.has(parseInt(fileId)) && (
                    <div className="border-t p-4 space-y-4">
                      <h4 className="font-medium">Найденные инструменты</h4>
                      <div className="space-y-4">
                        {group.results.map((result, index) => (
                          <div key={index} className="border rounded-lg p-4 bg-muted/20">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              {/* Изображение с bbox для этого инструмента */}
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <h5 className="font-medium">{result.tool.name}</h5>
                                  <Badge className={getConfidenceColor(result.confidence)}>
                                    {getConfidenceBadge(result.confidence)}
                                  </Badge>
                                </div>
                                <ImageWithBbox
                                  originalImageId={result.originalFile.id}
                                  preprocessFileId={result.file.id}
                                  toolName={result.tool.name}
                                  confidence={result.confidence}
                                  className="w-full"
                                />
                              </div>
                              
                              {/* Детали инструмента */}
                              <div className="space-y-3">
                                <div className="space-y-2">
                                  <h6 className="font-medium text-sm">Информация об инструменте</h6>
                                  <div className="text-sm space-y-1">
                                    <div>
                                      <span className="font-medium">Название:</span> {result.tool.name}
                                    </div>
                                    <div>
                                      <span className="font-medium">ID инструмента:</span> {result.tool.id}
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="space-y-2">
                                  <h6 className="font-medium text-sm">Результаты классификации</h6>
                                  <div className="text-sm space-y-1">
                                    <div>
                                      <span className="font-medium">Уверенность:</span> 
                                      <span className={`ml-1 ${isLowConfidence(result.confidence) ? 'text-orange-500 font-medium' : ''}`}>
                                        {(truncateConfidence(result.confidence * 100)).toFixed(2)}%
                                        {isLowConfidence(result.confidence) && <span className="text-orange-500 ml-1">⚠</span>}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="font-medium">Время обработки:</span> {new Date(result.createdAt).toLocaleString('ru-RU')}
                                    </div>
                                    <div>
                                      <span className="font-medium">Статус:</span> 
                                      <Badge 
                                        variant="outline" 
                                        className={`ml-2 ${isLowConfidence(result.confidence) ? 'border-orange-500 text-orange-700' : result.confidence >= 0.8 ? 'border-green-500 text-green-700' : result.confidence >= 0.6 ? 'border-yellow-500 text-yellow-700' : 'border-red-500 text-red-700'}`}
                                      >
                                        {isLowConfidence(result.confidence) ? 'Ниже порога' : result.confidence >= 0.8 ? 'Высокая точность' : result.confidence >= 0.6 ? 'Средняя точность' : 'Низкая точность'}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                
                                {searchMarking && (
                                  <div className="space-y-2">
                                    <h6 className="font-medium text-sm">Маркировка инструмента</h6>
                                    <div className="text-sm">
                                      <span className="font-medium">Маркировка:</span> {
                                        result.marking ? (
                                          <span className="font-medium text-info ml-1">{result.marking}</span>
                                        ) : (
                                          <span className="text-orange-500 font-medium ml-1">Не распознана</span>
                                        )
                                      }
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Изображения без результатов */}
              {filesWithoutResults.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-semibold text-orange-600">Изображения без результатов</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {filesWithoutResults.map((file) => (
                      <div key={file.id} className="p-2 border rounded bg-orange-50">
                        <div className="flex items-center space-x-2">
                          <AlertCircle className="h-4 w-4 text-orange-500" />
                          <span className="text-sm truncate">{file.fileName}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Кнопки действий */}
        <div className="flex justify-end space-x-3">
          <Button variant="outline" onClick={onBack}>
            Назад
          </Button>
          <Button onClick={onComplete} className="bg-primary hover:bg-primary/90">
            <CheckCircle className="h-4 w-4 mr-2" />
            Завершить тестирование
          </Button>
        </div>
      </div>
    </div>
  );
};

