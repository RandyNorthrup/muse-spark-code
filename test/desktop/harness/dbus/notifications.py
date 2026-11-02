#!/usr/bin/env python3
"""A real org.freedesktop.Notifications endpoint that records (M111 QA).

Implements the freedesktop notification specification (version 1.2) as a
sink: Notify hands out ids and writes one JSON line per notification to
$MUSE_HARNESS_RECORD, so a test can assert what real client code sent
over a real bus. CloseNotification emits NotificationClosed with reason
3 (closed by a call), as the specification requires.

Test-only: the desktop's own notification server is lane SH2. This sink
never stands in for it in a product test; it is the receiving end a
harness client talks to when the shell is not the thing under test.
"""

import json
import os
import sys

import gi

gi.require_version("Gio", "2.0")
gi.require_version("GLib", "2.0")
from gi.repository import Gio, GLib

BUS_NAME = "org.freedesktop.Notifications"
OBJECT_PATH = "/org/freedesktop/Notifications"

XML = """
<node>
  <interface name="org.freedesktop.Notifications">
    <method name="GetCapabilities">
      <arg type="as" name="capabilities" direction="out"/>
    </method>
    <method name="Notify">
      <arg type="s" name="app_name" direction="in"/>
      <arg type="u" name="replaces_id" direction="in"/>
      <arg type="s" name="app_icon" direction="in"/>
      <arg type="s" name="summary" direction="in"/>
      <arg type="s" name="body" direction="in"/>
      <arg type="as" name="actions" direction="in"/>
      <arg type="a{sv}" name="hints" direction="in"/>
      <arg type="i" name="expire_timeout" direction="in"/>
      <arg type="u" name="id" direction="out"/>
    </method>
    <method name="CloseNotification">
      <arg type="u" name="id" direction="in"/>
    </method>
    <method name="GetServerInformation">
      <arg type="s" name="name" direction="out"/>
      <arg type="s" name="vendor" direction="out"/>
      <arg type="s" name="version" direction="out"/>
      <arg type="s" name="spec_version" direction="out"/>
    </method>
    <signal name="NotificationClosed">
      <arg type="u" name="id"/>
      <arg type="u" name="reason"/>
    </signal>
    <signal name="ActionInvoked">
      <arg type="u" name="id"/>
      <arg type="s" name="action_key"/>
    </signal>
  </interface>
</node>
"""

next_id = 1
open_ids = set()


def record(entry):
    path = os.environ.get("MUSE_HARNESS_RECORD")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")


def on_method(connection, sender, path, interface, method, params, invocation):
    global next_id
    if method == "GetCapabilities":
        invocation.return_value(GLib.Variant("(as)", (["body"],)))
        return
    if method == "Notify":
        app_name, replaces_id, app_icon, summary, body, actions, hints, timeout = (
            params.unpack()
        )
        nid = replaces_id if replaces_id in open_ids else next_id
        if nid == next_id:
            next_id += 1
        open_ids.add(nid)
        record(
            {
                "service": "notifications",
                "method": "Notify",
                "sender": sender,
                "id": nid,
                "app_name": app_name,
                "summary": summary,
                "body": body,
                "actions": list(actions),
                "hints": {key: repr(value) for key, value in hints.items()},
                "expire_timeout": timeout,
            }
        )
        invocation.return_value(GLib.Variant("(u)", (nid,)))
        return
    if method == "CloseNotification":
        (nid,) = params.unpack()
        if nid not in open_ids:
            invocation.return_dbus_error(
                "org.freedesktop.DBus.Error.InvalidArgs",
                f"Notification {nid} is not open.",
            )
            return
        open_ids.discard(nid)
        record(
            {"service": "notifications", "method": "CloseNotification", "id": nid}
        )
        connection.emit_signal(
            None,
            OBJECT_PATH,
            BUS_NAME,
            "NotificationClosed",
            GLib.Variant("(uu)", (nid, 3)),
        )
        invocation.return_value(None)
        return
    if method == "GetServerInformation":
        invocation.return_value(
            GLib.Variant(
                "(ssss)",
                ("Muse Desktop QA sink", "Muse Spark Code (Unofficial)", "1.0", "1.2"),
            )
        )
        return
    invocation.return_dbus_error(
        "org.freedesktop.DBus.Error.UnknownMethod", f"Unknown method {method}"
    )


def main():
    loop = GLib.MainLoop()
    node = Gio.DBusNodeInfo.new_for_xml(XML)

    def on_acquired(connection, name):
        connection.register_object(OBJECT_PATH, node.interfaces[0], on_method, None, None)
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
