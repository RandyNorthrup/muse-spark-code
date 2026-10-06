"""Zed bootstrap: scrub credential variables before execing the runtime."""

import os
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


def main(argv):
    """Launch ACP or the companion without a shell or credential environment."""
    for name in list(os.environ):
        if name.upper().endswith("_API_KEY") or name.upper() in _FORBIDDEN:
            del os.environ[name]
    if len(argv) == 4 and argv[2] == "--agent-script" and argv[3]:
        prefix = [argv[1], argv[3]]
    elif len(argv) == 2:
        prefix = [argv[1]]
    else:
        raise ValueError("EPANEL_ARGUMENTS")
    if argv[0] not in ("acp", "panel") or not prefix[0]:
        raise ValueError("EPANEL_ARGUMENTS")
    command = prefix if argv[0] == "acp" else [*prefix, "panel", "--companion"]
    os.execvpe(prefix[0], command, dict(os.environ))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError):
        sys.exit("EPANEL_LAUNCH")
