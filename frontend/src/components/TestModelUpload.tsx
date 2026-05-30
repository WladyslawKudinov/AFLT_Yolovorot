import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Upload, FileArchive, ArrowLeft, Loader2, CheckCircle, AlertCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError } from "@/lib/api";

interface TestModelUploadProps {
  onBack: () => void;
  onNext: (jobId: number, searchMarking: boolean) => void;
}

export const TestModelUpload = ({ onBack, onNext }: TestModelUploadProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [searchMarking, setSearchMarking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<number | null>(null);
  const { toast } = useToast();

  const handleFileSelect = (file: File) => {
    // Строгая проверка на ZIP архив
    const isZipFile = file.name.toLowerCase().endsWith('.zip') && 
                     (file.type === 'application/zip' || 
                      file.type === 'application/x-zip-compressed' ||
                      file.type === ''); // Некоторые браузеры не определяют MIME тип для ZIP
    
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
      
      const result = await apiService.testModel(selectedFile, searchMarking);
      console.log('API testModel result:', result);
      
      // Проверяем, что jobId получен
      if (!result || typeof result.jobId !== 'number') {
        throw new Error('Неверный формат ответа: отсутствует jobId');
      }

      // После получения jobId начинаем опрос статуса и держим крутилку
      const jobId = result.jobId;
      let intervalId: number | null = null;

      const poll = async () => {
        try {
          const statusResp = await apiService.getJobStatus(jobId);
          const status = (statusResp?.status || statusResp || '').toString();
          if (status.toUpperCase() === 'FINISHED') {
            if (intervalId) {
              window.clearInterval(intervalId);
              intervalId = null;
            }
            setProcessing(false);
            onNext(jobId, searchMarking);
          }
          else {
            // Любой не-FINISHED статус переводит нас в состояние обработки
            setProcessing(true);
            // выключим исходную фазу загрузки, чтобы крутилка не погасла при смене состояний
            setUploading(false);
          }
        } catch (e) {
          console.error('Failed to poll job status:', e);
          if (intervalId) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          // Остановим крутилку и покажем ошибку
          setUploading(false);
          setProcessing(false);
          let errorMessage = 'Не удалось получить статус задачи';
          if (e instanceof ApiError) errorMessage = e.message;
          toast({ title: 'Ошибка', description: errorMessage, variant: 'destructive' });
        }
      };

      // Немедленно проверим и затем каждые 3 секунды
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
    } finally {
      // Крутилку не выключаем здесь — она выключится либо при ошибке, либо после перехода
    }
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
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
            <h1 className="text-2xl font-bold">Тест модели</h1>
            <p className="text-muted-foreground">Загрузите архив с фотографиями для тестирования</p>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Для тестирования модели загрузите <strong>только ZIP архив</strong>, содержащий до 100 фотографий инструментов. 
            Поддерживаются форматы JPG, PNG внутри архива. При загрузке нового архива предыдущие результаты тестирования будут удалены.
          </AlertDescription>
        </Alert>

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
                  ? 'border-green-500 bg-green-50'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileInputChange}
                className="hidden"
              />
              
              {selectedFile ? (
                <div className="space-y-2">
                  <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
                  <div>
                    <p className="font-medium text-green-700">{selectedFile.name}</p>
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

            {/* Настройки тестирования */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="searchMarking" 
                  checked={searchMarking}
                  onCheckedChange={(checked) => setSearchMarking(checked === true)}
                />
                <label 
                  htmlFor="searchMarking" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Распознавать маркировку инструментов
                </label>
              </div>
              <div className="flex items-start space-x-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Время обработки:</p>
                  <p>• Без маркировки: ~2 секунды на инструмент</p>
                  <p>• С маркировкой: ~10 секунд на инструмент</p>
                </div>
              </div>
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
                  className="bg-primary hover:bg-primary/90"
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

