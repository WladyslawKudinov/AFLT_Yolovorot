package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.ClassificationResult;
import com.lctproject.toolspredict.model.Job;
import com.lctproject.toolspredict.model.MinioFile;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Repository
public interface ClassificationResultRepository extends JpaRepository<ClassificationResult, Long> {
    List<ClassificationResult> findByJob(Job job);

    @Modifying
    @Transactional
    void deleteByJob(Job job);

    @Query(value = """
      SELECT tool_id, MAX(tool_count) AS count_per_tool
      FROM (
          SELECT cr.original_file_id,
                 cr.tool_id,
                 COUNT(*) AS tool_count
          FROM classification_result cr
          WHERE cr.job_id = :jobId
          GROUP BY cr.original_file_id, cr.tool_id
      ) AS per_file
      GROUP BY tool_id
      """, nativeQuery = true)
    List<Object[]> findMaxToolCountPerJob(@Param("jobId") Long jobId);


    @Query("""
    select cr
    from ClassificationResult cr
    where cr.job.id = :jobId
    order by cr.tool.id
    """)
    List<ClassificationResult> findAllByJobIdOrderByToolId(@Param("jobId") Long jobId);

    List<ClassificationResult> findByOriginalFile(MinioFile originalFile);

}
