import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileArchive, ArrowLeft, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError } from "@/lib/api";

interface PrototypeUploadProps {
  onBack: () => void;
  onNext: (prototypeName: string, responseData: any) => void;
}

export const PrototypeUpload = ({ onBack, onNext }: PrototypeUploadProps) => {
  const [prototypeName, setPrototypeName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      
      const result = await apiService.createPrototype(prototypeName.trim(), selectedFile);
      console.log('✅ createPrototype API response:', result);
      console.log('✅ prototypeId from response:', result?.prototypeId);
      
      toast({
        title: "Успешно",
        description: "Архив загружен и обработан",
      });
      
      // Переходим к результатам с полученными данными
      onNext(prototypeName.trim(), result);
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const canUpload = selectedFile && prototypeName.trim() && !uploading;

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="p-2"
            disabled={uploading}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Добавление прототипов</h1>
            <p className="text-muted-foreground">Загрузите архив с изображениями для создания прототипа</p>
          </div>
        </div>

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
                  ? 'border-green-500 bg-green-50'
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
                  className="bg-primary hover:bg-primary/90"
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

