package com.lctproject.toolspredict.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class MinioFileDTO {
    private Long id;
    private String bucketName;
    private String filePath;
    private String fileName;
    private LocalDateTime createdAt;
}