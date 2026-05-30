package com.lctproject.toolspredict.controller;

import com.lctproject.toolspredict.dto.AcceptedPrototypeImagesDto;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.service.JobService;
import com.lctproject.toolspredict.service.RetrainingService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.NoSuchFileException;
import java.util.NoSuchElementException;

@CrossOrigin
@RestController
@RequestMapping("/api/v1/support")
@Tag(name="Поддержка модели", description = "API ToolsPredict")
public class SupportController {
    private final RetrainingService retrainingService;
    private final JobService jobService;

    public SupportController(RetrainingService retrainingService, JobService jobService) {
        this.retrainingService = retrainingService;
        this.jobService = jobService;
    }

    @PostMapping("/reannotations/{resultId}/retrain")
    @Operation(summary = "Отправка изображения с неудовлетворительным результатом на доразметку и переобучение модели")
    public ResponseEntity<?> addToRetraining(@Parameter(description = "ID результата")
                                             @PathVariable Long resultId) {
        retrainingService.addRetrainingSample(resultId, "LABELING");
        return ResponseEntity.ok("OK");
    }

    @GetMapping("/reannotations/{imageId}/status")
    @Operation(summary = "Узнать отправлено ли изображение на доразметку по id файла")
    public ResponseEntity<Boolean> isImageSentToReannotation(@Parameter(description = "ID изображения")
                                                             @PathVariable Long imageId) {
        try {
            return ResponseEntity.ok(retrainingService.isImageSentToReannotation(imageId));
        } catch (NoSuchFileException e) {
            return ResponseEntity.notFound().build();
        }
    }


    @PostMapping(value = "/model/prototypes", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Operation(summary = "Создать прототип для дообучения модели")
    public ResponseEntity<?> createPrototype(@Parameter(description = "Загрузка архива")
                                             @RequestParam("file") MultipartFile file,
                                             @Parameter(description = "Название прототипа")
                                             @RequestParam String name) {
        return retrainingService.createPrototype(file, name);
    }

    @PostMapping("/model/prototypes/send")
    @Operation(summary = "Отправить прототип на дообучение модели")
    public ResponseEntity<?> sendPrototype(@RequestBody AcceptedPrototypeImagesDto acceptedPrototypeImagesDto) {
        retrainingService.sendPrototypeData(acceptedPrototypeImagesDto);
        return ResponseEntity.ok("Успех!");
    }

    @GetMapping(value = "/model/prototypes/{name}/images")
    public ResponseEntity<?> getPrototypeImages(@PathVariable String name) {
        return ResponseEntity.ok(retrainingService.getPrototypeImages(name));

    }


}
