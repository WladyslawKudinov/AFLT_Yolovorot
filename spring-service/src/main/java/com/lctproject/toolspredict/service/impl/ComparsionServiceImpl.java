package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.component.ConfidenceThresholdConfig;
import com.lctproject.toolspredict.dto.JobStatus;
import com.lctproject.toolspredict.model.ClassificationResult;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.ToolOrderItem;
import com.lctproject.toolspredict.repository.AccountingRepository;
import com.lctproject.toolspredict.repository.ClassificationResultRepository;
import com.lctproject.toolspredict.repository.ToolOrderItemRepository;
import com.lctproject.toolspredict.service.ComparsionService;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.OrderService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class ComparsionServiceImpl implements ComparsionService {
    private final ClassificationResultRepository classificationResultRepository;
    private final ToolOrderItemRepository toolOrderItemRepository;
    private final AccountingRepository accountingRepository;
    private final JobService jobService;
    private final OrderService orderService;
    private final ConfidenceThresholdConfig confidenceThresholdConfig;

    @Override
    public ResponseEntity<?> compareResults(Job job) {
        Order order = accountingRepository.findByJob(job).getOrder();
        List<ToolOrderItem> orderedItems = toolOrderItemRepository.findByOrder(order);

        List<ClassificationResult> results = getMergedResults(job.getId());

        List<Long> predictedToolList = results.stream()
                .map(cr -> cr.getTool().getId())
                .sorted()
                .toList();

        List<Long> orderedToolList = orderedItems.stream()
                .map(item -> item.getTool().getId())
                .sorted()
                .toList();

        boolean isEqual = predictedToolList.equals(orderedToolList);

        if (isEqual) {
            return ResponseEntity.ok("Полное совпадение с заказанным набором.");
        } else {
            if (!job.getStatus().equals("TEST")) jobService.updateStatus(job.getId(), JobStatus.MANUAL_MAPPING_IS_REQUIRED);
            return ResponseEntity.ok("Обнаружены расхождения. Требуется ручная разметка.");
        }
    }

    @Override
    @Deprecated
    public List<Long> getMergedToolList(Long jobId) {
        return classificationResultRepository.findMaxToolCountPerJob(jobId).stream()
                .flatMap(row -> {
                    Long toolId = ((Number) row[0]).longValue();
                    int count = ((Number) row[1]).intValue();
                    return Collections.nCopies(count, toolId).stream();
                })
                .toList();
    }

    public Map<Long, List<ClassificationResult>> getResultsGroupedByOriginalFile(Job job) {
        return classificationResultRepository.findAllByJobIdOrderByToolId(job.getId()).stream()
                .collect(Collectors.groupingBy(
                        cr -> cr.getOriginalFile().getId(),
                        LinkedHashMap::new,
                        Collectors.collectingAndThen(
                                Collectors.<ClassificationResult>toList(),
                                list -> list.stream()
                                        .sorted(Comparator.comparing(cr -> cr.getTool().getId()))
                                        .toList()
                        )
                ));
    }

    public List<ClassificationResult> mergeByMaxOccurrences(Map<Long, List<ClassificationResult>> groupedByOriginalFile) {
        Map<Long, List<ClassificationResult>> resultMap = new HashMap<>();
        double confidenceThreshold = confidenceThresholdConfig.getConfidenceThreshold();
        for (List<ClassificationResult> list : groupedByOriginalFile.values()) {
            log.info("Processing list: {}", list);

            Map<Long, List<ClassificationResult>> groupedByTool = list.stream()
                    .collect(Collectors.groupingBy(cr -> cr.getTool().getId()));

            for (Map.Entry<Long, List<ClassificationResult>> entry : groupedByTool.entrySet()) {
                long toolId = entry.getKey();
                List<ClassificationResult> items = entry.getValue();

                if (!resultMap.containsKey(toolId)) {
                    resultMap.put(toolId, items);
                } else {
                    List<ClassificationResult> existingItems = resultMap.get(toolId);

                    if (items.size() > existingItems.size()) {
                        resultMap.put(toolId, items);
                    } else if (items.size() == existingItems.size()) {
                        long newHighConfidenceCount = items.stream()
                                .filter(cr -> cr.getConfidence() >= confidenceThreshold)
                                .count();
                        long existingHighConfidenceCount = existingItems.stream()
                                .filter(cr -> cr.getConfidence() >= confidenceThreshold)
                                .count();

                        if (newHighConfidenceCount > existingHighConfidenceCount) {
                            resultMap.put(toolId, items);
                        }
                    }
                }
            }
        }

        return resultMap.values().stream()
                .flatMap(List::stream)
                .sorted(Comparator.comparing(cr -> cr.getTool().getId()))
                .toList();
    }

    @Override
    public List<ClassificationResult> getMergedResults(Long jobId) {
        Map<Long, List<ClassificationResult>> groupedByOriginalFile =
                getResultsGroupedByOriginalFile(jobService.getJob(jobId));
        return mergeByMaxOccurrences(groupedByOriginalFile);
    }
}