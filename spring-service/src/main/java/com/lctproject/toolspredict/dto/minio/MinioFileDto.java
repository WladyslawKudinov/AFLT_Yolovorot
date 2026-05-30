package com.lctproject.toolspredict.dto.minio;

import lombok.AllArgsConstructor;
import lombok.Data;
import org.springframework.core.io.InputStreamResource;

@Data
@AllArgsConstructor
public class MinioFileDto {
    private String fileName;
    private String contentType;
    private InputStreamResource resource;
}
