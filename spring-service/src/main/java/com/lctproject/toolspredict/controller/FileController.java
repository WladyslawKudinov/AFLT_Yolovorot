package com.lctproject.toolspredict.controller;

import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import com.lctproject.toolspredict.service.MinioFileService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@CrossOrigin
@RestController
@RequestMapping("/api/v1/files")
@Tag(name="Управление файлами", description = "API ToolsPredict")
public class FileController {
    private final MinioFileService minioFileService;

    public FileController(MinioFileService minioFileService) {
        this.minioFileService = minioFileService;
    }

    @GetMapping("/{fileId}")
    @Operation(summary = "Получить файл из MinIO по ID")
    public ResponseEntity<?> getFile(@PathVariable Long fileId) {
        try {
            MinioFileDto file = minioFileService.getById(fileId);
            String fileName = file.getFileName();
            String encodedFileName = URLEncoder.encode(fileName, StandardCharsets.UTF_8)
                    .replace("+", "%20");
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(file.getContentType()))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename*=UTF-8''" + encodedFileName)
                    .body(file.getResource());
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    @DeleteMapping("/{fileId}")
    @Operation(summary = "Удалить файл из MiniO")
    public ResponseEntity<?> deleteFile(@Parameter(description = "id_файла")
                           @PathVariable Long fileId) {
        try {
            minioFileService.deleteById(fileId);
            return ResponseEntity.ok().build();
        } catch (Exception ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }
}
