package com.lctproject.toolspredict.dto;

import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.RequiredArgsConstructor;
import lombok.experimental.Accessors;

import java.util.Map;

@Data
@NoArgsConstructor
@Accessors(chain = true)
public class ReannotationDTO {
    private String imageKey;
    private Map<String, String> annotations;
}
