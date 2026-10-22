# Offline toolpath review

Use the user's installed CAMotics for a local stock simulation, after
confirming units, work origin, stock size, tool geometry and dialect. Replace
input/output names with the project's files; do not overwrite its source.
<!-- recipe:camotics -->

```sh
camsim input.gcode stock.stl
```

Compare the simulated cut to the requested geometry, including rapid moves,
fixtures, tool length and clearance. A simulation does not prove physical
workholding or a laser enclosure safe. Analyse bounds/feed and unknown
commands before returning findings, then let the user run the job in their
sender. Do not add an upload, resume, homing or firing step to this recipe.

[CAMotics CLI source](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/master/src/camsim.cpp).
