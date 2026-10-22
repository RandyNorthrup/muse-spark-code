# Parametric exports

Use the user's installed CAD tools and preserve editable source plus units.
For OpenSCAD, use flags supported by the installed release; do not assume
snapshot-only --backend works on stable. Export mesh locally:
<!-- recipe:openscad-stl -->

```sh
openscad -o model.stl model.scad
```

Check dimensions, orientation, bounding box, mesh validity and tolerances
before calling the part manufacturable. Render feedback is sent to the
chosen model only when it supports vision; otherwise report measurements
and files. Never use a render to infer load capacity or electrical safety.

CadQuery, build123d, FreeCAD and Blender scripts execute arbitrary code.
Review them and use normal shell approval and workspace confinement; do not
install community MCP servers as a shortcut around those checks. Export STL
for meshes and STEP where the user's next tool needs editable solids.
Nothing GPL/AGPL is bundled; the CAD tools are the user's installations.

[OpenSCAD CLI](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment),
[build123d exports](https://build123d.readthedocs.io/en/latest/import_export.html).
