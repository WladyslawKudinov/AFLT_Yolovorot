package com.lctproject.toolspredict.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

import java.util.Map;

@Data
@AllArgsConstructor
@NoArgsConstructor
@Accessors(chain = true)
public class SegmentationPrototypeResult {
    Long prototypeId;
    Map<Long, SegmentationResponse> result;
}
