/* Local simavr runner: MCU execution with binary UART IRQs on a private PTY. */
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <time.h>
#include <simavr/sim_avr.h>
#include <simavr/sim_elf.h>
#include <simavr/sim_hex.h>
#include <simavr/avr_uart.h>

static volatile sig_atomic_t stopping;
static int uart_fd;
static int paused;
static int failed;
static void stop(int sig) { (void)sig; stopping = 1; }
static void output(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq; (void)param;
    uint8_t byte = value;
    if (write(uart_fd, &byte, 1) != 1) failed = 1;
}
static void xon(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq; (void)value; (void)param; paused = 0;
}
static void xoff(struct avr_irq_t *irq, uint32_t value, void *param) {
    (void)irq; (void)value; (void)param; paused = 1;
}
int main(int argc, char **argv) {
    if (argc != 4) return 2;
    avr_t *avr = avr_make_mcu_by_name(argv[1]);
    if (!avr || avr_init(avr)) return 1;
    avr->frequency = 16000000;
    if (strstr(argv[2], ".hex")) {
        ihex_chunk_p chunks;
        int count = read_ihex_chunks(argv[2], &chunks);
        if (count <= 0) return 1;
        for (int i = 0; i < count; i++) {
            uint32_t base = chunks[i].baseaddr, size = chunks[i].size;
            if (base > avr->flashend || size > avr->flashend + 1 - base) return 1;
            memcpy(avr->flash + base, chunks[i].data, size);
        }
        avr->pc = chunks[0].baseaddr;
        free_ihex_chunks(chunks);
        avr->codeend = avr->flashend;
    } else {
        elf_firmware_t firmware = {0};
        if (elf_read_firmware(argv[2], &firmware)) return 1;
        avr_load_firmware(avr, &firmware);
    }
    uart_fd = open(argv[3], O_RDWR | O_NOCTTY | O_NONBLOCK);
    if (uart_fd < 0) return 1;
    uint32_t flags = 0;
    avr_ioctl(avr, AVR_IOCTL_UART_SET_FLAGS('0'), &flags);
    avr_irq_t *input = avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_INPUT);
    avr_irq_register_notify(avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUTPUT), output, NULL);
    avr_irq_register_notify(avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUT_XON), xon, NULL);
    avr_irq_register_notify(avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUT_XOFF), xoff, NULL);
    signal(SIGTERM, stop);
    signal(SIGINT, stop);
    struct timespec begin;
    clock_gettime(CLOCK_MONOTONIC, &begin);
    while (!stopping && !failed) {
        for (int i = 0; i < 1000; i++) {
            int state = avr_run(avr);
            if (state == cpu_Done || state == cpu_Crashed) { failed = 1; break; }
        }
        uint64_t nanos = avr->cycle * 1000000000ULL / avr->frequency + begin.tv_nsec;
        struct timespec deadline = { begin.tv_sec + nanos / 1000000000ULL, nanos % 1000000000ULL };
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &deadline, NULL);
        if (!paused) {
            uint8_t byte;
            ssize_t count = read(uart_fd, &byte, 1);
            if (count == 1) avr_raise_irq(input, byte);
            else if (count < 0 && errno != EAGAIN && errno != EINTR) failed = 1;
        }
    }
    close(uart_fd);
    avr_terminate(avr);
    return failed ? 1 : 0;
}
