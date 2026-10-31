/* Minimal IDF UART firmware for the ESP32-S3 emulator (no network or GPIO). */
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
void app_main(void) {
    const uart_config_t config = {
        .baud_rate = 115200, .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE, .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE, .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 2048, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0, &config));
    for (;;) {
        const char ready[] = "MUSE_ESP32S3_READY\r\n";
        uart_write_bytes(UART_NUM_0, ready, sizeof(ready) - 1);
        char bytes[128];
        int count = uart_read_bytes(UART_NUM_0, bytes, sizeof(bytes), pdMS_TO_TICKS(100));
        if (count > 0) uart_write_bytes(UART_NUM_0, bytes, count);
    }
}
