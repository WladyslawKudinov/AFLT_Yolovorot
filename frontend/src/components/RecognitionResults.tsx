import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, CheckCircle, XCircle, AlertCircle, Package, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiRecognitionResultDetailed, ApiError } from "@/lib/api";
import { ImageWithBbox } from "./ImageWithBbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

interface RecognitionItem {
  id: string;
  name: string;
  partNumber: string;
  required: number;
  found: number;
  status: "found" | "not_found" | "not_expected";
  confidence?: number; // 0-100
  marking?: string; // маркировка инструмента
  orderedMarking?: string; // маркировка из заказа (для сравнения)
  markingStatus?: "match" | "mismatch" | "not_specified" | "not_recognized"; // статус соответствия маркировки
  // New fields for image display
  originalImageId?: number;
  preprocessFileId?: number;
  detailedResult?: ApiRecognitionResultDetailed;
}

interface RecognitionResultsProps {
  orderNumber: string;
  orderId: string;
  actionType: "issue" | "return";
  jobId: number;
  onBack: () => void;
  onComplete: () => void;
}

// No mocks – will load from API

export const RecognitionResults = ({ orderNumber, orderId, actionType, jobId, onBack, onComplete }: RecognitionResultsProps) => {
  const [results, setResults] = useState<RecognitionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [modelThreshold, setModelThreshold] = useState<number | null>(null);
  
  // Reannotation states
  const [reannotationStatuses, setReannotationStatuses] = useState<Map<number, boolean>>(new Map());
  const [loadingStatuses, setLoadingStatuses] = useState<Set<number>>(new Set());
  const [sendingResults, setSendingResults] = useState<Set<number>>(new Set());
  
  // Raw files for not_found items gallery
  const [rawFiles, setRawFiles] = useState<Array<{ id: number; fileName: string }>>([]);
  const [imageUrls, setImageUrls] = useState<Map<number, string>>(new Map());
  const [loadingImages, setLoadingImages] = useState<Set<number>>(new Set());
  
  // Modal state for fullscreen image view
  const [fullscreenImageUrl, setFullscreenImageUrl] = useState<string | null>(null);
  const [fullscreenImageName, setFullscreenImageName] = useState<string>("");
  
  // Carousel state for each not_found item
  const [carouselIndices, setCarouselIndices] = useState<Map<string, number>>(new Map());
  const [carouselDirection, setCarouselDirection] = useState<Map<string, 'next' | 'prev'>>(new Map());
  const [previousIndices, setPreviousIndices] = useState<Map<string, number>>(new Map());
  const [isAnimating, setIsAnimating] = useState<Map<string, boolean>>(new Map());
  
  const actionTitle = actionType === "issue" ? "Выдача инструментария" : "Сдача инструментария";
  
  const foundItems = results.filter(item => item.status === "found").length;
  const notFoundItems = results.filter(item => item.status === "not_found").length;
  const unexpectedItems = results.filter(item => item.status === "not_expected").length;
  
  const isCompleteMatch = notFoundItems === 0 && unexpectedItems === 0;

  // Helper function to truncate confidence to 2 decimal places
  const truncateConfidence = (confidence: number): number => {
    return Math.floor(confidence * 100) / 100;
  };

  // Helper function to check if confidence is below threshold
  const isLowConfidence = (confidence: number): boolean => {
    if (modelThreshold === null) return false;
    // confidence is stored in percent (0-100), modelThreshold comes as fraction (0-1)
    return truncateConfidence(confidence / 100) < truncateConfidence(modelThreshold);
  };

  useEffect(() => {
    loadResults();
    
    // Cleanup image URLs on unmount
    return () => {
      imageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [jobId, orderId]);

  const loadResults = async () => {
    try {
      setLoading(true);
      const [orderTools, detailedResults, threshold, rawFilesData] = await Promise.all([
        apiService.getOrderTools(orderId), // returns ApiOrderTool[]
        apiService.getDetailedResults(jobId), // returns ApiRecognitionResultDetailed[]
        apiService.getModelThreshold().catch(() => null), // returns number or null
        apiService.getJobFiles(jobId, 'RAW').catch(() => []), // returns ApiFileInfo[]
      ]);

      // Set model threshold
      setModelThreshold(threshold);

      const orderedToolIds = new Set<number>(
        orderTools.map((ot: any) => ot.tool?.id ?? ot.toolId)
      );

      // Build map for recognized by toolId - use array to handle duplicates
      const recognizedItems = Array.isArray(detailedResults) ? detailedResults : [];
      const recognizedByToolId = new Map<number, ApiRecognitionResultDetailed[]>();
      recognizedItems.forEach((r: ApiRecognitionResultDetailed) => {
        const tid = r.tool?.id;
        if (typeof tid === 'number') {
          if (!recognizedByToolId.has(tid)) {
            recognizedByToolId.set(tid, []);
          }
          recognizedByToolId.get(tid)!.push(r);
        }
      });

      const items: RecognitionItem[] = [];
      const usedRecognitions = new Set<number>(); // Track which recognition results we've used

      // 1) Items that were ordered: mark found/not_found
      orderTools.forEach((ot: any, idx: number) => {
        const tool = ot.tool;
        const rid = tool?.id;
        const orderedMarking = ot.marking; // маркировка из заказа
        const recognizedArray = rid != null ? recognizedByToolId.get(rid) : [];
        
        // Find the best recognition result with priority: matching marking > highest confidence
        let bestRecognition = null;
        let bestRecognitionIndex = -1;
        let bestScore = -1;
        let markingStatus: "match" | "mismatch" | "not_specified" | "not_recognized" = "not_specified";
        
        if (recognizedArray && recognizedArray.length > 0) {
          recognizedArray.forEach((recog: ApiRecognitionResultDetailed, recogIdx: number) => {
            const confidence = typeof recog.confidence === 'number' ? recog.confidence : 0;
            const recogMarking = recog.marking;
            
            // Calculate score: priority for matching markings
            let score = confidence;
            
            // If ordered marking is specified, prioritize matching markings
            if (orderedMarking && orderedMarking.trim()) {
              if (recogMarking && recogMarking.trim() === orderedMarking.trim()) {
                score += 1000; // High priority for matching markings
                markingStatus = "match";
              } else if (recogMarking && recogMarking.trim()) {
                score += 500; // Medium priority for any marking vs no marking
                markingStatus = "mismatch";
              } else {
                // No marking recognized but ordered marking exists
                markingStatus = "not_recognized";
              }
            }
            
            if (score > bestScore) {
              bestScore = score;
              bestRecognition = recog;
              bestRecognitionIndex = recogIdx;
            }
          });
        }
        
        const confidence = bestRecognition ? truncateConfidence(bestRecognition.confidence * 100) : undefined;
        const found = bestRecognition ? 1 : 0;
        const recogMarking = bestRecognition?.marking;
        
        // Determine final status - упрощенная логика
        let status: "found" | "not_found" | "not_expected" = found ? 'found' : 'not_found';
        
        // Mark this recognition as used
        if (bestRecognition && bestRecognitionIndex >= 0) {
          const globalIndex = recognizedItems.findIndex((r: any) => r === recognizedArray[bestRecognitionIndex]);
          if (globalIndex >= 0) {
            usedRecognitions.add(globalIndex);
          }
        }
        
        items.push({
          id: String(ot.id ?? `ord-${idx}`),
          name: tool?.name ?? `Инструмент ${idx + 1}`,
          partNumber: tool?.partNumber ?? '',
          required: 1,
          found,
          status,
          confidence,
          marking: recogMarking,
          orderedMarking: orderedMarking,
          markingStatus: markingStatus,
          // Add image data if available
          originalImageId: bestRecognition?.originalFile?.id,
          preprocessFileId: bestRecognition?.file?.id,
          detailedResult: bestRecognition,
        });
      });

      // 2) Items recognized but not ordered, or excess duplicates: not_expected
      recognizedItems.forEach((r: ApiRecognitionResultDetailed, idx: number) => {
        const tid = r.tool?.id;
        if (typeof tid === 'number' && !usedRecognitions.has(idx)) {
          items.push({
            id: String(r.id ?? `rec-${idx}`),
            name: r.tool?.name ?? `Распознанный инструмент ${idx + 1}`,
            partNumber: r.tool?.partNumber ?? '',
            required: 0,
            found: 1,
            status: 'not_expected',
            confidence: typeof r.confidence === 'number' ? truncateConfidence(r.confidence * 100) : undefined,
            marking: r.marking,
            markingStatus: "not_specified",
            // Add image data
            originalImageId: r.originalFile?.id,
            preprocessFileId: r.file?.id,
            detailedResult: r,
          });
        }
      });

      setResults(items);
      
      // Store raw files for gallery in not_found items
      setRawFiles(rawFilesData.map((file: any) => ({
        id: file.id,
        fileName: file.fileName
      })));
    } catch (error) {
      console.error('Failed to load results:', error);
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить результаты распознавания",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteClick = () => {
    if (isCompleteMatch) {
      onComplete();
    } else {
      setConfirmOpen(true);
    }
  };

  const toggleExpanded = (itemId: string, imageId?: number, isNotFound?: boolean) => {
    const newExpanded = new Set(expandedItems);
    const isExpanding = !newExpanded.has(itemId);
    
    if (isExpanding) {
      newExpanded.add(itemId);
      // Check reannotation status when expanding an item with image
      if (imageId) {
        checkReannotationStatus(imageId);
      }
      // Preload images for not_found items
      if (isNotFound) {
        preloadImagesForNotFound();
      }
    } else {
      newExpanded.delete(itemId);
    }
    setExpandedItems(newExpanded);
  };

  // Check reannotation status for an image when item is expanded
  const checkReannotationStatus = async (imageId: number) => {
    // Skip if already checked
    if (reannotationStatuses.has(imageId) || loadingStatuses.has(imageId)) {
      return;
    }

    try {
      setLoadingStatuses(prev => new Set(prev).add(imageId));
      const status = await apiService.checkImageReannotationStatus(imageId);
      setReannotationStatuses(prev => new Map(prev).set(imageId, status));
    } catch (error) {
      console.error('Failed to check reannotation status:', error);
      // On error, we hide the button by not setting status
    } finally {
      setLoadingStatuses(prev => {
        const newSet = new Set(prev);
        newSet.delete(imageId);
        return newSet;
      });
    }
  };

  // Carousel navigation helpers
  const getCurrentIndex = (itemId: string): number => {
    return carouselIndices.get(itemId) || 0;
  };

  const goToNext = (itemId: string) => {
    const currentIndex = getCurrentIndex(itemId);
    if (currentIndex < rawFiles.length - 1 && !isAnimating.get(itemId)) {
      setPreviousIndices(prev => new Map(prev).set(itemId, currentIndex));
      setCarouselDirection(prev => new Map(prev).set(itemId, 'next'));
      setIsAnimating(prev => new Map(prev).set(itemId, true));
      setCarouselIndices(prev => new Map(prev).set(itemId, currentIndex + 1));
      
      // Clear animation state after animation completes
      setTimeout(() => {
        setIsAnimating(prev => new Map(prev).set(itemId, false));
      }, 400);
    }
  };

  const goToPrevious = (itemId: string) => {
    const currentIndex = getCurrentIndex(itemId);
    if (currentIndex > 0 && !isAnimating.get(itemId)) {
      setPreviousIndices(prev => new Map(prev).set(itemId, currentIndex));
      setCarouselDirection(prev => new Map(prev).set(itemId, 'prev'));
      setIsAnimating(prev => new Map(prev).set(itemId, true));
      setCarouselIndices(prev => new Map(prev).set(itemId, currentIndex - 1));
      
      setTimeout(() => {
        setIsAnimating(prev => new Map(prev).set(itemId, false));
      }, 400);
    }
  };

  // Preload images for not_found item when expanded
  const preloadImagesForNotFound = async () => {
    // Load first few images proactively
    const imagesToPreload = rawFiles.slice(0, 3);
    for (const file of imagesToPreload) {
      if (!imageUrls.has(file.id) && !loadingImages.has(file.id)) {
        loadImageUrl(file.id);
      }
    }
  };

  // Load image URL by file ID
  const loadImageUrl = async (fileId: number): Promise<string | null> => {
    // Check if already loaded
    if (imageUrls.has(fileId)) {
      return imageUrls.get(fileId)!;
    }

    // Check if already loading
    if (loadingImages.has(fileId)) {
      return null;
    }

    try {
      setLoadingImages(prev => new Set(prev).add(fileId));
      const url = await apiService.getFileFromMinIO(fileId);
      setImageUrls(prev => new Map(prev).set(fileId, url));
      return url;
    } catch (error) {
      console.error('Failed to load image:', error);
      return null;
    } finally {
      setLoadingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });
    }
  };

  // Send result to reannotation
  const handleSendToReannotation = async (resultId: number, imageId: number) => {
    try {
      setSendingResults(prev => new Set(prev).add(resultId));
      await apiService.sendResultToReannotation(resultId);
      
      // Update status locally - mark image as sent
      setReannotationStatuses(prev => new Map(prev).set(imageId, true));
      
      toast({
        title: "Отправлено на доразметку",
        description: "Изображение успешно отправлено на доразметку и переобучение модели",
      });
    } catch (error) {
      console.error('Failed to send to reannotation:', error);
      
      let errorMessage = "Не удалось отправить на доразметку";
      if (error instanceof ApiError) {
        errorMessage = error.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Ошибка",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSendingResults(prev => {
        const newSet = new Set(prev);
        newSet.delete(resultId);
        return newSet;
      });
    }
  };

  const getStatusIcon = (status: RecognitionItem["status"]) => {
    switch (status) {
      case "found":
        return <CheckCircle className="h-5 w-5 text-success" />;
      case "not_found":
        return <XCircle className="h-5 w-5 text-destructive" />;
      case "not_expected":
        return <AlertCircle className="h-5 w-5 text-info" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (item: RecognitionItem) => {
    switch (item.status) {
      case "found":
        return (
          <Badge className="bg-success text-success-foreground">
            Найдено {item.found}/{item.required}
          </Badge>
        );
      case "not_found":
        return (
          <Badge variant="destructive">
            Не найдено (0/{item.required})
          </Badge>
        );
      case "not_expected":
        return (
          <Badge className="bg-info text-info-foreground">
            Лишний предмет
          </Badge>
        );
      default:
        return null;
    }
  };

  const getStatusDescription = (status: RecognitionItem["status"]) => {
    switch (status) {
      case "found":
        return "Было - найдено";
      case "not_found":
        return "Было - не найдено";
      case "not_expected":
        return "Не было - найдено";
      default:
        return "";
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center space-x-4 mb-8">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="flex items-center space-x-2"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Назад</span>
        </Button>
      </div>

      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <Package className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Результаты распознавания</h1>
            <p className="text-muted-foreground">{actionTitle} - Заказ {orderNumber}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Сводка результатов
              {isCompleteMatch ? (
                <Badge className="bg-success text-success-foreground">Полное соответствие</Badge>
              ) : (
                <Badge variant="destructive">Есть расхождения</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Результаты автоматического распознавания загруженных изображений
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-center space-x-3 p-4 border rounded-lg">
                <CheckCircle className="h-6 w-6 text-success" />
                <div>
                  <p className="text-2xl font-bold text-success">{foundItems}</p>
                  <p className="text-sm text-muted-foreground">Найдено</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-4 border rounded-lg">
                <XCircle className="h-6 w-6 text-destructive" />
                <div>
                  <p className="text-2xl font-bold text-destructive">{notFoundItems}</p>
                  <p className="text-sm text-muted-foreground">Не найдено</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-4 border rounded-lg">
                <AlertCircle className="h-6 w-6 text-info" />
                <div>
                  <p className="text-2xl font-bold text-info">{unexpectedItems}</p>
                  <p className="text-sm text-muted-foreground">Лишние</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Детальные результаты</CardTitle>
            <CardDescription>Список всех позиций с результатами распознавания</CardDescription>
          </CardHeader>
          
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((item) => {
                  // Only show expandable content for found or not_expected items
                  const shouldShowImage = item.status === "found" || item.status === "not_expected";
                  
                  if (shouldShowImage) {
                    return (
                      <Collapsible key={item.id} open={expandedItems.has(item.id)} onOpenChange={() => toggleExpanded(item.id, item.originalImageId)}>
                        <div className="border rounded-lg">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                              <div className="flex items-center space-x-3">
                                {getStatusIcon(item.status)}
                                <div>
                                  <p className="font-medium">{item.name}</p>
                                  {/* Показываем номер только для заказанных инструментов */}
                                  {item.orderedMarking && item.partNumber && (
                                    <p className="text-sm text-muted-foreground">Номер: {item.partNumber}</p>
                                  )}
                                  {/* Показываем маркировки только если они есть */}
                                  {item.orderedMarking && (
                                    <p className="text-sm text-muted-foreground">
                                      Заказанная маркировка: <span className="font-medium">{item.orderedMarking}</span>
                                    </p>
                                  )}
                                  {item.orderedMarking && (
                                    <p className="text-sm text-muted-foreground">
                                      Найденная маркировка: {
                                        item.marking ? (
                                          <>
                                            <span className={`font-medium ${item.markingStatus === "match" ? "text-success" : "text-orange-500"}`}>
                                              {item.marking}
                                            </span>
                                            {item.markingStatus === "match" && <span className="text-success ml-2">✓</span>}
                                            {item.markingStatus === "mismatch" && <span className="text-orange-500 ml-2">⚠</span>}
                                          </>
                                        ) : (
                                          <span className="text-orange-500 font-medium">Не распознана</span>
                                        )
                                      }
                                    </p>
                                  )}
                                  {/* Для лишних инструментов показываем маркировку отдельно */}
                                  {!item.orderedMarking && (
                                    <p className="text-sm text-muted-foreground">
                                      Маркировка: {
                                        item.marking ? (
                                          <span className="font-medium text-info">{item.marking}</span>
                                        ) : (
                                          <span className="text-orange-500 font-medium">Не распознана</span>
                                        )
                                      }
                                    </p>
                                  )}
                                  <div className="flex items-center space-x-2">
                                    <p className="text-xs text-muted-foreground">{getStatusDescription(item.status)}</p>
                                    {item.confidence && (
                                      <p className="text-xs text-muted-foreground">
                                        • Уверенность: 
                                        <span className={`ml-1 ${isLowConfidence(item.confidence) ? 'text-orange-500 font-medium' : ''}`}>
                                          {item.confidence.toFixed(2)}%
                                          {isLowConfidence(item.confidence) && <span className="text-orange-500 ml-1">⚠</span>}
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                {getStatusBadge(item)}
                                {expandedItems.has(item.id) ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          
                          <CollapsibleContent>
                            <div className="px-4 pb-4 border-t bg-muted/20">
                              {item.originalImageId ? (
                                <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {/* Изображение с bbox */}
                                  <div>
                                    <ImageWithBbox
                                      originalImageId={item.originalImageId}
                                      preprocessFileId={item.preprocessFileId || null}
                                      toolName={item.name}
                                      confidence={item.detailedResult?.confidence || 0}
                                      className="w-full"
                                    />
                                  </div>
                                  
                                  {/* Правый блок с деталями и кнопкой */}
                                  <div className="space-y-4">
                                    <div className="space-y-3">
                                      <h6 className="font-medium text-sm">Дополнительные действия</h6>
                                      <div className="text-sm text-muted-foreground mb-2">
                                        Если результат распознавания неудовлетворителен, отправьте изображение на доразметку для улучшения модели
                                      </div>
                                      
                                      {/* Кнопка отправки на доразметку */}
                                      {loadingStatuses.has(item.originalImageId) ? (
                                        <div className="flex items-center justify-center py-2 text-muted-foreground">
                                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                                          <span className="text-sm">Проверка статуса...</span>
                                        </div>
                                      ) : reannotationStatuses.get(item.originalImageId) === true ? (
                                        <Button 
                                          variant="outline" 
                                          className="w-full"
                                          disabled
                                        >
                                          <CheckCircle className="h-4 w-4 mr-2" />
                                          Фото уже отправлено на доразметку
                                        </Button>
                                      ) : reannotationStatuses.has(item.originalImageId) ? (
                                        <Button 
                                          variant="outline" 
                                          className="w-full border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white"
                                          onClick={() => {
                                            const resultId = item.detailedResult?.id;
                                            if (resultId && item.originalImageId) {
                                              handleSendToReannotation(resultId, item.originalImageId);
                                            }
                                          }}
                                          disabled={item.detailedResult?.id ? sendingResults.has(item.detailedResult.id) : true}
                                        >
                                          {item.detailedResult?.id && sendingResults.has(item.detailedResult.id) ? (
                                            <>
                                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2"></div>
                                              Отправка...
                                            </>
                                          ) : (
                                            <>
                                              <AlertCircle className="h-4 w-4 mr-2" />
                                              Отправить на доразметку
                                            </>
                                          )}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-4 p-4 text-center text-muted-foreground">
                                  <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                                  <p>Изображение недоступно</p>
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  } else {
                    // For not_found items, show expandable card with gallery
                    return (
                      <Collapsible key={item.id} open={expandedItems.has(item.id)} onOpenChange={() => toggleExpanded(item.id, undefined, true)}>
                        <div className="border rounded-lg">
                          <CollapsibleTrigger asChild>
                            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                              <div className="flex items-center space-x-3">
                                {getStatusIcon(item.status)}
                                <div>
                                  <p className="font-medium">{item.name}</p>
                                  {/* Показываем номер только для заказанных инструментов */}
                                  {item.orderedMarking && item.partNumber && (
                                    <p className="text-sm text-muted-foreground">Номер: {item.partNumber}</p>
                                  )}
                                  {/* Показываем маркировки только если они есть */}
                                  {item.orderedMarking && (
                                    <p className="text-sm text-muted-foreground">
                                      Заказанная маркировка: <span className="font-medium">{item.orderedMarking}</span>
                                    </p>
                                  )}
                                  <div className="flex items-center space-x-2">
                                    <p className="text-xs text-muted-foreground">{getStatusDescription(item.status)}</p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center space-x-2">
                                {getStatusBadge(item)}
                                {expandedItems.has(item.id) ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                          </CollapsibleTrigger>
                          
                          <CollapsibleContent>
                            <div className="px-4 pb-4 border-t bg-muted/20">
                              <div className="mt-4">
                                <h6 className="font-medium text-sm mb-3">Все загруженные изображения ({rawFiles.length})</h6>
                                {rawFiles.length === 0 ? (
                                  <div className="text-center py-8 text-muted-foreground">
                                    <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                                    <p>Изображения не найдены</p>
                                  </div>
                                ) : (
                                  <div className="space-y-4">
                                    {/* Carousel */}
                                    <div className="relative">
                                      <Card className="overflow-hidden">
                                        <CardContent className="p-4">
                                          {(() => {
                                            const currentIndex = getCurrentIndex(item.id);
                                            const currentFile = rawFiles[currentIndex];
                                            const imageUrl = currentFile ? imageUrls.get(currentFile.id) : null;
                                            const direction = carouselDirection.get(item.id) || 'next';
                                            
                                            return (
                                              <div className="space-y-2">
                                                <div className="flex items-center justify-between mb-2">
                                                  <span className="text-sm font-medium">{currentFile?.fileName}</span>
                                                  <span className="text-sm text-muted-foreground">
                                                    {currentIndex + 1} / {rawFiles.length}
                                                  </span>
                                                </div>
                                                
                                                <div className="relative group overflow-hidden rounded-lg" style={{ minHeight: '300px' }}>
                                                  {loadingImages.has(currentFile?.id) || !imageUrl ? (
                                                    <div className="flex items-center justify-center bg-muted rounded-lg h-full">
                                                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                                    </div>
                                                  ) : (
                                                    <>
                                                      {/* Previous image (sliding out) */}
                                                      {isAnimating.get(item.id) && (() => {
                                                        const prevIndex = previousIndices.get(item.id);
                                                        if (prevIndex !== undefined) {
                                                          const prevFile = rawFiles[prevIndex];
                                                          const prevImageUrl = prevFile ? imageUrls.get(prevFile.id) : null;
                                                          if (prevImageUrl) {
                                                            return (
                                                              <div
                                                                className="absolute inset-0"
                                                                style={{
                                                                  animation: direction === 'next' 
                                                                    ? 'slideOutToLeft 0.4s ease-out forwards' 
                                                                    : 'slideOutToRight 0.4s ease-out forwards',
                                                                  zIndex: 1
                                                                }}
                                                              >
                                                                <img 
                                                                  src={prevImageUrl} 
                                                                  alt={prevFile.fileName}
                                                                  className="w-full h-auto rounded-lg border"
                                                                  style={{ 
                                                                    maxHeight: '400px', 
                                                                    objectFit: 'contain',
                                                                    pointerEvents: 'none'
                                                                  }}
                                                                />
                                                              </div>
                                                            );
                                                          }
                                                        }
                                                        return null;
                                                      })()}
                                                      
                                                      {/* Current image (sliding in) */}
                                                      <div
                                                        key={`${item.id}-${currentIndex}`}
                                                        className="relative flex items-center justify-center"
                                                        style={{
                                                          animation: isAnimating.get(item.id)
                                                            ? (direction === 'next' 
                                                              ? 'slideInFromRight 0.4s ease-out' 
                                                              : 'slideInFromLeft 0.4s ease-out')
                                                            : 'none',
                                                          zIndex: 2,
                                                          position: isAnimating.get(item.id) ? 'relative' : 'relative',
                                                          minHeight: '300px'
                                                        }}
                                                      >
                                                        <div 
                                                          className="inline-block cursor-pointer"
                                                          onClick={() => {
                                                            setFullscreenImageUrl(imageUrl);
                                                            setFullscreenImageName(currentFile.fileName);
                                                          }}
                                                        >
                                                          <img 
                                                            src={imageUrl} 
                                                            alt={currentFile.fileName}
                                                            className="rounded-lg border hover:opacity-90 transition-opacity"
                                                            style={{ 
                                                              maxHeight: '400px', 
                                                              objectFit: 'contain',
                                                              display: 'block'
                                                            }}
                                                            onLoad={() => {
                                                              // Preload next image
                                                              if (currentIndex < rawFiles.length - 1) {
                                                                const nextFile = rawFiles[currentIndex + 1];
                                                                if (nextFile && !imageUrls.has(nextFile.id)) {
                                                                  loadImageUrl(nextFile.id);
                                                                }
                                                              }
                                                            }}
                                                          />
                                                        </div>
                                                        <Button
                                                          variant="secondary"
                                                          size="sm"
                                                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                                          onClick={(e) => {
                                                            e.stopPropagation();
                                                            setFullscreenImageUrl(imageUrl);
                                                            setFullscreenImageName(currentFile.fileName);
                                                          }}
                                                        >
                                                          <Maximize2 className="h-4 w-4" />
                                                        </Button>
                                                      </div>
                                                    </>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })()}
                                        </CardContent>
                                      </Card>
                                      
                                      {/* Navigation buttons */}
                                      {rawFiles.length > 1 && (
                                        <>
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            className="absolute left-2 top-1/2 -translate-y-1/2 z-50 shadow-lg"
                                            style={{ 
                                              pointerEvents: getCurrentIndex(item.id) === 0 ? 'none' : 'auto'
                                            }}
                                            onClick={() => goToPrevious(item.id)}
                                            disabled={getCurrentIndex(item.id) === 0}
                                          >
                                            <ChevronLeft className="h-4 w-4" />
                                          </Button>
                                          <Button
                                            variant="outline"
                                            size="icon"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 z-50 shadow-lg"
                                            style={{ 
                                              pointerEvents: getCurrentIndex(item.id) === rawFiles.length - 1 ? 'none' : 'auto'
                                            }}
                                            onClick={() => goToNext(item.id)}
                                            disabled={getCurrentIndex(item.id) === rawFiles.length - 1}
                                          >
                                            <ChevronRight className="h-4 w-4" />
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                    
                                    <p className="text-xs text-muted-foreground text-center">
                                      Нажмите на изображение для просмотра в полном размере
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  }
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {isCompleteMatch 
              ? "Все позиции найдены и соответствуют заказу. Можно продолжить." 
              : "Есть расхождения. Проверьте список перед продолжением."}
          </div>
          
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button 
                onClick={handleCompleteClick}
                size="lg" 
                className="px-8"
              >
                {actionType === "issue" ? "Выдать" : "Принять"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Подтверждение выдачи при расхождениях</AlertDialogTitle>
                <AlertDialogDescription>
                  В результатах найдены расхождения с заказом. Подтвердите, что вы отметили вручную изменения в системе ТОиР.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Отмена</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setConfirmOpen(false);
                    onComplete();
                  }}
                >
                  Подтверждаю
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
      
      {/* Fullscreen image dialog */}
      <Dialog open={!!fullscreenImageUrl} onOpenChange={(open) => !open && setFullscreenImageUrl(null)}>
        <DialogContent 
          className="max-w-[95vw] max-h-[95vh] p-2 [&>button]:hidden animate-none"
          style={{
            animationDuration: '0s',
            transition: 'none'
          }}
        >
          <DialogTitle className="sr-only">{fullscreenImageName}</DialogTitle>
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Close button */}
            <Button
              variant="outline"
              size="icon"
              className="absolute top-2 right-2 z-50 shadow-lg"
              onClick={() => setFullscreenImageUrl(null)}
            >
              <X className="h-5 w-5" />
            </Button>
            
            <img 
              src={fullscreenImageUrl || ''} 
              alt={fullscreenImageName}
              className="max-w-full max-h-[90vh] object-contain"
            />
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white px-3 py-1 rounded text-sm">
              {fullscreenImageName}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};