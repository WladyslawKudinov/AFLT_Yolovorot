package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.ClassificationResponseDTO;
import com.lctproject.toolspredict.dto.ClassificationResultDTO;
import com.lctproject.toolspredict.dto.EnrichmentResponse;
import com.lctproject.toolspredict.model.ClassificationResult;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.repository.*;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.LogService;
import com.lctproject.toolspredict.service.MetricsService;
import com.lctproject.toolspredict.service.MinioFileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class LogServiceImpl implements LogService {
    private final ToolRepository toolRepository;
    private final MinioFileRepository minioFileRepository;
    private final MinioFileService minioFileService;
    private final JobService jobService;
    private final ClassificationResultRepository classificationResultRepository;
    private final MetricsService metricsService;
    @Value("${integrations.minio.bucket.raw}")
    private String bucketRaw;
    @Value("${integrations.minio.bucket.processed}")
    private String bucketProcessed;

    @Override
    public void logClassificationResult(Long jobId, ClassificationResultDTO classificationResultDTO, String processedFileKey) {
            log.info("{}, {}", classificationResultDTO.getMicroClass(), classificationResultDTO.getRawFileKey());
            log.info("Microclass {}",classificationResultDTO.getMicroClass());
            ClassificationResult classificationResult = new ClassificationResult()
                    .setJob(jobService.getJob(jobId))
                    .setFile(minioFileRepository.findByFilePathAndBucketName(processedFileKey, bucketProcessed))
                    .setOriginalFile(minioFileRepository.findByFilePathAndBucketName(classificationResultDTO.getRawFileKey(), bucketRaw))
                    .setCreatedAt(LocalDateTime.now())
                    .setConfidence(classificationResultDTO.getConfidence())
                    .setTool(toolRepository.findByTrimmedName(classificationResultDTO.getMicroClass()))
                    .setMarking(classificationResultDTO.getMarking());
            classificationResultRepository.save(classificationResult);
            metricsService.recordModelConfidence(classificationResultDTO.getConfidence());
    }





}
