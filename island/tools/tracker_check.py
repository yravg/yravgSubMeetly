#!/usr/bin/env python3
"""Check the objective rows of docs/TRACKER.md against what GitHub actually serves.

    python3 island/tools/tracker_check.py [--deep]

Checks (each prints PASS / FAIL / WARN, exit 1 if any FAIL):
  1. the latest GitHub release tag equals v<version in island/Cargo.toml>
  2. latest.json is an asset of that release, parses, and names the same version
  3. its signature verifies (ECDSA P-256 / SHA-256) against a key in
     crates/poni-core/data/update-keys.txt (same check the app does)
  4. the Windows Setup and the Mac DMG it names exist as release assets, with the size it states
  5. their SHA-256 matches the payload (GitHub's asset digest; --deep downloads and hashes them)
  6. the add-on pre-releases the app downloads from exist (tags read from addons.rs)

Standard library + the `openssl` command only. GH_TOKEN (optional) raises the API rate limit.
Release-process rows that need a person (Windows PC install, Mac clean install) are NOT checked here.
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = os.path.join(ROOT, "crates", "poni-core", "data", "update-keys.txt")
ADDONS = os.path.join(ROOT, "crates", "poni-core", "src", "addons.rs")
CARGO = os.path.join(ROOT, "Cargo.toml")
REPO = os.environ.get("GITHUB_REPOSITORY") or "yravg/yravgSubMeetly"
API = "https://api.github.com/repos/" + REPO

fails = 0


def row(status, name, detail=""):
    global fails
    if status == "FAIL":
        fails += 1
    print(f"{status:<4}  {name}" + (f"  -  {detail}" if detail else ""))


def http(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": "tracker-check", "Accept": "application/vnd.github+json"})
    tok = os.environ.get("GH_TOKEN")
    if tok and url.startswith("https://api.github.com"):
        req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data)


def cargo_version():
    with open(CARGO, encoding="utf-8") as f:
        m = re.search(r'^version = "([0-9.]+)"', f.read(), re.M)
    return m.group(1) if m else None


def trusted_keys():
    keys = {}
    with open(KEYS, encoding="utf-8") as f:
        for line in f:
            p = line.split()
            if len(p) == 2 and not line.startswith("#"):
                keys[p[0]] = bytes.fromhex(p[1])
    return keys


def raw_to_der(raw):
    def der_int(b):
        b = b.lstrip(b"\0") or b"\0"
        if b[0] & 0x80:
            b = b"\0" + b
        return b"\x02" + bytes([len(b)]) + b

    body = der_int(raw[:32]) + der_int(raw[32:])
    return b"\x30" + bytes([len(body)]) + body


def verify(payload_text, signature_b64, point):
    spki = bytes.fromhex("3059301306072a8648ce3d020106082a8648ce3d030107034200") + point
    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for name, data in (("pub.der", spki), ("sig.der", raw_to_der(base64.b64decode(signature_b64))), ("payload", payload_text.encode("utf-8"))):
            paths[name] = os.path.join(tmp, name)
            with open(paths[name], "wb") as f:
                f.write(data)
        pem = subprocess.run(["openssl", "pkey", "-pubin", "-inform", "DER", "-in", paths["pub.der"], "-outform", "PEM"], capture_output=True)
        if pem.returncode:
            return False
        paths["pub.pem"] = os.path.join(tmp, "pub.pem")
        with open(paths["pub.pem"], "wb") as f:
            f.write(pem.stdout)
        r = subprocess.run(["openssl", "dgst", "-sha256", "-verify", paths["pub.pem"], "-signature", paths["sig.der"], paths["payload"]], capture_output=True)
        return r.returncode == 0


def addon_tags():
    with open(ADDONS, encoding="utf-8") as f:
        text = f.read().split("#[cfg(test)]")[0]  # tags inside the tests are fixtures
    return sorted(set(re.findall(r'tag: "(addon-[a-z0-9-]+)"', text)))


def main():
    deep = "--deep" in sys.argv
    want = cargo_version()
    try:
        rel = http(API + "/releases/latest")
    except Exception as e:  # noqa: BLE001
        row("FAIL", "GitHub latest release readable", str(e))
        return 1
    tag = rel["tag_name"]
    row("PASS" if tag == f"v{want}" else "FAIL", "latest release tag == island/Cargo.toml version", f"release {tag}, Cargo.toml {want}")
    assets = {a["name"]: a for a in rel.get("assets", [])}
    if "latest.json" not in assets:
        row("FAIL", "latest.json is a release asset")
        return 1
    row("PASS", "latest.json is a release asset")
    feed = json.loads(http(assets["latest.json"]["browser_download_url"], binary=True))
    payload = json.loads(feed["payload"])
    row("PASS" if payload.get("version") == tag.lstrip("v") else "FAIL", "latest.json version == release tag", payload.get("version", "?"))
    key = trusted_keys().get(feed.get("key"))
    if key is None:
        row("FAIL", "latest.json signed with a trusted key", f"key {feed.get('key')} not in update-keys.txt")
    else:
        row("PASS" if verify(feed["payload"], feed["signature"], key) else "FAIL", "latest.json signature verifies", f"key {feed['key']}")
    for label, entry in (("Windows Setup", payload.get("windows")), ("Mac DMG", payload.get("mac"))):
        if not entry:
            row("FAIL", f"{label} named in latest.json")
            continue
        name = entry["url"].rsplit("/", 1)[-1]
        a = assets.get(name)
        if a is None:
            row("FAIL", f"{label} asset exists", name)
            continue
        row("PASS" if a["size"] == entry["size"] else "FAIL", f"{label} size matches payload", f"{name} {a['size']} B")
        digest = (a.get("digest") or "").removeprefix("sha256:")
        if deep or not digest:
            h = hashlib.sha256(http(a["browser_download_url"], binary=True)).hexdigest()
            src = "downloaded"
        else:
            h, src = digest, "GitHub asset digest"
        row("PASS" if h == entry["sha256"] else "FAIL", f"{label} sha256 matches payload", src)
    for t in addon_tags():
        try:
            r = http(f"{API}/releases/tags/{t}")
            row("PASS" if r.get("prerelease") else "WARN", f"add-on release {t} exists", f"{len(r.get('assets', []))} assets" + ("" if r.get("prerelease") else ", NOT a pre-release (would hijack releases/latest)"))
        except Exception:  # noqa: BLE001
            row("FAIL", f"add-on release {t} exists")
    print()
    print("RESULT: " + ("PASS" if not fails else f"FAIL ({fails})"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
