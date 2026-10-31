"""Regression for round-two publishing credential confinement."""
from pathlib import Path
import re


def test_round2_pypi_uses_only_oidc_in_upload_job_and_separate_build():
    root = Path(__file__).resolve().parents[3]
    source = (root / '.github/workflows/publish-thonny.yml').read_text(encoding='utf-8')
    build = source.split('  build:\n', 1)[1].split('  publish:\n', 1)[0]
    upload = source.split('  publish:\n', 1)[1]
    assert 'environment:' not in build and 'id-token:' not in build
    assert 'environment: pypi' in upload and 'needs: build' in upload
    assert len(re.findall(r'^\s+id-token: write$', source, re.M)) == 1
    assert 'id-token: write' in upload and 'secrets.' not in source
    assert 'PYPI_API_TOKEN' not in source and 'TWINE_PASSWORD' not in source
    assert '--trusted-publishing always' in upload
    assert 'python -m build' in build and 'twine check' in build
    assert 'actions/download-artifact@' in upload and 'actions/checkout@' not in upload


def test_every_action_pin_is_40_hex_chars_with_version_comment():
    root = Path(__file__).resolve().parents[3]
    pinned = re.compile(r'^(\s*- uses: [^@\s]+)@([0-9a-f]{40})( # v\d+\.\d+\.\d+)\s*$')
    for name in ('publish-thonny.yml', 'thonny.yml'):
        lines = (root / '.github/workflows' / name).read_text(encoding='utf-8').splitlines()
        uses = [line for line in lines if re.match(r'^\s*- uses:', line)]
        assert uses, 'no uses: lines in ' + name
        for line in uses:
            assert pinned.match(line), 'unpinned action in %s: %r' % (name, line)
