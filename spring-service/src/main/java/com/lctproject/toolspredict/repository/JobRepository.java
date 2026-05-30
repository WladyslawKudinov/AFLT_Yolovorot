package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.Job;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.PagingAndSortingRepository;
import org.springframework.data.repository.query.Param;

public interface JobRepository extends PagingAndSortingRepository<Job, Long> {

    @Query("""
        SELECT j FROM Job j
        JOIN Accounting a ON a.job = j
        JOIN a.order o
        JOIN o.employee e
        WHERE LOWER(e.name) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(e.surname) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(e.patronymic) LIKE LOWER(CONCAT('%', :query, '%'))
           OR CAST(o.id AS string) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(o.description) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(o.workorder) LIKE LOWER(CONCAT('%', :query, '%'))
           OR CAST(j.id AS string) LIKE LOWER(CONCAT('%', :query, '%'))
           OR LOWER(j.status) LIKE LOWER(CONCAT('%', :query, '%'))
    """)
    Page<Job> getPage(@Param("query") String query, Pageable pageable);

}
