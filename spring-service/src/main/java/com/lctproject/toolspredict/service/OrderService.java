package com.lctproject.toolspredict.service;

import com.lctproject.toolspredict.dto.OrderRequest;
import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.ToolOrderItem;
import org.springframework.data.domain.Page;

import java.util.List;
import java.util.UUID;

public interface OrderService {
    void createOrder(OrderRequest orderRequest);

    void changeOrder(OrderRequest orderRequest);

    Page<Order> getPage(int page, int size);

    Order getOrder(UUID orderId);

    void deleteOrder(UUID orderId);

    List<ToolOrderItem> getOrderDetails(UUID orderId, int page, int size);
}
