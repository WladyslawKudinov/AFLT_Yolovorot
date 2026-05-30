package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.Tool;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ToolRepository extends JpaRepository<Tool, Long> {
    @Query(
            nativeQuery = true,
            value = "SELECT * FROM tool " +
                    "WHERE REPLACE(tool_name, ' ', '') = REPLACE(:microclass, ' ', '')"
    )
    Tool findByTrimmedName(@Param("microclass") String microclass);

    void deleteByName(String name);
}
