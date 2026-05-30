package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "classification_result", schema = "public")
@Accessors(chain = true)
public class ClassificationResult {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne
    @JoinColumn(name = "job_id")
    private Job job;
    @ManyToOne
    @JoinColumn(name = "tool_id")
    private Tool tool;
    @OneToOne
    @JoinColumn(name = "file_id")
    private MinioFile file;
    @ManyToOne
    @JoinColumn(name = "original_file_id")
    private MinioFile originalFile;
    @Column(name = "confidence")
    private Double confidence;
    @Column(name = "created_at")
    private LocalDateTime createdAt;
    @Column(name = "marking")
    private String marking;
}
