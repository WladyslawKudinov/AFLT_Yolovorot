const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || '/api/v1';
console.log('[API] Initialized with base URL:', API_BASE_URL);

// Кэш для API запросов (оптимизация)
const apiCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 минут

// Функция для очистки кэша (при смене заказа)
export const clearApiCache = () => {
  console.log('🧹 Clearing API cache');
  apiCache.clear();
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public originalError?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiEmployee {
  id: number;
  name: string;
  surname: string;
  patronymic: string;
}

export interface ApiOrder {
  id: string;
  employee: ApiEmployee;
  description: string;
  createdAt: string;
  lastModified: string;
  workorder?: string; // Номер из ТОиР
}

export interface ApiOrderResponse {
  content: ApiOrder[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface ApiJobInfo {
  id: number;
  status: string;
  createDate: string;
  lastModified: string;
}

export interface ApiJob {
  id: number;
  job: ApiJobInfo;
  actionType: 'TOOLS_ISSUANCE' | 'TOOLS_RETURN';
  order: ApiOrder;
  createDate: string;
}

export interface ApiJobsResponse {
  content: ApiJob[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface ApiToolInfo {
  id: number;
  name: string;
  partNumber: string;
  description?: string;
}

export interface ApiToolsResponse {
  content: ApiToolInfo[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface ApiToolReference {
  id: number;
  toolName: string;
}

export interface ApiTool {
  id: number;
  name: string;
}

export interface ApiOrderTool {
  id: number;
  order: ApiOrder;
  tool: ApiTool;
  marking?: string;
}

export interface ApiCreateStandardOrderRequest {
  orderId: string;
  employeeId: number;
  tools: Array<{
    id: number;
    marking: string;
  }>;
  description: string;
}

export interface ApiOrderToolsResponse {
  content: ApiOrderTool[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface ApiPackageId {
  id: number;
  status: string;
  createDate: string;
  lastModified: string;
}

export interface ApiFileInfo {
  id: number;
  packageId: ApiPackageId;
  createdAt: string;
  bucketName: string;
  filePath: string;
  fileName: string;
}

export interface ApiRecognitionResult {
  toolId: number;
  toolName: string;
  partNumber: string;
  required: number;
  found: number;
  status: 'found' | 'not_found' | 'not_expected';
  confidence?: number;
}

// New interfaces for recognition results with image data
export interface ApiRecognitionResultDetailed {
  id: number;
  job: ApiJobInfo;
  tool: ApiTool;
  file: ApiFileInfo;
  originalFile: ApiFileInfo;
  confidence: number;
  createdAt: string;
  marking: string | null;
}

export interface ApiPreprocessData {
  source_image_key: string;
  object_key: string;
  class_id: number;
  macro_class: string;
  confidence: number;
  score?: number; // Альтернативное поле для confidence
  bbox: [number, number, number, number]; // [x1, y1, x2, y2]
  mask?: number[][]; // [[x, y], [x, y], ...] polygon points for segmentation
  timestamp: string;
}

export interface AcceptedPrototypeImagesDto {
  prototypeId: number;
  acceptedImagesId: number[];
  imagesToDelete: number[];
}

class ApiService {
  private async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
    console.log('[API] makeRequest - URL:', url, 'method:', options.method || 'GET');
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    console.log('[API] makeRequest - response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      
      // Специфичные сообщения для разных статусов
      switch (response.status) {
        case 400:
          throw new ApiError(`Сервис распознавания недоступен: ${errorText}`, 400, errorText);
        case 422:
          throw new ApiError(`Не удалось распознать инструменты на фото: ${errorText}`, 422, errorText);
        case 404:
          throw new ApiError(`Ресурс не найден: ${errorText}`, 404, errorText);
        case 500:
          throw new ApiError(`Внутренняя ошибка сервера: ${errorText}`, 500, errorText);
        default:
          throw new ApiError(`HTTP ${response.status}: ${errorText}`, response.status, errorText);
      }
    }
    
    return response;
  }

  // Orders
  async getOrders(page = 0, size = 10): Promise<ApiOrder[]> {
    console.log('[API] getOrders called - page:', page, 'size:', size);
    const url = `${API_BASE_URL}/orders?page=${page}&size=${size}`;
    console.log('[API] Fetching from URL:', url);
    const response = await this.makeRequest(url);
    console.log('[API] getOrders response received, status:', response.status);
    const data = await response.json();
    console.log('[API] getOrders data:', data);
    return data;
  }

  async getOrder(orderId: string) {
    const response = await this.makeRequest(`${API_BASE_URL}/orders/${orderId}`);
    return response.json();
  }

  async getOrderTools(orderId: string, page = 0, size = 20): Promise<ApiOrderTool[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/orders/${orderId}/tools?page=${page}&size=${size}`);
    return response.json();
  }

  async createOrder(orderData: ApiOrder): Promise<string> {
    const response = await this.makeRequest(`${API_BASE_URL}/orders`, {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
    return response.text();
  }

  // Функция для генерации UUID (совместимость с старыми браузерами)
  private generateUUID(): string {
    // Проверяем поддержку crypto.randomUUID
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    // Fallback для старых браузеров
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async createStandardOrder(): Promise<void> {
    // Генерируем случайный UUID
    const orderId = this.generateUUID();
    
    // Генерируем случайный employeeId от 1 до 3
    const employeeId = Math.floor(Math.random() * 3) + 1;
    
    // Создаем массив из 11 инструментов с id от 1 до 11 и реальными маркировками
    const realMarkings = [
      'AT-288293-1',  // 1 - Отвертка «-»
      'AT-288293-2',  // 2 - Отвертка «+»
      'AT-288293-3',  // 3 - Отвертка на смещенный крест
      'AT-288293-10', // 4 - Коловорот
      'AT-288293-6',  // 5 - Пассатижи контровочные
      'AT-288293-9',  // 6 - Пассатижи
      'AT-288293-7',  // 7 - Шэрница
      'AT-288293-4',  // 8 - Разводной ключ
      'AT-3870',      // 9 - Открывашка для банок с маслом
      'AT-288293-5',  // 10 - Ключ рожковый накидной ¾
      'AT-288293-11'  // 11 - Дополнительный инструмент
    ];
    
    const tools = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1,
      marking: realMarkings[index]
    }));

    const orderData: ApiCreateStandardOrderRequest = {
      orderId,
      employeeId,
      tools,
      description: "Стандартный заказ"
    };

    await this.makeRequest(`${API_BASE_URL}/orders`, {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  }

  // Jobs
  async getJobs(query?: string, page = 0, size = 10): Promise<ApiJob[]> {
    const url = new URL(`${API_BASE_URL}/jobs`, window.location.origin);
    if (query) url.searchParams.set('query', query);
    url.searchParams.set('page', page.toString());
    url.searchParams.set('size', size.toString());
    
    const response = await this.makeRequest(url.toString());
    return response.json();
  }

  async getJobsByOrderId(orderId: string): Promise<ApiJob[]> {
    const jobs = await this.getJobs(orderId);
    return jobs || [];
  }

  async createJob(orderId: string, actionType: 'TOOLS_ISSUANCE' | 'TOOLS_RETURN'): Promise<void> {
    await this.makeRequest(`${API_BASE_URL}/jobs?orderId=${orderId}&actionType=${actionType}`, {
      method: 'POST',
    });
    // backend may return empty body; creation is asynchronous
  }

  async getJob(jobId: number) {
    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`);
    if (!response.ok) throw new Error('Failed to fetch job');
    return response.json();
  }

  async uploadFile(jobId: number, file: File, searchMarking: boolean = false) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('searchMarking', searchMarking.toString());

    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/files`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      
      // Специфичные сообщения для разных статусов при загрузке файлов
      switch (response.status) {
        case 400:
          // Проверяем, является ли это ошибкой превышения лимита файлов
          if (errorText.includes('Превышен лимит файлов для Job') || 
              errorText.includes('Чтобы добавить новый файл, удалите предыдущие')) {
            throw new ApiError('Превышен лимит файлов для Job. Чтобы добавить новый файл, удалите предыдущие.', 400, errorText);
          }
          throw new ApiError(`Сервис распознавания недоступен: ${errorText}`, 400, errorText);
        case 422:
          throw new ApiError(`Не удалось распознать инструменты на фото: ${errorText}`, 422, errorText);
        case 404:
          throw new ApiError(`Задача обработки не найдена: ${errorText}`, 404, errorText);
        case 413:
          throw new ApiError(`Файл слишком большой: ${errorText}`, 413, errorText);
          case 415:
            throw new ApiError(`Неподдерживаемый формат файла. Выберите JPG, PNG или MP4: ${errorText}`, 415, errorText);
        case 500:
          throw new ApiError(`Внутренняя ошибка сервера: ${errorText}`, 500, errorText);
        default:
          throw new ApiError(`HTTP ${response.status}: ${errorText}`, response.status, errorText);
      }
    }
    
    // Для видео файлов может вернуться текстовый ответ с информацией о кадрах
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/plain')) {
      return await response.text();
    }
    
    // Для обычных файлов - void
    return undefined as unknown as void;
  }

  async getJobFiles(jobId: number, type: 'RAW' | 'PROCESSED' | 'ALL' = 'ALL'): Promise<ApiFileInfo[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/files?type=${type}`);
    return response.json();
  }

  async deleteFile(fileId: number): Promise<void> {
    const response = await this.makeRequest(`${API_BASE_URL}/files/${fileId}`, {
      method: 'DELETE',
    });
    // DELETE request might not return content, so we don't call .json()
  }

  async startClassification(jobId: number): Promise<void> {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/classify`, {
      method: 'POST',
    });
    // Backend may return empty body on success
    return undefined;
  }

  async getCompareResults(jobId: number) {
    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/results/compare`);
    if (!response.ok) throw new Error('Failed to fetch compare results');
    return response.json();
  }

  async getClassificationResults(jobId: number) {
    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/results/classification`);
    if (!response.ok) throw new Error('Failed to fetch classification results');
    return response.json();
  }

  async getResults(jobId: number) {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/results`);
    return response.json();
  }

  // Job status
  async getJobStatus(jobId: number) {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/status`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const text = (await response.text()).trim();
    // Попробуем распарсить JSON из текста, если это случайно JSON
    try {
      const maybeJson = JSON.parse(text);
      return maybeJson;
    } catch {
      // Вернем простой текст статуса, например: STARTED/FINISHED/TEST
      return text;
    }
  }


  async updateJobStatus(jobId: number, jobStatus: 'STARTED' | 'FINISHED' | 'MANUAL_MAPPING_IS_REQUIRED' | 'VALIDATION', isFull?: boolean) {
    const url = new URL(`${API_BASE_URL}/jobs/${jobId}/status`, window.location.origin);
    url.searchParams.set('jobStatus', jobStatus);
    
    // Добавляем isFull только если он передан (для метрик полных наборов)
    if (isFull !== undefined) {
      url.searchParams.set('isFull', isFull.toString());
    }
    
    const response = await this.makeRequest(url.toString(), { method: 'POST' });
    return response.json();
  }

  // Model configuration
  async getModelThreshold(): Promise<number> {
    const response = await this.makeRequest(`${API_BASE_URL}/config/model/threshold`);
    return response.json();
  }

  async setModelThreshold(threshold: number): Promise<void> {
    const url = new URL(`${API_BASE_URL}/config/model/threshold`, window.location.origin);
    url.searchParams.set('confidenceThresholdConfig', threshold.toString());
    await this.makeRequest(url.toString(), { method: 'POST' });
  }

  // Tools
  async getTools(): Promise<ApiToolsResponse> {
    const response = await this.makeRequest(`${API_BASE_URL}/tools`);
    return response.json();
  }

  async getTool(toolId: number) {
    const response = await fetch(`${API_BASE_URL}/tools/${toolId}`);
    if (!response.ok) throw new Error('Failed to fetch tool');
    return response.json();
  }

  // MinIO methods for image and data retrieval using existing file endpoints
  async getFileFromMinIO(fileId: number): Promise<string> {
    // Use existing endpoint to get file from MinIO by ID
    const response = await this.makeRequest(`${API_BASE_URL}/files/${fileId}`);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async getPreprocessDataFromMinIO(fileId: number): Promise<ApiPreprocessData> {
    // Get preprocess JSON data from MinIO using file ID
    const cacheKey = `preprocess_${fileId}`;
    
    // Проверяем кэш
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    
    const response = await this.makeRequest(`${API_BASE_URL}/files/${fileId}`);
    const data = await response.json();
    
    // Сохраняем в кэш
    apiCache.set(cacheKey, { data, timestamp: Date.now() });
    
    return data;
  }

  // Enhanced results method that returns detailed data
  async getDetailedResults(jobId: number): Promise<ApiRecognitionResultDetailed[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/results`);
    return response.json();
  }

  // Get job results (combined)
  async getJobResults(jobId: number): Promise<any[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/results`);
    return response.json();
  }

  // Get job classification results (per image)
  async getJobClassificationResults(jobId: number): Promise<any[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/jobs/${jobId}/results/classification`);
    return response.json();
  }

  // Test model method for uploading archive and creating TEST job
  async testModel(file: File, searchMarking: boolean = false): Promise<{ jobId: number }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('searchMarking', searchMarking.toString());

    const response = await fetch(`${API_BASE_URL}/test/model`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      
      // Специфичные сообщения для разных статусов при загрузке архива
      switch (response.status) {
        case 400:
          throw new ApiError(`Сервис тестирования недоступен: ${errorText}`, 400, errorText);
        case 422:
          throw new ApiError(`Не удалось обработать архив: ${errorText}`, 422, errorText);
        case 404:
          throw new ApiError(`Сервис тестирования не найден: ${errorText}`, 404, errorText);
        case 413:
          throw new ApiError(`Архив слишком большой: ${errorText}`, 413, errorText);
        case 415:
          throw new ApiError(`Неподдерживаемый формат архива. Выберите ZIP архив: ${errorText}`, 415, errorText);
        case 500:
          throw new ApiError(`Внутренняя ошибка сервера: ${errorText}`, 500, errorText);
        default:
          throw new ApiError(`HTTP ${response.status}: ${errorText}`, response.status, errorText);
      }
    }
    
    // Ответ может быть: number, string, или JSON-объект с полем jobId/id
    const contentType = response.headers.get('content-type') || '';
    let jobId: number | null = null;
    try {
      if (contentType.includes('application/json')) {
        const result = await response.json();
        console.log('testModel API JSON response:', result);
        if (typeof result === 'number') {
          jobId = result;
        } else if (result && typeof result.jobId === 'number') {
          jobId = result.jobId;
        } else if (result && typeof result.id === 'number') {
          jobId = result.id;
        } else if (typeof result === 'string' && /^\d+$/.test(result)) {
          jobId = parseInt(result, 10);
        }
      } else {
        const text = await response.text();
        console.log('testModel API text response:', text);
        const trimmed = (text || '').trim();
        // Может прийти как "17" или 17
        const numericMatch = trimmed.match(/\d+/);
        if (numericMatch) {
          jobId = parseInt(numericMatch[0], 10);
        }
      }
    } catch (e) {
      console.warn('Failed to parse testModel response, trying text fallback', e);
      try {
        const fallbackText = await response.text();
        const numericMatch = (fallbackText || '').trim().match(/\d+/);
        if (numericMatch) {
          jobId = parseInt(numericMatch[0], 10);
        }
      } catch {}
    }

    if (typeof jobId !== 'number' || Number.isNaN(jobId)) {
      throw new ApiError('Неверный формат ответа от сервера: ожидается идентификатор задачи', 500);
    }

    return { jobId };
  }

  // Reannotation support methods
  async checkImageReannotationStatus(imageId: number): Promise<boolean> {
    const response = await this.makeRequest(`${API_BASE_URL}/support/reannotations/${imageId}/status`);
    return response.json();
  }

  async sendResultToReannotation(resultId: number): Promise<void> {
    const response = await this.makeRequest(`${API_BASE_URL}/support/reannotations/${resultId}/retrain`, {
      method: 'POST',
    });
    // Backend may return object on success
    return undefined;
  }

  // Prototype support methods
  async createPrototype(name: string, file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/support/model/prototypes?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      
      switch (response.status) {
        case 400:
          throw new ApiError(`Некорректные данные: ${errorText}`, 400, errorText);
        case 415:
          throw new ApiError(`Неподдерживаемый формат архива. Выберите ZIP архив: ${errorText}`, 415, errorText);
        case 500:
          throw new ApiError(`Внутренняя ошибка сервера: ${errorText}`, 500, errorText);
        default:
          throw new ApiError(`HTTP ${response.status}: ${errorText}`, response.status, errorText);
      }
    }
    
    return response.json();
  }

  async getPrototypeImages(name: string): Promise<any[]> {
    const response = await this.makeRequest(`${API_BASE_URL}/support/model/prototypes/${encodeURIComponent(name)}/images`);
    return response.json();
  }

  async sendPrototype(dto: AcceptedPrototypeImagesDto): Promise<void> {
    const response = await this.makeRequest(`${API_BASE_URL}/support/model/prototypes/send`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    
    // Backend may return object on success
    return undefined;
  }
}

export const apiService = new ApiService();