package com.lctproject.toolspredict.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class ClassificationResponseDTO {
    private String status;
    private Map<String, ClassificationResultDTO> results;
}