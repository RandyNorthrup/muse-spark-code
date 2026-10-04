#!/usr/bin/env python3
"""Validate a native delivery plan or print scoped evidence fingerprints.

Requires Python 3.12+. Exit 0 means the requested check completed successfully;
exit 1 means a failed requirement; exit 2 means malformed or unreadable input.
The command never executes the argv recorded in an evidence receipt.
"""

import sys

from delivery.cli import run


def main() -> int:
    """Print the native validator's report and propagate its exact result."""
    code, output = run()
    print(output)
    return code


if __name__ == "__main__":
    sys.exit(main())
