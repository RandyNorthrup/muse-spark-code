#!/usr/bin/env python3
"""Harness-owned D-Bus canary (M111 lane QA, test-only).

Owns org.muse.TestHarness.Canary1 on the session bus it is started on.
Ping echoes its argument and counts; Fail returns a named error on
purpose, so callers can prove their error path against a real bus.
Every call appends one JSON line to $MUSE_HARNESS_RECORD when set.

This service is a canary endpoint for the harness's own checks. It is
not a stand-in for any system service, and product code never calls it.
"""

import json
import os
import sys

import gi

gi.require_version("Gio", "2.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gio, GLib

BUS_NAME = "org.muse.TestHarness.Canary1"
OBJECT_PATH = "/org/muse/TestHarness/Canary1"
INTERFACE = "org.muse.TestHarness.Canary1"

XML = """
<node>
  <interface name="org.muse.TestHarness.Canary1">
    <method name="Ping">
      <arg type="s" name="message" direction="in"/>
      <arg type="s" name="reply" direction="out"/>
    </method>
    <method name="Fail"/>
    <property name="PingCount" type="u" access="read"/>
  </interface>
</node>
"""

count = 0


def record(entry):
    path = os.environ.get("MUSE_HARNESS_RECORD")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


def on_method(connection, sender, path, interface, method, params, invocation):
    global count
    if method == "Ping":
        (message,) = params.unpack()
        count += 1
        record({"service": "canary", "method": "Ping", "sender": sender, "message": message})
        invocation.return_value(GLib.Variant("(s)", (message,)))
        return
    if method == "Fail":
        record({"service": "canary", "method": "Fail", "sender": sender})
        invocation.return_dbus_error(
            "org.muse.TestHarness.Error.CanaryRequested",
            "The canary was asked to fail.",
        )
        return
    invocation.return_dbus_error(
        "org.freedesktop.DBus.Error.UnknownMethod", f"Unknown method {method}"
    )


def on_get_property(connection, sender, path, interface, prop):
    if prop == "PingCount":
        return GLib.Variant("u", count)
    return None


def main():
    loop = GLib.MainLoop()
    node = Gio.DBusNodeInfo.new_for_xml(XML)

    def on_acquired(connection, name):
        connection.register_object(
            OBJECT_PATH, node.interfaces[0], on_method, on_get_property, None
        )
        print(f"READY {name}", flush=True)

    def on_lost(connection, name):
        print(f"LOST {name}", flush=True)
        loop.quit()

    Gio.bus_own_name(
        Gio.BusType.SESSION,
        BUS_NAME,
        Gio.BusNameOwnerFlags.NONE,
        None,
        on_acquired,
        on_lost,
    )
    loop.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
