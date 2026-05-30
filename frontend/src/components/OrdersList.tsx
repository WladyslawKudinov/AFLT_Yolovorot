import { useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Package, Plane, Loader2 } from "lucide-react";

export interface Order {
  id: string;
  orderNumber: string;
  workorder?: string; // Номер из ТОиР
  aircraft: string;
  department: string;
  requestedDate: string;
  status: "awaiting_issue" | "awaiting_return" | "completed";
  itemsCount: number;
  requester: string;
  tools?: Array<{
    id: number;
    name: string;
    marking?: string;
  }>;
}

interface OrdersListProps {
  onIssue: (orderId: string) => void;
  onReturn: (orderId: string) => void;
  onRequestOrders: () => void;
  onTestModel: () => void;
  onAddPrototype: () => void;
  orders: Order[];
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}


const getStatusBadge = (status: Order["status"]) => {
  switch (status) {
    case "awaiting_issue":
      return <Badge variant="secondary">Ожидает выдачи</Badge>;
    case "awaiting_return":
      return <Badge className="bg-warning text-warning-foreground">Ожидает сдачи</Badge>;
    case "completed":
      return <Badge className="bg-success text-success-foreground">Завершен</Badge>;
    default:
      return <Badge variant="secondary">Неизвестно</Badge>;
  }
};

export const OrdersList = ({ onIssue, onReturn, onRequestOrders, onTestModel, onAddPrototype, orders, loading = false, loadingMore = false, hasMore = false, onLoadMore }: OrdersListProps) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry.isIntersecting && !loadingMore) {
        onLoadMore();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, loadingMore, orders.length]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <Package className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Инструментарий Аэрофлота</h1>
            <p className="text-muted-foreground">Система сдачи-выдачи инструментов</p>
          </div>
        </div>
        
        <div className="flex space-x-3">
          <Button 
            onClick={onAddPrototype}
            variant="outline"
            className="border-orange-500 text-orange-600 hover:bg-orange-500 hover:text-white"
          >
            Добавление прототипов
          </Button>
          <Button 
            onClick={onTestModel}
            variant="outline"
            className="border-primary text-primary hover:bg-primary hover:text-primary-foreground"
          >
            Тест модели
          </Button>
          <Button 
            onClick={onRequestOrders}
            className="bg-primary hover:bg-primary/90"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Загрузка...
              </>
            ) : (
              "Обновить заказы из ТОиР"
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        {orders.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Заказы не найдены</h3>
              <p className="text-muted-foreground mb-4">
                Нажмите кнопку "Обновить заказы из ТОиР" для загрузки заказов
              </p>
            </CardContent>
          </Card>
        ) : (
          orders.map((order) => (
            <Card key={order.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-semibold">
                      {order.workorder || order.orderNumber}
                    </CardTitle>
                    <CardDescription className="flex items-center space-x-4">
                      <span className="flex items-center space-x-1">
                        <Plane className="h-4 w-4" />
                        <span>{order.aircraft}</span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                        <span>{new Date(order.requestedDate).toLocaleDateString('ru-RU')}</span>
                      </span>
                    </CardDescription>
                  </div>
                  {getStatusBadge(order.status)}
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Подразделение</p>
                    <p className="text-sm">{order.department}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Заявитель</p>
                    <p className="text-sm">{order.requester}</p>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{order.itemsCount} позиций</span>
                  </div>
                </div>
                
                <div className="flex space-x-3">
                  {order.status === "awaiting_issue" && (
                    <Button 
                      onClick={() => onIssue(order.id)}
                      className="flex-1"
                    >
                      Выдать
                    </Button>
                  )}
                  {order.status === "awaiting_return" && (
                    <Button 
                      onClick={() => onReturn(order.id)}
                      variant="outline"
                      className="flex-1"
                    >
                      Сдать
                    </Button>
                  )}
                  {order.status === "completed" && (
                    <div className="text-center text-muted-foreground py-2">
                      Заказ завершен
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            {loadingMore && (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Загрузка...</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};