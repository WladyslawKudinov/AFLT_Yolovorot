package com.lctproject.toolspredict.model;

import com.lctproject.toolspredict.dto.ActionType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Getter
@Setter
@Entity
@Table(name = "processing_jobs", schema = "public")
@Accessors(chain = true)
public class Job {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "status")
    private String status;
    @Column(name = "create_date")
    private LocalDateTime createDate;
    @Column(name = "last_modified")
    private LocalDateTime lastModified;

}
