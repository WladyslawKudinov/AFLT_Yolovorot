package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@Entity
@Accessors(chain = true)
@Table(name="prototype", schema = "public")
public class Prototype {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne
    @JoinColumn(name = "job_id", referencedColumnName = "id")
    private Job job;
    @Column(name = "prototype_name")
    private String name;
    @Column(name = "create_date")
    private LocalDateTime createDate;
}
