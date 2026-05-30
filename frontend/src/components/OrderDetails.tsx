import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Package, Plane, User, Loader2 } from "lucide-react";
import { Order } from "./OrdersList";
import { apiService } from "@/lib/api";

interface OrderDetailsProps {
  order: Order;
  actionType: "issue" | "return";
  onBack: () => void;
  onNext: () => void;
}

interface OrderItem {
  id: number;
  toolName: string;
  toolId: number;
  marking?: string; // маркировка инструмента
}

// No mock data - will load from API

export const OrderDetails = ({ order, actionType, onBack, onNext }: OrderDetailsProps) => {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  
  const actionTitle = actionType === "issue" ? "Выдача инструментария" : "Сдача инструментария";
  const actionColor = actionType === "issue" ? "text-primary" : "text-info";

  useEffect(() => {
    const loadOrderItems = async () => {
      try {
        setLoadingItems(true);
        const response = await apiService.getOrderTools(order.id);
        
        // Transform API response to match our OrderItem interface
        const transformedItems = response?.map((apiOrderTool) => ({
          id: apiOrderTool.id,
          toolName: apiOrderTool.tool.name,
          toolId: apiOrderTool.tool.id,
          marking: apiOrderTool.marking // маркировка из заказа
        })) || [];
        
        setOrderItems(transformedItems);
      } catch (error) {
        console.error('Failed to load order items:', error);
        setOrderItems([]); // No fallback to mock data
      } finally {
        setLoadingItems(false);
      }
    };

    loadOrderItems();
  }, [order.id]);

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
          <span>Назад к списку заказов</span>
        </Button>
      </div>

      <div className="space-y-6">
        <div className="flex items-center space-x-3">
          <Package className={`h-8 w-8 ${actionColor}`} />
          <div>
            <h1 className="text-3xl font-bold">{actionTitle}</h1>
            <p className="text-muted-foreground">Заказ {order.workorder || order.orderNumber}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Информация о заказе
              <Badge variant="secondary">Ожидает обработки</Badge>
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Plane className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Описание заказа</p>
                    <p className="font-medium">{order.aircraft}</p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Заявитель</p>
                    <p className="font-medium">{order.requester}</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Дата запроса</p>
                    <p className="font-medium">{new Date(order.requestedDate).toLocaleDateString('ru-RU')}</p>
                  </div>
                </div>
                
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Подразделение</p>
                  <p className="font-medium">{order.department}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Состав заказа</CardTitle>
            <CardDescription>Список инструментария для {actionType === "issue" ? "выдачи" : "сдачи"}</CardDescription>
          </CardHeader>
          
          <CardContent>
            {loadingItems ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span>Загрузка инструментов...</span>
              </div>
            ) : (
              <div className="space-y-3">
                {orderItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium">{item.toolName}</p>
                      {item.marking && (
                        <p className="text-sm text-muted-foreground">
                          Маркировка: <span className="font-medium text-primary">{item.marking}</span>
                        </p>
                      )}
                    </div>
                    <Badge variant="outline">ID: {item.toolId}</Badge>
                  </div>
                ))}
                {orderItems.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    Инструменты не найдены
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button 
            onClick={onNext} 
            size="lg" 
            className="px-8"
            disabled={loadingItems}
          >
            {loadingItems ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Загрузка...
              </>
            ) : (
              "Далее"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};