package com.lctproject.toolspredict.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class AcceptedPrototypeImagesDto {
    private Long prototypeId;
    private List<Long> acceptedImagesId;
    private List<Long> imagesToDelete;
}
