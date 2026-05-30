package com.lctproject.toolspredict.model;

import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

import java.time.LocalDateTime;
import java.util.UUID;

@Data
@Entity
@Accessors(chain = true)
@Table(name="employee_order", schema = "public")
public class Order {
    @Id
    private UUID id;
    @ManyToOne
    @JoinColumn(name="employee_id", referencedColumnName = "id")
    private Employee employee;
    @Column(name="description")
    private String description;
    @Column(name="created_at")
    private LocalDateTime createdAt;
    @Column(name="last_modified")
    private LocalDateTime lastModified;
    @Column(name="workorder_id")
    private String workorder;
}
