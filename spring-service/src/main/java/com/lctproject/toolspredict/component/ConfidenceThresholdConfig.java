package com.lctproject.toolspredict.component;

import lombok.Getter;
import lombok.Setter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Getter
@Setter
@Component
public class ConfidenceThresholdConfig {
    @Value("${model.confidence.threshold}")
    private double confidenceThreshold;
}
