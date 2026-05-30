package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.ClassificationResponseDTO;
import com.lctproject.toolspredict.dto.ClassificationResultDTO;
import com.lctproject.toolspredict.dto.EnrichmentResponse;
import com.lctproject.toolspredict.model.Job;

public interface LogService {

    void logClassificationResult(Long jobId, ClassificationResultDTO classificationResultDTO, String rawFileKey);

}
