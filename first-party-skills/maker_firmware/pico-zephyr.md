# Pico SDK and Zephyr

Keep the project's SDK revision and target. For a configured Pico SDK CMake
project, generate into a separate local build folder, then build it.
<!-- recipe:pico-configure -->

```sh
cmake -S . -B build
```

<!-- recipe:pico-build -->

```sh
cmake --build build
```

For Zephyr, use the workspace's west manifest and selected board; replace
BOARD and APP with the user's project values.
<!-- recipe:zephyr-build -->

```sh
west build -b BOARD APP
```

Prefer host tests or Renode where the board is supported. A successful build
does not validate physical wiring. Before picotool load/reboot, west flash,
OpenOCD programming or copying UF2 to RPI-RP2, ask through the host's approval
surface with the identity and artifact. BOOTSEL and USB re-enumeration can
change the port. Do not write RP2350 OTP or permanent protection settings.
Stop physical output using the user's safe board and actuator-power
disconnect. Never flash a printer or CNC controller as a development board.

[Pico SDK](https://github.com/raspberrypi/pico-sdk),
[Zephyr west](https://docs.zephyrproject.org/latest/develop/west/build-flash-debug.html).
