import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const GRAFANA_URL = (import.meta as any).env?.VITE_GRAFANA_URL || 'localhost:3000';

const Analytics = () => {
  const handleOpenGrafana = () => {
    window.open(`http://${GRAFANA_URL}/d/analytics?kiosk`, "_blank");
  };

  return (
    <div className="h-screen overflow-hidden p-6">
      <h2 className="text-xl font-semibold mb-4">Аналитика</h2>
      
      <div className="grid gap-4 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Метрики и дашборды</CardTitle>
            <CardDescription>
              Просмотр аналитики системы распознавания в Grafana
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleOpenGrafana} className="w-full sm:w-auto">
              <ExternalLink className="w-4 h-4 mr-2" />
              Открыть Grafana
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Analytics;

