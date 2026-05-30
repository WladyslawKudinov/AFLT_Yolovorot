package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.Prototype;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface PrototypeRepository extends JpaRepository<Prototype, Long> {
    boolean existsByName(String name);

    Optional<Prototype> findByName(String name);
}
