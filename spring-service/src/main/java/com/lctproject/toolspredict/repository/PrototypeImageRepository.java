package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.MinioFile;
import com.lctproject.toolspredict.model.Prototype;
import com.lctproject.toolspredict.model.PrototypeImage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PrototypeImageRepository extends JpaRepository<PrototypeImage, Long> {
    @Query(nativeQuery = true,
    value = "select i.* from public.prototype_image i join public.prototype p on i.prototype_id = p.id where p.prototype_name = :name")
    List<PrototypeImage> getByPrototypeName(@Param("name") String name);

    Optional<PrototypeImage> findByPrototypeAndImage(Prototype prototype, MinioFile image);
}
