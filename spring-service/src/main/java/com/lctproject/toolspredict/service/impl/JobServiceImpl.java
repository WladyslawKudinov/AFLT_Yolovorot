package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.ActionType;
import com.lctproject.toolspredict.dto.BucketType;
import com.lctproject.toolspredict.dto.JobStatus;
import com.lctproject.toolspredict.model.*;
import com.lctproject.toolspredict.repository.*;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.MetricsService;
import com.lctproject.toolspredict.service.MinioFileService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class JobServiceImpl implements JobService {
    private final ProcessingJobsRepository processingJobsRepository;
    private final OrderRepository orderRepository;
    private final ClassificationResultRepository classificationResultRepository;
    private final MinioFileService minioFileService;
    private final AccountingRepository accountingRepository;
    private final MetricsService metricsService;
    private final RetrainingSampleRepository retrainingSampleRepository;

    @Override
    public Job createJob(UUID orderId, ActionType actionType) {
        Order order = orderRepository.findById(orderId).orElse(null);
        if (order == null) throw new NullPointerException("Заказ не найден.");
        if (actionType == ActionType.TOOLS_RETURN &&
                accountingRepository.findByOrderAndActionType(order, ActionType.TOOLS_ISSUANCE.toString()) == null)
            throw new IllegalArgumentException("Сдача невозможна - отсутствует выдача.");
        if (accountingRepository.countByOrder(order) >= 2) {
            throw new RuntimeException("Невозможно создать job к текущему заказу - уже существуют 2 job'а, открывающий и закрывающий");
        }
        if (actionType == ActionType.TOOLS_ISSUANCE &&
                accountingRepository.findByOrderAndActionType(order, ActionType.TOOLS_ISSUANCE.toString()) != null)
            throw new IllegalArgumentException("В базе уже есть Job выдачи для этого заказа.");

        log.info("Создание job {} для Order с id={}", actionType.toString(), order.getId());
        Job job = new Job()
                .setStatus("Предобработка")
                .setCreateDate(LocalDateTime.now())
                .setLastModified(LocalDateTime.now());
        job = processingJobsRepository.save(job);

        Accounting accounting = new Accounting()
                .setActionType(actionType.toString())
                .setJob(job)
                .setOrder(order)
                .setCreateDate(LocalDateTime.now());
        accountingRepository.save(accounting);
        return job;

    }

    @Override
    public Job getJob(Long jobId) {
        Job job = processingJobsRepository.findById(jobId).orElse(null);
        if (job == null) throw new NoSuchElementException("Job не найден.");
        return job;
    }

    @Override
    public void updateStatus(Long jobId, JobStatus status) {
        Job job = getJob(jobId);
        job.setStatus(status.toString());
        log.info("Job updated status: {}", job.getStatus());
        job = processingJobsRepository.save(job);
        if (job.getStatus().equals("FINISHED")) {
            if (accountingRepository.existsByJob(job)) {
                LocalDateTime now = LocalDateTime.now();
                metricsService.recordSessionDuration(Duration.between(job.getCreateDate(), now).getSeconds());
            }

            if (retrainingSampleRepository.existsByJob(jobId)) {
                metricsService.counter("session.with.reports.total").increment();
            }
        }

    }

    @Override
    public Page<Accounting> getPage(String query, int page, int size) {
        if (query == null) query = "";
        int pageSize = Math.min(Math.max(size, 1), 50);
        Pageable pageable = PageRequest.of(page, pageSize, Sort.by("createDate").descending());
        return accountingRepository.getPage(query, pageable);
    }

    @Override
    public void deleteJob(Long jobId) {
        if (getJob(jobId) == null) return;
        minioFileService.deleteAllFromJob(getJob(jobId));
        processingJobsRepository.deleteById(jobId);
    }

    @Override
    public List<MinioFile> getJobFiles(Long jobId, BucketType type) {
        Job job = getJob(jobId);
        return minioFileService.getMinioFiles(job, type);
    }

    @Override
    public List<ClassificationResult> getClassificationResults(Long jobId) {
        Job job = getJob(jobId);
        return classificationResultRepository.findByJob(job);
    }

    public List<Tool> getToolResults(Long jobId) {
        return null;
    }

    @Override
    public Job createTestJob() {
        Job job = new Job()
           .setStatus("TEST")
           .setCreateDate(LocalDateTime.now());
        return processingJobsRepository.save(job);
    }

    @Override
    public String getJobAction(Long jobId) {
        Job job;
        try {
            job = getJob(jobId);
        } catch (Exception ex) {
            return null;
        }
        Accounting accounting = accountingRepository.findByJob(job);
        if (accounting == null) return null;

        return accounting.getActionType();
    }
}
