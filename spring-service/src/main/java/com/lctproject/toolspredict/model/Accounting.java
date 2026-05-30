package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;

@Data
@Entity
@Table(name = "accounting", schema = "public")
@Accessors(chain = true)
public class Accounting {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @JoinColumn(name = "job_id")
    @ManyToOne
    private Job job;
    @Column(name = "action_type")
    private String actionType;
    @JoinColumn(name = "order_id")
    @ManyToOne
    private Order order;
    @Column(name = "create_date")
    private LocalDateTime createDate;

}
