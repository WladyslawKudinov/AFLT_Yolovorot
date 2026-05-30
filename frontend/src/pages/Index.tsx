import { useState, useEffect, useCallback } from "react";
import { OrdersList, Order } from "@/components/OrdersList";
import { ProcessingWorkspace } from "@/components/ProcessingWorkspace";
import { InteractiveOnboarding } from "@/components/InteractiveOnboarding";
import { TestModelUpload } from "@/components/TestModelUpload";
import { TestModelResults } from "@/components/TestModelResults";
import { PrototypeUpload } from "@/components/PrototypeUpload";
import { PrototypeResults } from "@/components/PrototypeResults";
import { useToast } from "@/hooks/use-toast";
import { apiService, ApiError } from "@/lib/api";

type ViewState = "orders" | "processing" | "testModel" | "testResults" | "prototypeUpload" | "prototypeResults";
type ActionType = "issue" | "return";

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  uploadDate: Date;
  status: "uploaded" | "processing" | "processed";
}

interface JobData {
  jobId: number;
  orderId: string;
  actionType: "TOOLS_ISSUANCE" | "TOOLS_RETURN";
}

interface TestJobData {
  jobId: number;
  searchMarking: boolean;
}

interface PrototypeData {
  prototypeName: string;
  uploadResponse: any;
}

// Empty initial orders - will be loaded from API
const initialOrders: Order[] = [];

