/* Runs on both AVR CPUs: observable UART output and exact byte echo. */
#define F_CPU 16000000UL
#include <avr/io.h>
#include <util/delay.h>
static void send(char byte) {
    while (!(UCSR0A & (1 << UDRE0))) {}
    UDR0 = byte;
}
int main(void) {
    UBRR0L = 16;
    UCSR0A = (1 << U2X0);
    UCSR0B = (1 << RXEN0) | (1 << TXEN0);
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    for (;;) {
        if (UCSR0A & (1 << RXC0)) send(UDR0);
        else {
            const char *text = "MUSE_AVR_READY\r\n";
            while (*text) send(*text++);
            _delay_ms(100);
        }
    }
}
