"""Emit Zed's supported custom-agent and companion-task configuration."""

import argparse
import json
import shlex
import sys
from pathlib import Path


def configuration(agent, python, agent_script=None):
    """Return authored Zed settings/tasks without writing user settings."""
    launcher = str(Path(__file__).with_name("launch.py").resolve())
    agent_args = [agent]
    if agent_script is not None:
        if not agent_script:
            raise ValueError("EPANEL_ARGUMENTS")
        agent_args.extend(["--agent-script", agent_script])
    # Native tasks build shell text; custom ACP commands remain exec argv.
    if sys.platform == "win32":
        def quote(part):
            return "'" + part.replace("'", "''") + "'"
        task_command = "& " + quote(python)
        task_shell = {"program": "powershell.exe"}
    else:
        quote = shlex.quote
        task_command = quote(python)
        task_shell = {"program": "/bin/sh"}
    tasks = []
    for mode in ("panel", "stop"):
        tasks.append({
            "label": "Muse Spark Code (Unofficial): " + mode,
            "command": task_command,
            "args": [quote(part) for part in ["-I", launcher, mode, *agent_args]],
            "shell": task_shell,
            "allow_concurrent_runs": mode == "stop",
            "use_new_terminal": True,
            "reveal": "never", "show_command": False, "show_summary": False, "save": "none",
        })
    return {
        "settings": {
            "agent_servers": {
                "Muse Spark Code (Unofficial)": {
                    "type": "custom",
                    "command": python,
                    "args": ["-I", launcher, "acp", *agent_args],
                    "env": {},
                }
            }
        },
        "tasks": tasks,
    }


def main():
    """Print configuration for the owner's explicit settings merge."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", default="muse-spark-code-acp")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--agent-script")
    args = parser.parse_args()
    print(
        json.dumps(configuration(args.agent, args.python, args.agent_script), indent=2)
    )


if __name__ == "__main__":
    main()
