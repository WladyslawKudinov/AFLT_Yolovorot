package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.MinioFile;
import com.lctproject.toolspredict.model.Job;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

@Repository
public interface MinioFileRepository extends JpaRepository<MinioFile,Long> {

    @Modifying
    @Transactional
    void delete(MinioFile minioFile);

    MinioFile findByFilePathAndBucketName(String filePath, String bucketName);

    MinioFile findByFilePath(String s);

    List<MinioFile> findByPackageId(Job job);

    int countByPackageIdAndBucketName(Job job, String bucketRaw);

    List<MinioFile> findByPackageIdAndBucketName(Job job, String bucketRaw);

    List<MinioFile> findByFilePathContaining(String substring);

    List<MinioFile> findByFilePathContainingAndBucketName(String substring, String bucketProcessed);

    List<MinioFile> findByPackageIdAndBucketNameAndFilePathContaining(Job job, String bucketProcessed, String rawFilePath);
}
