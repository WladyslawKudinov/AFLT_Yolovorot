package com.lctproject.toolspredict.controller;

import com.lctproject.toolspredict.dto.OrderRequest;
import com.lctproject.toolspredict.service.OrderService;
import com.lctproject.toolspredict.service.ToolService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;
@CrossOrigin
@RestController
@RequestMapping("/api/v1/orders")
@Tag(name="Управление заказами", description = "API ToolsPredict")
public class OrderController {
    private final OrderService orderService;
    private final ToolService toolService;

    public OrderController(OrderService orderService, ToolService toolService) {
        this.orderService = orderService;
        this.toolService = toolService;
    }

    @GetMapping
    @Operation(summary = "Вывести заказы")
    public ResponseEntity<?> getAll(@Parameter(description = "Номер страницы")
                                    @RequestParam(name = "page", defaultValue = "0") int page,
                                    @Parameter(description = "Размер страницы")
                                    @RequestParam(name ="size", defaultValue = "10") int size) {
        return ResponseEntity.ok(orderService.getPage(page, size).getContent());
    }

    @GetMapping("/{orderId}")
    @Operation(summary = "Вывести информацию о заказе")
    public ResponseEntity<?> get(@PathVariable UUID orderId) {
        return ResponseEntity.ok(orderService.getOrder(orderId));
    }

    @GetMapping("/{orderId}/tools")
    @Operation(summary = "Вывести детали заказа")
    public ResponseEntity<?> getTools(@PathVariable UUID orderId,
                                      @RequestParam(name = "page", defaultValue = "0") int page,
                                      @Parameter(description = "Размер страницы")
                                      @RequestParam(name ="size", defaultValue = "20") int size) {
        try {
            return ResponseEntity.ok(orderService.getOrderDetails(orderId, page, size));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @PostMapping
    @Operation(summary = "Добавление заказа в хранилище")
    public ResponseEntity<String> add(@RequestBody OrderRequest orderRequest) {
        orderService.createOrder(orderRequest);
        return ResponseEntity.ok("Заказ успешно добавлен.");
    }


    @PutMapping
    @Operation(summary = "Изменение заказа. В ходе ручной проверки из заказа можно удалить отсутствующие на складе позиции")
    public ResponseEntity<String> change(@RequestBody OrderRequest orderRequest) {
        orderService.changeOrder(orderRequest);
        return ResponseEntity.ok("Заказ успешно изменен.");
    }


    @DeleteMapping("/{orderId}")
    @Operation(summary = "Удалить заказ. В ходе удаления все привязанные job'ы удаляются.")
    public ResponseEntity<String> delete(@PathVariable UUID orderId) {
        orderService.deleteOrder(orderId);
        return ResponseEntity.ok("Заказ успешно удалён.");
    }

    @DeleteMapping("/{orderId}/tool")
    @Operation(summary = "Удалить инструмент из заказа")
    public ResponseEntity<?> deleteToolOrderItem(@Parameter(description = "Уникальный идентификатор заказанного инструмента")
                                                 @RequestParam Long id) {
        toolService.deleteToolOrderItem(id);
        return ResponseEntity.ok("OK");
    }

    @PostMapping("/{orderId}/tool")
    @Operation(summary = "Добавить инструмент в заказ")
    public ResponseEntity<?> addToolOrderItem(@Parameter(description = "Идентификатор заказа")
                                              @PathVariable UUID orderId,
                                              @Parameter(description = "Идентификатор инструмента")
                                              @RequestParam Long toolId,
                                              @Parameter(description = "Маркировка инструмента")
                                              @RequestParam(required = false) String marking) {
        toolService.addToolOrderItem(toolId, orderService.getOrder(orderId), marking);
        return ResponseEntity.ok("OK");
    }
}
