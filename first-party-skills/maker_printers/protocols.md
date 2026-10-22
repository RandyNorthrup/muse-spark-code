# Printer protocols and stop

Register the user's named machine through the host, with credentials in its
secret store, not a workspace file or model argument. Observe status first.
Plain HTTP is only for a registered private LAN address after the host's
unencrypted-LAN warning. Do not probe arbitrary printers or use Moonraker's
trusted-client or unix-socket paths to evade the host.

Before every send, job start, pause, resume, cancel, heating or fan change,
ask through the host's approval surface for the exact machine and payload.
The user stays present with the printer's physical E-stop or safe power
switch in reach. A software stop is not an emergency stop. Stop is the
host's fixed sequence, without approval, never a model-composed macro:

- Moonraker: POST /printer/emergency_stop out of band. Never send M112
  through gcode/script; it waits behind earlier G-code. PAUSE and CANCEL_PRINT
  can park the toolhead and require approval as actuation.
- OctoPrint: use its emergency parser's out-of-band M112. Prefer the appkeys
  flow and Read-only Access for diagnosis; the user approves in OctoPrint.
- Marlin serial: M112/M410 are immediate only when EMERGENCY_PARSER is
  present; otherwise direct the user to the physical switch. M410 loses
  position. Do not assume a capability from the firmware name alone.
- PrusaLink: status and documented job control only; its API has no raw
  G-code, jog or temperature endpoint. Use the printer's physical switch
  for an immediate stop where no out-of-band stop is available.
- Bambu: use the user's supported tools and physical switch. Do not defeat
  Authorization Control or invent MQTT payloads from community guesses.

Do not send M997, M502, M500, SAVE_CONFIG, RESTART, FIRMWARE_RESTART,
M80/M81, M42 or M303; do not upload to root=config or shut down/reboot the
host. The user handles firmware, persistent settings and autotune in their
own tools. Work on Klipper/Marlin configuration in a local copy, preserve
thermal protection, and highlight changed safety limits before deployment.

[Moonraker API](https://moonraker.readthedocs.io/en/latest/external_api/printer/),
[OctoPrint emergency parser](https://github.com/OctoPrint/OctoPrint/blob/master/src/octoprint/schema/config/serial.py),
[Marlin M112](https://marlinfw.org/docs/gcode/M112.html),
[PrusaLink spec](https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml).
