import { useState, useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ArrowLeft, Camera, Upload, Play, X, AlertCircle, ChevronLeft, ChevronRight, HelpCircle, Search, Check, ChevronDown, Eye, CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError, clearApiCache } from "@/lib/api";
import { Order } from "./OrdersList";
import { ImageWithBbox } from "./ImageWithBbox";
import { ImageWithMultipleSegmentations, clearImageCache } from "./ImageWithMultipleSegmentations";
import { cn } from "@/lib/utils";

interface ProcessingWorkspaceProps {
  order: Order | null;
  orders: Order[];
  actionType: "issue" | "return";
  jobId: number | null;
  onOrderChange: (orderId: string) => void;
  onComplete: (isFull?: boolean) => void; // isFull - полный ли набор (все позиции найдены)
}

interface UploadedFile {
  id: string;
  name: string;
  file: File;
  status: "uploaded" | "processing" | "processed" | "error";
  previewUrl?: string; // URL для превью (для файлов из MinIO)
}

interface RecognitionResult {
  id: number;
  name: string;
  confidence: number;
  marking?: string;
  markingMatch?: boolean;
  bbox?: string;
  mask?: number[][]; // Polygon points for segmentation
  fileId?: number; // ID файла сегментации в MinIO
  originalFileId?: number;
}

interface AllResultsData {
  results: RecognitionResult[];
}

