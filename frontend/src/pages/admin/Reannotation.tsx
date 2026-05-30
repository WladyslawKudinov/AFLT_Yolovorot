import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LABEL_STUDIO_URL = (import.meta as any).env?.VITE_LABEL_STUDIO_PROJECT_URL || 'http://localhost:8888/projects/1/data?tab=1';

const Reannotation = () => {
  const handleOpenLabelStudio = () => {
    window.open(LABEL_STUDIO_URL, "_blank");
  };

  return (
    <div className="h-screen overflow-hidden p-6">
      <h2 className="text-xl font-semibold mb-4">Доразметка</h2>
      
      <div className="grid gap-4 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Label Studio</CardTitle>
            <CardDescription>
              Открыть проект с изображениями, отправленными пользователями на доразметку в процессе выдачи и сдачи инструментов. Содержит фотографии с текущей сегментацией модели.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleOpenLabelStudio} className="w-full sm:w-auto">
              <ExternalLink className="w-4 h-4 mr-2" />
              Открыть проект Label Studio
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Reannotation;

