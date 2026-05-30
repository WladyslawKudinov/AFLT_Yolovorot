package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.ClassificationResult;
import com.lctproject.toolspredict.model.MinioFile;
import com.lctproject.toolspredict.model.RetrainingSample;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RetrainingSampleRepository extends JpaRepository<RetrainingSample, Long> {

    Optional<RetrainingSample> findByImage(MinioFile originalFile);

    @Query(
            nativeQuery = true,
            value = """
                SELECT EXISTS(
                    SELECT 1
                    FROM public.retraining_sample rs
                    INNER JOIN public.classification_result cr
                        ON rs.model_result_id = cr.id
                    WHERE cr.job_id = :job_id
                )
        """
    )
    boolean existsByJob(@Param("job_id") Long jobId);
}
