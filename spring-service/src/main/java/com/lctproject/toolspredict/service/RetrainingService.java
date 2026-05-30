package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.AcceptedPrototypeImagesDto;
import com.lctproject.toolspredict.dto.PrototypeImageDto;
import com.lctproject.toolspredict.dto.SegmentationPrototypeResult;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.PrototypeImage;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.NoSuchFileException;
import java.util.List;

public interface RetrainingService {
    void sendPrototypeData(AcceptedPrototypeImagesDto acceptedPrototypeImagesDto);

    ResponseEntity<SegmentationPrototypeResult> createPrototype(MultipartFile file, String name);

    List<PrototypeImageDto> getPrototypeImages(String name);

    void addRetrainingSample(Long classificationResultId, String status);

    Boolean isImageSentToReannotation(Long minioFileId) throws NoSuchFileException;
}
