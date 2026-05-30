package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.*;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.service.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;

@Service
@RequiredArgsConstructor
@Slf4j
public class ManageJobsServiceImpl implements ManageJobsService {
    private final JobService jobService;
    private final MinioFileService minioFileService;
    private final ComparsionService comparsionService;
    private final MinioService minioService;
    private final SenderService senderService;
    private final LogService logService;
    @Value("${integrations.minio.bucket.raw}")
    private String bucketRaw;
    @Value("${integrations.minio.bucket.processed}")
    private String bucketProcessed;

    @Override
    public String processFile(MultipartFile file, Long jobId, boolean searchMarking) {
        String result;
        String rawFileKey = addRawFile(file, jobId);
        if (rawFileKey.substring(rawFileKey.lastIndexOf('.')+1).equals("mp4")) {
            int countSaved = 0;
            StringBuilder builder = new StringBuilder();
            FrameResponse response = getFrames(rawFileKey, jobId);
            for (Map.Entry<String, String> entry: response.getResults().entrySet()) {
                try {
                    ClassificationResponseDTO classificationResponseDTO = sendToRecognition(entry.getValue(), jobId);
                    handleClassificationResponse(classificationResponseDTO, jobId, entry.getValue(), searchMarking);
                    countSaved++;
                    builder.append(entry.getValue()).append(": ").append("OK").append("\n");
                } catch (NoSuchElementException e) {
                    log.error("Ошибка: модели не удалось распознать инструменты в кадре {}", entry.getValue());
                    builder.append(entry.getValue()).append(": ").append(e.getMessage()).append("\n");
                } catch (Exception ex) {
                    log.error("Ошибка отправки кадра на предобработку: {}", ex.getMessage());
                    builder.append(entry.getValue()).append(": ").append(ex.getMessage()).append("\n");
                }
            }
            if (countSaved == 0) throw new RuntimeException(builder.toString());
            return builder.toString();
        } else {
            ClassificationResponseDTO response = sendToRecognition(rawFileKey, jobId);
            handleClassificationResponse(response, jobId, rawFileKey, searchMarking);
            return "OK";
        }
    }

    private void handleClassificationResponse(ClassificationResponseDTO response, Long jobId, String rawFileKey, Boolean searchMarking) {
        for (Map.Entry<String,ClassificationResultDTO> entry: response.getResults().entrySet()) {
            ClassificationResultDTO classificationResultDTO = entry.getValue().setRawFileKey(rawFileKey);
            String marking = null;
            if (searchMarking) marking = sendToEnrichment(jobId, rawFileKey, entry.getKey());
            logService.logClassificationResult(jobId, classificationResultDTO.setMarking(marking), entry.getKey());
        }
    }


    @Override
    public String addRawFile(MultipartFile file, Long jobId) {
        String fileName = file.getOriginalFilename();
        log.info(String.valueOf(jobId));
        log.info(fileName);
        switch (Objects.requireNonNull(fileName).substring(fileName.lastIndexOf('.')+1).toLowerCase()) {
            case "png", "mp4", "jpg", "jpeg" -> {
                Job job = jobService.getJob(jobId);
                return minioFileService.create(bucketRaw, file, job).getFilePath();
            }
            default -> throw new IllegalArgumentException("Unsupported file type: " + fileName
                    .substring(fileName.lastIndexOf('.')+1));
        }

    }

    @Override
    public ClassificationResponseDTO sendToRecognition(String minioKey, Long jobId) {
        Job job = jobService.getJob(jobId);
        try {
            ResponseEntity<?> response = senderService.sendToRecognition(minioKey);
            ClassificationResponseDTO classificationResponseDTO = (ClassificationResponseDTO) response.getBody();
            if (classificationResponseDTO == null) throw new NullPointerException("No recognition");
            for (Map.Entry<String, ClassificationResultDTO> entry : classificationResponseDTO.getResults().entrySet()){
                minioFileService.create(bucketProcessed, entry.getKey(), job);
            }
            return classificationResponseDTO;
        } catch (NoSuchElementException e) {
            throw new NoSuchElementException(e.getMessage());
        }
    }

    public FrameResponse getFrames(String minioKey, Long jobId) {
        ResponseEntity<?> response = senderService.sendVideoToCut(minioKey);
        FrameResponse frameResponse = (FrameResponse) response.getBody();
        if (frameResponse == null) throw new NullPointerException("FrameResponse is null");
        Job job = jobService.getJob(jobId);
        for (Map.Entry<String, String> entry : frameResponse.getResults().entrySet()){
            minioFileService.create(bucketRaw, entry.getValue(), job);
        }
        return frameResponse;
    }

    @Override
    public String sendToEnrichment(Long jobId, String rawFileKey, String processedFileKey) {
        Job job = jobService.getJob(jobId);
        EnrichmentRequest enrichmentRequest = new EnrichmentRequest()
                .setProcessedFileKey(processedFileKey)
                .setRawFileKey(rawFileKey);
        try {
            EnrichmentResponse response = (EnrichmentResponse) senderService.sendToEnrichment(enrichmentRequest).getBody();
            return response.getMarking();
        } catch (Exception ex) {
            log.error("Ошибка определения маркировки: {}", ex.getMessage());
        }
        return null;
    }

    @Async
    @Override
    public void testModels(Job job, MultipartFile file, boolean searchMarking) {
        long jobId = job.getId();
        List<String> savedKeys = minioFileService.createFromArchive(file, job);
        for (String rawFileKey : savedKeys) {
            try {
                ClassificationResponseDTO response = sendToRecognition(rawFileKey, jobId);
                handleClassificationResponse(response, jobId, rawFileKey, searchMarking);
            } catch (Exception ex) {
                log.error("Ошибка обработки файла {}: {}", rawFileKey, ex.getMessage());
            }
        }
        jobService.updateStatus(job.getId(), JobStatus.FINISHED);
    }



}
