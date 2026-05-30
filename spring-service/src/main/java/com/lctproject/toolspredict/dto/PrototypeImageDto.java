package com.lctproject.toolspredict.dto;

import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import com.lctproject.toolspredict.model.MinioFile;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Accessors(chain = true)
public class PrototypeImageDto {
    private Long id;
    private MinioFileDTO image;
    private MinioFileDTO segmentationFile;
    private LocalDateTime createDate;
}