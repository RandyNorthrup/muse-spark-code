I've completed the research. Everything below comes from the official docs or the source code (checked with `gh`/`curl`) unless I mark it otherwise. I made no code changes and called no paid APIs.

## 1. Klipper + Moonraker

- **printer.cfg limits** ([Config_Reference](https://www.klipper3d.org/Config_Reference.html)):
  - `[printer] max_velocity` and `max_accel` are required, and `SET_VELOCITY_LIMIT` can change them at runtime.
  - Steppers: `position_min` defaults to 0; `position_max` and `position_endstop` are required for cartesian X/Y/Z.
  - `[extruder]`/`[heater_bed]`: `min_temp` and `max_temp` are required, and the MCU shuts down if a reading leaves that range. `min_extrude_temp` defaults to 170.
  - `[verify_heater]` is on for every heater automatically. Defaults: `max_error` 120, `check_gain_time` 20 s (extruder) / 60 s (bed), `hysteresis` 5, `heating_gain` 2.
  - `[force_move]` is off by default (`enable_force_move: False`). The docs say FORCE_MOVE and SET_KINEMATIC_POSITION "may place the printer in an invalid state".
  - Moving before homing fails with "Must home axis first" ([cartesian.py](https://github.com/Klipper3d/klipper/blob/master/klippy/kinematics/cartesian.py)).
- **Runtime limits** are readable from `toolhead.axis_minimum/axis_maximum/homed_axes/max_velocity` and `configfile.settings` ([Status_Reference](https://www.klipper3d.org/Status_Reference.html)).
- **Moonraker endpoints** ([printer](https://moonraker.readthedocs.io/en/latest/external_api/printer/)): GET `/printer/info`, GET `/printer/objects/list`, POST `/printer/objects/query`, websocket-only `printer.objects.subscribe`, POST `/printer/gcode/script`, POST `/printer/emergency_stop`, `/printer/restart`, `/printer/firmware_restart`, `/printer/print/start|pause|resume|cancel`. JSON-RPC names mirror the paths (`printer.gcode.script`).
- **Transport** ([intro](https://moonraker.readthedocs.io/en/latest/external_api/introduction/)): websocket at `ws://host:7125/websocket` (JSON-RPC 2.0). The unix socket `~/printer_data/comms/moonraker.sock` needs **no authentication**.
- **M112 is not immediate through `gcode/script`.** Moonraker's docs say it is "placed on the gcode queue and executed after all previous gcodes are complete"; use `/printer/emergency_stop` instead. Klipper's own pseudo-tty does catch M112 out of order ([gcode.py](https://github.com/Klipper3d/klipper/blob/master/klippy/gcode.py)). `gcode/script` also queues behind a running temperature wait ([API_Server](https://www.klipper3d.org/API_Server.html)).
- **Pause, resume and cancel run printer-defined macros.** They call `PAUSE`, `RESUME` and `CANCEL_PRINT` ([pause_resume.py](https://github.com/Klipper3d/klipper/blob/master/klippy/extras/pause_resume.py)). Mainsail's `PAUSE` parks the toolhead (motion), and `CANCEL_PRINT` can park, then runs TURN_OFF_HEATERS ([client.cfg](https://github.com/mainsail-crew/mainsail-config/blob/master/client.cfg)).
- **Upload** ([files](https://moonraker.readthedocs.io/en/latest/external_api/file_manager/)): POST `/server/files/upload` takes `root=gcodes|config`. `print=true` starts the print after upload. Writing to `root=config` changes printer.cfg.
- **Power** ([devices](https://moonraker.readthedocs.io/en/latest/external_api/devices/)): GET `/machine/device_power/devices|device|status`, POST `/machine/device_power/device|on|off`. Config options include `locked_while_printing`, `on_when_job_queued`, `off_when_shutdown` and `restart_klipper_when_powered`. `[job_queue]` has `load_on_startup` and `automatic_transition` ([config](https://moonraker.readthedocs.io/en/latest/configuration/)).
- **Host control** ([machine](https://moonraker.readthedocs.io/en/latest/external_api/machine/)): `/machine/shutdown`, `/machine/reboot`, `/machine/services/*`.
- **Auth** ([authorization](https://moonraker.readthedocs.io/en/latest/external_api/authorization/)):
  - `X-Api-Key` header, or JWT `Authorization: Bearer` (access token 1 h, refresh token about 260 days).
  - One-shot token from GET `/access/oneshot_token`, passed as `?token=`, valid once for 5 s.
  - `trusted_clients` get "full access to the API"; `force_logins` overrides that.
  - **There are no roles; access is all or nothing**, so any limits have to be enforced by the extension.
- **Simulation:**
  - Batch mode: `klippy.py printer.cfg -i test.gcode -o test.serial -v -d out/klipper.dict`, then `parsedump.py`. Some request/response commands are disabled, so the output "is not useful for sending to a real micro-controller" ([Debugging](https://www.klipper3d.org/Debugging.html)).
  - simulavr emulates an atmega644p and needs desktop-class CPU.
  - A "Linux process" MCU exists ([RPi_microcontroller](https://www.klipper3d.org/RPi_microcontroller.html)).
  - [virtual-klipper-printer](https://github.com/mainsail-crew/virtual-klipper-printer): GPL-3.0, 129 stars, last push 2026-01-10, not archived. Its [supervisord.conf](https://github.com/mainsail-crew/virtual-klipper-printer/blob/master/config/supervisord.conf) runs **simulavr (atmega644p)**, Klipper, Moonraker and a dummy mjpg webcam. Ports 7125 and 8110→8080.

## 2. OctoPrint, PrusaLink, Bambu

- **OctoPrint auth** ([general](https://docs.octoprint.org/en/master/api/general.html)): `X-Api-Key`, `Authorization: Bearer`, or `?apikey` (testing only). Clients are told to use the appkeys flow first.
- **Appkeys flow** ([appkeys](https://docs.octoprint.org/en/master/bundledplugins/appkeys.html)):
  - GET `/plugin/appkeys/probe` returns 204 if supported.
  - POST `/plugin/appkeys/request` returns 201 plus a poll URL.
  - Polling GET `/plugin/appkeys/request/<token>` returns 202 (pending), 200 (key) or 404 (denied).
  - The user approves in the OctoPrint web UI. The request goes stale if not polled for more than 5 s.
- **OctoPrint endpoints:**
  - [printer](https://docs.octoprint.org/en/master/api/printer.html): GET `/api/printer` (STATUS). POST `/printer/printhead` (jog/home), `/printer/tool` (target/extrude), `/printer/bed`, `/printer/chamber`, `/printer/command` (arbitrary G-code); all need CONTROL.
  - [job](https://docs.octoprint.org/en/master/api/job.html): POST `/api/job` start/cancel/restart/pause (PRINT).
  - [files](https://docs.octoprint.org/en/master/api/files.html): upload takes `print=true`.
  - [connection](https://docs.octoprint.org/en/master/api/connection.html): connect/disconnect/`fake_ack` (the docs warn `fake_ack` is for emergencies only).
- **OctoPrint permissions:** access control has been mandatory since 1.5.0. A built-in "Read-only Access" group exists, so a status-only key is possible ([accesscontrol](https://docs.octoprint.org/en/maintenance/features/accesscontrol.html)).
- **OctoPrint emergency commands:** defaults are `emergencyCommands = ["M112","M108","M410"]` and `emergency_parser: True`, which sends them out of band ([serial.py](https://github.com/OctoPrint/OctoPrint/blob/master/src/octoprint/schema/config/serial.py)).
- **OctoPrint virtual printer:** a bundled plugin enabled with `plugins.virtual_printer.enabled`. It simulates temperatures, SD, M105/M115 and edge conditions through `!!DEBUG:` ([virtual_printer](https://docs.octoprint.org/en/master/development/virtual_printer.html)).
- **OctoPrint on the internet:** its own blog says exposing it publicly is "a terrible idea" because of heaters, motors and firmware flashing ([blog](https://octoprint.org/blog/2018/09/03/safe-remote-access/)).
- **PrusaLink** ([openapi.yaml](https://github.com/prusa3d/Prusa-Link-Web/blob/master/spec/openapi.yaml)):
  - Security scheme is `digestAuth`.
  - Paths: `/api/v1/info|status|job`, PUT `/job/{id}/pause|resume|continue`, DELETE `/job/{id}`, PUT `/api/v1/files/{storage}/{path}` with header `Print-After-Upload: ?1`, POST on a file to start it.
  - **The spec has no raw G-code, jog or temperature endpoint.**
- **Bambu Lab:**
  - Authorization Control ([2025-01-16 blog](https://blog.bambulab.com/firmware-update-introducing-new-authorization-control-system-2/)) gates "Initiating a print job (via LAN or cloud)" and "Controlling motion system, temperature, fans, AMS settings, calibrations". It started with X1 firmware 01.08.03.00. Status pushes over MQTT and SD-card prints stay open.
  - Developer Mode ([2025-01-20 blog](https://blog.bambulab.com/updates-and-third-party-integration-with-bambu-connect/)) leaves "MQTT channel, live stream, and FTP open"; the user assumes "full responsibility" and gets no support.
  - MQTT details (community reverse-engineering, not official): TLS on 8883, user `bblp`, password is the LAN access code, topics `device/{serial}/request|report`, commands `stop/pause/resume/gcode_line` ([OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)).

## 3. GRBL, grblHAL, FluidNC, senders, simulators, Marlin

- **GRBL real-time commands** ([Commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands)) are intercepted immediately, never buffered: `?` status, `!` hold, `~` resume, `0x18` soft reset, `0x84` door, `0x85` jog cancel (flushes queued jogs), `0x90+` overrides.
- **Jogging:** `$J=X10 F100` needs an explicit feed rate. A soft-limit violation just returns an error.
- **`$C` check mode is the dry run.** It parses every block "but it does not move any of the axes, ignores dwells, and powers off the spindle and coolant", and checks soft limits. Turning it off triggers an automatic soft reset, which clears G92 ([Interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface)).
- **`$X`:** "This should only be used in emergency situations… position has likely been lost."
- **Settings** ([Configuration](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration)):
  - `$20` soft limits need homing and correct `$130–132` max travel; when triggered: feed hold, alarm, position kept.
  - `$21` hard limits: stop at once, "likely have lost steps".
  - `$22` homing locks G-code until `$H` or `$X`. `$110–112` max rate (mm/min).
  - `$32` laser mode comes with an explicit fire and eye warning.
  - `$N` startup lines run on reset (they can contain motion).
  - Alarm 1 = hard limit, 2 = soft limit, 3 = reset during motion. Grbl prints `[MSG:Reset to continue]` after a limit alarm.
- **grblHAL:**
  - Same core real-time bytes, plus `0x19` stop and `0x87` full status ([grbl.h](https://github.com/grblHAL/core/blob/master/grbl.h)).
  - **Alarm 10 is E-stop in grblHAL** ([alarms.h](https://github.com/grblHAL/core/blob/master/alarms.h)) but a homing failure in GRBL 1.1. Code tables differ between firmwares.
  - Inputs are normally closed by default, including a hardware E-stop input ([README](https://github.com/grblHAL/core)).
- **FluidNC** (2,585 stars, pushed 2026-10-04):
  - Per-axis `max_rate_mm_per_min` (default 1000), `acceleration_mm_per_sec2`, `max_travel_mm` (default 1000).
  - **`soft_limits` defaults to false** and "relies on accurate machine position… always home" ([Axis.cpp](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/Axis.cpp)).
  - Ports are unverified and sources conflict: websocket on 81/82 according to DeepWiki-derived search results, `ws://host:80/` according to [cnc-fluidnc-mcp](https://github.com/WhitneyDesignLabs/cnc-fluidnc-mcp). Telnet on 23 is also unverified. The official wiki refused connections.
- **CNCjs** (MIT, 2,646 stars):
  - socket.io events `open/close/command/write/writeln`; commands include gcode, start/pause/stop, homing, unlock, reset ([Controller-API](https://github.com/cncjs/cncjs/wiki/Controller-API)).
  - Pendants sign a JWT with the `~/.cncrc` secret; default port 8000; token lifetime 30 d ([pendant-boilerplate](https://github.com/cncjs/cncjs-pendant-boilerplate)).
- **UGS** (GPL-3.0): a web pendant on port 8080 at `/api/v1`. This comes from [ugs-mcp](https://github.com/zackpeters93/ugs-mcp) and search results; I did not check it in UGS's own docs.
- **Headless G-code simulators:**
  - CAMotics `camsim [opts] in.gcode out.stl` writes the cut-workpiece STL. GPL-2.0-or-later ([camsim.cpp](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/master/src/camsim.cpp)).
  - npm, all MIT: `gcode-parser` 2.2.0, `gcode-interpreter` 3.0.0, `gcode-toolpath` 3.0.0 (all cncjs), and `gcode-preview` 2.18.0 (three.js-based).
  - NC Viewer: [NCalu/NCviewer](https://github.com/NCalu/NCviewer) has **no LICENSE file**. Whether ncviewer.com is open source is unverified.
- **Marlin:**
  - [M112](https://marlinfw.org/docs/gcode/M112.html) shuts down; reset required. [M410](https://marlinfw.org/docs/gcode/M410.html) stops steppers instantly; position is lost. [M108](https://marlinfw.org/docs/gcode/M108.html) breaks out of heating waits.
  - All three need `EMERGENCY_PARSER`, which is **commented out by default** in Configuration_adv.h. Without it they wait behind the queue.
  - Thermal protection for hotends, bed and chamber is on by default: hotend 40 s/4 °C, bed 20 s/2 °C, plus a heating watch period ([Configuration.h](https://github.com/MarlinFirmware/Marlin/blob/bugfix-2.1.x/Marlin/Configuration.h), [Configuration_adv.h](https://github.com/MarlinFirmware/Marlin/blob/bugfix-2.1.x/Marlin/Configuration_adv.h)).
  - Persistent or destructive codes ([index](https://marlinfw.org/meta/gcode/)): M500 save, M502 factory reset, M997 firmware update, M80/M81 PSU power, M42 set pin, M303 PID autotune (heats).

## 4. CAD and slicers, headless

- **OpenSCAD:**
  - Last stable release is still 2021.01. `openscad-2026.10-TEST*` tags appeared on 2026-10-02/04; an actual release is unverified.
  - Manifold became the snapshot default in Aug 2025 ([list](https://lists.openscad.org/empathy/thread/TMJEJCZINIJNYJX2YF7IDNBAPQY66KIF)); `--backend` is nightly-only.
  - CLI: `-o`, `-D var=val`, `--export-format binstl|asciistl`, `--render`, `--imgsize`, `--camera`, `--summary` ([manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment)).
  - Licence is GPL-2.0 with a CGAL exception ([COPYING](https://github.com/openscad/openscad/blob/master/COPYING)), which only matters if you bundle it.
- **CadQuery and cq-cli** ([cq-cli](https://github.com/CadQuery/cq-cli)): both Apache-2.0. Flags include `--codec stl|step|glb`, `--params`, `--validate`. **The scripts are arbitrary Python.**
- **build123d** (Apache-2.0): `export_stl(..., tolerance, angular_tolerance, ascii_format)`, `export_step`, `export_gltf`, and 3MF through `Mesher` ([docs](https://build123d.readthedocs.io/en/latest/import_export.html)).
- **FreeCAD** (LGPL-2.1): `FreeCADCmd script.py` plus `Mesh.export` ([forum](https://forum.freecad.org/viewtopic.php?t=42596)). The official wiki was blocked by bot protection, so details beyond that are unverified.
- **Webview preview:**
  - three.js 0.186.1 (MIT): three.module.min.js 393 KB plus three.core.min.js 416 KB, uncompressed. STLLoader is 11 KB.
  - Online3DViewer (MIT): o3dv.min.js 1.06 MB.
  - `<model-viewer>` (Apache-2.0): 1.07 MB. I believe it is glTF-only; unverified.
- **Slicers:**
  - PrusaSlicer (AGPL-3.0): `export-gcode|gcode|g`, `--load`, `--info`, `--datadir` exist in source ([PrintConfig.cpp](https://github.com/prusa3d/PrusaSlicer/blob/master/src/slic3r-shared/src/Slic3r/Biz/Config/Legacy/PrintConfig.cpp)). Latest stable 2.9.6, plus 3.0.0-alpha12. The [wiki CLI page](https://github.com/prusa3d/PrusaSlicer/wiki/Command-Line-Interface) is unmaintained and says to use `--help`; on Windows use `prusa-slicer-console.exe`.
  - OrcaSlicer (AGPL-3.0) has an official documented CLI ([wiki](https://www.orcaslicer.com/wiki/cli/cli_mode)): `--slice`, `--export-3mf`, `--load-settings`, `--load-filaments`, `--arrange`, `--outputdir`.
  - CuraEngine (AGPL-3.0): `CuraEngine slice -j def.json -s key=val -l model.stl -o out.gcode` ([Application.cpp](https://github.com/Ultimaker/CuraEngine/blob/main/src/Application.cpp)).

## 5. Existing MCP servers

Stars and last push are as of 2026-10-05. Registry hits come from [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/v0/servers). I did not survey smithery or mcp.so.

**3D printers**

| Server                                                                                        | Stars, licence, last push            | How it gates physical actions                                                                                                                                            |
| --------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [DMontgomery40/mcp-3D-printer-server](https://github.com/DMontgomery40/mcp-3D-printer-server) | 245, GPL-2.0, 09-29                  | **Human confirmation through MCP elicitation** for every print start and positive heater target; refuses clients that cannot ask. Heater-off and cancel are never gated. |
| [DMontgomery40/bambu-printer-mcp](https://github.com/DMontgomery40/bambu-printer-mcp)         | 172, GPL-2.0, 10-05, in the registry | Same elicitation gate.                                                                                                                                                   |
| [codeofaxel/Kiln](https://github.com/codeofaxel/Kiln)                                         | 90, AGPL-3.0                         | "A person says go" before every print (client dialog or a typed on-screen code); temperature caps; blocked G-codes. Users can opt out for up to a day.                   |
| [OctoEverywhere/mcp](https://github.com/OctoEverywhere/mcp)                                   | 38, Apache-2.0, 2025-07              | Cloud service; pause/resume/cancel only; no gating described.                                                                                                            |
| [Charleslotto/klipper-mcp](https://github.com/Charleslotto/klipper-mcp)                       | 25, no licence                       | `ARMED=False` by default; fail-closed read-only mode.                                                                                                                    |
| [mikehatch/KlipperMCP](https://github.com/mikehatch/KlipperMCP)                               | 7                                    | Confirmation for heating, motion, cancel and restarts.                                                                                                                   |
| [nixkor/moonraker-mcp](https://github.com/nixkor/moonraker-mcp)                               | 1, MIT                               | `confirm=true` only for heater commands, e-stop and restarts. **Motion G-code is not gated.**                                                                            |
| [schwarztim/bambu-mcp](https://github.com/schwarztim/bambu-mcp)                               | 22, MIT                              | Blocklist (M112, M500, M502, M997, M999). Advertises "Bypass firmware auth restrictions with certificate signing".                                                       |
| [griches/bambu-mcp](https://github.com/griches/bambu-mcp)                                     | 53, no licence                       | Blocklist and temperature limits.                                                                                                                                        |
| [synman/bambu-mcp](https://github.com/synman/bambu-mcp)                                       | 5                                    | `user_permission=True` flag.                                                                                                                                             |

**CNC**

| Server                                                                                    | Stars, licence | How it gates physical actions                                                     |
| ----------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| [zackpeters93/ugs-mcp](https://github.com/zackpeters93/ugs-mcp)                           | 5, MIT         | uuid token that expires in 2 min.                                                 |
| [WhitneyDesignLabs/cnc-fluidnc-mcp](https://github.com/WhitneyDesignLabs/cnc-fluidnc-mcp) | 0, MIT         | `confirm: true` for dangerous commands; **jog and home run with only a warning.** |
| [georgesFoundation/grbl-mcp](https://github.com/georgesFoundation/grbl-mcp)               | 0, GPL-3.0     | None documented.                                                                  |

**These "confirm" flags are not human approval.** ugs-mcp's [motion.py](https://github.com/zackpeters93/ugs-mcp/blob/HEAD/ugs_mcp/tools/motion.py) puts the token in the tool result ("show the user this confirmation token"), so the model can read it and pass it back itself. Plain `confirm=true` and `user_permission=True` flags are equally self-settable. Only host- or client-side prompts (elicitation, or Kiln's on-screen code) involve a human. That is my reading of the code and READMEs.

**CAD and electronics**

- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp): 30,028 stars, MIT. Runs arbitrary Python by default; `BLENDER_MCP_SAFE_MODE=1` blocks file, process and network access.
- [neka-nat/freecad-mcp](https://github.com/neka-nat/freecad-mcp): 2,692, MIT. Has a code-execution doc.
- [mixelpixx/KiCAD-MCP-Server](https://github.com/mixelpixx/KiCAD-MCP-Server): 2,582, MIT.
- OpenSCAD: [jhacksman](https://github.com/jhacksman/OpenSCAD-MCP-Server) 200, MIT; [RobertCoop](https://github.com/RobertCoop/openscad-mcp) 149, MIT, has `allowed_paths` and a threat model.
- [pzfreo/build123d-mcp](https://github.com/pzfreo/build123d-mcp): 103, Apache-2.0, in the registry.
- [rishigundakaram/cadquery-mcp-server](https://github.com/rishigundakaram/cadquery-mcp-server): 20, no licence.
- [jl-codes/platformio-mcp](https://github.com/jl-codes/platformio-mcp): 52, MIT. allow/deny/`requires_approval` policy; flashing needs approval through a CLI, outside the model.
- Wokwi: official, experimental, `wokwi-cli mcp`, needs a token ([docs](https://docs.wokwi.com/wokwi-ci/mcp-support)).
- ESP-IDF 6.0 ships `idf.py mcp-server` (build/flash) ([Espressif](https://developer.espressif.com/blog/2026/04/esp-idf-tools-mcp-server/)).
- Arduino: community servers only, e.g. [hardware-mcp](https://github.com/hardware-mcp/arduino-mcp-server).
- Serial: [Adancurusul](https://github.com/Adancurusul/serial-mcp-server) 94, MIT, has macro `--dry-run`; [es617](https://github.com/es617/serial-mcp-server) 24, MIT, warns that "Always allow" means the agent can act unsupervised.
- [robotmcp/ros-mcp-server](https://github.com/robotmcp/ros-mcp-server): 1,484, Apache-2.0. Publishes topics and calls services; no motion gating documented.

**Incidents and warnings**

- [LLM-3D Print](https://arxiv.org/html/2408.14307): giving the model full firmware docs overflowed its context and caused "unintended LLM-driven shutdowns". The fix was to exclude shutdown, restart and firmware commands.
- nixkor's README says gating "is not a substitute for a human watching hot, moving hardware. Keep an emergency stop within reach." ugs-mcp says "Know where your E-stop is."

## 6. Safety references

- **ISO 13850:2015 §4.1.1.3:** the e-stop "is a complementary protective measure and shall not be applied as a substitute for safeguarding". It takes a single human action, is always available, overrides other functions, and resetting it must not restart the machine. Minimum PL c or SIL 1. Source is the secondary [machinerysafety101](https://machinerysafety101.com/2026/05/18/iso-13850-emergency-stop-requirements/); iso.org returned 403.
- **IEC 60204-1:2016** ([IEC](https://webstore.iec.ch/en/publication/26037)) covers emergency stop. Stop category 0 removes power immediately; category 1 is a controlled stop, then power removal. The category text is secondary ([Schneider FAQ](https://www.se.com/us/en/faqs/FA122781/)).
- **A software e-stop is not a substitute for a physical one.** No source says it in those words. It follows from the above, plus: Marlin's own M112 doc calls it a control stop rather than a formal safety-rated e-stop, M112 can be queued (Moonraker, Marlin without EMERGENCY_PARSER), and the host link can fail. Treat the conclusion as my synthesis.
- **Unattended printing:** I found no regulator (CPSC/OPSS) guidance; that is unverified. Bambu says never leave the machine during laser jobs ([H2D FAQ](https://bambulab.com/en-us/h2d/faq)).

## Facts a design must respect

- **Read-only:** Moonraker `printer.info`, `objects.list/query/subscribe`, `query_endstops/status`, `gcode/help`, `server/files/list/metadata`, `device_power/devices|status`; OctoPrint GET `/api/printer|job|connection|files`; PrusaLink GET `/api/v1/*`; Bambu `pushall`/report; GRBL `?`, `$$`, `$#`, `$G`, `$I`.
- **Moves, heats or powers (gate every call):**
  - Moonraker `gcode/script`, `print/start|resume|pause` (PAUSE parks), `cancel` (may park), `firmware_restart`, `restart`, `device_power/*`, `/machine/shutdown|reboot`, upload with `print=true` or into `root=config`.
  - OctoPrint printhead/tool/bed/chamber/command, `/api/job`, upload with `print=true`.
  - PrusaLink file PUT/POST with `Print-After-Upload`.
  - Bambu `gcode_line` and project print.
  - GRBL `$J=`, `$H`, `$X`, `$N`, streaming, `~`; CNCjs `command`/`write`; Marlin M80, M42, M303.
- **Stop paths must be ungated and out of band:** Moonraker `/printer/emergency_stop` (never M112 through `gcode/script`), GRBL `!`, `0x85`, `0x18`. Cooling and stopping lower the energy, but Klipper cancel still runs a user macro.
- **Approval must come from the host's UI.** A token or `confirm` flag that the model can see or set is not human approval.
- **Moonraker auth is all or nothing,** and its unix socket and `trusted_clients` skip auth. Limits have to be enforced on the extension side.
- **Limits are trustworthy only after homing** (Klipper `homed_axes`, GRBL `$20`/`$22`, FluidNC `soft_limits`, which is off by default). Read live limits rather than hard-coding them.
- **Alarm codes differ between firmwares** (alarm 10 is E-stop in grblHAL, a homing failure in GRBL 1.1).
- **Dry runs:** GRBL `$C` (exiting it soft-resets), Klipper batch mode, virtual-klipper-printer, OctoPrint's virtual printer, CAMotics `camsim`, the MIT cncjs parsers.
- **Bambu:** don't circumvent Authorization Control. Developer Mode is the supported path.
- **Bundling:** OpenSCAD, CAMotics and UGS are GPL; PrusaSlicer, OrcaSlicer and CuraEngine are AGPL. Bundling any of them carries licence obligations, while running a user-installed copy does not.
- **CAD scripts:** CadQuery, build123d, FreeCAD and Blender scripts are arbitrary code and should be sandboxed.

**Unverified:** FluidNC ports; UGS pendant paths from UGS's own docs; `<model-viewer>` STL support; licensing of ncviewer.com; FreeCAD CLI details beyond the forum; the primary text of ISO 13850 and IEC 60204-1; any OpenSCAD 2026 release.

Scratch downloads are in `C:\Users\Randy\AppData\Local\Temp\claude\c--Users-Randy-Coding-muse-extension\f5e67bec-452c-4384-85e7-efedc257d060\scratchpad\`.
