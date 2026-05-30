package com.lctproject.toolspredict.controller;

import com.lctproject.toolspredict.repository.ToolRepository;
import com.lctproject.toolspredict.service.ToolService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Path;
import java.util.UUID;
@CrossOrigin
@RestController
@RequestMapping("/api/v1/tools")
@Tag(name="Управление инструментами", description = "API ToolsPredict")
public class ToolController {

    private final ToolService toolService;

    public ToolController(ToolService toolService) {
        this.toolService = toolService;
    }

    @GetMapping("/{toolId}")
    @Operation(summary = "Вывести информацию об инструменте")
    public ResponseEntity<?> get(@PathVariable Long toolId) {
        return ResponseEntity.ok(toolService.getTool(toolId));
    }

    @GetMapping
    @Operation(summary = "Вывести все инструменты")
    public ResponseEntity<?> getAll() {
        return ResponseEntity.ok(toolService.getAllTools());
    }

    @PostMapping("/{name}")
    @Operation(summary = "Добавить инструмент в базу [ДЛЯ ОТЛАДКИ]")
    public ResponseEntity<?> addTool(@PathVariable String name) {
        toolService.addTool(name);
        return ResponseEntity.ok("");
    }

    @DeleteMapping("/{name}")
    @Operation(summary = "Удалить инструмент из базы [ДЛЯ ОТЛАДКИ]")
    public ResponseEntity<?> removeTool(@PathVariable String name) {
        toolService.deleteTool(name);
        return ResponseEntity.ok("ОК");
    }

}
