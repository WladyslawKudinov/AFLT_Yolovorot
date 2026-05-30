package com.lctproject.toolspredict.model;


import jakarta.persistence.*;
import lombok.Data;
import lombok.experimental.Accessors;

@Data
@Entity
@Table(name="tool_order_item", schema = "public")
@Accessors(chain = true)
public class ToolOrderItem {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne
    @JoinColumn(name="order_id", referencedColumnName = "id")
    private Order order;
    @ManyToOne
    @JoinColumn(name="tool_id", referencedColumnName = "id")
    private Tool tool;
    @Column(name = "marking")
    private String marking;
}
