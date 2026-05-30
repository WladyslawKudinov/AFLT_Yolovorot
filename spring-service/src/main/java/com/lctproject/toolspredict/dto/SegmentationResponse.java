package com.lctproject.toolspredict.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SegmentationResponse {
    private String status;
    private Double score;
    private List<Double> bbox;
    private List<List<Double>> mask;
    @JsonProperty("object_key")
    private String key;
}
