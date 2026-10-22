# PlatformIO

Read platformio.ini and select an existing environment. Find the user's pio
installation (often ~/.platformio/penv/bin/pio or the Windows penv Scripts
folder); do not silently install or upgrade a toolchain.

Build first, then run native tests only where a native environment exists.
Ordinary pio test may upload firmware, so never use it as an offline check.
<!-- recipe:pio-build -->

```sh
pio run
```

<!-- recipe:pio-native-test -->

```sh
pio test -e native
```

<!-- recipe:pio-check -->

```sh
pio check --json-output --fail-on-defect
```

<!-- recipe:pio-list -->

```sh
pio device list --json-output
```

Before any upload/uploadfs/erase, ask through the host's approval surface,
showing the selected board and port VID:PID/serial beside the project's board.
Refuse a known mismatch; show unknown identity rather than guessing. Build
success does not authorize flashing. Disconnect the development board and
its actuator supply using the user's safe physical stop if it misbehaves.

Serial monitoring opens a port and may reset it: request host approval for
connect. PlatformIO's monitor has no timeout; use the host's bounded serial
tool, or a process-tree deadline and byte cap. Do not rely on Ctrl-C or start
an indefinite background monitor. Respect another IDE's port lease.

[Build CLI](https://docs.platformio.org/en/latest/core/userguide/cmd_run.html)
and [monitor](https://docs.platformio.org/en/latest/core/userguide/device/cmd_monitor.html).