const Index = () => {
  const [currentView, setCurrentView] = useState<ViewState>("processing");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<ActionType>("issue");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [jobData, setJobData] = useState<JobData | null>(null);
  const [testJobData, setTestJobData] = useState<TestJobData | null>(null);
  const [prototypeData, setPrototypeData] = useState<PrototypeData | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const selectedOrder = orders.find(order => order.id === selectedOrderId);

  // paging state
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Load orders on component mount
  useEffect(() => {
    const initializeApp = async () => {
      console.log('[APP] Starting initialization...');
      console.log('[APP] API_BASE_URL:', (import.meta as any).env?.VITE_API_BASE_URL);
      try {
        console.log('[APP] Loading orders...');
        // Try to load orders first
        await loadOrders(0, false);
        console.log('[APP] Orders loaded successfully');
      } catch (error) {
        console.error('[APP] Failed to initialize app:', error);
        // App will show error message via apiError state
      }
    };
    
    initializeApp();
  }, []);

  // Restore view state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('afl-tools-ui-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        
        // Проверяем валидность состояний перед восстановлением
        if (parsed.currentView && ['orders', 'processing', 'testModel', 'testResults', 'prototypeUpload', 'prototypeResults'].includes(parsed.currentView)) {
          // Если это testResults, проверяем что testJobData валидный
          if (parsed.currentView === 'testResults') {
            if (parsed.testJobData && typeof parsed.testJobData.jobId === 'number') {
              // Если searchMarking отсутствует, устанавливаем значение по умолчанию
              const testJobData = {
                jobId: parsed.testJobData.jobId,
                searchMarking: typeof parsed.testJobData.searchMarking === 'boolean' ? parsed.testJobData.searchMarking : false
              };
              setCurrentView(parsed.currentView);
              setTestJobData(testJobData);
            } else {
              console.log('Invalid testJobData, staying on processing view');
              setCurrentView("processing");
            }
          } else if (parsed.currentView === 'prototypeResults') {
            if (parsed.prototypeData && parsed.prototypeData.prototypeName) {
              setCurrentView(parsed.currentView);
              setPrototypeData(parsed.prototypeData);
            } else {
              console.log('Invalid prototypeData, staying on processing view');
              setCurrentView("processing");
            }
          } else {
            setCurrentView(parsed.currentView);
          }
        }
        
        // Restore order selection and job data for processing view
        if (parsed.selectedOrderId) {
          setSelectedOrderId(parsed.selectedOrderId);
          // Re-create job if needed after page reload
          if (parsed.currentView === 'processing' && orders.length > 0) {
            const order = orders.find(o => o.id === parsed.selectedOrderId);
            if (order) {
              // Will be handled by useEffect below
            }
          }
        }
        if (parsed.actionType) setActionType(parsed.actionType);
        if (parsed.jobData) setJobData(parsed.jobData);
        if (parsed.testJobData && parsed.currentView !== 'testResults') setTestJobData(parsed.testJobData);
        if (parsed.prototypeData && parsed.currentView !== 'prototypeResults') setPrototypeData(parsed.prototypeData);
      }
    } catch (error) {
      console.error('Error restoring state from localStorage:', error);
      // Очищаем поврежденное состояние
      localStorage.removeItem('afl-tools-ui-state');
    }
  }, []);

  // Persist view state to localStorage
  useEffect(() => {
    const data = {
      currentView,
      selectedOrderId,
      actionType,
      jobData,
      testJobData,
      prototypeData,
    };
    try {
      localStorage.setItem('afl-tools-ui-state', JSON.stringify(data));
    } catch {}
  }, [currentView, selectedOrderId, actionType, jobData, testJobData, prototypeData]);

  // Reconcile restored state with actual data (orders) to avoid blank screens
  useEffect(() => {
    // If a specific order is required by view but it's not found, reset
    const needsOrder = currentView === 'processing';
    if (needsOrder && selectedOrderId && !orders.find(o => o.id === selectedOrderId)) {
      setCurrentView('processing');
      setSelectedOrderId(null);
      setJobData(null);
      try { localStorage.removeItem('afl-tools-ui-state'); } catch {}
      toast({
        title: 'Сеанс обновлен',
        description: 'Ранее выбранный заказ недоступен.',
      });
    }
  }, [orders, currentView, selectedOrderId, toast]);

  // Restore job after orders are loaded (for page refresh)
  useEffect(() => {
    const restoreJob = async () => {
      if (selectedOrderId && orders.length > 0 && !jobData && currentView === 'processing') {
        const order = orders.find(o => o.id === selectedOrderId);
        if (order) {
          // Re-create the job
          await handleOrderChange(selectedOrderId);
        }
      }
    };
    restoreJob();
  }, [orders.length]); // Only run when orders are first loaded


  const loadOrders = async (targetPage = 0, append = false) => {
    console.log('[loadOrders] Starting... page:', targetPage, 'append:', append);
    try {
      if (append) setLoadingMore(true); else setLoading(true);
      
      console.log('[loadOrders] Fetching from API...');
      // Add timeout for API calls
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('API timeout')), 10000)
      );
      
      const apiOrders = await Promise.race([
        apiService.getOrders(targetPage, pageSize),
        timeoutPromise
      ]);
      console.log('[loadOrders] Loaded orders from API:', apiOrders);
      
      // Transform API response to match our Order interface
      const transformedOrders = await Promise.all(
        apiOrders.map(async (apiOrder) => {
          let itemsCount = 0;
          let computedStatus: "awaiting_issue" | "awaiting_return" | "completed" = "awaiting_issue";

          await Promise.all([
            (async () => {
              try {
                const toolsResponse = await apiService.getOrderTools(apiOrder.id);
                itemsCount = toolsResponse?.length || 0;
              } catch (error) {
                console.error(`Failed to load tools for order ${apiOrder.id}:`, error);
                itemsCount = 0;
              }
            })(),
            (async () => {
              try {
                const jobs = await apiService.getJobsByOrderId(apiOrder.id);
                const issueJob = jobs.find(j => j.actionType === 'TOOLS_ISSUANCE');
                const returnJob = jobs.find(j => j.actionType === 'TOOLS_RETURN');
                const isIssueFinished = issueJob ? (issueJob.job?.status?.includes('FINISHED') || issueJob.job?.status === 'FINISHED') : false;
                const isReturnFinished = returnJob ? (returnJob.job?.status?.includes('FINISHED') || returnJob.job?.status === 'FINISHED') : false;
                if (isIssueFinished && isReturnFinished) computedStatus = 'completed';
                else if (isIssueFinished) computedStatus = 'awaiting_return';
                else computedStatus = 'awaiting_issue';
              } catch (error) {
                console.error(`Failed to load jobs for order ${apiOrder.id}:`, error);
                computedStatus = 'awaiting_issue';
              }
            })(),
          ]);

          return {
            id: apiOrder.id,
            orderNumber: apiOrder.id,
            workorder: apiOrder.workorder, // Номер из ТОиР
            aircraft: apiOrder.description || "Описание не указано",
        department: "Техническое обслуживание",
            requestedDate: apiOrder.createdAt,
            status: computedStatus,
            itemsCount,
            requester: `${apiOrder.employee.surname} ${apiOrder.employee.name} ${apiOrder.employee.patronymic}`
          };
        })
      );
      
      console.log('Transformed orders with tools count:', transformedOrders);
      if (append) {
        const existingIds = new Set(orders.map(o => o.id));
        const toAdd = transformedOrders.filter(o => !existingIds.has(o.id));
        setOrders(prev => [...prev, ...toAdd]);
      } else {
        setOrders(transformedOrders);
      }
      setPage(targetPage);
      setHasMore(apiOrders.length === pageSize);
      setApiError(null); // Clear any previous errors
    } catch (error) {
      console.error('Failed to load orders:', error);
      setOrders([]); // No fallback to mock data
      
      let errorMessage = "Не удалось загрузить заказы из системы ТОиР";
      
      if (error instanceof Error && error.message === 'API timeout') {
        errorMessage = "Превышено время ожидания ответа от сервера. Проверьте подключение к сети.";
      } else if (error instanceof ApiError) {
        switch (error.status) {
          case 400:
            errorMessage = "Сервис распознавания недоступен. Попробуйте позже.";
            break;
          case 404:
            errorMessage = "Сервис распознавания не найден. Проверьте подключение.";
            break;
          default:
            errorMessage = error.message;
        }
      }
      
      setApiError(errorMessage);
      toast({
        title: "Ошибка загрузки",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  };

  const handleLoadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    await loadOrders(page + 1, true);
  }, [loadingMore, hasMore, page, pageSize, orders]);


  const handleBackToOrders = () => {
    setCurrentView("orders");
    setSelectedOrderId(null);
    setUploadedFiles([]);
    setJobData(null);
    setTestJobData(null);
    setPrototypeData(null);
    try { localStorage.removeItem('afl-tools-ui-state'); } catch {}
  };

  const handleOrderChange = async (orderId: string) => {
    setSelectedOrderId(orderId);
    
    try {
      setLoading(true);
      
      // Determine action type based on order status
      const order = orders.find(o => o.id === orderId);
      if (!order) return;
      
      // Auto-detect action type: awaiting_issue -> issue, awaiting_return -> return
      const detectedActionType: ActionType = order.status === "awaiting_return" ? "return" : "issue";
      setActionType(detectedActionType);
      
      const apiActionType = detectedActionType === "issue" ? "TOOLS_ISSUANCE" : "TOOLS_RETURN";
      
      // Get or create job
      const existingJobs = await apiService.getJobsByOrderId(orderId);
      const existingJob = existingJobs.find(job => job.actionType === apiActionType);
      
      let jobIdToUse: number | null = null;
      if (existingJob) {
        jobIdToUse = existingJob.job?.id ?? existingJob.id;
      } else {
        await apiService.createJob(orderId, apiActionType);
        const refreshedJobs = await apiService.getJobsByOrderId(orderId);
        const created = refreshedJobs.find(j => j.actionType === apiActionType);
        jobIdToUse = created?.job?.id ?? created?.id ?? null;
      }

      if (!jobIdToUse) {
        throw new Error('Job was not created');
      }
      
      setJobData({
        jobId: jobIdToUse,
        orderId: orderId,
        actionType: apiActionType
      });
      
      // Signal ProcessingWorkspace to load existing files and results
      // This will be handled via prop drilling or context
      
    } catch (error) {
      console.error('Failed to get or create job:', error);
      
      let errorMessage = "Не удалось получить или создать задачу обработки";
      
      if (error instanceof ApiError) {
        switch (error.status) {
          case 400:
            errorMessage = "Сервис обработки недоступен. Попробуйте позже.";
            break;
          case 422:
            errorMessage = "Не удалось распознать инструменты на фото. Проверьте качество изображения.";
            break;
          default:
            errorMessage = error.message;
        }
      }
      
      toast({
        title: "Ошибка",
        description: errorMessage,
        variant: "destructive",
      });
      
      // Reset to empty state on error
      setSelectedOrderId(null);
      setJobData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleTestModel = () => {
    setCurrentView("testModel");
  };


  const handleBackFromTestModel = () => {
    setCurrentView("orders");
  };

  const handleNextFromTestModel = (jobId: number, searchMarking: boolean) => {
    console.log('Setting testJobData with jobId:', jobId, 'searchMarking:', searchMarking);
    setTestJobData({ jobId, searchMarking });
    setCurrentView("testResults");
  };

  const handleBackFromTestResults = () => {
    setCurrentView("testModel");
  };

  const handleCompleteTestModel = () => {
    toast({
      title: "Тестирование завершено",
      description: "Результаты тестирования модели получены",
    });
    handleBackToOrders();
  };

  const handleAddPrototype = () => {
    setCurrentView("prototypeUpload");
  };

  const handleBackFromPrototypeUpload = () => {
    setCurrentView("orders");
  };

  const handleNextFromPrototypeUpload = (prototypeName: string, responseData: any) => {
    console.log('Setting prototypeData:', { prototypeName, uploadResponse: responseData });
    setPrototypeData({ prototypeName, uploadResponse: responseData });
    setCurrentView("prototypeResults");
  };

  const handleBackFromPrototypeResults = () => {
    setCurrentView("prototypeUpload");
  };

  const handleCompletePrototype = () => {
    toast({
      title: "Прототип добавлен",
      description: "Изображения прототипа успешно загружены",
    });
    handleBackToOrders();
  };



  const handleCompleteProcess = async (isFull?: boolean) => {
    if (!selectedOrder) return;
    
    const actionText = actionType === "issue" ? "выдан" : "принят";
    
    // Update job status to FINISHED
    // Если isFull передан (true/false) - добавляем его в запрос для метрики полных наборов
    if (jobData) {
      try {
        console.log('=== UPDATING JOB STATUS TO FINISHED ===');
        console.log('JobId:', jobData.jobId);
        console.log('isFull:', isFull);
        
        await apiService.updateJobStatus(jobData.jobId, 'FINISHED', isFull);
      } catch (error) {
        console.error('Failed to update job status:', error);
      }
    }
    
    // Update order status based on action
    const newStatus = actionType === "issue" ? "awaiting_return" : "completed";
    setOrders(prevOrders => 
      prevOrders.map(order => 
        order.id === selectedOrder.id 
          ? { ...order, status: newStatus }
          : order
      )
    );
    
    toast({
      title: "Операция завершена",
      description: `Заказ ${selectedOrder?.orderNumber} успешно ${actionText}`,
    });

    // If we just finished issue and order now awaits return, auto-switch to return mode
    if (actionType === "issue") {
      toast({
        title: "Переход к сдаче",
        description: "Заказ готов к сдаче инструментов",
      });
      
      // Wait a bit for user to see the message, then reload the same order in return mode
      setTimeout(() => {
        handleOrderChange(selectedOrder.id);
      }, 1500);
    } else {
      // If return completed, reset to "Выберите заказ" state
      setSelectedOrderId(null);
      setJobData(null);
      setActionType("issue");
      toast({
        title: "Готово",
        description: "Выберите следующий заказ",
      });
    }
  };

  const handleRequestOrders = async () => {
    try {
      setLoading(true);
      
      // Reload orders to get the updated list from ТОиР
      await loadOrders();
      
      toast({
        title: "Заказы обновлены",
        description: `Заказы загружены из системы ТОиР`,
      });
    } catch (error) {
      console.error('Failed to load orders:', error);
      
      let errorMessage = "Не удалось загрузить заказы";
      
      if (error instanceof ApiError) {
        switch (error.status) {
          case 400:
            errorMessage = "Сервис распознавания недоступен. Попробуйте позже.";
            break;
          case 404:
            errorMessage = "Сервис распознавания не найден. Проверьте подключение.";
            break;
          default:
            errorMessage = error.message;
        }
      }
      
      toast({
        title: "Ошибка",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const renderCurrentView = () => {
    console.log('Current view state:', currentView);
    console.log('Selected order ID:', selectedOrderId);
    console.log('Job data:', jobData);
    console.log('Test job data:', testJobData);
    
    switch (currentView) {
      case "orders":
        // Redirect to processing view (main entry point)
        setCurrentView("processing");
        return null;

      case "processing":
        return (
          <>
            <ProcessingWorkspace
              order={selectedOrder || null}
              orders={orders}
              actionType={actionType}
              jobId={jobData?.jobId || null}
              onOrderChange={handleOrderChange}
              onComplete={handleCompleteProcess}
            />
            <InteractiveOnboarding />
            {apiError && (
              <div className="fixed top-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
                <strong>Ошибка подключения:</strong> {apiError}
                <button 
                  onClick={() => {
                    setApiError(null);
                    loadOrders(0, false);
                  }}
                  className="ml-2 text-red-500 hover:text-red-700 underline"
                >
                  Повторить
                </button>
              </div>
            )}
          </>
        );

      case "testModel":
        return (
          <TestModelUpload
            onBack={handleBackFromTestModel}
            onNext={handleNextFromTestModel}
          />
        );

      case "testResults":
        if (!testJobData || testJobData.jobId === undefined) {
          console.error('TestJobData is missing or jobId is undefined:', testJobData);
          // Fallback to orders view if testJobData is invalid
          setCurrentView("orders");
          return null;
        }
        return (
          <TestModelResults
            jobId={testJobData.jobId}
            searchMarking={testJobData.searchMarking}
            onBack={handleBackFromTestResults}
            onComplete={handleCompleteTestModel}
          />
        );

      case "prototypeUpload":
        return (
          <PrototypeUpload
            onBack={handleBackFromPrototypeUpload}
            onNext={handleNextFromPrototypeUpload}
          />
        );

      case "prototypeResults":
        if (!prototypeData || !prototypeData.prototypeName) {
          console.error('PrototypeData is missing or invalid:', prototypeData);
          // Fallback to orders view if prototypeData is invalid
          setCurrentView("orders");
          return null;
        }
        return (
          <PrototypeResults
            prototypeName={prototypeData.prototypeName}
            uploadResponse={prototypeData.uploadResponse}
            onBack={handleBackFromPrototypeResults}
            onComplete={handleCompletePrototype}
          />
        );

      default:
        console.error('Unknown view state:', currentView);
        // Fallback to orders view for unknown states
        setCurrentView("orders");
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {loading && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}
      
      {/* Debug info - remove in production */}
      {process.env.NODE_ENV === 'development' && (
        <div className="fixed top-4 right-4 bg-black/80 text-white p-2 rounded text-xs z-50">
          <div>View: {currentView}</div>
          <div>Order: {selectedOrderId || 'none'}</div>
          <div>TestJob: {testJobData?.jobId || 'none'}</div>
          <div>Prototype: {prototypeData?.prototypeName || 'none'}</div>
          <button 
            onClick={() => {
              setCurrentView("orders");
              setSelectedOrderId(null);
              setJobData(null);
              setTestJobData(null);
              setPrototypeData(null);
              localStorage.removeItem('afl-tools-ui-state');
              window.location.reload();
            }}
            className="bg-red-500 px-2 py-1 rounded mt-1 mr-1"
          >
            Emergency Reset
          </button>
          <button 
            onClick={() => {
              localStorage.removeItem('afl-tools-ui-state');
              window.location.reload();
            }}
            className="bg-orange-500 px-2 py-1 rounded mt-1"
          >
            Clear Storage
          </button>
        </div>
      )}
      
      {renderCurrentView()}
    </div>
  );
};

export default Index;