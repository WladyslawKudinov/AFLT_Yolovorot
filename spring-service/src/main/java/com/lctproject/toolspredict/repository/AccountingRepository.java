package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.dto.ActionType;
import com.lctproject.toolspredict.model.Accounting;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.Order;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface AccountingRepository extends JpaRepository<Accounting, Long> {
    Accounting findByOrderAndActionType(Order order, String actionType);
    int countByOrder(Order order);

    @Query("""
        SELECT a FROM Accounting a
        JOIN a.job j
        JOIN a.order o
        JOIN o.employee e
        WHERE LOWER(e.name) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(e.surname) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(e.patronymic) LIKE LOWER(CONCAT('%', :query, '%'))
           OR CAST(o.id AS string) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(o.description) LIKE LOWER(CONCAT('%', :query, '%'))
           OR CAST(j.id AS string) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(j.status) LIKE LOWER(CONCAT('%', :query, '%'))
    """)
    Page<Accounting> getPage(@Param("query") String query, Pageable pageable);

    List<Accounting> findByOrder(Order order);

    Accounting findByJob(Job job);

    boolean existsByJob(Job job);
}
