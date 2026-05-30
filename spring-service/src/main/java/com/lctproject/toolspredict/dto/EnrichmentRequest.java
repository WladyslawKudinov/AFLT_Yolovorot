package com.lctproject.toolspredict.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Accessors(chain = true)
public class EnrichmentRequest {
    @JsonProperty("raw_file_key")
    private String rawFileKey;
    @JsonProperty("processed_file_key")
    private String processedFileKey;
}
