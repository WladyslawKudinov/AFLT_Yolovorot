package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.model.ClassificationResult;
import com.lctproject.toolspredict.model.Job;
import org.springframework.http.ResponseEntity;

import java.util.List;

public interface ComparsionService {
    ResponseEntity<?> compareResults(Job job);

    List<Long> getMergedToolList(Long jobId);

    List<ClassificationResult> getMergedResults(Long jobId);
}
