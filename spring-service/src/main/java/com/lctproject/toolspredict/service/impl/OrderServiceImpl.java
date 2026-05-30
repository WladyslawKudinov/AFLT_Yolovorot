package com.lctproject.toolspredict.service.impl;

import com.lctproject.toolspredict.dto.OrderRequest;
import com.lctproject.toolspredict.dto.ToolRequest;
import com.lctproject.toolspredict.model.Accounting;
import com.lctproject.toolspredict.model.Order;
import com.lctproject.toolspredict.model.ToolOrderItem;
import com.lctproject.toolspredict.repository.AccountingRepository;
import com.lctproject.toolspredict.repository.EmployeeRepository;
import com.lctproject.toolspredict.repository.OrderRepository;
import com.lctproject.toolspredict.service.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

@Slf4j
@Service
@RequiredArgsConstructor
public class OrderServiceImpl implements OrderService {
    private final OrderRepository orderRepository;
    private final EmployeeRepository employeeRepository;
    private final ToolService toolService;
    private final JobService jobService;
    private final AccountingRepository accountingRepository;

    @Override
    public void createOrder(OrderRequest orderRequest) {
        try {
            Order order = new Order()
                    .setId(orderRequest.getOrderId())
                    .setEmployee(employeeRepository
                            .findById(orderRequest.getEmployeeId()).orElseThrow())
                    .setDescription(orderRequest.getDescription())
                    .setCreatedAt(LocalDateTime.now())
                    .setWorkorder(orderRequest.getWorkorder())
                    .setLastModified(LocalDateTime.now());
            orderRepository.save(order);
            for (ToolRequest request: orderRequest.getToolsList()) {
                try {
                    toolService.addToolOrderItem(request.getId(), order, request.getMarking());
                } catch (NoSuchElementException e) {
                    log.error("Не зафиксирован инструмент под номером {}: нет в справочнике.", request.getId());
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
            log.error("Ошибка добавления заказа в хранилище: {}", e.getMessage());
        }
    }

    @Override
    public void changeOrder(OrderRequest orderRequest) {
        try {
            Order order = orderRepository.findById(orderRequest.getOrderId()).orElseThrow();
            toolService.changeToolOrderItems(order.getId(), orderRequest.getToolsList());
            order.setLastModified(LocalDateTime.now());
            orderRepository.save(order);
        } catch (Exception ex) {
            log.error(ex.getMessage());
        }
    }

    @Override
    public Page<Order> getPage(int page, int size) {
        int pageSize = Math.min(Math.max(size, 1), 50);
        Pageable pageable = PageRequest.of(page, pageSize, Sort.by("createdAt").descending());
        return orderRepository.findAll(pageable);
    }

    @Override
    public Order getOrder(UUID orderId) {
        return orderRepository.findById(orderId).orElse(null);
    }

    @Override
    public void deleteOrder(UUID orderId) {
        List<Accounting> accountingList = accountingRepository.findByOrder(getOrder(orderId));
        for (Accounting accounting: accountingList) {
            accountingRepository.delete(accounting);
            jobService.deleteJob(accounting.getJob().getId());
        }
        orderRepository.deleteById(orderId);
    }

    @Override
    public List<ToolOrderItem> getOrderDetails(UUID orderId, int page, int size) {
        Order order = getOrder(orderId);
        if (order == null) throw new NoSuchElementException("Заказ не найден.");
        return toolService.getToolOrderPage(order, page, size).getContent();
    }
}
