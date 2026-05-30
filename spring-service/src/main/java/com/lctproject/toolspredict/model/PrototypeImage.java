package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@Entity
@Accessors(chain = true)
@Table(name="prototype_image", schema = "public")
public class PrototypeImage {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne
    @JoinColumn(name="prototype_id", referencedColumnName = "id")
    private Prototype prototype;
    @OneToOne
    @JoinColumn(name = "image_id")
    private MinioFile image;
    @OneToOne
    @JoinColumn(name = "segmentation_file_id")
    private MinioFile segmentationFile;
    @Column(name = "create_date")
    private LocalDateTime createDate;
}
