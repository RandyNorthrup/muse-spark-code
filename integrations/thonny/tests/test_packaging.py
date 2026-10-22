"""Static packaging guards: what the built files must and must not contain.

Builds nothing and opens no socket: every check reads only
``pyproject.toml``, ``MANIFEST.in`` and the source tree, so a missing wheel
member or a stray sdist member fails here before any publish is attempted.
"""

from pathlib import Path
import re

THONNY = Path(__file__).resolve().parents[1]
SRC = THONNY / "src" / "thonnycontrib" / "muse_spark"
LOCALE = SRC / "locale"

EXPECTED_MODULES = ("__init__", "bridge", "companion", "l10n", "notices",
                    "process_tree", "protocol", "runner", "runtime")
EXPECTED_LOCALES = ("cs", "de", "es", "fr", "hu", "it", "ja", "ko", "pl",
                    "pt_BR", "ru", "tr", "zh_CN", "zh_TW")


def _package_data_patterns():
    text = (THONNY / "pyproject.toml").read_text(encoding="utf-8")
    section = text.split("[tool.setuptools.package-data]", 1)[1].split("\n[", 1)[0]
    entries = re.search(r"=\s*\[(.*?)\]", section, re.S).group(1)
    return re.findall(r'"([^"]+)"', entries)


def test_nine_modules_and_job_launcher_exist():
    for module in EXPECTED_MODULES:
        assert (SRC / (module + ".py")).is_file(), module
    assert (SRC / "windows_job.cs").is_file()


def test_every_locale_has_mo_and_po():
    found = sorted(path.name for path in LOCALE.iterdir() if path.is_dir())
    assert found == sorted(EXPECTED_LOCALES)
    for code in EXPECTED_LOCALES:
        assert (LOCALE / code / "LC_MESSAGES" / "muse_spark.mo").is_file(), code
        assert (LOCALE / code / "LC_MESSAGES" / "muse_spark.po").is_file(), code


def test_package_data_covers_job_and_every_catalogue():
    patterns = _package_data_patterns()
    assert patterns
    covered = set()
    for pattern in patterns:
        for path in sorted(SRC.glob(pattern.replace("\\", "/"))):
            covered.add(path.relative_to(SRC).as_posix())
    assert "windows_job.cs" in covered
    for code in EXPECTED_LOCALES:
        assert ("locale/%s/LC_MESSAGES/muse_spark.mo" % code) in covered, code
        assert ("locale/%s/LC_MESSAGES/muse_spark.po" % code) in covered, code


def test_declares_supported_thonny_range():
    text = (THONNY / "pyproject.toml").read_text(encoding="utf-8")
    section = text.split("[project]", 1)[1].split("\n[", 1)[0]
    entry = re.search(r"dependencies\s*=\s*\[(.*?)\]", section, re.S).group(1)
    assert re.findall(r'"([^"]+)"', entry) == ["thonny>=4.1.7,<6"]


def test_sdist_manifest_prunes_tests():
    lines = (THONNY / "MANIFEST.in").read_text(encoding="utf-8").splitlines()
    stripped = [line.strip() for line in lines
                if line.strip() and not line.strip().startswith("#")]
    assert any(re.match(r"^(prune|exclude)\s+tests\b", line) for line in stripped)
    assert (THONNY / "tests").is_dir()  # the guard has something to prune
