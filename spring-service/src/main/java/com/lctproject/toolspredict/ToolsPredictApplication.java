package com.lctproject.toolspredict;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@EnableAsync
@SpringBootApplication
public class ToolsPredictApplication {

	public static void main(String[] args) {
		SpringApplication.run(ToolsPredictApplication.class, args);
	}

}
