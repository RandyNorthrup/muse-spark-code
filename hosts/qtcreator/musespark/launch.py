"""Trusted environment scrubber for Qt Creator's environment-less Lua API."""

import os
import re
import subprocess
import sys

_FORBIDDEN = frozenset(
    (
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "OPENAI_KEY",
        "ANTHROPIC_KEY",
        "META_KEY",
    )
)
_LAUNCH = re.compile(r"http://(?:127\.0\.0\.1|\[::1\]):([0-9]+)/#k=[A-Za-z0-9_-]+")


def main(argv):
    """Scrub before any child; exec the trusted runtime or system browser."""
    for name in list(os.environ):
        if name.upper().endswith("_API_KEY") or name.upper() in _FORBIDDEN:
            del os.environ[name]
    if len(argv) == 4 and argv[2] == "--agent-script" and argv[3]:
        mode, value = argv[:2]
        prefix = [value, argv[3]]
        if mode not in ("panel", "lsp", "stop"):
            raise ValueError("EPANEL_ARGUMENTS")
    elif len(argv) == 2:
        mode, value = argv
        prefix = [value]
    else:
        raise ValueError("EPANEL_ARGUMENTS")
    if not value:
        raise ValueError("EPANEL_ARGUMENTS")
    if mode == "panel":
        command = [*prefix, "supervise", "panel", "--companion"]
    elif mode in ("lsp", "stop"):
        command = [*prefix, mode]
    elif mode == "open":
        match = _LAUNCH.fullmatch(value)
        if not match or not 0 < int(match[1]) <= 65535:
            raise ValueError("EPANEL_LAUNCH_URL")
        if sys.platform == "win32":
            raise ValueError("EPANEL_OPENER_REQUIRED")
        command = ["open" if sys.platform == "darwin" else "xdg-open", value]
        result = subprocess.run(
            command,
            env=dict(os.environ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError("EPANEL_LAUNCH")
        return
    else:
        raise ValueError("EPANEL_ARGUMENTS")
    os.execvpe(command[0], command, dict(os.environ))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError):
        sys.exit("EPANEL_LAUNCH")
