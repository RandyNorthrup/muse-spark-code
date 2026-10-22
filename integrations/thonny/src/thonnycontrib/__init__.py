"""Third-party Thonny plugins live in the shared ``thonnycontrib`` namespace.

This file uses the ``pkgutil`` style so our ``muse_spark`` subpackage coexists
with other installed ``thonnycontrib`` plugins instead of shadowing them.
"""

__path__ = __import__("pkgutil").extend_path(__path__, __name__)  # type: ignore
