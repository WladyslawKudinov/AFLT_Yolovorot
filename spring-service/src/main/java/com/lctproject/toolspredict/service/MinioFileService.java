package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.BucketType;
import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.MinioFile;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.NoSuchFileException;
import java.util.List;
import java.util.Map;

public interface MinioFileService {
    MinioFile create(String bucket, MultipartFile file, Job job);

    MinioFile get(String key, String bucketName);

    void deleteAllFromJob(Job job);

    List<MinioFile> getMinioFiles(Job job, BucketType type);

    MinioFileDto getById(Long minioFileId) throws NoSuchFileException;

    void deleteById(Long minioFileId) throws NoSuchFileException;

    MinioFile create(String bucketProcessed, String key, Job job);

    Map<String, List<String>> getPackages(Job job);

    List<String> createFromArchive(MultipartFile file, Job job);

    String getUrl(Long fileId);
}
