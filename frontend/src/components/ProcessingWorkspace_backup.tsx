import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Camera, Upload, Play, X, AlertCircle, ChevronLeft, ChevronRight, HelpCircle, Search, Check, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService } from "@/lib/api";
import { Order } from "./OrdersList";
import { cn } from "@/lib/utils";

interface ProcessingWorkspaceProps {
  order: Order;
  orders: Order[];
  actionType: "issue" | "return";
  jobId: number;
  onOrderChange: (orderId: string, actionType: "issue" | "return") => void;
  onComplete: () => void;
}

interface UploadedFile {
  id: string;
  name: string;
  file: File;
  status: "uploaded" | "processing" | "processed";
}

interface RecognitionResult {
  id: number;
  name: string;
  confidence: number;
  marking?: string;
  markingMatch?: boolean;
}

export const ProcessingWorkspace = ({ order, orders, actionType, jobId, onOrderChange, onComplete }: ProcessingWorkspaceProps) => {
  const [cameraStreams, setCameraStreams] = useState<MediaStream[]>([]);
  const [currentCameraIndex, setCurrentCameraIndex] = useState(0);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [combinePredictions, setCombinePredictions] = useState(true);
  const [recognizeMarkings, setRecognizeMarkings] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState("80");
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [detectedCount, setDetectedCount] = useState<number | null>(null);
  const [results, setResults] = useState<RecognitionResult[]>([]);
  const [hasError, setHasError] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<number | null>(null);
  const [missingTools, setMissingTools] = useState<string[]>([]);
  const [extraTools, setExtraTools] = useState<string[]>([]);
  const [feedbackGiven, setFeedbackGiven] = useState<'yes' | 'no' | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRefs = useRef<HTMLCanvasElement[]>([]);
  const { toast } = useToast();

  const actionTitle = actionType === "issue" ? "Выдача инструментария" : "Сдача инструментария";

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

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newFiles: UploadedFile[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${file.name}`,
      name: file.name,
      file: file,
      status: "uploaded" as const,
    }));

    setUploadedFiles((prev) => [...prev, ...newFiles]);

    // Auto-select first uploaded image
    if (newFiles.length > 0 && !selectedFileId) {
      const firstFile = newFiles[0];
      setSelectedFileId(firstFile.id);
      const imageUrl = URL.createObjectURL(firstFile.file);
      setCurrentImageUrl(imageUrl);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (selectedFileId === fileId) {
      setSelectedFileId(null);
      setCurrentImageUrl(null);
    }
  };

  const handleFileClick = (fileId: string) => {
    const file = uploadedFiles.find((f) => f.id === fileId);
    if (file) {
      setSelectedFileId(fileId);
      const imageUrl = URL.createObjectURL(file.file);
      setCurrentImageUrl(imageUrl);
    }
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

    const canvas = document.createElement("canvas");
    const video = videoRef.current;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera-${currentCameraIndex}-${Date.now()}.jpg`, { type: "image/jpeg" });
          const newFile: UploadedFile = {
            id: `camera-${currentCameraIndex}-${Date.now()}`,
            name: file.name,
            file: file,
            status: "uploaded",
          };
          
          setUploadedFiles((prev) => [...prev, newFile]);
          setSelectedFileId(newFile.id);
          const imageUrl = URL.createObjectURL(newFile.file);
          setCurrentImageUrl(imageUrl);

          toast({
            title: "Захват завершен",
            description: `Захвачено изображение с камеры ${currentCameraIndex + 1}`,
          });
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

        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], `camera-${i}-${Date.now()}.jpg`, { type: "image/jpeg" });
            const newFile: UploadedFile = {
              id: `camera-${i}-${Date.now()}`,
              name: file.name,
              file: file,
              status: "uploaded",
            };
            capturedFiles.push(newFile);
          }
        }, "image/jpeg");
      }
    }

    // Wait a bit for all blobs to be created
    await new Promise((resolve) => setTimeout(resolve, 500));

    setUploadedFiles((prev) => [...prev, ...capturedFiles]);

    if (capturedFiles.length > 0 && !selectedFileId) {
      const firstFile = capturedFiles[0];
      setSelectedFileId(firstFile.id);
      const imageUrl = URL.createObjectURL(firstFile.file);
      setCurrentImageUrl(imageUrl);
    }

    toast({
      title: "Захват завершен",
      description: `Захвачено изображений: ${capturedFiles.length}`,
    });
  };

  const handleProcessAll = async () => {
    if (uploadedFiles.length === 0) {
      toast({
        title: "Нет файлов",
        description: "Загрузите файлы для обработки",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    const startTime = Date.now();

    try {
      // Simulate processing - API disabled
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const endTime = Date.now();
      const processingTimeMs = endTime - startTime;
      setProcessingTime(processingTimeMs / 1000);

      // Mock results
      const mockResults: RecognitionResult[] = [
        { id: 1, name: "Бокорезы", confidence: 0.98, marking: "БК-2024-001", markingMatch: true },
        { id: 2, name: "Пассатижи контровочные", confidence: 0.98, marking: "ПК-2024-015", markingMatch: true },
        { id: 3, name: "Шэрница", confidence: 0.98, marking: "ШР-2023-042", markingMatch: false },
        { id: 4, name: "Коловорот", confidence: 0.97, marking: "КЛ-2024-008", markingMatch: true },
        { id: 5, name: "Отвертка «-»", confidence: 0.96, marking: "ОТ-2024-103", markingMatch: true },
        { id: 6, name: "Пассатижи", confidence: 0.96, marking: "ПС-2023-089", markingMatch: true },
        { id: 7, name: "Ключ рожковый/накидной ¾", confidence: 0.95, marking: "КЛ-2024-055", markingMatch: false },
        { id: 8, name: "Открывашка", confidence: 0.95, marking: "ОП-2024-012", markingMatch: true },
        { id: 9, name: "Отвертка «+»", confidence: 0.94, marking: "ОТ-2024-104", markingMatch: true },
        { id: 10, name: "Разводной ключ", confidence: 0.9, marking: "РК-2023-067", markingMatch: true },
      ];

      setResults(mockResults);
      setDetectedCount(mockResults.length);
      setHasError(mockResults.length < order.itemsCount);

      // Mock missing and extra tools
      setMissingTools(["Отвертка на смещ. крест"]);
      setExtraTools(["Открывашка"]);

      setUploadedFiles((prev) => prev.map((f) => ({ ...f, status: "processed" as const })));

      toast({
        title: "Обработка завершена",
        description: "Все файлы успешно обработаны",
      });
    } catch (error) {
      console.error("Processing error:", error);
      toast({
        title: "Ошибка обработки",
        description: "Не удалось обработать файлы",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="grid grid-cols-12 gap-3 items-center">
            <div className="col-span-3">
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">Workorder</Label>
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={open}
                      className="w-full justify-between"
                      data-onboarding="order-selector"
                    >
                      {order.orderNumber}
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
                              value={`${o.orderNumber} ${o.aircraft}`}
                              onSelect={() => {
                                const newActionType = o.status === "awaiting_issue" ? "issue" : "return";
                                onOrderChange(o.id, newActionType);
                                setOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  order.id === o.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex items-center justify-between w-full gap-2">
                                <span>{o.orderNumber} - {o.aircraft}</span>
                                <Badge 
                                  variant={
                                    o.status === "awaiting_issue" ? "default" : 
                                    o.status === "awaiting_return" ? "secondary" : 
                                    "outline"
                                  }
                                  className="text-[9px] h-5 px-2 shrink-0"
                                >
                                  {o.status === "awaiting_issue" ? "Ожидает выдачи" : 
                                   o.status === "awaiting_return" ? "Ожидает сдачи" : 
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
            </div>
            <div className="col-span-6 text-center">
              <h1 className="text-xl font-bold break-words">{actionTitle}</h1>
              <p className="text-sm text-muted-foreground">Заказ {order.orderNumber}</p>
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
                          onClick={onComplete} 
                          size="sm"
                          className="w-full"
                          disabled={results.length === 0}
                        >
                          Закончить {actionType === "issue" ? "выдачу" : "сдачу"}
                        </Button>
                      </div>
                    </TooltipTrigger>
                    {results.length === 0 && (
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
            {/* Sources */}
            <Card>
              <CardHeader className="py-2">
                <CardTitle className="text-xs font-semibold text-center">Источники</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 py-2">
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
                    accept="image/*"
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
                  >
                    Загрузить файлы
                  </Button>

                  {uploadedFiles.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto p-1">
                      {uploadedFiles.map((file) => (
                        <div
                          key={file.id}
                          className={`relative aspect-square rounded border-2 cursor-pointer transition-all group ${
                            selectedFileId === file.id
                              ? "border-primary shadow-sm"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => handleFileClick(file.id)}
                        >
                          <img
                            src={URL.createObjectURL(file.file)}
                            alt={file.name}
                            className="w-full h-full object-cover rounded"
                          />
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
                          {file.status === "processed" && (
                            <div className="absolute bottom-0 left-0 right-0 bg-green-500/80 text-white text-[8px] text-center py-0.5">
                              ✓
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Processing */}
            <Card>
              <CardHeader className="py-2">
                <CardTitle className="text-xs font-semibold text-center">Обработка</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 py-2">
                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full h-auto min-h-7 text-[10px] flex items-start justify-between py-1.5 px-2 overflow-hidden">
                      <span className="flex-1 text-left leading-tight pr-1 break-words min-w-0">Дополнительные настройки</span>
                      <ChevronDown className={cn("h-3 w-3 transition-transform shrink-0 mt-0.5", settingsOpen && "rotate-180")} />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 mt-2">
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
                      <Switch checked={combinePredictions} onCheckedChange={setCombinePredictions} className="scale-75" />
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

                    <div className="p-2 bg-muted rounded space-y-1.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]">Порог уверенности (%)</span>
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
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={confidenceThreshold}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0;
                          setConfidenceThreshold(Math.min(100, Math.max(0, val)).toString());
                        }}
                        className="h-7 text-xs text-center"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Button
                  size="sm"
                  className="w-full h-auto min-h-8 text-xs font-semibold whitespace-normal py-2"
                  onClick={handleProcessAll}
                  disabled={isProcessing || uploadedFiles.length === 0}
                  data-onboarding="process-button"
                >
                  {isProcessing ? (
                    <>
                      <Play className="h-3 w-3 mr-1.5 animate-spin shrink-0" />
                      <span>Обработка...</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3 mr-1.5 shrink-0" />
                      <span>Запустить обработку</span>
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
                <div className="w-full flex-1 bg-black rounded flex items-center justify-center">
                  {isCameraActive ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : currentImageUrl ? (
                    <img src={currentImageUrl} alt="Processing" className="max-w-full max-h-full object-contain" />
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
                {results.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    <div className="bg-muted rounded p-1.5 text-center">
                      <div className="text-muted-foreground">Найдено</div>
                      <div className="text-base font-bold">{detectedCount}</div>
                    </div>
                    <div className="bg-muted rounded p-1.5 text-center">
                      <div className="text-muted-foreground">Ср. точность</div>
                      <div className="text-base font-bold">
                        {((results.reduce((sum, r) => sum + r.confidence, 0) / results.length) * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                )}

                {/* Missing Tools Alert */}
                {missingTools.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-destructive">
                      Отсутствуют ({missingTools.length})
                    </div>
                    <div className="space-y-0.5">
                      {missingTools.map((tool, idx) => (
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

                {/* Extra Tools Alert */}
                {extraTools.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-yellow-600 dark:text-yellow-400">
                      Лишние ({extraTools.length})
                    </div>
                    <div className="space-y-0.5">
                      {extraTools.map((tool, idx) => (
                        <div
                          key={idx}
                          className="bg-yellow-500/10 border-l-2 border-yellow-500 px-2 py-1 text-[10px] rounded-sm"
                        >
                          {tool}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Detected Tools List */}
                {results.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] font-semibold text-muted-foreground">Распознано</div>
                    <div className="space-y-1 max-h-[calc(100vh-450px)] overflow-y-auto pr-1">
                      {results.map((result) => {
                        const confidencePercent = result.confidence * 100;
                        const isHighConfidence = confidencePercent >= 95;
                        const isMediumConfidence = confidencePercent >= 85 && confidencePercent < 95;

                        return (
                          <div
                            key={result.id}
                            className={`p-2 rounded cursor-pointer transition-all border ${
                              selectedToolId === result.id
                                ? "bg-primary/10 border-primary shadow-sm"
                                : "bg-card hover:bg-accent border-border"
                            }`}
                            onClick={() => setSelectedToolId(result.id === selectedToolId ? null : result.id)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="text-[10px] font-medium truncate">{result.name}</div>
                              </div>
                              <Badge
                                variant={isHighConfidence ? "default" : isMediumConfidence ? "secondary" : "outline"}
                                className="text-[9px] px-1.5 py-0 h-4 shrink-0"
                              >
                                {confidencePercent.toFixed(0)}%
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
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {results.length > 0 && !hasError && (
                  <Button className="w-full h-7 text-xs" onClick={onComplete}>
                    {actionType === "issue" ? "Выдать" : "Сдать"}
                  </Button>
                )}

                {results.length > 0 && (
                  <div className="mt-2 border rounded-lg p-2">
                    {feedbackGiven ? (
                      <div className="bg-success/10 text-success border border-success px-3 py-2 text-[10px] rounded text-center">
                        {feedbackGiven === 'yes' 
                          ? 'Спасибо! Ваша оценка помогает улучшать модель'
                          : 'Спасибо! Мы перепроверим фото и улучшим модель'
                        }
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="text-[10px] font-medium text-center">
                          Правильно ли распознаны инструменты?
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFeedbackGiven('yes')}
                            className="flex-1 h-7 text-[10px]"
                          >
                            Да
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setFeedbackGiven('no')}
                            className="flex-1 h-7 text-[10px]"
                          >
                            Нет
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};
