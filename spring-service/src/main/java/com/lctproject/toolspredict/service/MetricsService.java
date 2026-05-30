package com.lctproject.toolspredict.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Timer;

public interface MetricsService {
    void recordSessionDuration(double seconds);

    void recordModelConfidence(double confidence);

    Timer getImageDurationTimer();

    Counter counter(String name, String... tags);
}
