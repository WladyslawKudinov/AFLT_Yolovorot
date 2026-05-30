package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.*;
import com.lctproject.toolspredict.model.*;
import com.lctproject.toolspredict.repository.*;
import com.lctproject.toolspredict.service.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.NoSuchFileException;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

@Slf4j
@Service
@RequiredArgsConstructor
public class RetrainingServiceImpl implements RetrainingService {
    private final RetrainingSampleRepository retrainingSampleRepository;
    private final ClassificationResultRepository classificationResultRepository;
    private final ToolService toolService;
    private final SenderService senderService;
    private final MinioFileService minioFileService;
    private final PrototypeRepository prototypeRepository;
    private final PrototypeImageRepository prototypeImageRepository;
    private final JobService jobService;
    private final MetricsService metricsService;
    @Value("${integrations.minio.bucket.raw}")
    private String bucketRaw;
    @Value("${integrations.minio.bucket.processed}")
    private String bucketProcessed;

    @Override
    public void sendPrototypeData(AcceptedPrototypeImagesDto acceptedPrototypeImagesDto) {
        log.info("ID ПРОТОТИПА: {}", acceptedPrototypeImagesDto.getPrototypeId());
        List<PrototypeAdditionDataDto> result = new ArrayList<>();
        Prototype prototype = prototypeRepository.findById(acceptedPrototypeImagesDto.getPrototypeId()).orElseThrow();
        acceptedPrototypeImagesDto.getImagesToDelete().forEach((id) ->{
            try {
                minioFileService.deleteById(id);
            } catch (Exception ex) {
                log.error(ex.getMessage());
            }
        });

        getPrototypeImages(prototype.getName()).forEach((obj) -> {
            result.add(new PrototypeAdditionDataDto()
                    .setImageKey(obj.getImage().getFilePath())
                    .setSegmentationFileKey(obj.getSegmentationFile().getFilePath()));
                }
        );
        try {
            PrototypeAdditionDTO prototypeAdditionDTO = new PrototypeAdditionDTO()
                    .setClassName(prototype.getName())
                    .setPrototypes(result);
            ResponseEntity<?> response = senderService.sendToPrototypeAddition(prototypeAdditionDTO);
            if (response.getStatusCode().is2xxSuccessful()) {
                toolService.addTool(prototype.getName());
                jobService.updateStatus(prototype.getId(), JobStatus.FINISHED);
            }
        } catch (Exception ex) {
            log.error(ex.getMessage());
        }

    }

    @Override
    public ResponseEntity<SegmentationPrototypeResult> createPrototype(MultipartFile file, String name) {
        Prototype unsavedPrototype = prototypeRepository.findByName(name).orElseGet(() ->
             new Prototype()
                .setName(name)
                .setJob(jobService.createTestJob())
                .setCreateDate(LocalDateTime.now())
        );

        long jobId = unsavedPrototype.getJob().getId();
        List<String> savedKeys = minioFileService.createFromArchive(file, unsavedPrototype.getJob());

        Prototype prototype = prototypeRepository.save(unsavedPrototype);
        HashMap<Long, SegmentationResponse> result = new HashMap<>();
        savedKeys.forEach((key) -> {
            MinioFile image = minioFileService.get(key, bucketRaw);
            PrototypeImage prototypeImage = prototypeImageRepository.findByPrototypeAndImage(prototype, image)
                    .orElseGet(() -> new PrototypeImage()
                            .setPrototype(prototype)
                            .setImage(image)).setCreateDate(LocalDateTime.now());

            try {
                SegmentationResponse response = senderService.sendToSegmentation(key).getBody();
                prototypeImage.setSegmentationFile(response != null ? minioFileService.create(bucketProcessed, response.getKey(), prototype.getJob()): null);
                result.put(image.getId(), response);
            } catch (Exception ex) {
                log.error("Ошибка сегментации прототипа: {}", ex.getMessage());
            }
            prototypeImageRepository.save(prototypeImage);
        });

        return ResponseEntity.ok(new SegmentationPrototypeResult().setPrototypeId(prototype.getId()).setResult(result));
    }

    @Override
    public List<PrototypeImageDto> getPrototypeImages(String name) {
        List<PrototypeImage> images = prototypeImageRepository.getByPrototypeName(name);
        return images.stream()
                .map(img -> new PrototypeImageDto(
                        img.getId(),
                        new MinioFileDTO(
                                img.getImage().getId(),
                                img.getImage().getBucketName(),
                                img.getImage().getFilePath(),
                                img.getImage().getFileName(),
                                img.getImage().getCreatedAt()
                        ),
                        img.getSegmentationFile() != null ?
                        new MinioFileDTO(
                                img.getSegmentationFile().getId(),
                                img.getSegmentationFile().getBucketName(),
                                img.getSegmentationFile().getFilePath(),
                                img.getSegmentationFile().getFileName(),
                                img.getSegmentationFile().getCreatedAt()
                        ): null,
                        img.getCreateDate()
                ))
                .toList();
    }

    @Override
    public void addRetrainingSample(Long classificationResultId, String status) {
        RetrainingSample retrainingSample = logRetrainingSample(classificationResultId, status);
        if (status.equals("LABELING")) {
            try {
                HashMap<String, String> annotations = new HashMap<>();
                classificationResultRepository.findByOriginalFile(retrainingSample.getImage())
                        .forEach(result -> {
                            annotations.put(result.getTool().getName(), result.getFile().getFilePath());
                        });

                ReannotationDTO reannotationDTO = new ReannotationDTO()
                        .setImageKey(retrainingSample.getImage().getFilePath())
                        .setAnnotations(annotations);

                senderService.sendToReannotation(reannotationDTO);
            } catch (RuntimeException e) {
                e.printStackTrace();
                log.error("Не удалось отправить изображение на доразметку.");
                retrainingSample.setStatus("SENDING_ERROR");
            } catch (Exception e) {
                log.error("Неизвестная ошибка: {}", e.getMessage());
                retrainingSample.setStatus("ERROR");
            }
        }
        retrainingSampleRepository.save(retrainingSample);
    }

    private RetrainingSample logRetrainingSample(Long classificationResultId, String status) {
        ClassificationResult classificationResult = getClassificationResult(classificationResultId);
        metricsService.counter("tool.report.count", "instrument", classificationResult.getTool().getName()).increment();

        retrainingSampleRepository
                .findByImage(classificationResult.getOriginalFile()).ifPresent(obj ->
                {throw new IllegalArgumentException("Данное изображение уже отправлено на переразметку");});

        RetrainingSample newRetrainingSample = new RetrainingSample()
                .setClassificationResult(classificationResult)
                .setImage(classificationResult.getOriginalFile())
                .setStatus(status)
                .setCreateDate(LocalDateTime.now());
        return retrainingSampleRepository.save(newRetrainingSample);
    }


    public ClassificationResult getClassificationResult(Long classificationResultId) {
        return classificationResultRepository.findById(classificationResultId).orElseThrow();
    }

    public RetrainingSample getRetrainingSample(Long retrainingSampleId) {
        return retrainingSampleRepository.findById(retrainingSampleId).orElseThrow();
    }

    @Override
    public Boolean isImageSentToReannotation(Long minioFileId) throws NoSuchFileException {
        return retrainingSampleRepository
                .findByImage(minioFileService.get(minioFileService.getById(minioFileId).getFileName(), bucketRaw)).isPresent();

    }



}
