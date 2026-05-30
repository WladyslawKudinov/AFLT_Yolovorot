package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.*;
import com.lctproject.toolspredict.dto.KeyRequest;
import com.lctproject.toolspredict.service.SenderService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.client.*;

import java.util.List;
import java.util.NoSuchElementException;

@Slf4j
@Service
public class SenderServiceImpl implements SenderService {
    private final RestTemplate restTemplate;
    @Value("${integrations.services.url.recognition}")
    private String preprocessServiceUrl;
    @Value("${integrations.services.url.enrichment}")
    private String inferenceServiceUrl;
    @Value("${integrations.services.url.support}")
    private String supportServiceUrl;

    public SenderServiceImpl() {
        this.restTemplate = new RestTemplate();
    }

    @Override
    public ResponseEntity<ClassificationResponseDTO> sendToRecognition(String minioKey) {
        try {
            log.info("Отправка ключа файла в сервис распознавания...");
            KeyRequest request = new KeyRequest(minioKey);
            ResponseEntity<ClassificationResponseDTO> response = restTemplate.postForEntity(preprocessServiceUrl + "/recognize", request, ClassificationResponseDTO.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Файл с ключем {} успешно обработан.", minioKey);
                return ResponseEntity.ok(response.getBody());
            } else {
                log.warn("Распознавание вернуло статус {}", response.getStatusCode());
                ClassificationResponseDTO errorBody = new ClassificationResponseDTO();
                errorBody.setStatus("error");
                return ResponseEntity.status(response.getStatusCode()).body(errorBody);
            }
        } catch (HttpClientErrorException.UnprocessableEntity e) {
            throw new NoSuchElementException("Модели не удалось распознать инструменты на фото.");
        } catch (ResourceAccessException e) {
            throw new RuntimeException("Ошибка: не удалось установить соединение с сервисом распознавания.");
        } catch (RestClientException e) {
            log.error("Ошибка отправки файла на распознавание: {}", e.getMessage());
            throw new RuntimeException("Неизвестная ошибка: " + e.getMessage());
        }
    }

    @Override
    public ResponseEntity<EnrichmentResponse> sendToEnrichment(EnrichmentRequest request) {
        try {
            ResponseEntity<EnrichmentResponse> response = restTemplate.postForEntity(inferenceServiceUrl + "/enrich",
                    request, EnrichmentResponse.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Успешно получены микроклассы от inference-сервиса");
                return response;
            } else {
                return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
            }
        } catch (ResourceAccessException e) {
            throw new RuntimeException("Ошибка: не удалось установить соединение с сервисом классификации");
        } catch (RestClientException e) {
            log.error("Ошибка отправки пакета ключей файлов на классификацию: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @Override
    public ResponseEntity<FrameResponse> sendVideoToCut(String minioKey) {
        try {
            log.info("Отправка ключа видеофайла на разделение по кадрам");
            KeyRequest request = new KeyRequest(minioKey);
            ResponseEntity<FrameResponse> response = restTemplate.postForEntity(preprocessServiceUrl + "/video/cut", request, FrameResponse.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Файл с ключем {} успешно разделен по кадрам.", minioKey);
                return ResponseEntity.ok(response.getBody());
            } else {
                log.warn("Распознавание видео вернула статус {}", response.getStatusCode());
                FrameResponse errorBody = new FrameResponse();
                errorBody.setStatus("error");
                errorBody.setMessage("Распознавание видео вернуло статус: " + response.getStatusCode());
                return ResponseEntity.status(response.getStatusCode()).body(errorBody);
            }
        } catch (ResourceAccessException  e) {
            throw new RuntimeException("Ошибка: не удалось установить соединение с сервисом распознавания");
        } catch (RestClientException e) {
            log.error("Ошибка отправки видеофайла на разеделение по кадрам: {}", e.getMessage());
            throw new RuntimeException("Неизвестная ошибка: " + e.getMessage());
        }
    }

    @Override
    public ResponseEntity<?> sendToReannotation(ReannotationDTO reannotationDTO) {
        try {
            ResponseEntity<?> response = restTemplate.postForEntity(supportServiceUrl + "/reannotation", reannotationDTO, ResponseEntity.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Успешно отправлен файл на переразметку");
            }
            return response;
        } catch (ResourceAccessException  e) {
            throw new RuntimeException("Не удалось установить соединение с support-service");
        } catch (RestClientException e) {
            log.error("Ошибка отправки данных на переразметку: {}", e.getMessage());
            throw new RuntimeException("Неизвестная ошибка: " + e.getMessage());
        }

    }

    @Override
    public ResponseEntity<SegmentationResponse> sendToSegmentation(String minioKey) {
        try {
            log.info("Отправка ключа прототипа на сегментацию...");
            KeyRequest request = new KeyRequest(minioKey);
            ResponseEntity<SegmentationResponse> response = restTemplate.postForEntity(preprocessServiceUrl + "/segmentation", request, SegmentationResponse.class);
            if (response.getStatusCode().is2xxSuccessful()) {
                log.info("Файл с ключем {} успешно обработан.", minioKey);
                return ResponseEntity.ok(response.getBody());
            } else {
                log.warn("Сегментация вернула статус {}", response.getStatusCode());
                SegmentationResponse errorBody = new SegmentationResponse();
                errorBody.setStatus("error");
                return ResponseEntity.status(response.getStatusCode()).body(errorBody);
            }
        } catch (HttpClientErrorException.UnprocessableEntity e) {
            throw new NoSuchElementException("Не удалось сегментировать объект на изображении");
        } catch (ResourceAccessException e) {
            throw new RuntimeException("Ошибка: не удалось установить соединение с сервисом распознавания.");
        } catch (RestClientException e) {
            throw new RuntimeException("Неизвестная ошибка: " + e.getMessage());
        }
    }

    @Override
    public ResponseEntity<?> sendToPrototypeAddition(PrototypeAdditionDTO prototypeAdditionDto) {
        try {
            log.info("Отправка прототипов в модель");
            ResponseEntity<String> response = restTemplate.postForEntity(preprocessServiceUrl + "/prototypes/add", prototypeAdditionDto, String.class);
            return response;
        } catch (HttpClientErrorException.UnprocessableEntity e) {
            throw new NoSuchElementException("Не удалось отправить прототип");
        } catch (ResourceAccessException e) {
            throw new RuntimeException("Ошибка: не удалось установить соединение с сервисом распознавания.");
        } catch (RestClientException e) {
            throw new RuntimeException("Неизвестная ошибка: " + e.getMessage());
        }
    }


}
