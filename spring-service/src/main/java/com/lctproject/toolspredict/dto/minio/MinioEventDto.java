package com.lctproject.toolspredict.dto.minio;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
public class MinioEventDto {
    @JsonProperty("EventName")
    private String eventName;
    @JsonProperty("Key")
    private String key;
}
