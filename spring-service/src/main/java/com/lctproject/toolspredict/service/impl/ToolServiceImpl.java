package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.ToolRequest;
import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.Tool;
import com.lctproject.toolspredict.model.ToolOrderItem;
import com.lctproject.toolspredict.repository.ToolOrderItemRepository;
import com.lctproject.toolspredict.repository.ToolRepository;
import com.lctproject.toolspredict.service.ToolService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class ToolServiceImpl implements ToolService {

    private final ToolOrderItemRepository toolOrderItemRepository;
    private final ToolRepository toolRepository;

    @Override
    public void addToolOrderItem(Long toolId, Order order, String marking) {
        ToolOrderItem toolOrderItem = new ToolOrderItem()
                .setOrder(order)
                .setTool(toolRepository.findById(toolId).orElseThrow())
                .setMarking(marking);
        toolOrderItemRepository.save(toolOrderItem);
    }

    @Override
    public void changeToolOrderItems(UUID orderId, List<ToolRequest> smallerToolsList) {
        try {
            List<Long> currToolOrderItemList = toolOrderItemRepository.
                    findToolOrderItemsByOrderId(orderId).stream()
                    .map(item -> item.getTool().getId())
                    .toList();
            List<Long> result = new ArrayList<>(currToolOrderItemList);
            for (ToolRequest el : smallerToolsList) {
                result.remove(el.getId());
            }
            for (Long el: result) {
                toolOrderItemRepository.deleteOneByOrderIdAndReferenceId(orderId, el);
            }
        } catch (Exception ex) {
            log.error(ex.getMessage());
        }
    }
    @Override
    public Tool getTool(Long id) {
        return toolRepository.findById(id).orElse(null);
    }

    @Override
    public List<Tool> getAllTools() {
        return toolRepository.findAll();
    }

    @Override
    public Page<ToolOrderItem> getToolOrderPage(Order order, int page, int size) {
        int pageSize = Math.min(Math.max(size, 1), 50);
        Pageable pageable = PageRequest.of(page, pageSize, Sort.by("id").descending());
        return toolOrderItemRepository.findAllByOrder(order, pageable);
    }

    @Override
    public List<Tool> getToolsByList(List<Long> toolIdList) {
        return toolRepository.findAllById(toolIdList);
    }

    @Override
    public void deleteToolOrderItem(Long id) {
        toolOrderItemRepository.deleteById(id);
    }

    @Override
    public Tool addTool(String name) {
        return toolRepository.save(new Tool().setName(name));
    }
    @Override
    public void deleteTool(String name) {
        toolRepository.deleteByName(name);
    }
}
