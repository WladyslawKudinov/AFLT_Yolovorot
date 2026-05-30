package com.lctproject.toolspredict.controller;
import com.lctproject.toolspredict.dto.ActionType;
import com.lctproject.toolspredict.dto.BucketType;
import com.lctproject.toolspredict.dto.JobStatus;
import com.lctproject.toolspredict.service.ComparsionService;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.ManageJobsService;
import com.lctproject.toolspredict.service.MetricsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.NoSuchElementException;
import java.util.UUID;

@CrossOrigin
@RestController
@RequestMapping("/api/v1/jobs")
@Tag(name="Учёт инструментов при выдаче и приёме", description = "API ToolsPredict")
public class JobContoller {
    private final ManageJobsService manageJobsService;
    private final ComparsionService comparsionService;
    private final JobService jobService;
    private final MetricsService metricsService;

    @Autowired
    public JobContoller(ManageJobsService manageJobsService, ComparsionService comparsionService, JobService jobService, MetricsService metricsService) {
        this.manageJobsService = manageJobsService;
        this.comparsionService = comparsionService;
        this.jobService = jobService;
        this.metricsService = metricsService;
    }

    @PostMapping(value = "/{jobId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Загрузка файла в job")
    public ResponseEntity<?> uploadFile(@Parameter(description = "Фото/Видео для обработки и построения прогноза")
                                             @RequestParam("file") MultipartFile file,
                                             @Parameter(description = "id процесса")
                                             @PathVariable Long jobId,
                                             @Parameter(description = "Стоит ли выполнять поиск маркировок? Внимание: время распознавания сильно увеличится.")
                                            @RequestParam(value = "searchMarking", defaultValue = "false") boolean searchMarking) {
        try {
            String result = metricsService.getImageDurationTimer().record(() ->
                    manageJobsService.processFile(file, jobId, searchMarking)
            );
            return ResponseEntity.ok(result);
        } catch (NoSuchElementException ex) {
            return new ResponseEntity<>("Модели не удалось распознать инструменты на фото.", HttpStatus.UNPROCESSABLE_ENTITY);
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping
    @Operation(summary = "Создание Job. Необходимо указание orderId и типа взаимодействия")
    public ResponseEntity<?> createJob(@RequestParam(value = "orderId", required = true) UUID orderId,
                                       @RequestParam(value = "actionType",required = true) ActionType actionType) {
        try {
            return ResponseEntity.ok(jobService.createJob(orderId, actionType).getId());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping(value = "/{jobId}")
    @Operation(summary = "Вывести информацию о процессе обработки")
    public ResponseEntity<?> getJobInfo(@Parameter(description = "ID операции")
                                             @PathVariable Long jobId) {
        return ResponseEntity.ok(jobService.getJob(jobId));
    }

    @GetMapping
    @Operation(summary = "Вывести страницу процессов")
    public ResponseEntity<?> getJobPage(@Parameter(description = "Фильтрация")
                                        @RequestParam(value = "query", required = false) String query,
                                        @Parameter(description = "Номер страницы")
                                        @RequestParam(name = "page", defaultValue = "0") int page,
                                        @Parameter(description = "Размер страницы")
                                        @RequestParam(name ="size", defaultValue = "10") int size) {
        return ResponseEntity.ok(jobService.getPage(query, page, size).getContent());
    }



    @DeleteMapping("/{jobId}")
    @Operation(summary = "Удалить процесс")
    public ResponseEntity<?> deleteJob(@PathVariable Long jobId) {
        jobService.deleteJob(jobId);
        return ResponseEntity.ok("Успешно удалён.");
    }

    @GetMapping("/{jobId}/files")
    @Operation(summary = "Вывести информацию обо всех файлах, привязанных к Job")
    public ResponseEntity<?> getFiles(@PathVariable Long jobId,
                                      @RequestParam("type") BucketType bucketType) {
        try {
            return ResponseEntity.ok(jobService.getJobFiles(jobId, bucketType));
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    @GetMapping("/{jobId}/results/classification")
    @Operation(summary = "Вывод результата классификации - выделения микроклассов")
    public ResponseEntity<?> getClassificationResults(@PathVariable Long jobId) {
        try {
            return ResponseEntity.ok(jobService.getClassificationResults(jobId));
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    @GetMapping("/{jobId}/results/compare")
    @Operation(summary = "Сравнение результата классификации с заказанным набором инструментов")
    public ResponseEntity<?> getCompareResults(@PathVariable Long jobId) {
        try {
            return comparsionService.compareResults(jobService.getJob(jobId));
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    @GetMapping("/{jobId}/results")
    @Operation(summary = "Вывод итогового результата распознавания инструментов")
    public ResponseEntity<?> getResults(@PathVariable Long jobId) {
        try {
            return ResponseEntity.ok(comparsionService.getMergedResults(jobId));
        } catch (Exception ex) {
            ex.printStackTrace();
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    @PostMapping("/{jobId}/status")
    @Operation(summary = "Обновить статус Job")
    public ResponseEntity<?> updateStatus(@PathVariable Long jobId, @RequestParam("jobStatus") JobStatus jobStatus,
                                          @RequestParam(required = false) Boolean isFull) {
        String action = jobService.getJobAction(jobId);
        if (action != null && jobStatus == JobStatus.FINISHED) {
            if (Boolean.TRUE.equals(isFull)) {
                metricsService.counter("toolkit.completed.total", "action", action).increment();
            }
            metricsService.counter("session.total", "action", action).increment();

        }
        jobService.updateStatus(jobId, jobStatus);
        return ResponseEntity.ok("ok");
    }

    @GetMapping("/{jobId}/status")
    @Operation(summary = "Узнать текущий статус Job")
    public ResponseEntity<?> getStatus(@PathVariable Long jobId) {
        return ResponseEntity.ok(jobService.getJob(jobId).getStatus());
    }

}