export const ProcessingWorkspace = ({ order, orders, actionType, jobId, onOrderChange, onComplete }: ProcessingWorkspaceProps) => {
  const [cameraStreams, setCameraStreams] = useState<MediaStream[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [combinePredictions, setCombinePredictions] = useState(false); // По умолчанию OFF
  const [recognizeMarkings, setRecognizeMarkings] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState("80");
  const [showBbox, setShowBbox] = useState(false); // false = mask, true = bbox
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [detectedCount, setDetectedCount] = useState<number | null>(null);
  const [allResultsData, setAllResultsData] = useState<AllResultsData | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<'yes' | 'no' | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [orderTools, setOrderTools] = useState<any[]>([]); // Инструменты заказа
  
  // Reannotation states (как в оригинале)
  const [reannotationStatuses, setReannotationStatuses] = useState<Map<number, boolean>>(new Map());
  const [loadingStatuses, setLoadingStatuses] = useState<Set<number>>(new Set());
  const [sendingResults, setSendingResults] = useState<Set<number>>(new Set());
  
  // Confirmation dialog state (для подтверждения при расхождениях)
  const [confirmOpen, setConfirmOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const { toast } = useToast();

  const actionTitle = order 
    ? (actionType === "issue" ? "Выдача инструментария" : "Сдача инструментария")
    : "Выберите заказ для начала работы";

  // Функция для обрезания (truncate) процентов до 2 знаков после запятой (как в оригинале)
  const truncateConfidence = (confidence: number): number => {
    // Умножаем на 100, обрезаем до 2 знаков, делим обратно
    return Math.floor(confidence * 10000) / 100;
  };

  // Проверка является ли файл видео
  const isVideoFile = (file: UploadedFile): boolean => {
    return file.file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
  };

  // Фильтруем результаты в зависимости от режима и выбранного файла (мемоизация)
  const filteredResults = useMemo(() => {
    console.log("=== FILTERING RESULTS ===");
    console.log("combinePredictions:", combinePredictions);
    console.log("selectedFileId:", selectedFileId);
    console.log("uploadedFiles:", uploadedFiles.map(f => ({ id: f.id, name: f.name })));
    console.log("allResultsData:", allResultsData ? allResultsData.results.length : 0);
    
    if (!allResultsData) {
      console.log("No allResultsData, returning empty array");
      return [];
    }
    
    // ВАЖНО: используем ТЕКУЩЕЕ значение combinePredictions, а не сохраненное
    // Если combinePredictions = true, показываем все результаты
    if (combinePredictions) {
      console.log("=== COMBINED MODE: showing all results ===", allResultsData.results.length);
      return allResultsData.results;
    }
    
    // Если combinePredictions = false, показываем только результаты для выбранного файла
    if (!selectedFileId) {
      console.log("=== PER-IMAGE MODE: no file selected ===");
      return [];
    }
    
    // Находим выбранный файл
    const selectedFile = uploadedFiles.find(f => f.id === selectedFileId);
    if (!selectedFile) {
      console.log("=== PER-IMAGE MODE: file not found ===");
      return [];
    }
    
    // Простая логика: ищем результаты по originalFileId
    const fileId = parseInt(selectedFile.id);
    console.log("=== PER-IMAGE MODE: filtering by fileId ===");
    console.log("Selected file:", selectedFile);
    console.log("Looking for results by fileId:", fileId);
    console.log("All results with originalFileIds:", allResultsData.results.map(r => ({ 
      id: r.id, 
      name: r.name, 
      originalFileId: r.originalFileId
    })));
    
    // Фильтруем результаты по fileId
    const matchingResults = allResultsData.results.filter(r => r.originalFileId === fileId);
    console.log("Found results for fileId:", matchingResults.length);
    console.log("Matching results:", matchingResults.map(r => ({ id: r.id, name: r.name })));
    return matchingResults;
  }, [allResultsData, combinePredictions, selectedFileId, uploadedFiles]);

  // Разделяем результаты на "Совпадают с заказом" и "Лишние" (мемоизация)
  const categorizedResults = useMemo(() => {
    if (!orderTools || orderTools.length === 0) {
      return { matching: filteredResults, extra: [] };
    }

    const matching: RecognitionResult[] = [];
    const extra: RecognitionResult[] = [];
    const usedRecognitions = new Set<number>();

    // Считаем сколько каждого инструмента нужно в заказе
    const orderToolCounts = new Map<string, number>();
    orderTools.forEach((orderTool: any) => {
      const toolName = orderTool.tool?.name;
      if (!toolName) return;
      
      const normalizedName = toolName.toLowerCase().trim();
      orderToolCounts.set(normalizedName, (orderToolCounts.get(normalizedName) || 0) + 1);
    });

    // 1) Сначала находим инструменты, которые совпадают с заказом (с учетом количества)
    filteredResults.forEach((result) => {
      const normalizedName = result.name.toLowerCase().trim();
      const requiredCount = orderToolCounts.get(normalizedName) || 0;
      
      // Считаем сколько уже добавили matching для этого инструмента
      const alreadyMatchedCount = matching.filter(r => 
        r.name.toLowerCase().trim() === normalizedName
      ).length;
      
      if (requiredCount > 0 && alreadyMatchedCount < requiredCount) {
        // Этот инструмент нужен в заказе и еще не весь учтен
        matching.push(result);
        usedRecognitions.add(result.id);
      }
    });

    // 2) Остальные - лишние (либо вообще не в заказе, либо больше чем нужно)
    filteredResults.forEach((result) => {
      if (!usedRecognitions.has(result.id)) {
        extra.push(result);
      }
    });

    console.log("Categorized results:", {
      matching: matching.length,
      extra: extra.length,
      matchingList: matching.map(r => r.name),
      extraList: extra.map(r => r.name)
    });

    return { matching, extra };
  }, [filteredResults, orderTools]);

  // Фильтруем bbox для отображения на изображении (мемоизация для предотвращения лишних перерендеров)
  const bboxesToDisplay = useMemo(() => {
    if (!allResultsData || !selectedFileId) return [];
    
    // Находим числовой ID выбранного файла
    const selectedFile = uploadedFiles.find(f => f.id === selectedFileId);
    if (!selectedFile) return [];
    
    const fileId = parseInt(selectedFile.id);
    
    // Если выбран конкретный инструмент, показываем только его bbox
    if (selectedToolId) {
      // Ищем этот инструмент среди всех результатов и фильтруем по файлу
      const selectedResult = allResultsData.results.find(r => r.id === selectedToolId);
      if (selectedResult && selectedResult.originalFileId === fileId) {
        return [selectedResult];
      }
      return [];
    }
    
    // Если выбран режим combinePredictions, показываем только bbox для текущего файла
    if (combinePredictions) {
      return allResultsData.results.filter(r => r.originalFileId === fileId);
    }
    
    // Если режим per-image, показываем bbox для выбранного файла
    return allResultsData.results.filter(r => r.originalFileId === fileId);
  }, [allResultsData, selectedFileId, selectedToolId, combinePredictions, uploadedFiles]);

  // Мемоизируем segmentationFileIds для ImageWithMultipleSegmentations
  const segmentationFileIds = useMemo(() => 
    bboxesToDisplay.filter(r => r.fileId).map(r => r.fileId!), 
    [bboxesToDisplay]
  );

  // Мемоизируем названия инструментов для подписей
  const toolNames = useMemo(() => 
    bboxesToDisplay.filter(r => r.fileId).map(r => r.name), 
    [bboxesToDisplay]
  );

  // Load confidence threshold on mount
  useEffect(() => {
    const loadThreshold = async () => {
      try {
        const threshold = await apiService.getModelThreshold();
        setConfidenceThreshold((threshold * 100).toString());
      } catch (error) {
        console.error("Failed to load threshold:", error);
      }
    };
    loadThreshold();
  }, []);

  // Load order tools when order changes AND reset all state
  useEffect(() => {
    const loadOrderTools = async () => {
      if (!order) {
        setOrderTools([]);
        return;
      }

      // Сброс всех состояний при смене заказа
      console.log("=== ORDER CHANGED - RESETTING STATE ===");
      
      // Очищаем все кэши (КРИТИЧНО!)
      clearApiCache();
      clearImageCache();
      
      setUploadedFiles([]);
      setAllResultsData(null);
      setSelectedFileId(null);
      setCurrentImageUrl(null);
      setSelectedToolId(null);
      setDetectedCount(null);
      setHasError(false);
      setReannotationStatuses(new Map());
      setLoadingStatuses(new Set());
      setSendingResults(new Set());

      try {
        const tools = await apiService.getOrderTools(order.id);
        console.log("Loaded order tools:", tools);
        setOrderTools(tools);
      } catch (error) {
        console.error("Failed to load order tools:", error);
        setOrderTools([]);
      }
    };

    loadOrderTools();
  }, [order?.id]);

  // Load existing files when job AND order changes together
  useEffect(() => {
    let cancelled = false; // Флаг для предотвращения race conditions
    
    const loadExistingFiles = async () => {
      if (!jobId || !order) {
        // Reset when no job selected
        setUploadedFiles([]);
        setAllResultsData(null);
        setSelectedFileId(null);
        setCurrentImageUrl(null);
        return;
      }

      // Сначала очищаем файлы перед загрузкой новых (предотвращает race condition)
      console.log("=== CLEARING FILES BEFORE LOADING NEW ONES ===");
      setUploadedFiles([]);
      setSelectedFileId(null);
      setCurrentImageUrl(null);

      try {
        console.log("=== LOADING FILES FROM API ===");
        console.log("Loading files for jobId:", jobId, "orderId:", order.id);
        
        // Получаем список всех RAW файлов привязанных к Job (как в оригинале)
        const apiFiles = await apiService.getJobFiles(jobId, 'RAW');
        
        // Проверяем, не был ли отменен запрос
        if (cancelled) {
          console.log("=== LOADING CANCELLED (component unmounted or deps changed) ===");
          return;
        }
        
        console.log("Loaded files from API:", apiFiles);
        
        if (!apiFiles || apiFiles.length === 0) {
          console.log("No files found for this job");
          return;
        }

        // Сначала попытаемся получить результаты распознавания (если они есть)
        // Нужно проверить ОБА типа результатов: combined (/results) и per-image (/results/classification)
        let allExistingResults: any[] = [];
        try {
          const [combinedResults, classificationResults] = await Promise.allSettled([
            apiService.getJobResults(jobId),
            apiService.getJobClassificationResults(jobId)
          ]);
          
          if (combinedResults.status === 'fulfilled') {
            allExistingResults = [...allExistingResults, ...(combinedResults.value || [])];
          }
          if (classificationResults.status === 'fulfilled') {
            allExistingResults = [...allExistingResults, ...(classificationResults.value || [])];
          }
          
          console.log("Loaded existing results for status check (combined + classification):", allExistingResults);
          console.log("Total results count:", allExistingResults.length);
        } catch (error) {
          console.log("No existing results found (this is OK for new jobs)");
        }
        
        // Загружаем превью для каждого файла (параллельно, не прерываясь на ошибках)
        const filePromises = apiFiles.map(async (apiFile) => {
          try {
            const imageUrl = await apiService.getFileFromMinIO(apiFile.id);
            
            // Create a placeholder file object
            const placeholderFile = new File([], apiFile.fileName || `file-${apiFile.id}`, {
              type: 'image/jpeg'
            });
            
            // Проверяем является ли файл видео (по расширению)
            const isVideoFile = apiFile.fileName && 
              (apiFile.fileName.toLowerCase().endsWith('.mp4') || 
               apiFile.fileName.toLowerCase().endsWith('.avi') || 
               apiFile.fileName.toLowerCase().endsWith('.mov'));
            
            // Проверяем есть ли результаты по этому файлу (в обоих типах результатов)
            const hasResults = allExistingResults && allExistingResults.length > 0 && 
              allExistingResults.some((r: any) => {
                // Для /results/classification: r.originalFile.id
                // Для /results (combined): r.originalFileId
                const resultFileId = r.originalFile?.id || r.originalFileId;
                
                // Сравниваем и как число, и как строку на всякий случай
                return resultFileId === apiFile.id || 
                       resultFileId === apiFile.id.toString() ||
                       Number(resultFileId) === apiFile.id;
              });
            
            // Для видео файлов всегда "processed" (результаты есть только для кадров)
            const fileStatus = isVideoFile ? "processed" as const : 
                              hasResults ? "processed" as const : "error" as const;
            
            console.log(`File ${apiFile.id} (${apiFile.fileName}):`);
            console.log(`  - Checking against ${allExistingResults.length} results`);
            console.log(`  - Sample result IDs:`, allExistingResults.slice(0, 3).map((r: any) => ({
              originalFileId: r.originalFileId,
              originalFile_id: r.originalFile?.id
            })));
            console.log(`  - hasResults: ${hasResults}`);
            console.log(`  - status: ${fileStatus}`);

            setUploadedFiles((prev) => {
              // Avoid duplicates
              if (prev.find(f => f.id === apiFile.id.toString())) {
                return prev;
              }
              console.log(`Adding file to uploadedFiles: ${apiFile.id} - ${apiFile.fileName} - status: ${fileStatus}`);
              return [...prev, {
                id: apiFile.id.toString(),
                name: apiFile.fileName || `Изображение ${apiFile.id}`,
                file: placeholderFile,
                status: fileStatus,
                previewUrl: imageUrl // Сохраняем URL для превью
              }];
            });

            // Auto-select first file (пропускаем видео файлы)
            if (!selectedFileId && !isVideoFile) {
              console.log(`Auto-selecting first file: ${apiFile.id}`);
              setSelectedFileId(apiFile.id.toString());
              setCurrentImageUrl(imageUrl);
            } else if (isVideoFile) {
              console.log(`Skipping auto-select for video file: ${apiFile.fileName}`);
            }
          } catch (error) {
            console.error(`Failed to load file ${apiFile.id}:`, error);
          }
        });

        // Используем Promise.allSettled чтобы не прерываться на ошибках отдельных файлов
        await Promise.allSettled(filePromises);
        
        // Финальная проверка перед завершением
        if (cancelled) {
          console.log("=== LOADING CANCELLED AFTER FILES LOADED ===");
          return;
        }
        
        console.log("=== FILES LOADED ===");
      } catch (error) {
        console.error("Failed to load existing files:", error);
        // Not a critical error - user can still upload new files
      }
    };

    loadExistingFiles();
    
    // Cleanup function - отменяем загрузку при размонтировании или смене зависимостей
    return () => {
      cancelled = true;
    };
  }, [jobId, order?.id]);

  // Effect to bind camera stream to video element after render
  useEffect(() => {
    if (isCameraActive && videoRef.current && cameraStreams.length > 0) {
      const stream = cameraStreams[currentCameraIndex];
      if (stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((err) => {
          console.warn("Video play failed:", err);
        });
      }
    }
  }, [isCameraActive, cameraStreams, currentCameraIndex]);

  // Вычисляем отсутствующие и лишние инструменты
  const missingAndExtraTools = (() => {
    console.log("=== Missing and Extra Tools Calculation ===");
    console.log("allResultsData:", !!allResultsData);
    console.log("order:", !!order);
    console.log("orderTools.length:", orderTools.length);
    console.log("selectedFileId:", selectedFileId);
    console.log("uploadedFiles:", uploadedFiles.map(f => ({ id: f.id, name: f.name })));
    
    if (!allResultsData || !order || orderTools.length === 0) {
      console.log("Early return: missing data");
      return { missing: [], extra: [] };
    }

    // ВАЖНО: используем ТЕКУЩЕЕ значение combinePredictions
    // Определяем какие результаты анализировать в зависимости от режима
    let resultsToAnalyze: RecognitionResult[];
    
    if (combinePredictions) {
      // Режим 1: "На всех фото один набор" = ON
      // Анализируем все результаты из /results
      console.log("=== MISSING/EXTRA: COMBINED MODE ===");
      resultsToAnalyze = allResultsData.results;
    } else {
      // Режим 2: "На всех фото один набор" = OFF  
      // Анализируем только результаты для текущего выбранного фото
      if (!selectedFileId) {
        console.log("=== MISSING/EXTRA: PER-IMAGE MODE - no file selected ===");
        resultsToAnalyze = [];
      } else {
        const selectedFile = uploadedFiles.find(f => f.id === selectedFileId);
        if (!selectedFile) {
          console.log("=== MISSING/EXTRA: PER-IMAGE MODE - file not found ===");
          resultsToAnalyze = [];
        } else {
          const fileId = parseInt(selectedFile.id);
          console.log("=== MISSING/EXTRA: PER-IMAGE MODE - filtering ===");
          console.log("Selected file:", selectedFile);
          console.log("Looking for results by fileId:", fileId);
          console.log("All results:", allResultsData.results.map(r => ({ 
            id: r.id, 
            name: r.name, 
            originalFileId: r.originalFileId
          })));
          resultsToAnalyze = allResultsData.results.filter(r => {
            const matches = r.originalFileId === fileId;
            console.log(`Result ${r.id} (${r.name}) originalFileId: ${r.originalFileId}, matches:`, matches);
            return matches;
          });
          console.log("Filtered results:", resultsToAnalyze.map(r => ({ id: r.id, name: r.name })));
        }
      }
    }

    const missing: string[] = [];
    const extra: string[] = [];

    // 1) Считаем сколько каждого инструмента нужно в заказе
    const orderToolCounts = new Map<string, number>();
    orderTools.forEach((orderTool: any) => {
      const toolName = orderTool.tool?.name;
      if (!toolName) return;
      
      const normalizedName = toolName.toLowerCase().trim();
      orderToolCounts.set(normalizedName, (orderToolCounts.get(normalizedName) || 0) + 1);
    });
    
    // 2) Считаем сколько каждого инструмента распознано
    const recognizedToolCounts = new Map<string, number>();
    resultsToAnalyze.forEach((result) => {
      const normalizedName = result.name.toLowerCase().trim();
      recognizedToolCounts.set(normalizedName, (recognizedToolCounts.get(normalizedName) || 0) + 1);
    });
    
    // 3) Находим недостающие инструменты (учитываем количество!)
    orderToolCounts.forEach((requiredCount, normalizedToolName) => {
      const recognizedCount = recognizedToolCounts.get(normalizedToolName) || 0;
      const missingCount = requiredCount - recognizedCount;
      
      if (missingCount > 0) {
        // Находим оригинальное название с правильным регистром
        const originalTool = orderTools.find((ot: any) => 
          ot.tool?.name?.toLowerCase().trim() === normalizedToolName
        );
        const displayName = originalTool?.tool?.name || normalizedToolName;
        
        // Добавляем в массив столько раз, сколько не хватает
        for (let i = 0; i < missingCount; i++) {
          missing.push(displayName);
        }
      }
    });

    // 4) Находим лишние инструменты (распознано больше чем в заказе, или не в заказе вообще)
    recognizedToolCounts.forEach((recognizedCount, normalizedToolName) => {
      const requiredCount = orderToolCounts.get(normalizedToolName) || 0;
      const extraCount = recognizedCount - requiredCount;
      
      if (extraCount > 0) {
        // Находим оригинальное название
        const originalResult = resultsToAnalyze.find(r => 
          r.name.toLowerCase().trim() === normalizedToolName
        );
        const displayName = originalResult?.name || normalizedToolName;
        
        // Добавляем в массив столько раз, сколько лишних
        for (let i = 0; i < extraCount; i++) {
          extra.push(displayName);
        }
      }
    });

    console.log("Missing and extra tools calculation:", {
      mode: combinePredictions ? "combined" : "per-image",
      selectedFileId: selectedFileId,
      orderTools: orderTools.length,
      orderToolsList: orderTools.map(ot => ot.tool?.name),
      resultsToAnalyze: resultsToAnalyze.length,
      resultsToAnalyzeList: resultsToAnalyze.map(r => r.name),
      missing: missing.length,
      extra: extra.length,
      missingList: missing,
      extraList: extra
    });

    return { missing, extra };
  })();

  // Проверяем, есть ли полное соответствие с заказом (как в оригинале)
  const isCompleteMatch = missingAndExtraTools.missing.length === 0 && missingAndExtraTools.extra.length === 0;

  // Пересчитываем detectedCount при смене файла (если режим per-image)
  useEffect(() => {
    if (!allResultsData || !order) return;
    
    if (combinePredictions) {
      // Если режим combined, показываем общее количество
      setDetectedCount(allResultsData.results.length);
      setHasError(allResultsData.results.length < order.itemsCount);
    } else {
      // Если режим per-image, фильтруем по выбранному файлу
      const count = filteredResults.length;
      setDetectedCount(count);
      setHasError(count < order.itemsCount);
    }
  }, [selectedFileId, allResultsData, filteredResults.length, order?.itemsCount]);

  // Check reannotation status for an image (как в оригинале)
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

  // Send result to reannotation (как в оригинале)
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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    // Check file limit (max 5 files)
    const currentCount = uploadedFiles.length;
    const newCount = files.length;
    
    if (currentCount + newCount > 5) {
      toast({
        title: "Превышен лимит",
        description: `Максимум 5 файлов. У вас уже ${currentCount} файл(ов).`,
        variant: "destructive",
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    // Reset results when new files are added - user needs to click "Посмотреть результаты" again
    setAllResultsData(null);
    setDetectedCount(0);
    setHasError(false);
    setSelectedToolId(null);

    // Process each file immediately (original flow)
    for (const file of Array.from(files)) {
      const newFile: UploadedFile = {
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        file: file,
        status: "processing" as const,
      };

      setUploadedFiles((prev) => [...prev, newFile]);

      try {
        // Upload and process file immediately
        await apiService.uploadFile(jobId!, file, recognizeMarkings);
        
        const isVideo = file.type === 'video/mp4' || file.name.toLowerCase().endsWith('.mp4');
        
        // Получаем реальный ID файла из /files по имени
        const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
        const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
        const realFileId = uploadedFileInfo?.id;
        
        console.log("Uploaded file name:", file.name);
        console.log("Is video:", isVideo);
        console.log("Found file in job files:", uploadedFileInfo);
        console.log("Real file ID from backend:", realFileId);
        
        // Update file with real ID and status, удаляем дубликаты если есть
        setUploadedFiles((prev) => {
          const realIdStr = realFileId ? realFileId.toString() : newFile.id;
          
          // Проверяем, есть ли уже файл с таким реальным ID
          const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
          
          if (existingFile) {
            // Файл с таким ID уже существует (перезаписан на бэкенде)
            // Удаляем временный файл, оставляем существующий
            console.log(`File with ID ${realIdStr} already exists, removing duplicate temporary file`);
            return prev.filter(f => f.id !== newFile.id);
          }
          
          // Обновляем временный ID на реальный
          return prev.map(f => f.id === newFile.id ? { 
            ...f, 
            id: realIdStr,
            status: "processed" as const 
          } : f);
        });

        // Auto-select first uploaded file
        const finalFileId = realFileId ? realFileId.toString() : newFile.id;
        
        if (!isVideo) {
          // Для обычных фото - автовыбор как раньше
          if (!selectedFileId) {
            console.log("Auto-selecting image:", file.name);
            setSelectedFileId(finalFileId);
            const imageUrl = URL.createObjectURL(file);
            setCurrentImageUrl(imageUrl);
          }
        } else {
          // Для видео - НЕ выбираем, ждем кадры
          console.log("Skipping auto-select for video, will select first frame later");
        }

        // Для видео - перезагружаем файлы чтобы подтянуть извлеченные кадры
        if (isVideo) {
          console.log("Video uploaded, reloading files to get extracted frames...");
          // Небольшая задержка чтобы дать серверу время на извлечение кадров
          setTimeout(async () => {
            try {
              const apiFiles = await apiService.getJobFiles(jobId!, 'RAW');
              console.log("Reloaded files after video upload:", apiFiles);
              
              // Находим новые кадры
              const newFrames = apiFiles.filter(f => 
                f.fileName.includes('frame') // Кадры из видео
              );
              
              console.log("New frames found:", newFrames);
              
              if (newFrames.length === 0) return;
              
              // Загружаем превью параллельно
              const loadedFrames = await Promise.all(newFrames.map(async (frameFile) => {
                try {
                  const previewUrl = await apiService.getFileFromMinIO(frameFile.id);
                  return {
                    id: frameFile.id.toString(),
                    name: frameFile.fileName,
                    file: new File([], frameFile.fileName),
                    status: "processed" as const,
                    previewUrl: previewUrl
                  };
                } catch (err) {
                  console.error(`Failed to load frame ${frameFile.fileName}:`, err);
                  return null;
                }
              }));
              
              const validFrames = loadedFrames.filter(Boolean) as UploadedFile[];
              
              if (validFrames.length > 0) {
                setUploadedFiles(prev => {
                  // Добавляем только те кадры, которых еще нет
                  const framesToAdd = validFrames.filter(vf => 
                    !prev.some(pf => pf.id === vf.id)
                  );
                  return [...prev, ...framesToAdd];
                });
                
                // Автоматически выбираем первый загруженный кадр
                // Выбираем если ничего не выбрано или если выбрано видео (временный или реальный ID)
                const videoFileId = realFileId ? realFileId.toString() : newFile.id;
                if (!selectedFileId || selectedFileId === newFile.id || selectedFileId === videoFileId) {
                  const firstFrame = validFrames[0];
                  setSelectedFileId(firstFrame.id);
                  setCurrentImageUrl(firstFrame.previewUrl || null);
                  console.log("Auto-selected first frame:", firstFrame.name);
                }
              }
            } catch (error) {
              console.error("Failed to reload files after video upload:", error);
            }
          }, 2000); // 2 секунды на извлечение кадров
        }

        toast({
          title: isVideo ? "Видео загружено" : "Файл обработан",
          description: isVideo 
            ? `${file.name} загружено. Кадры появятся автоматически после обработки на сервере.`
            : `${file.name} успешно загружен и обработан`,
        });

      } catch (error) {
        // Даже при ошибке попытаемся получить реальный ID файла с бэкенда
        // (файл может быть загружен, но распознавание не удалось)
        try {
          const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
          const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
          const realFileId = uploadedFileInfo?.id;
          
          console.log("Error occurred, but trying to get real file ID...");
          console.log("Found file in job files:", uploadedFileInfo);
          console.log("Real file ID from backend:", realFileId);
          
          // Update file status to error BUT with real ID if available, удаляем дубликаты
          setUploadedFiles((prev) => {
            const realIdStr = realFileId ? realFileId.toString() : newFile.id;
            
            // Проверяем, есть ли уже файл с таким реальным ID
            const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
            
            if (existingFile) {
              // Файл с таким ID уже существует (перезаписан на бэкенде)
              // Удаляем временный файл, оставляем существующий с обновлением статуса
              console.log(`File with ID ${realIdStr} already exists, removing duplicate and updating existing to error`);
              return prev.filter(f => f.id !== newFile.id).map(f => 
                f.id === realIdStr ? { ...f, status: "error" as const } : f
              );
            }
            
            // Обновляем временный ID на реальный
            return prev.map(f => f.id === newFile.id ? { 
              ...f, 
              id: realIdStr,
              status: "error" as const 
            } : f);
          });
        } catch (idError) {
          console.error("Failed to get real file ID after error:", idError);
          // If we can't get the real ID, just mark as error with temp ID
          setUploadedFiles((prev) => 
            prev.map(f => f.id === newFile.id ? { ...f, status: "error" as const } : f)
          );
        }

        let errorMessage = `Не удалось обработать файл ${file.name}`;
        
        if (error instanceof ApiError) {
          switch (error.status) {
            case 400:
              errorMessage = "Сервис распознавания недоступен. Попробуйте позже.";
              break;
            case 422:
              errorMessage = "Не удалось распознать инструменты на фото. Проверьте качество изображения.";
              break;
            case 404:
              errorMessage = "Задача обработки не найдена. Обновите страницу и попробуйте снова.";
              break;
            case 413:
              errorMessage = "Файл слишком большой. Выберите файл размером менее 2 ГБ.";
              break;
            case 415:
              errorMessage = "Неподдерживаемый формат файла. Выберите JPG, PNG или MP4.";
              break;
            default:
              errorMessage = error.message;
          }
        }
        
        toast({
          title: "Ошибка обработки",
          description: errorMessage,
          variant: "destructive",
        });
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = async (fileId: string) => {
    const removedFile = uploadedFiles.find(f => f.id === fileId);
    
    try {
      // Extract file ID
      const fileIdNumber = parseInt(fileId);
      
      // Delete file from the backend
      if (fileIdNumber) {
        await apiService.deleteFile(fileIdNumber);
        
        // Remove results associated with this file
        setAllResultsData((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            results: prev.results.filter((r) => r.originalFileId !== fileIdNumber)
          };
        });
        
        toast({
          title: "Файл удален",
          description: "Файл успешно удален из системы",
        });
      } else {
        // For newly uploaded files (not yet in MinIO), just remove from local state
        toast({
          title: "Файл удален",
          description: "Файл удален из списка",
        });
      }
      
      // Remove file from local state
      setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
      
      if (selectedFileId === fileId) {
        setSelectedFileId(null);
        setCurrentImageUrl(null);
      }

      // Reset results when files are changed - user needs to click "Посмотреть результаты" again
      setAllResultsData(null);
      setDetectedCount(0);
      setHasError(false);
      setSelectedToolId(null);
      
    } catch (error) {
      console.error('Failed to delete file:', error);
      
      let errorMessage = "Не удалось удалить файл";
      
      if (error instanceof ApiError) {
        switch (error.status) {
          case 400:
            errorMessage = "Сервис недоступен. Попробуйте позже.";
            break;
          case 404:
            errorMessage = "Файл не найден. Возможно, он уже был удален.";
            break;
          case 500:
            errorMessage = "Внутренняя ошибка сервера. Попробуйте позже.";
            break;
          default:
            errorMessage = error.message;
        }
      }
      
      toast({
        title: "Ошибка удаления",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const handleFileClick = async (fileId: string) => {
    const file = uploadedFiles.find((f) => f.id === fileId);
    if (!file) return;
    
    setSelectedFileId(fileId);
    
    // Используем previewUrl если есть (для файлов из MinIO)
    if (file.previewUrl) {
      setCurrentImageUrl(file.previewUrl);
    } else if (file.file.size > 0) {
      // Для свежезагруженных файлов создаем blob URL
      const imageUrl = URL.createObjectURL(file.file);
      setCurrentImageUrl(imageUrl);
    } else {
      // Для файлов из MinIO без previewUrl - загружаем
      console.log("PreviewUrl missing, loading from MinIO:", fileId);
      try {
        const imageUrl = await apiService.getFileFromMinIO(parseInt(fileId));
        setCurrentImageUrl(imageUrl);
        
        // Обновляем файл с previewUrl
        setUploadedFiles(prev => prev.map(f => 
          f.id === fileId ? { ...f, previewUrl: imageUrl } : f
        ));
      } catch (error) {
        console.error("Failed to load image from MinIO:", error);
      }
    }
    
    // Предзагружаем соседние файлы для быстрого переключения
    prefetchNeighborFiles(fileId);
  };
  
  // Предзагрузка данных сегментации для соседних файлов (оптимизация)
  const prefetchNeighborFiles = (currentFileId: string) => {
    if (!allResultsData || combinePredictions) return;
    
    const currentIndex = uploadedFiles.findIndex(f => f.id === currentFileId);
    if (currentIndex === -1) return;
    
    // Предзагружаем следующий и предыдущий файлы
    const filesToPrefetch = [
      uploadedFiles[currentIndex + 1], // Следующий
      uploadedFiles[currentIndex - 1]  // Предыдущий
    ].filter(Boolean);
    
    filesToPrefetch.forEach(file => {
      const fileIdNum = parseInt(file.id);
      if (isNaN(fileIdNum)) return;
      
      // Находим результаты для этого файла
      const fileResults = allResultsData.results.filter(
        r => r.originalFileId === fileIdNum
      );
      
      // Предзагружаем файлы сегментации
      fileResults.forEach(result => {
        if (result.fileId) {
          // Запускаем загрузку в фоне (результат закэшируется)
          apiService.getPreprocessDataFromMinIO(result.fileId).catch(() => {
            // Игнорируем ошибки предзагрузки
          });
        }
      });
    });
  };

  const handleStartCamera = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === "videoinput");

      const streams: MediaStream[] = [];

      for (const device of videoDevices) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: device.deviceId },
          });
          streams.push(stream);
        } catch (err) {
          console.warn(`Failed to start camera ${device.label}:`, err);
        }
      }

      if (streams.length === 0) {
        throw new Error("No cameras available");
      }

      setCameraStreams(streams);
      setCurrentCameraIndex(0);
      setIsCameraActive(true);

      toast({
        title: "Камеры запущены",
        description: `Активировано камер: ${streams.length}`,
      });
    } catch (error) {
      console.error("Camera error:", error);
      toast({
        title: "Ошибка камеры",
        description: "Не удалось получить доступ к камерам",
        variant: "destructive",
      });
    }
  };

  const handleStopCamera = () => {
    cameraStreams.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraStreams([]);
    setCurrentCameraIndex(0);
    setIsCameraActive(false);
  };

  const handlePrevCamera = () => {
    if (cameraStreams.length === 0) return;
    const newIndex = (currentCameraIndex - 1 + cameraStreams.length) % cameraStreams.length;
    setCurrentCameraIndex(newIndex);
  };

  const handleNextCamera = () => {
    if (cameraStreams.length === 0) return;
    const newIndex = (currentCameraIndex + 1) % cameraStreams.length;
    setCurrentCameraIndex(newIndex);
  };

  const handleCaptureCurrentCamera = async () => {
    if (cameraStreams.length === 0 || !videoRef.current) {
      toast({
        title: "Камера не запущена",
        description: "Запустите камеру перед захватом изображения",
        variant: "destructive",
      });
      return;
    }

    // Reset results when new files are added - user needs to click "Посмотреть результаты" again
    setAllResultsData(null);
    setDetectedCount(0);
    setHasError(false);
    setSelectedToolId(null);

    const canvas = document.createElement("canvas");
    const video = videoRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);

      canvas.toBlob(async (blob) => {
        if (blob) {
          const file = new File([blob], `camera-${currentCameraIndex}-${Date.now()}.jpg`, { type: "image/jpeg" });
          const newFile: UploadedFile = {
            id: `camera-${currentCameraIndex}-${Date.now()}`,
            name: file.name,
            file: file,
            status: "processing",
          };
          
          setUploadedFiles((prev) => [...prev, newFile]);

          try {
            // Upload and process file immediately
            await apiService.uploadFile(jobId!, file, recognizeMarkings);
            
            // Получаем реальный ID файла из /files по имени
            const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
            const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
            const realFileId = uploadedFileInfo?.id;
            
            console.log("Camera - uploaded file name:", file.name);
            console.log("Camera - found file in job files:", uploadedFileInfo);
            console.log("Camera - real file ID from backend:", realFileId);
            
            // Update file with real ID and status, удаляем дубликаты
            setUploadedFiles((prev) => {
              const realIdStr = realFileId ? realFileId.toString() : newFile.id;
              const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
              
              if (existingFile) {
                console.log(`Camera - File with ID ${realIdStr} already exists, removing duplicate`);
                return prev.filter(f => f.id !== newFile.id);
              }
              
              return prev.map(f => f.id === newFile.id ? { 
                ...f, 
                id: realIdStr, 
                status: "processed" as const 
              } : f);
            });

            const finalFileId = realFileId ? realFileId.toString() : newFile.id;
            setSelectedFileId(finalFileId);
            const imageUrl = URL.createObjectURL(newFile.file);
            setCurrentImageUrl(imageUrl);

            toast({
              title: "Захват и обработка завершены",
              description: `Изображение с камеры ${currentCameraIndex + 1} обработано`,
            });

          } catch (error) {
            // Даже при ошибке попытаемся получить реальный ID файла с бэкенда
            try {
              const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
              const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
              const realFileId = uploadedFileInfo?.id;
              
              console.log("Camera - Error occurred, but trying to get real file ID...");
              console.log("Camera - Found file in job files:", uploadedFileInfo);
              console.log("Camera - Real file ID from backend:", realFileId);
              
              // Update file status to error BUT with real ID if available, удаляем дубликаты
              setUploadedFiles((prev) => {
                const realIdStr = realFileId ? realFileId.toString() : newFile.id;
                const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
                
                if (existingFile) {
                  console.log(`Camera - File with ID ${realIdStr} already exists, removing duplicate and updating to error`);
                  return prev.filter(f => f.id !== newFile.id).map(f => 
                    f.id === realIdStr ? { ...f, status: "error" as const } : f
                  );
                }
                
                return prev.map(f => f.id === newFile.id ? { 
                  ...f, 
                  id: realIdStr, 
                  status: "error" as const 
                } : f);
              });
            } catch (idError) {
              console.error("Camera - Failed to get real file ID after error:", idError);
              // If we can't get the real ID, just mark as error with temp ID
              setUploadedFiles((prev) => 
                prev.map(f => f.id === newFile.id ? { ...f, status: "error" as const } : f)
              );
            }

            let errorMessage = `Не удалось обработать изображение с камеры ${currentCameraIndex + 1}`;
            
            if (error instanceof ApiError) {
              switch (error.status) {
                case 400:
                  errorMessage = "Сервис распознавания недоступен. Попробуйте позже.";
                  break;
                case 422:
                  errorMessage = "Не удалось распознать инструменты на фото. Проверьте качество изображения.";
                  break;
                default:
                  errorMessage = error.message;
              }
            }
            
            toast({
              title: "Ошибка обработки",
              description: errorMessage,
              variant: "destructive",
            });
          }
        }
      }, "image/jpeg");
    }
  };

  const handleCaptureAllCameras = async () => {
    if (cameraStreams.length === 0) {
      toast({
        title: "Камеры не запущены",
        description: "Запустите камеры перед захватом изображений",
        variant: "destructive",
      });
      return;
    }

    // Reset results when new files are added - user needs to click "Посмотреть результаты" again
    setAllResultsData(null);
    setDetectedCount(0);
    setHasError(false);
    setSelectedToolId(null);

    const capturedFiles: UploadedFile[] = [];

    for (let i = 0; i < cameraStreams.length; i++) {
      const stream = cameraStreams[i];
      const canvas = document.createElement("canvas");
      const video = document.createElement("video");

      video.srcObject = stream;
      video.play();

      await new Promise((resolve) => {
        video.onloadedmetadata = resolve;
      });

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0);

        canvas.toBlob(async (blob) => {
          if (blob) {
            const file = new File([blob], `camera-${i}-${Date.now()}.jpg`, { type: "image/jpeg" });
            const newFile: UploadedFile = {
              id: `camera-${i}-${Date.now()}`,
              name: file.name,
              file: file,
              status: "processing",
            };
            
            setUploadedFiles((prev) => [...prev, newFile]);

            try {
              // Upload and process file immediately
              await apiService.uploadFile(jobId!, file, recognizeMarkings);
              
              // Получаем реальный ID файла из /files по имени
              const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
              const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
              const realFileId = uploadedFileInfo?.id;
              
              console.log("Camera (all) - uploaded file name:", file.name);
              console.log("Camera (all) - found file in job files:", uploadedFileInfo);
              console.log("Camera (all) - real file ID from backend:", realFileId);
              
              // Update file with real ID and status, удаляем дубликаты
              let finalFileId: string | null = null;
              setUploadedFiles((prev) => {
                const realIdStr = realFileId ? realFileId.toString() : newFile.id;
                const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
                
                if (existingFile) {
                  console.log(`Camera (all) - File with ID ${realIdStr} already exists, removing duplicate`);
                  finalFileId = realIdStr;
                  return prev.filter(f => f.id !== newFile.id);
                }
                
                finalFileId = realIdStr;
                return prev.map(f => f.id === newFile.id ? { 
                  ...f, 
                  id: realIdStr, 
                  status: "processed" as const 
                } : f);
              });

              const updatedFile = { 
                ...newFile, 
                id: finalFileId || newFile.id, 
                status: "processed" as const 
              };
              capturedFiles.push(updatedFile);

              if (capturedFiles.length === 1 && !selectedFileId) {
                setSelectedFileId(updatedFile.id);
                const imageUrl = URL.createObjectURL(newFile.file);
                setCurrentImageUrl(imageUrl);
              }

            } catch (error) {
              // Даже при ошибке попытаемся получить реальный ID файла с бэкенда
              try {
                const jobFiles = await apiService.getJobFiles(jobId!, 'RAW');
                const uploadedFileInfo = jobFiles.find(f => f.fileName === file.name);
                const realFileId = uploadedFileInfo?.id;
                
                console.log("Camera (all) - Error occurred, but trying to get real file ID...");
                console.log("Camera (all) - Found file in job files:", uploadedFileInfo);
                console.log("Camera (all) - Real file ID from backend:", realFileId);
                
                // Update file status to error BUT with real ID if available, удаляем дубликаты
                setUploadedFiles((prev) => {
                  const realIdStr = realFileId ? realFileId.toString() : newFile.id;
                  const existingFile = prev.find(f => f.id === realIdStr && f.id !== newFile.id);
                  
                  if (existingFile) {
                    console.log(`Camera (all) - File with ID ${realIdStr} already exists, removing duplicate and updating to error`);
                    return prev.filter(f => f.id !== newFile.id).map(f => 
                      f.id === realIdStr ? { ...f, status: "error" as const } : f
                    );
                  }
                  
                  return prev.map(f => f.id === newFile.id ? { 
                    ...f, 
                    id: realIdStr, 
                    status: "error" as const 
                  } : f);
                });
              } catch (idError) {
                console.error("Camera (all) - Failed to get real file ID after error:", idError);
                // If we can't get the real ID, just mark as error with temp ID
                setUploadedFiles((prev) => 
                  prev.map(f => f.id === newFile.id ? { ...f, status: "error" as const } : f)
                );
              }

              let errorMessage = `Не удалось обработать изображение с камеры ${i + 1}`;
              
              if (error instanceof ApiError) {
                switch (error.status) {
                  case 400:
                    errorMessage = "Сервис распознавания недоступен. Попробуйте позже.";
                    break;
                  case 422:
                    errorMessage = "Не удалось распознать инструменты на фото. Проверьте качество изображения.";
                    break;
                  default:
                    errorMessage = error.message;
                }
              }
              
              toast({
                title: "Ошибка обработки",
                description: errorMessage,
                variant: "destructive",
              });
            }
          }
        }, "image/jpeg");
      }
    }

    // Wait a bit for all processing to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    toast({
      title: "Захват и обработка завершены",
      description: `Обработано изображений: ${capturedFiles.length}`,
    });
  };

  const handleViewResults = async () => {
    if (!jobId || !order) {
      toast({
        title: "Заказ не выбран",
        description: "Выберите заказ для начала работы",
        variant: "destructive",
      });
      return;
    }

    const processedFiles = uploadedFiles.filter(f => f.status === "processed");
    if (processedFiles.length === 0) {
      toast({
        title: "Нет обработанных файлов",
        description: "Загрузите и обработайте файлы для просмотра результатов",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Set confidence threshold before getting results
      await apiService.setModelThreshold(parseFloat(confidenceThreshold) / 100);

      // Fetch results based on combinePredictions setting
      let resultsData;
      if (combinePredictions) {
        resultsData = await apiService.getJobResults(jobId);
      } else {
        resultsData = await apiService.getJobClassificationResults(jobId);
        // НЕ фильтруем здесь! Сохраняем все результаты, фильтрация будет в filteredResults
      }

      // Process results - НЕ загружаем данные сегментации сразу (оптимизация)
      // Компоненты сами загрузят данные когда понадобятся
      const processedResults: RecognitionResult[] = resultsData.map((result: any) => {
        return {
          id: result.id,
          name: result.tool?.name || "Unknown",
          confidence: result.confidence || 0,
          marking: result.marking,
          markingMatch: result.markingMatch,
          bbox: result.bbox, // Если есть напрямую
          mask: result.mask, // Если есть напрямую
          fileId: result.file?.id, // ID для lazy loading
          originalFileId: result.originalFile?.id
        };
      });

      // Сохраняем все результаты (фильтрация будет идти по ТЕКУЩЕМУ состоянию combinePredictions)
      setAllResultsData({
        results: processedResults
      });

      // Агрессивная предзагрузка ВСЕХ файлов сегментации в фоне (оптимизация)
      if (!combinePredictions && processedResults.length > 0) {
        console.log(`🚀 Prefetching ${processedResults.length} segmentation files...`);
        processedResults.forEach((result, index) => {
          if (result.fileId) {
            // Небольшая задержка между запросами чтобы не перегрузить сервер
            setTimeout(() => {
              apiService.getPreprocessDataFromMinIO(result.fileId!).catch(() => {
                // Игнорируем ошибки предзагрузки
              });
            }, index * 50); // 50ms между запросами
          }
        });
      }

      // Перезагружаем детали заказа для корректного сравнения
      try {
        const tools = await apiService.getOrderTools(order.id);
        console.log("Reloaded order tools after getting results:", tools);
        setOrderTools(tools);
      } catch (error) {
        console.error("Failed to reload order tools:", error);
      }

      // Для подсчета используем либо все результаты (combined), либо для первого файла (per-image)
      let displayCount: number;
      if (combinePredictions) {
        displayCount = processedResults.length;
      } else {
        // Для режима per-image считаем результаты для текущего выбранного файла
        if (selectedFileId) {
          const selectedFile = uploadedFiles.find(f => f.id === selectedFileId);
          if (selectedFile) {
            const fileId = parseInt(selectedFile.id);
            displayCount = processedResults.filter(r => r.originalFileId === fileId).length;
          } else {
            displayCount = 0;
          }
        } else {
          displayCount = 0;
        }
      }

      setDetectedCount(displayCount);
      setHasError(displayCount < order.itemsCount);

      toast({
        title: "Результаты загружены",
        description: `Найдено ${displayCount} инструментов`,
      });
    } catch (error) {
      console.error("Failed to load results:", error);
      toast({
        title: "Ошибка загрузки результатов",
        description: "Не удалось загрузить результаты",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setIsProcessing(false);
  };

  // Обработчик нажатия на кнопку завершения (как в оригинале)
  const handleCompleteClick = () => {
    if (isCompleteMatch) {
      // Если полное соответствие - завершаем сразу
      handleCompleteConfirmed();
    } else {
      // Если есть расхождения - показываем модальное окно
      setConfirmOpen(true);
    }
  };

  // Подтверждённое завершение
  const handleCompleteConfirmed = () => {
    // Определяем полный ли набор на основе ТЕКУЩИХ выведенных результатов
    // - Если combinePredictions = true: анализируем все результаты (весь набор)
    // - Если combinePredictions = false: анализируем только текущее выбранное фото
    const isFull = missingAndExtraTools.missing.length === 0;
    
    console.log('=== COMPLETING JOB ===');
    console.log('Mode:', combinePredictions ? 'COMBINED (all photos)' : 'PER-IMAGE (current photo)');
    console.log('Selected file:', selectedFileId);
    console.log('Missing items (current view):', missingAndExtraTools.missing.length, missingAndExtraTools.missing);
    console.log('Extra items (current view):', missingAndExtraTools.extra.length, missingAndExtraTools.extra);
    console.log('isFull (all items found in current view):', isFull);
    
    // Сбрасываем состояние
    setUploadedFiles([]);
    setAllResultsData(null);
    setSelectedFileId(null);
    setCurrentImageUrl(null);
    setSelectedToolId(null);
    setDetectedCount(null);
    setHasError(false);
    setReannotationStatuses(new Map());
    setLoadingStatuses(new Set());
    setSendingResults(new Set());
    setConfirmOpen(false);
    
    // Вызываем колбэк завершения с информацией о полноте набора
    onComplete(isFull);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-3">
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open}
                      className="w-full justify-between"
                      data-onboarding="order-selector"
                    >
                      {order ? (order.workorder || order.orderNumber) : "Выберите заказ"}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0 bg-card z-50">
                    <Command>
                      <CommandInput placeholder="Search order..." />
                      <CommandList>
                        <CommandEmpty>No order found.</CommandEmpty>
                        <CommandGroup>
                          {orders.filter(o => o.status !== "completed").map((o) => (
                            <CommandItem
                              key={o.id}
                              value={`${o.workorder || o.orderNumber} ${o.id} ${o.aircraft}`}
                              onSelect={() => {
                                onOrderChange(o.id);
                                setOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  order?.id === o.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex items-center justify-between w-full gap-2">
                                <span className="truncate">{o.workorder || o.orderNumber}</span>
                                <Badge 
                                  variant={
                                    o.status === "awaiting_issue" ? "default" : 
                                    o.status === "awaiting_return" ? "secondary" : 
                                    "outline"
                                  }
                                  className="text-[9px] h-5 px-2 shrink-0 min-w-[80px] justify-center mr-2"
                                >
                                  {o.status === "awaiting_issue" ? "Выдача" : 
                                   o.status === "awaiting_return" ? "Сдача" : 
                                   "Закрыт"}
                                </Badge>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
            </div>
            <div className="col-span-6 text-center">
              <h1 className="text-xl font-bold break-words">{actionTitle}</h1>
              {order && <p className="text-sm text-muted-foreground">Заказ {order.workorder || order.orderNumber}</p>}
            </div>
            <div className="col-span-3 flex flex-col lg:flex-row justify-end gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full lg:w-auto"
                      onClick={() => {
                        if ((window as any).resetOnboarding) {
                          (window as any).resetOnboarding();
                        }
                      }}
                      data-onboarding="help-button"
                    >
                      <HelpCircle className="h-4 w-4 mr-2" />
                      Помощь
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Показать обучение</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <div data-onboarding="complete-button" className="w-full lg:w-auto">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div>
                        <Button 
                          onClick={handleCompleteClick} 
                          size="sm"
                          className="w-full"
                          disabled={!order || filteredResults.length === 0}
                        >
                          Закончить {actionType === "issue" ? "выдачу" : "сдачу"}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {filteredResults.length === 0 && (
                      <TooltipContent>
                        <p>Сначала распознайте инструменты на экране</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-3">
        <div className="grid grid-cols-12 gap-3">
          {/* Left Panel */}
          <div className="col-span-3 space-y-3">
            {/* Processing - перемещен наверх */}
            <Card>
              <CardHeader className="py-2">
                <CardTitle className="text-xs font-semibold text-center">Преднастройка обработки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 py-2">
                {/* Переключатель bbox/mask */}
                <div className="p-2 bg-muted rounded">
                  <div className="flex items-center justify-between gap-2" data-onboarding="display-format-toggle">
                    <span className="text-[10px]">Отображение</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] text-muted-foreground">Контур</span>
                      <Switch 
                        checked={showBbox} 
                        onCheckedChange={setShowBbox}
                        className="scale-75"
                      />
                      <span className="text-[9px] text-muted-foreground">Рамка</span>
                    </div>
                  </div>
                </div>

                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full h-auto min-h-7 text-[10px] flex items-start justify-between py-1.5 px-2 overflow-hidden">
                      <span className="flex-1 text-left leading-tight pr-1 break-words min-w-0">Дополнительные настройки</span>
                      <ChevronDown className={cn("h-3 w-3 transition-transform shrink-0 mt-0.5", settingsOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
                    {/* Порог уверенности - перемещен в дополнительные настройки */}
                    <div className="p-2 bg-muted rounded space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px]">Порог уверенности</span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[200px] text-xs">
                                <p>
                                  Например, при пороге в 80% модель выделит желтым те инструменты, в предсказании по которым
                                  она уверена меньше чем на 80%
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <span className="text-[11px] font-bold text-primary">{confidenceThreshold}%</span>
                      </div>
                      <div className="relative w-full h-4 flex items-center">
                        {/* Track (линия) */}
                        <div className="absolute w-full h-1 bg-blue-100 dark:bg-blue-950 rounded-full" />
                        {/* Filled part (заполненная часть) */}
                        <div 
                          className="absolute h-1 bg-blue-500 rounded-full" 
                          style={{ width: `${parseInt(confidenceThreshold)}%` }}
                        />
                        {/* Thumb (круглый ползунок) */}
                        <input
                          type="range"
                          min={1}
                          max={100}
                          step={1}
                          value={parseInt(confidenceThreshold)}
                          onChange={(e) => setConfidenceThreshold(e.target.value)}
                          className="absolute w-full h-1 opacity-0 cursor-pointer z-10"
                        />
                        <div 
                          className="absolute bg-blue-500 rounded-full shadow-sm pointer-events-none"
                          style={{ 
                            width: '12px',
                            height: '12px',
                            left: `calc(${parseInt(confidenceThreshold)}% - 6px)`,
                            borderRadius: '50%'
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">На всех фото один набор</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[200px] text-xs">
                              <p>
                                Модель строит единый прогноз, предполагая что на всех фото один набор снят с разных
                                ракурсов
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Switch 
                        checked={combinePredictions} 
                        onCheckedChange={(checked) => {
                          console.log("=== SWITCHING combinePredictions ===");
                          console.log("From:", combinePredictions, "To:", checked);
                          setCombinePredictions(checked);
                          
                          // Сбрасываем результаты при переключении режима
                          // Пользователь должен будет нажать "Посмотреть результаты" заново
                          setAllResultsData(null);
                          setDetectedCount(null);
                          setHasError(false);
                          setSelectedToolId(null);
                          
                          console.log("Results cleared - user needs to click 'View Results' again");
                        }} 
                        className="scale-75" 
                      />
                    </div>

                    <div className="flex items-center justify-between p-2 bg-muted rounded">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Распознавание маркировок</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[200px] text-xs">
                              <p>
                                Включает распознавание заводских маркировок и серийных номеров на инструментах
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <Switch checked={recognizeMarkings} onCheckedChange={setRecognizeMarkings} className="scale-75" />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
            </Card>

            {/* Sources - перемещен вниз */}
            <Card>
              <CardHeader className="py-2">
                <CardTitle className="text-xs font-semibold text-center">Источники</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 py-2">
                {!order && (
                  <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-2 mb-3">
                    <p className="text-[10px] text-yellow-800 dark:text-yellow-200 text-center">
                      Выберите заказ для начала работы
                    </p>
                  </div>
                )}
                {/* Camera Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-medium">Камера</span>
                    </div>
                    <Badge variant={isCameraActive ? "default" : "secondary"} className="text-[9px] h-4 px-1.5">
                      {isCameraActive ? "Активна" : "Выкл"}
                    </Badge>
                  </div>

                  <Button 
                    size="sm" 
                    className="w-full h-auto min-h-7 text-xs whitespace-normal py-1.5" 
                    onClick={isCameraActive ? handleStopCamera : handleStartCamera}
                    variant={isCameraActive ? "destructive" : "default"}
                    data-onboarding="camera-button"
                    disabled={!order}
                  >
                    {isCameraActive ? "Остановить камеру" : "Запустить камеру"}
                  </Button>

                  {isCameraActive && (
                    <>
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="w-full h-auto min-h-7 text-xs whitespace-normal py-1.5"
                        onClick={handleCaptureCurrentCamera}
                      >
                        <Camera className="h-3.5 w-3.5 mr-1.5" />
                        Сделать фото с выбранной
                      </Button>
                      {cameraStreams.length > 1 && (
                        <Button 
                          size="sm" 
                          className="w-full h-auto min-h-7 text-xs whitespace-normal py-1.5"
                          onClick={handleCaptureAllCameras}
                        >
                          <Camera className="h-3.5 w-3.5 mr-1.5" />
                          Сделать фото со всех камер
                        </Button>
                      )}
                    </>
                  )}
                </div>

                <div className="border-t pt-2" />

                {/* Files Section */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Upload className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-medium">Файлы</span>
                    </div>
                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                      {uploadedFiles.length}
                    </Badge>
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.mp4"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                  />

                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-auto min-h-7 text-xs whitespace-normal py-1.5"
                    onClick={() => fileInputRef.current?.click()}
                    data-onboarding="upload-button"
                    disabled={!order}
                  >
                    Загрузить файлы
                  </Button>

                  {uploadedFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto p-1">
                      {uploadedFiles.map((file) => {
                        const isVideo = isVideoFile(file);
                        
                        return (
                        <div
                          key={file.id}
                          className={`relative aspect-square rounded border-2 transition-all group ${
                            isVideo 
                              ? "border-blue-500/50 cursor-not-allowed" 
                              : selectedFileId === file.id
                                ? "border-primary shadow-sm cursor-pointer"
                                : "border-border hover:border-primary/50 cursor-pointer"
                          }`}
                          onClick={() => !isVideo && handleFileClick(file.id)}
                        >
                          {isVideo ? (
                            <div className="w-full h-full bg-blue-500/10 flex items-center justify-center rounded">
                              <Play className="h-8 w-8 text-blue-500" />
                            </div>
                          ) : (
                            <img
                              src={file.previewUrl || URL.createObjectURL(file.file)}
                              alt={file.name}
                              className={`w-full h-full object-cover rounded ${file.status === "processing" ? "opacity-50" : ""}`}
                            />
                          )}
                          <Button
                            variant="destructive"
                            size="sm"
                            className="absolute -top-1 -right-1 h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(file.id);
                            }}
                          >
                            <X className="h-2.5 w-2.5" />
                          </Button>
                          {file.status === "processing" && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Loader2 className="h-6 w-6 text-white animate-spin" />
                            </div>
                          )}
                          {file.status === "processed" && (
                            <div className="absolute bottom-0 left-0 right-0 bg-green-500/80 text-white text-[8px] text-center py-0.5">
                              ✓
                            </div>
                          )}
                          {file.status === "error" && (
                            <div className="absolute bottom-0 left-0 right-0 bg-red-500/80 text-white text-[8px] text-center py-0.5">
                              ✗
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Кнопка "Посмотреть результаты" перенесена в конец блока "Источники" */}
                <Button
                  size="sm"
                  className="w-full h-auto min-h-8 text-xs font-semibold whitespace-normal py-2"
                  onClick={handleViewResults}
                  disabled={isProcessing || uploadedFiles.filter(f => f.status === "processed").length === 0}
                  data-onboarding="view-results-button"
                >
                  {isProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-1.5 shrink-0"></div>
                      <span>Загрузка...</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3 w-3 mr-1.5 shrink-0" />
                      <span>Посмотреть результаты</span>
                    </>
                  )}
                </Button>

                {isProcessing && (
                  <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={handleCancel}>
                    Остановить
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Center Panel - Image Display */}
          <div className="col-span-6">
            <Card className="h-full">
              <CardHeader className="py-2">
                <CardTitle className="text-xs font-medium truncate text-center">
                {isCameraActive 
                  ? `Камера ${currentCameraIndex + 1} / ${cameraStreams.length}` 
                  : selectedFileId 
                    ? uploadedFiles.find((f) => f.id === selectedFileId)?.name 
                    : "Выберите файл"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center p-2 gap-2" style={{ height: "calc(100vh - 180px)" }}>
              <div className="w-full bg-black rounded flex items-center justify-center overflow-hidden" style={{ height: "calc(100vh - 230px)" }}>
                {isCameraActive ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="max-w-full max-h-full object-contain"
                  />
                ) : currentImageUrl ? (
                  segmentationFileIds.length > 0 ? (
                    <ImageWithMultipleSegmentations
                      imageId={parseInt(selectedFileId || "0")}
                      segmentationFileIds={segmentationFileIds}
                      showBbox={showBbox}
                      preloadedImageUrl={currentImageUrl || undefined}
                      toolNames={toolNames}
                    />
                  ) : (
                    <img src={currentImageUrl} alt="Processing" className="max-w-full max-h-full object-contain" />
                  )
                ) : (
                  <div className="text-center text-muted-foreground">
                    <Camera className="h-10 w-10 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Загрузите файлы или запустите камеру</p>
                  </div>
                )}
              </div>
              
              {isCameraActive && cameraStreams.length > 1 && (
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handlePrevCamera}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground px-2">
                    {currentCameraIndex + 1} / {cameraStreams.length}
                  </span>
                  <Button size="sm" variant="outline" onClick={handleNextCamera}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Results */}
        <div className="col-span-3" data-onboarding="results-panel">
          {/* Results */}
          <Card className="h-full">
            <CardHeader className="py-2">
              <CardTitle className="text-xs font-semibold text-center">Результаты</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 py-2">
              {/* Statistics Summary */}
              {filteredResults.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="bg-muted rounded p-1.5 text-center">
                    <div className="text-muted-foreground">Найдено</div>
                    <div className="text-base font-bold">{detectedCount}</div>
                  </div>
                  <div className="bg-muted rounded p-1.5 text-center">
                    <div className="text-muted-foreground">Ср. точность</div>
                    <div className="text-base font-bold">
                      {((filteredResults.reduce((sum, r) => sum + r.confidence, 0) / filteredResults.length) * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>
              )}

              {/* Missing Tools Alert */}
              {missingAndExtraTools.missing.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-destructive">
                    Отсутствуют ({missingAndExtraTools.missing.length})
                  </div>
                  <div className="space-y-0.5">
                    {missingAndExtraTools.missing.map((tool, idx) => (
                      <div
                        key={idx}
                        className="bg-destructive/10 border-l-2 border-destructive px-2 py-1 text-[10px] rounded-sm"
                      >
                        {tool}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Matching Tools (соответствуют заказу) */}
              {categorizedResults.matching.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-green-600 dark:text-green-400">
                    Совпадают с заказом ({categorizedResults.matching.length})
                  </div>
                  <div className="space-y-1 max-h-[calc(100vh-550px)] overflow-y-auto pr-1">
                    {categorizedResults.matching.map((result) => {
                      // Обрезаем уверенность до 2 знаков после запятой в процентах (как в оригинале)
                      const confidencePercent = truncateConfidence(result.confidence);
                      const thresholdPercent = parseFloat(confidenceThreshold);
                      
                      console.log(`Tool: ${result.name}, raw confidence: ${result.confidence}, truncated percent: ${confidencePercent}, threshold: ${thresholdPercent}`);
                      
                      const isHighConfidence = confidencePercent >= thresholdPercent;
                      const isMediumConfidence = confidencePercent >= thresholdPercent * 0.75 && confidencePercent < thresholdPercent;

                      return (
                        <div
                          key={result.id}
                          className={`p-2 rounded cursor-pointer transition-all border ${
                            selectedToolId === result.id
                              ? "bg-primary/10 border-primary shadow-sm"
                              : "bg-card hover:bg-accent border-border"
                          }`}
                          onClick={async () => {
                            const newSelectedId = result.id === selectedToolId ? null : result.id;
                            setSelectedToolId(newSelectedId);
                            
                            // Load and display the image associated with this result
                            if (result.originalFileId && newSelectedId !== null) {
                              try {
                                const imageUrl = await apiService.getFileFromMinIO(result.originalFileId);
                                setCurrentImageUrl(imageUrl);
                                setSelectedFileId(result.originalFileId.toString());
                                
                                // Check reannotation status (как в оригинале)
                                checkReannotationStatus(result.originalFileId);
                              } catch (error) {
                                console.error('Failed to load result image:', error);
                              }
                            }
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-medium truncate">{result.name}</div>
                            </div>
                            <Badge
                              variant={isHighConfidence ? "default" : isMediumConfidence ? "secondary" : "outline"}
                              className="text-[9px] px-1.5 py-0 h-4 shrink-0"
                            >
                              {confidencePercent.toFixed(2)}%
                            </Badge>
                          </div>
                          {/* Confidence Bar */}
                          <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                isHighConfidence
                                  ? "bg-green-500"
                                  : isMediumConfidence
                                    ? "bg-yellow-500"
                                    : "bg-orange-500"
                              }`}
                              style={{ width: `${confidencePercent}%` }}
                            />
                          </div>
                          {/* Marking Info */}
                          {recognizeMarkings && result.marking && (
                            <div className={`mt-1.5 text-[9px] px-1.5 py-0.5 rounded ${
                              result.markingMatch 
                                ? "bg-green-500/10 text-green-700 dark:text-green-400" 
                                : "bg-red-500/10 text-red-700 dark:text-red-400"
                            }`}>
                              {result.markingMatch ? "Маркировка совпадает" : "Маркировка расходится, ожидалась"}: {result.marking}
                            </div>
                          )}
                          
                          {/* Reannotation block - плавно появляется под выбранным инструментом */}
                          {selectedToolId === result.id && result.originalFileId && (
                            <div 
                              className="mt-2 pt-2 border-t border-border animate-in slide-in-from-top-2 duration-300"
                            >
                              {loadingStatuses.has(result.originalFileId) ? (
                                <div className="flex items-center justify-center py-1 text-muted-foreground">
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1.5"></div>
                                  <span className="text-[9px]">Проверка...</span>
                                </div>
                              ) : reannotationStatuses.get(result.originalFileId) === true ? (
                                <div className="bg-success/10 text-success border border-success px-2 py-1 text-[9px] rounded text-center flex items-center justify-center gap-1">
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  Отправлено на доразметку
                                </div>
                              ) : reannotationStatuses.has(result.originalFileId) ? (
                                <div className="space-y-1">
                                  <div className="text-[9px] font-medium text-center">
                                    Правильно распознан?
                                  </div>
                                  <div className="flex gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedToolId(null);
                                      }}
                                      className="flex-1 h-6 text-[9px] py-0"
                                    >
                                      Да
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 h-6 text-[9px] py-0 border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSendToReannotation(result.id, result.originalFileId);
                                      }}
                                      disabled={sendingResults.has(result.id)}
                                    >
                                      {sendingResults.has(result.id) ? (
                                        <>
                                          <div className="animate-spin rounded-full h-2 w-2 border-b-2 border-current mr-0.5"></div>
                                          <span className="text-[8px]">Отправка...</span>
                                        </>
                                      ) : (
                                        <>
                                          <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                                          Нет
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Extra Tools (лишние инструменты) - кликабельные */}
              {categorizedResults.extra.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
                    Лишние инструменты ({categorizedResults.extra.length})
                  </div>
                  <div className="space-y-1 max-h-[calc(100vh-550px)] overflow-y-auto pr-1">
                    {categorizedResults.extra.map((result) => {
                      // Обрезаем уверенность до 2 знаков после запятой в процентах (как в оригинале)
                      const confidencePercent = truncateConfidence(result.confidence);
                      const thresholdPercent = parseFloat(confidenceThreshold);
                      
                      const isHighConfidence = confidencePercent >= thresholdPercent;
                      const isMediumConfidence = confidencePercent >= thresholdPercent * 0.75 && confidencePercent < thresholdPercent;

                      return (
                        <div
                          key={result.id}
                          className={`p-2 rounded cursor-pointer transition-all border ${
                            selectedToolId === result.id
                              ? "bg-blue-500/20 border-blue-500 shadow-sm"
                              : "bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/30"
                          }`}
                          onClick={async () => {
                            const newSelectedId = result.id === selectedToolId ? null : result.id;
                            setSelectedToolId(newSelectedId);
                            
                            // Load and display the image associated with this result
                            if (result.originalFileId && newSelectedId !== null) {
                              try {
                                const imageUrl = await apiService.getFileFromMinIO(result.originalFileId);
                                setCurrentImageUrl(imageUrl);
                                setSelectedFileId(result.originalFileId.toString());
                                
                                // Check reannotation status (как в оригинале)
                                checkReannotationStatus(result.originalFileId);
                              } catch (error) {
                                console.error('Failed to load result image:', error);
                              }
                            }
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[10px] font-medium truncate">{result.name}</div>
                              <div className="text-[9px] text-blue-600 dark:text-blue-400">Не в заказе</div>
                            </div>
                            <Badge
                              variant={isHighConfidence ? "default" : isMediumConfidence ? "secondary" : "outline"}
                              className="text-[9px] px-1.5 py-0 h-4 shrink-0 bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500"
                            >
                              {confidencePercent.toFixed(2)}%
                            </Badge>
                          </div>
                          {/* Confidence Bar */}
                          <div className="mt-1 h-0.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                isHighConfidence
                                  ? "bg-green-500"
                                  : isMediumConfidence
                                    ? "bg-yellow-500"
                                    : "bg-orange-500"
                              }`}
                              style={{ width: `${confidencePercent}%` }}
                            />
                          </div>
                          {/* Marking Info */}
                          {recognizeMarkings && result.marking && (
                            <div className="mt-1.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-700 dark:text-blue-400">
                              Маркировка: {result.marking}
                            </div>
                          )}
                          
                          {/* Reannotation block - плавно появляется под выбранным лишним инструментом */}
                          {selectedToolId === result.id && result.originalFileId && (
                            <div 
                              className="mt-2 pt-2 border-t border-blue-500/30 animate-in slide-in-from-top-2 duration-300"
                            >
                              {loadingStatuses.has(result.originalFileId) ? (
                                <div className="flex items-center justify-center py-1 text-muted-foreground">
                                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary mr-1.5"></div>
                                  <span className="text-[9px]">Проверка...</span>
                                </div>
                              ) : reannotationStatuses.get(result.originalFileId) === true ? (
                                <div className="bg-success/10 text-success border border-success px-2 py-1 text-[9px] rounded text-center flex items-center justify-center gap-1">
                                  <CheckCircle className="h-2.5 w-2.5" />
                                  Отправлено на доразметку
                                </div>
                              ) : reannotationStatuses.has(result.originalFileId) ? (
                                <div className="space-y-1">
                                  <div className="text-[9px] font-medium text-center">
                                    Правильно распознан?
                                  </div>
                                  <div className="flex gap-1.5">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedToolId(null);
                                      }}
                                      className="flex-1 h-6 text-[9px] py-0"
                                    >
                                      Да
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="flex-1 h-6 text-[9px] py-0 border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSendToReannotation(result.id, result.originalFileId);
                                      }}
                                      disabled={sendingResults.has(result.id)}
                                    >
                                      {sendingResults.has(result.id) ? (
                                        <>
                                          <div className="animate-spin rounded-full h-2 w-2 border-b-2 border-current mr-0.5"></div>
                                          <span className="text-[8px]">Отправка...</span>
                                        </>
                                      ) : (
                                        <>
                                          <AlertCircle className="h-2.5 w-2.5 mr-0.5" />
                                          Нет
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </div>

      {/* Confirmation dialog при расхождениях (как в оригинале) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Подтверждение {actionType === "issue" ? "выдачи" : "приёмки"} при расхождениях
            </AlertDialogTitle>
            <AlertDialogDescription>
              В результатах найдены расхождения с заказом.
              {missingAndExtraTools.missing.length > 0 && (
                <div className="mt-2">
                  <span className="font-medium text-destructive">Отсутствуют ({missingAndExtraTools.missing.length}):</span>
                  <span className="ml-1">{missingAndExtraTools.missing.join(", ")}</span>
                </div>
              )}
              {missingAndExtraTools.extra.length > 0 && (
                <div className="mt-2">
                  <span className="font-medium text-blue-600">Лишние ({missingAndExtraTools.extra.length}):</span>
                  <span className="ml-1">{missingAndExtraTools.extra.join(", ")}</span>
                </div>
              )}
              <p className="mt-3">
                Подтвердите, что вы отметили вручную изменения в системе ТОиР.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleCompleteConfirmed}>
              Подтверждаю
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
