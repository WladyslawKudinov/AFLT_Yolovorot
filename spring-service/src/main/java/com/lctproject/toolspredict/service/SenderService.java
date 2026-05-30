package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.*;
import org.springframework.http.ResponseEntity;

import java.util.List;

public interface SenderService {
    ResponseEntity<?> sendToRecognition(String minioKey);

    ResponseEntity<EnrichmentResponse> sendToEnrichment(EnrichmentRequest request);

    ResponseEntity<FrameResponse> sendVideoToCut(String minioKey);

    ResponseEntity<?> sendToReannotation(ReannotationDTO reannotationDTO);

    ResponseEntity<SegmentationResponse> sendToSegmentation(String minioKey);

    ResponseEntity<?> sendToPrototypeAddition(PrototypeAdditionDTO prototypeAdditionDataDtoList);
}
