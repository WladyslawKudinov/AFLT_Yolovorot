package com.lctproject.toolspredict.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ToolRequest {
    @NotNull
    @JsonProperty("id")
    private Long id;
    @JsonProperty("marking")
    private String marking;
}