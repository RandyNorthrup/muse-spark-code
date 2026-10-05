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
    if len(argv) != 2 or argv[0] not in ("acp", "panel") or not argv[1]:
        raise ValueError("EPANEL_ARGUMENTS")
    mode, agent = argv
    command = [agent] if mode == "acp" else [agent, "panel", "--companion"]
    os.execvpe(agent, command, dict(os.environ))


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (OSError, ValueError):
        sys.exit("EPANEL_LAUNCH")
