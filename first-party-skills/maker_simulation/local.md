# Local simulation first

Choose by the project's chip and actual test needs. Espressif QEMU can check
supported ESP boot/logic, but not Wi-Fi, Bluetooth or unimplemented peripheral
paths. Renode uses the project's supported platform and Robot test file:
<!-- recipe:renode-test -->

```sh
renode-test tests.robot
```

Keep time and output bounds even for a simulator. Gazebo simulation must use
an isolated ROS domain with hardware drivers excluded. Virtual Klipper and
OctoPrint's Virtual Printer exercise API behavior without motors/heaters;
do not point a test at the registered real printer as a fallback.

A simulated success is not a serial reset, USB re-enumeration, thermal or
wiring test. Before moving from simulation to connect or programming, ask
through the host's approval surface for the real target and exact payload.
Identify the real machine's physical E-stop or board-and-actuator supply
disconnect first. Never call simulator controls permission for real hardware.

[Espressif QEMU](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/qemu.html),
[Renode testing](https://renode.readthedocs.io/en/latest/introduction/testing.html).
