"""Polite HTTP for the asset-list lane: one request every PAUSE seconds (≤ 0.5/s), a User-Agent that names fox,
robots.txt honoured, no cookies/header games. A 403/429/captcha page marks the host blocked and we stop for that host."""
from __future__ import annotations
import time, urllib.request, urllib.error, urllib.robotparser, urllib.parse, ssl, gzip, io

UA = "Mozilla/5.0 (compatible; fox-research-il/0.1 asset-lists; +https://fox-research-il.web.app)"
PAUSE = 2.0
_last = [0.0]
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
BLOCKED: set[str] = set()
CTX = ssl.create_default_context()


class Blocked(Exception):
    pass


def _wait():
    d = time.time() - _last[0]
    if d < PAUSE:
        time.sleep(PAUSE - d)
    _last[0] = time.time()


def robots_ok(url: str) -> tuple[bool, str]:
    """(allowed, status) — status is 'ok', 'disallow', 'none' (no robots.txt) or 'error'."""
    p = urllib.parse.urlsplit(url)
    host = f"{p.scheme}://{p.netloc}"
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            _wait()
            req = urllib.request.Request(host + "/robots.txt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                txt = r.read().decode("utf-8", "replace")
            if "<html" in txt[:500].lower():
                _robots[host] = None
            else:
                rp.parse(txt.splitlines())
                _robots[host] = rp
        except urllib.error.HTTPError as e:
            _robots[host] = None if e.code == 404 else rp
            if e.code in (401, 403):
                rp.disallow_all = True
        except Exception:
            _robots[host] = None
    rp = _robots[host]
    if rp is None:
        return True, "none"
    return (rp.can_fetch(UA, url), "ok" if rp.can_fetch(UA, url) else "disallow")


def quote(url: str) -> str:
    """percent-encode non-ASCII path/query characters (Hebrew slugs) without touching reserved ones"""
    return urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~[]")


def get(url: str, *, binary: bool = False, timeout: int = 90, check_robots: bool = True, _hops: int = 0):
    url = quote(url)
    host = urllib.parse.urlsplit(url).netloc
    if host in BLOCKED:
        raise Blocked(host)
    if check_robots:
        ok, st = robots_ok(url)
        if not ok:
            raise Blocked(f"robots.txt disallows {url}")
    _wait()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            data = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
            ctype = r.headers.get("Content-Type", "")
            final = r.geturl()
    except urllib.error.HTTPError as e:
        if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location") and _hops < 5:
            nxt = urllib.parse.urljoin(url, e.headers["Location"])
            return get(nxt, binary=binary, timeout=timeout, check_robots=check_robots, _hops=_hops + 1)
        if e.code in (403, 429, 503):
            BLOCKED.add(host)
            raise Blocked(f"{host} HTTP {e.code}")
        raise
    if not binary:
        txt = data.decode("utf-8", "replace")
        low = txt[:4000].lower()
        title = low.split("<title>", 1)[1].split("</title>", 1)[0] if "<title>" in low else ""
        if any(k in title for k in ("radware", "captcha", "attention required", "just a moment", "access denied")) or \
                "verifying your browser" in low or "perfdrive.com" in low:
            BLOCKED.add(host)
            raise Blocked(f"{host} bot wall ({title.strip()[:40]})")
        if len(txt) < 30000 and any(k in low for k in ("captcha", "incapsula", "cf-challenge", "are you a robot", "access denied", "request unsuccessful")):
            BLOCKED.add(host)
            raise Blocked(f"{host} bot wall")
        return txt, ctype, final
    return data, ctype, final
