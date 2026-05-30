package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.ActionType;
import com.lctproject.toolspredict.dto.BucketType;
import com.lctproject.toolspredict.dto.JobStatus;
import com.lctproject.toolspredict.model.*;
import org.springframework.data.domain.Page;

import java.util.List;
import java.util.UUID;

public interface JobService {

    Job createJob(UUID orderId, ActionType actionType);

    Job getJob(Long jobId);

    void updateStatus(Long jobId, JobStatus status);

    Page<Accounting> getPage(String query, int page, int size);

    void deleteJob(Long jobId);

    List<MinioFile> getJobFiles(Long jobId, BucketType type);

    List<ClassificationResult> getClassificationResults(Long jobId);

    Job createTestJob();

    String getJobAction(Long jobId);
}
