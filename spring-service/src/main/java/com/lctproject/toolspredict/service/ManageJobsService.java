package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.ClassificationResponseDTO;
import com.lctproject.toolspredict.model.Job;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;

public interface ManageJobsService {

    String processFile(MultipartFile file, Long jobId, boolean searchMarking);

    String addRawFile(MultipartFile file, Long jobId);

    ClassificationResponseDTO sendToRecognition(String minioKey, Long jobId);

    String sendToEnrichment(Long jobId, String rawFileKey, String processedFileKey);

    void testModels(Job testJob, MultipartFile file, boolean searchMarking);
}
