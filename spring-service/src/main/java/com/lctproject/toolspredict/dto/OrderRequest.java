package com.lctproject.toolspredict.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotNull;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class OrderRequest {
    @NotNull
    private UUID orderId;
    private String workorder;
    @NotNull
    private Long employeeId;
    @NotNull
    @JsonProperty("tools")
    private List<ToolRequest> toolsList;
    @JsonProperty("description")
    private String description;
}
