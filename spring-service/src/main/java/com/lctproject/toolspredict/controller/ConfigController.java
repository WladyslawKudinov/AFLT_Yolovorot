package com.lctproject.toolspredict.controller;


import com.lctproject.toolspredict.component.ConfidenceThresholdConfig;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;

@CrossOrigin
@RestController
@RequestMapping("/api/v1/config")
@Tag(name="Конфигурация", description = "API ToolsPredict")
public class ConfigController {
    private final ConfidenceThresholdConfig confidenceThresholdConfig;

    public ConfigController(ConfidenceThresholdConfig confidenceThresholdConfig) {
        this.confidenceThresholdConfig = confidenceThresholdConfig;
    }

    @GetMapping("/model/threshold")
    @Operation(summary = "Получить порог уверенности модели, выше которого инструмент принимается")
    public ResponseEntity<?> getModelThreshold() {
        return ResponseEntity.ok(confidenceThresholdConfig.getConfidenceThreshold());
    }

    @PostMapping("/model/threshold")
    @Operation(summary = "Установить порог уверенности модели, выше которого инструмент принимается. До 4 знаков после запятой.")
    public ResponseEntity<?> setModelThreshold(@RequestParam Double confidenceThresholdConfig) {
        if (confidenceThresholdConfig == null) {
            return ResponseEntity.badRequest().body("Порог не может быть пустым");
        }
        BigDecimal bd = BigDecimal.valueOf(confidenceThresholdConfig);
        if (bd.scale() > 4) {
            return ResponseEntity.badRequest().body("Значение должно иметь максимум четыре знака после запятой");
        }

        return ResponseEntity.ok("Порог успешно установлен: " + confidenceThresholdConfig);
    }

}
