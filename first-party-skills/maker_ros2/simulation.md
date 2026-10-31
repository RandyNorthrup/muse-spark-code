# ROS 2 and isolated simulation

Use the workspace's pinned ROS distribution and matching Gazebo release;
do not mix system installations. Read package.xml and existing launch/test
configuration, then build and run package tests.
<!-- recipe:ros-build -->

```sh
colcon build
```

<!-- recipe:ros-test -->

```sh
colcon test
```

<!-- recipe:ros-report -->

```sh
colcon test-result --verbose
```

<!-- recipe:ros-doctor -->

```sh
ros2 doctor --report
```

<!-- recipe:ros-bag -->

```sh
ros2 bag info recording.mcap
```

For Gazebo, isolate the simulation's ROS domain and transport from real
robots; review launch files for hardware drivers before executing them.
Confirm the controller command timeout and stale-sensor stop in tests.
Introspection is read-only, but bounded topic echo still needs a host
process deadline when no messages arrive.

Physical robots are status-and-stop only in this delivery. Do not publish
motion topics, call hardware services, send action goals or change hardware
parameters through a shell/MCP workaround. Any future allowed actuation must
ask through the host's approval surface for exact payloads and live limits;
a model-set confirm flag is never approval. Keep the robot's physical E-stop
for drive and joint power available; ROS cancel, a zero velocity message,
twist_mux or stale-command software stops are not emergency stops.

[ROS doctor](https://docs.ros.org/en/humble/Tutorials/Beginner-Client-Libraries/Getting-Started-With-Ros2doctor.html),
[Gazebo ROS pairing](https://gazebosim.org/docs/latest/ros_installation/),
[controller timeout](https://control.ros.org/rolling/doc/ros2_controllers/diff_drive_controller/doc/userdoc.html).
