package com.lctproject.toolspredict.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class FrameResponse {
    private String status;
    private Map<String, String> results;
    private List<String> size;
    private String message;
}
