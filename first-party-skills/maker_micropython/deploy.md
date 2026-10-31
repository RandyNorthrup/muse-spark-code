# Device deployment

Use a local working copy first. A CIRCUITPY volume is live hardware:
writing code.py can auto-reload and actuate connected devices. File edits on
the mounted volume need the host's approval surface even when automatic
edits are enabled. On Muse Code, whose edits may skip a prompt, keep a
working copy and use an approved deploy; never edit the live volume directly.

List ports without opening them:
<!-- recipe:mpremote-list -->

```sh
mpremote connect list
```

Before mpremote connect/repl, ask through the host's approval surface:
opening a port may reset the board; a 1200-baud open/close can enter the
bootloader. Before copying, deleting, mounting, exec, run or reset, ask again
for the exact files/bytes and board. A Python script run from RAM can drive
pins, so do not call it an offline test. CircuitPython /fs/ HTTP writes are
programming too, and USB mount conflicts are reported, not forced away.

Keep the user's safe physical board and external-actuator disconnect ready.
Respect the serial lease; Thonny owns its connection, so use its host serial
provider rather than opening a second port. Bound reads by time and bytes;
never leave a REPL running after the task ends.

Do not open or emit settings.toml or Wi-Fi values, or place credentials in
tracked examples. Use token-free configuration and tell the user which
private settings they fill in outside chat.

[mpremote](https://docs.micropython.org/en/latest/reference/mpremote.html),
[CircuitPython workflows](https://docs.circuitpython.org/en/latest/docs/workflows.html).
