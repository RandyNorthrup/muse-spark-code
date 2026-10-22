"""Tests for the companion page opener: fragment-only codes, loopback only."""

import pytest

from thonnycontrib.muse_spark import companion
from thonnycontrib.muse_spark.companion import CompanionError


def test_code_lands_in_fragment_never_query():
    url = companion.build_companion_url("http://127.0.0.1:4311/", "abc 123/xyz")
    assert url.startswith("http://127.0.0.1:4311/#launch=")
    assert "?launch=" not in url and "abc 123" not in url
    assert "abc%20123%2Fxyz" in url


def test_open_opens_exactly_that_url():
    opened = []
    url = companion.open_companion("http://localhost:4311/", "code-1", opener=lambda url: opened.append(url) or True)
    assert opened == [url]
    assert "#launch=code-1" in url


def test_browser_refusal_is_reported():
    with pytest.raises(CompanionError, match="browser"):
        companion.open_companion("http://127.0.0.1:4311/", "fake-code", opener=lambda url: False)


@pytest.mark.parametrize(
    "base",
    [
        "http://192.168.1.10:4311/",
        "http://10.0.0.5:4311/",
        "http://example.com/",
        "http://[fe80::1]/",
        "file:///tmp/page.html",
        "http://127.0.0.1.evil.com/",
        "",
    ],
)
def test_non_loopback_bases_are_refused(base):
    with pytest.raises(CompanionError):
        companion.build_companion_url(base, "code-1")


@pytest.mark.parametrize("base", ["http://127.0.0.1:4311/", "http://localhost:4311/", "http://[::1]:4311/"])
def test_loopback_bases_are_accepted(base):
    assert "#launch=c" in companion.build_companion_url(base, "c")


def test_empty_code_is_refused():
    with pytest.raises(CompanionError):
        companion.build_companion_url("http://127.0.0.1:4311/", "")


def test_base_with_fragment_is_refused():
    with pytest.raises(CompanionError):
        companion.build_companion_url("http://127.0.0.1:4311/#other", "code-1")
