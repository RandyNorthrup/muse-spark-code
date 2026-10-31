# G-code review before a send

Read only the relevant dialect and macros, not the entire firmware manual.
Analyse offline before asking. Track units, absolute/relative XYZ and
extrusion, arcs, maximum feed and temperature, and unknown commands. Treat
unknown macros as actuation. Expand known printer macros for review;
pause/cancel can move and are not emergency stops.

Read current travel, thermal and feed limits from the machine; use the
smaller of those and the user's registered limits. The model never supplies
limits. With missing limits, observe and stop only. An unhomed printer or
one without trustworthy soft limits gets no model-proposed motion; do not
solve that by sending homing or changing coordinate state yourself.

Before any approved short printer send, ask through the host's approval
surface with exact lines and analysis. If the machine's state changes while
the prompt is open, ask again. Out-of-limit commands are refused without a
prompt. Use Stop machine for the fixed out-of-band stop; the printer's
physical E-stop/switch remains the emergency stop if the network fails.

For offline trials use a virtual Klipper or OctoPrint Virtual Printer in an
isolated local setup. Slicing is file generation, not authorization to print.
Do not auto-start after upload or stream a complete unattended print job.

[Klipper status limits](https://www.klipper3d.org/Status_Reference.html),
[Virtual Printer](https://docs.octoprint.org/en/master/development/virtual_printer.html).
