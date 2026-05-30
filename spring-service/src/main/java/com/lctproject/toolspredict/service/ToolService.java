package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.ToolRequest;
import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.Tool;
import com.lctproject.toolspredict.model.ToolOrderItem;
import jakarta.transaction.Transactional;
import org.springframework.data.domain.Page;

import java.util.List;
import java.util.UUID;

public interface ToolService {
    void addToolOrderItem(Long toolId, Order order, String marking);

    void changeToolOrderItems(UUID orderId, List<ToolRequest> smallerToolsList);

    Tool getTool(Long id);

    List<Tool> getAllTools();

    Page<ToolOrderItem> getToolOrderPage(Order order, int page, int size);

    List<Tool> getToolsByList(List<Long> toolIdList);


    void deleteToolOrderItem(Long id);

    Tool addTool(String name);

    void deleteTool(String name);
}
