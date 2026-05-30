package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.service.MetricsService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.DistributionSummary;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class MetricsServiceImpl implements MetricsService {
    private final DistributionSummary sessionDurationSummary;
    private final DistributionSummary modelConfidenceSummary;
    private final MeterRegistry meterRegistry;
    private final Timer imageDurationTimer;

    public MetricsServiceImpl(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.sessionDurationSummary =  DistributionSummary.builder("job.session.seconds")
                .description("Session duration in seconds")
                .baseUnit("seconds")
                .publishPercentileHistogram()
                .publishPercentiles(0.5, 0.9, 0.95)
                .register(meterRegistry);

        this.modelConfidenceSummary = DistributionSummary.builder("app.model.confidence")
                .description("Уверенность предсказаний модели (0.0 - 1.0)")
                .baseUnit("confidence")
                .publishPercentiles(0.5, 0.9, 0.99)
                .register(meterRegistry);

        this.imageDurationTimer = Timer.builder("image.processing.duration")
                .description("Длительность обработки изображения")
                .register(meterRegistry);

    }

    @Override
    public void recordSessionDuration(double seconds) {
        sessionDurationSummary.record(seconds);
    }
    @Override
    public void recordModelConfidence(double confidence) {
        modelConfidenceSummary.record(confidence);
    }

    @Override
    public Timer getImageDurationTimer() {
        return imageDurationTimer;
    }

    @Override
    public Counter counter(String name, String... tags) {
        return Counter.builder(name).tags(tags).register(meterRegistry);
    }
}
