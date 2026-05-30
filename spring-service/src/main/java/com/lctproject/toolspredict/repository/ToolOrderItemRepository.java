package com.lctproject.toolspredict.repository;

import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.ToolOrderItem;
import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface ToolOrderItemRepository extends JpaRepository<ToolOrderItem, Long> {
    @Query(nativeQuery = true,
            value = "select * from public.tool_order_item t " +
                    "where t.order_id=:order_id")
    List<ToolOrderItem> findToolOrderItemsByOrderId(@Param("order_id") UUID orderId);

    @Modifying
    @Transactional
    @Query(nativeQuery = true,
        value = "delete from public.tool_order_item " +
                "where id in (select t.id from public.tool_order_item t " +
                "where t.order_id=:order_id and t.tool_id=:reference_id limit 1)")
    void deleteOneByOrderIdAndReferenceId(@Param("order_id") UUID orderId, @Param("reference_id") Long toolId);

    Page<ToolOrderItem> findAllByOrder(Order order, Pageable pageable);

    List<ToolOrderItem> findByOrder(Order order);
}
