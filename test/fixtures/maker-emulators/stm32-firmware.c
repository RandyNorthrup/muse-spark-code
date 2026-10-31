/* STM32F4 UART4 firmware; executable code runs in Renode's Cortex-M4. */
#include <stdint.h>
#define REG(address) (*(volatile uint32_t *)(address))
void reset(void);
__attribute__((section(".vectors"), used))
const uintptr_t vectors[] = { 0x20020000, (uintptr_t)reset };
static void send(char value) {
    while (!(REG(0x40004c00) & (1u << 7))) {}
    REG(0x40004c04) = value;
}
void reset(void) {
    REG(0x40023840) |= 1u << 19;
    REG(0x40004c08) = 139;
    REG(0x40004c0c) = (1u << 13) | (1u << 3) | (1u << 2);
    for (;;) {
        const char *text = "MUSE_STM32_READY\r\n";
        while (*text) send(*text++);
        for (volatile unsigned i = 0; i < 100000; i++) {
            if (REG(0x40004c00) & (1u << 5)) {
                char byte;
                do {
                    while (!(REG(0x40004c00) & (1u << 5))) {}
                    byte = REG(0x40004c04);
                    send(byte);
                } while (byte != '\n');
            }
        }
    }
}
