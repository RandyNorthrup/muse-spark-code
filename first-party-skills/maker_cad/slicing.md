# Slicing

Use a user-approved machine/material profile and the installed slicer's
current help. PrusaSlicer's old wiki CLI page is unmaintained; Windows uses
its console executable. OrcaSlicer and CuraEngine have different profile
formats. Do not invent nozzle diameter, bed size or temperature limits.

Slice into a local output file, analyse its units, bounds, feed, temperature
and start/end macros, and return the file plus findings. This is offline
work. Upload-and-print flags, Moonraker print=true and PrusaLink
Print-After-Upload are physical actuation, never part of an offline recipe.
Before any allowed printer action, ask through the host's approval surface
with exact payload and target and read its live limits again. The user's
printer physical E-stop/switch is the emergency stop; software Stop is not.
CNC and laser jobs remain in the user's sender and cannot be sent by the model.

[OrcaSlicer CLI](https://www.orcaslicer.com/wiki/cli/cli_mode),
[CuraEngine source](https://github.com/Ultimaker/CuraEngine/blob/main/src/Application.cpp).
