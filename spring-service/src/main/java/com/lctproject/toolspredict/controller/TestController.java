package com.lctproject.toolspredict.controller;

import com.lctproject.toolspredict.dto.JobStatus;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.ManageJobsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;


@CrossOrigin
@RestController
@RequestMapping("/api/v1/test")
@Tag(name="Тест модели", description = "API ToolsPredict")
public class TestController {
    private final ManageJobsService manageJobsService;
    private final JobService jobService;

    public TestController(ManageJobsService manageJobsService, JobService jobService) {
        this.manageJobsService = manageJobsService;
        this.jobService = jobService;
    }

    @PostMapping(value = "/model", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Загрузка архива фотографий для теста модели")
    public ResponseEntity<?> uploadFile(@Parameter(description = "Загрузка архива")
                                        @RequestParam("file") MultipartFile file,
                                        @Parameter(description = "Стоит ли выполнять поиск маркировок? Внимание: время распознавания сильно увеличится.")
                                        @RequestParam(value = "searchMarking", defaultValue = "false") boolean searchMarking) {
        Job job = jobService.createTestJob();

        try {
            manageJobsService.testModels(job, file, searchMarking);
            return ResponseEntity.accepted().body(job.getId());
        } catch (Exception e) {
            jobService.updateStatus(job.getId(), JobStatus.FINISHED);
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }


}
