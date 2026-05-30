package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.Job;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface ProcessingJobsRepository extends JpaRepository<Job, Long> {

    Job findById(long id);

    Optional<Job> findFirstByStatus(String test);
}
