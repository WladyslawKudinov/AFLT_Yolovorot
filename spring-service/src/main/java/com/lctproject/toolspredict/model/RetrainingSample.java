package com.lctproject.toolspredict.model;


import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@Entity
@Accessors(chain = true)
@Table(name="retraining_sample", schema = "public")
public class RetrainingSample {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @OneToOne
    @JoinColumn(name="model_result_id", referencedColumnName = "id")
    private ClassificationResult classificationResult;
    @ManyToOne
    @JoinColumn(name="image_id", referencedColumnName = "id")
    private MinioFile image;
    @Column(name="status")
    private String status;
    @Column(name="create_date")
    private LocalDateTime createDate;
}
