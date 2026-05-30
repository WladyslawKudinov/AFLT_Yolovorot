package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "minio_file", schema = "public")
@Accessors(chain = true)
public class MinioFile {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @JoinColumn(name = "package_id")
    @ManyToOne(fetch = FetchType.LAZY)
    private Job packageId;
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    @Column(name = "bucket_name")
    private String bucketName;
    @Column(name = "file_path")
    private String filePath;
    @Column(name = "file_name")
    private String fileName;
}
