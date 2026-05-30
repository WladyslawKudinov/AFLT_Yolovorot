package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import io.minio.messages.Item;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.zip.ZipInputStream;

public interface MinioService {
    String uploadFile(MultipartFile file, String bucketName, String packageId);

    void deleteFile(String bucketName, String key);

    String rearrangeFile(String key, Long jobId);

    MinioFileDto getFile(String bucketName, String key);

    void uploadFileFromStream(String fileName, ZipInputStream zis, long size, Long jobId);

    List<Item> listObjects(String bucketName, String prefix);

    String generatePresignedUrl(String bucketName, String objectName, int expirySeconds);
}
