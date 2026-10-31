# ESP-IDF and ESPHome

Use the project's pinned SDK in an already configured shell. Inspect
CONFIG_IDF_TARGET in token-free configuration; never dump sdkconfig because
it can carry Wi-Fi credentials. Build before any device connection.
<!-- recipe:idf-build -->

```sh
idf.py build
```

<!-- recipe:esphome-build -->

```sh
esphome compile device.yaml
```

ESPHome run combines compilation, upload and logs; an OTA address is a
program target too. Before flashing, erasing, OTA upload or opening a monitor,
ask through the host's approval surface with target identity and the exact
payload. A serial bridge VID:PID does not prove which ESP chip is behind it.
Keep a safe physical disconnect for the board and its actuator power ready.

Prefer local QEMU boot tests before hardware. For a monitor, prefer the
bounded host serial tool: ESP-IDF can toggle DTR/RTS on connect. Its newer
stdin-command mode has an expect timeout; verify that the installed version
supports it and still use the host's process-tree deadline and byte cap.
No indefinite monitor, reset command or flash-plus-monitor chain is approval.

Do not burn eFuses, secure-boot keys, encryption keys, protection bits or OTP.
The user performs irreversible provisioning in their own terminal. esptool
v5 uses dashed subcommands; older underscore spellings remain recognizable.
The ESP-IDF MCP server is physical and needs the same host approval.

[ESP-IDF monitor](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/idf-monitor.html),
[esptool migration](https://docs.espressif.com/projects/esptool/en/latest/esp32/migration-guide.html),
[ESPHome CLI](https://esphome.io/guides/cli/).
