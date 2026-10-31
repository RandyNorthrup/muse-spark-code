# GPIO and power

On a Pi, start with read-only power and line information. These commands
require the user's installed Raspberry Pi utilities and libgpiod.
<!-- recipe:pi-throttle -->

```sh
vcgencmd get_throttled
```

<!-- recipe:pi-gpioinfo -->

```sh
gpioinfo
```

get_throttled reports current and historical power/thermal trouble; diagnose
that before blaming application logic. GPIO numbers and header positions
are different; verify the exact board and wiring from its documentation.

Use gpiozero's mock pin factory for the project's own host tests. Pi 5 uses
RP1; use a supported gpiozero pin backend rather than assuming RPi.GPIO.
Do not change pin modes just to inspect them. gpioset holds a line until it
exits; terminating it is not proof an external load is safe.

Before every real GPIO write, relay or actuator operation, ask through the
host's approval surface for the exact chip/line, value and duration. Unknown
wiring or limits means no actuation. The user must identify a physical E-stop
or safe disconnect for external loads and their own power supply; SSH loss
or a software stop is not an emergency stop. Do not run hardware tests in
unattended workers or CI.

[gpiozero pin factories](https://gpiozero.readthedocs.io/en/stable/api_pins.html),
[Pi OS utilities](https://www.raspberrypi.com/documentation/computers/os.html).
