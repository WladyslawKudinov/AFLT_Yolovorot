package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.minio.MinioFileDto;
import com.lctproject.toolspredict.service.MinioService;
import io.minio.*;
import io.minio.errors.*;
import io.minio.http.Method;
import io.minio.messages.Item;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.InputStreamResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.security.InvalidKeyException;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipInputStream;

@Slf4j
@Service
public class MinioServiceImpl implements MinioService {
    @Value("${integrations.minio.bucket.raw}")
    private String bucketRaw;
    @Value("${integrations.minio.bucket.processed}")
    private String bucketProcessed;
    @Value("${minio.endpoint}")
    private String minioEndpoint;
    @Value("${minio.access.key}")
    private String minioAccessKey;
    @Value("${minio.secret.key}")
    private String minioSecretKey;
    private MinioClient client;

    @PostConstruct
    public void init() {
        String endpoint = System.getenv("MINIO_ENDPOINT");
        String accessKey = System.getenv("MINIO_ROOT_USER");
        String secretKey = System.getenv("MINIO_ROOT_PASSWORD");

        log.info("MINIO_ENDPOINT: '{}'", endpoint);
        log.info("MINIO_ROOT_USER: '{}'", accessKey);
        log.info("MINIO_ROOT_PASSWORD: '{}'", secretKey != null ? "***" : "null");

       try {
           client = new MinioClient(
                   minioEndpoint,
                   minioAccessKey,
                   minioSecretKey
           );
           createBucketIfNotExists(bucketRaw);
           createBucketIfNotExists(bucketProcessed);
       } catch (Exception e) {
           log.error("Ошибка создания бакетов в MinioService: {}", e.getMessage());
       }

    }

    private void createBucketIfNotExists(String bucketName) throws ServerException, InvalidBucketNameException, InsufficientDataException,
            ErrorResponseException, IOException, NoSuchAlgorithmException,
            InvalidKeyException, InvalidResponseException, XmlParserException, InternalException, RegionConflictException {
        if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucketName).build())) {
            client.makeBucket(MakeBucketArgs.builder()
                    .bucket(bucketName)
                    .build());
        }
    }
    @Override
    public String uploadFile(MultipartFile file, String bucketName, String packageId) {
        try {
            String path = packageId + "/" + file.getOriginalFilename();
            client.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucketName)
                            .object(path)
                            .stream(file.getInputStream(), file.getSize(), -1)
                            .contentType(file.getContentType())
                            .build()
            );

            return path;
        } catch (Exception ex) {
            log.error("Ошибка загрузки файла в MinIO: {]", ex.getMessage());
        }
        return null;
    }

    @Override
    public void deleteFile(String bucketName, String key) {
        try {
            client.removeObject(
                    RemoveObjectArgs.builder()
                            .bucket(bucketName)
                            .object(key)
                            .build()
            );
        } catch (Exception ex) {
            log.error("Ошибка при удалении файла в MinIO: {}", ex.getMessage());
        }

    }

    @Override
    public String rearrangeFile(String key, Long jobId) {
        String[] parts = key.split("/");
        try (InputStream stream = client.getObject(
                GetObjectArgs.builder()
                        .bucket(bucketRaw)
                        .object(parts[1])
                        .build()
        )) {
            var stat = client.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucketRaw)
                            .object(parts[1])
                            .build()
            );
            String contentType = stat.contentType();
            client.putObject(
                    PutObjectArgs.builder()
                            .bucket(bucketRaw)
                            .object(String.valueOf(jobId) + "/" + parts[1])
                            .stream(stream, stat.length(), -1)
                            .contentType(contentType)
                            .build()
            );
            return key;
        } catch  (Exception ex) {
            log.error("Ошибка перемещения файла в MinIO: {}", ex.getMessage());
        }
        return null;
    }

    @Override
    public MinioFileDto getFile(String bucketName, String key) {
        try {
            var stat = client.statObject(
                    StatObjectArgs.builder()
                            .bucket(bucketName)
                            .object(key)
                            .build()
            );

            InputStream stream = client.getObject(
                    GetObjectArgs.builder()
                            .bucket(bucketName)
                            .object(key)
                            .build()
            );

            return new MinioFileDto(
                    key,
                    stat.contentType(),
                    new InputStreamResource(stream)
            );

        } catch (Exception e) {
            log.error("Ошибка скачивания файла из MinIO: {}", e.getMessage(), e);
            return null;
        }
    }

    @Override
    public void uploadFileFromStream(String fileName, ZipInputStream zis, long size, Long jobId) {
        try {
            String path = jobId + "/" + fileName;

            PutObjectArgs.Builder builder = PutObjectArgs.builder()
                    .bucket(bucketRaw)
                    .object(path)
                    .contentType("application/octet-stream");

            if (size > 0) {
                builder.stream(zis, size, -1);
            } else {
                builder.stream(zis, -1, 10 * 1024 * 1024);
            }

            client.putObject(builder.build());

            log.info("Файл успешно загружен: {}", path);
        } catch (Exception ex) {
            log.error("Ошибка загрузки файла в MinIO: {}", ex.getMessage(), ex);
        }
    }

    @Override
    public List<Item> listObjects(String bucketName, String prefix) {
        List<Item> items = new ArrayList<>();
        try {
            Iterable<Result<Item>> results = client.listObjects(
                    ListObjectsArgs.builder()
                            .bucket(bucketName)
                            .prefix(prefix)
                            .recursive(true)
                            .build()
            );

            for (Result<Item> result : results) {
                items.add(result.get());
            }

        } catch (Exception e) {
            throw new RuntimeException("Ошибка при получении списка объектов из MinIO", e);
        }

        return items;
    }

    @Override
    public String generatePresignedUrl(String bucketName, String objectName, int expirySeconds) {
        try {
            return client.getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .bucket(bucketName)
                            .object(objectName)
                            .method(Method.GET)
                            .expiry(expirySeconds)
                            .build()
            );
        } catch (Exception e) {
            log.error("Ошибка при генерации presigned ссылки: {}", e.getMessage(), e);
            return null;
        }
    }

}
