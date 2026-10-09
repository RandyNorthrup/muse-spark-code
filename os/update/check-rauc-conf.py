#!/usr/bin/env python3
"""Check RAUC system.conf files against RAUC 1.13's parser rules (OS2, M110).

Implements the documented invariants from RAUC 1.13 src/config_file.c
without running a RAUC binary (forbidden in this lane):

- the custom backend handler lives under [handlers] as
  bootloader-custom-backend, never under [system];
- every bootname is unique across the file;
- a child slot (one with `parent`) carries no bootname of its own;
- every `parent` names an existing slot section;
- every slot has a device and a type.

Usage: check-rauc-conf.py <system.conf> [more ...]
Prints one line per file (RAUC_CONF_OK or RAUC_CONF_<reason>); exit 0 only
when every file passes.
"""

import configparser
import sys
from pathlib import Path


def check_file(text, name):
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    try:
        parser.read_string(text)
    except configparser.Error:
        return f"RAUC_CONF_UNPARSEABLE {name}"
    sections = parser.sections()

    handler = None
    if parser.has_section("handlers"):
        handler = parser["handlers"].get("bootloader-custom-backend")
    if parser.has_section("system") and parser["system"].get(
        "bootloader-custom-backend"
    ):
        return f"RAUC_CONF_HANDLER_SECTION {name}"
    if (
        parser.has_section("system")
        and parser["system"].get("bootloader") == "custom"
        and not handler
    ):
        return f"RAUC_CONF_HANDLER_MISSING {name}"

    slots = [s for s in sections if s.startswith("slot.")]
    if not slots:
        return f"RAUC_CONF_NO_SLOTS {name}"
    seen_bootnames = {}
    for slot in slots:
        items = dict(parser[slot])
        if not items.get("device") or not items.get("type"):
            return f"RAUC_CONF_SLOT_INCOMPLETE {name} {slot}"
        parent = items.get("parent")
        bootname = items.get("bootname")
        if parent:
            if bootname:
                return f"RAUC_CONF_CHILD_BOOTNAME {name} {slot}"
            if f"slot.{parent}" not in sections:
                return f"RAUC_CONF_PARENT_MISSING {name} {slot}"
        if bootname:
            if bootname in seen_bootnames:
                return f"RAUC_CONF_DUPLICATE_BOOTNAME {name} {bootname}"
            seen_bootnames[bootname] = slot
    return ""


def main(argv):
    if not argv:
        print("usage: check-rauc-conf.py <system.conf> [...]")
        return 2
    failed = False
    for path in argv:
        try:
            text = Path(path).read_text()
        except OSError:
            print(f"RAUC_CONF_UNREADABLE {path}")
            failed = True
            continue
        problem = check_file(text, path)
        if problem:
            print(problem)
            failed = True
        else:
            print(f"RAUC_CONF_OK {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
