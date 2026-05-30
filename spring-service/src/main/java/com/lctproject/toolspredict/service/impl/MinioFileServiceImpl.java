package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.BucketType;
import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.MinioFile;
import com.lctproject.toolspredict.repository.MinioFileRepository;
import com.lctproject.toolspredict.service.MinioFileService;
import com.lctproject.toolspredict.service.MinioService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;


import java.time.LocalDateTime;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;


@Service
@RequiredArgsConstructor
@Slf4j
public class MinioFileServiceImpl implements MinioFileService {
    private final MinioFileRepository minioFileRepository;
    private final MinioService minioService;
    @Value("${integrations.minio.bucket.raw}")
    private String bucketRaw;
    @Value("${integrations.minio.bucket.processed}")
    private String bucketProcessed;
    @Value("${integrations.minio.limit}")
    private int FILE_LIMIT;


    @Override
    public MinioFile create(String bucket, MultipartFile file, Job job) {
        if (minioFileRepository.countByPackageIdAndBucketName(job, bucketRaw) >= FILE_LIMIT) {
            throw new IndexOutOfBoundsException("Превышен лимит файлов для Job. Чтобы добавить новый файл, удалите предыдущие.");
        }
        String key = minioService.uploadFile(file, bucketRaw, String.valueOf(job.getId()));
        log.info("Create minio file from Multipart {}", key);
        String[] parts = key.split("/");
        MinioFile minioFile = get(key,bucket);
        if (minioFile == null) {
            minioFile = new MinioFile()
                    .setBucketName(bucket)
                    .setFilePath(key)
                    .setFileName(parts[parts.length-1])
                    .setCreatedAt(LocalDateTime.now())
                    .setPackageId(job);
        } else {
            List<MinioFile> oldProcessedFiles = minioFileRepository.findByFilePathContainingAndBucketName(key.substring(0, key.lastIndexOf('.')), bucketProcessed);
            oldProcessedFiles.forEach(oldFile -> {
                minioService.deleteFile(oldFile.getBucketName(), oldFile.getFilePath());
                minioFileRepository.delete(oldFile);
            });
            minioFile.setCreatedAt(LocalDateTime.now());
        }
        return minioFileRepository.save(minioFile);
    }

    @Override
    public MinioFile get(String key, String bucketName) {
        return minioFileRepository.findByFilePathAndBucketName(key, bucketName);
    }

    @Override
    public void deleteAllFromJob(Job job) {
        List<MinioFile> minioFileList = minioFileRepository.findByPackageId(job);
        minioFileList.forEach(minioFile -> {
            minioService.deleteFile(minioFile.getBucketName(), minioFile.getFilePath());
            minioFileRepository.delete(minioFile);
        });
    }
    @Override
    public List<MinioFile> getMinioFiles(Job job, BucketType type) {
        switch (type) {
            case RAW -> {
                return minioFileRepository.findByPackageIdAndBucketName(job, bucketRaw);
            }
            case PROCESSED -> {
                return minioFileRepository.findByPackageIdAndBucketName(job, bucketProcessed);
            }
            default -> {
                return minioFileRepository.findByPackageId(job);
            }
        }

    }

    @Override
    public MinioFileDto getById(Long minioFileId) throws NoSuchFileException {
        MinioFile minioFile = minioFileRepository.findById(minioFileId).orElse(null);
        if (minioFile == null) throw new NoSuchFileException("Файл не найден");
        return minioService.getFile(minioFile.getBucketName(), minioFile.getFilePath());
    }

    @Override
    public void deleteById(Long minioFileId) throws NoSuchFileException {
        MinioFile minioFile = minioFileRepository.findById(minioFileId).orElse(null);
        if (minioFile == null) throw new NoSuchFileException("Файл не найден");
        minioService.deleteFile(minioFile.getBucketName(), minioFile.getFilePath());
        minioFileRepository.delete(minioFile);
    }

    @Override
    public MinioFile create(String bucket, String key, Job job) {
        log.info("Create minio file {}", key);
        String[] parts = key.split("/");
        MinioFile minioFile = get(key,bucket);
        if (minioFile == null) {
            minioFile = new MinioFile()
                    .setBucketName(bucket)
                    .setFilePath(key)
                    .setFileName(parts[parts.length-1])
                    .setCreatedAt(LocalDateTime.now())
                    .setPackageId(job);
        } else {
            if (bucket.equals(bucketRaw)) {
                List<MinioFile> oldProcessedFiles = minioFileRepository
                        .findByFilePathContainingAndBucketName(key.substring(0, key.lastIndexOf('.')), bucketProcessed);
                oldProcessedFiles.forEach(oldFile -> {
                    minioService.deleteFile(oldFile.getBucketName(), oldFile.getFilePath());
                    minioFileRepository.delete(oldFile);
                });
            }
            minioFile.setCreatedAt(LocalDateTime.now());
        }
        return minioFileRepository.save(minioFile);
    }

    @Override
    public Map<String, List<String>> getPackages(Job job) {
        List<MinioFile> rawFiles = minioFileRepository.findByPackageIdAndBucketName(job, bucketRaw);
        Map<String, List<String>> packages = new HashMap<>();
        rawFiles.forEach(rawFile -> {
            if (rawFile != null && !rawFile.getFileName().endsWith(".mp4")){
                List<String> processedFiles = minioFileRepository.findByPackageIdAndBucketNameAndFilePathContaining(job,
                                bucketProcessed, rawFile.getFilePath().substring(0, rawFile.getFilePath().lastIndexOf('.')))
                        .stream()
                        .map(MinioFile::getFilePath)
                        .toList();
                packages.put(rawFile.getFilePath(), processedFiles);
            }
        });
        return packages;
    }

    @Override
    public List<String> createFromArchive(MultipartFile file, Job job) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Архив пустой");
        }
        List<String> result = new ArrayList<>();

        try (ZipInputStream zis = new ZipInputStream(file.getInputStream())) {
            ZipEntry entry;
            int savedCount = 0;

            while ((entry = zis.getNextEntry()) != null) {
                if (!entry.isDirectory()) {
                    String fileName = entry.getName();

                    if (fileName.startsWith("__MACOSX/") || fileName.endsWith(".DS_Store")) {
                        log.debug("Пропущен служебный файл macOS: " + fileName);
                        zis.closeEntry();
                        continue;
                    }

                    log.info("Загружаем: " + fileName);
                    MinioFile minioFile = get(job.getId() + "/" + fileName,bucketRaw);
                    if (minioFile == null) {
                        minioFile = new MinioFile()
                                .setBucketName(bucketRaw)
                                .setFileName(fileName)
                                .setFilePath(job.getId() + "/" + fileName)
                                .setPackageId(job);
                    }
                    minioFileRepository.save(minioFile.setCreatedAt(LocalDateTime.now()));
                    minioService.uploadFileFromStream(fileName, zis, entry.getSize(), job.getId());
                    result.add(minioFile.getFilePath());
                    zis.closeEntry();

                    if (savedCount >= 100) {
                        log.warn("Достигнут лимит 100 файлов, оставшиеся файлы будут пропущены.");
                        break;
                    }
                }
            }
        } catch (IOException e) {
            throw new RuntimeException("Ошибка при обработке архива", e);
        }
        return result;
    }

    @Override
    public String getUrl(Long fileId) {
        MinioFile minioFile = minioFileRepository.findById(fileId).orElseThrow();
        return minioService.generatePresignedUrl(minioFile.getBucketName(), minioFile.getFilePath(), 900);
    }

}
