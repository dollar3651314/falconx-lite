package com.falconx.lite;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** FalconX Lite 后端入口：单体应用，单实例运行（00-架构方案.md 3.3 ⑦）。 */
@SpringBootApplication
public class FalconxLiteApplication {

  public static void main(String[] args) {
    SpringApplication.run(FalconxLiteApplication.class, args);
  }
}
