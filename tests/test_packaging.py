#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Deterministic packaging, contract, Strict-CSP/jsmin, and po2lmo gate for luci-app-mtk-wed."""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PKG_DIR = os.path.join(REPO_ROOT, "luci-app-mtk-wed")

EXPECTED_PKG_VERSION = "2.1.1"
EXPECTED_PKG_RELEASE = "1"
EXPECTED_MSGID_COUNT = 376

EXPECTED_PKG_FILES = {
    "LICENSE",
    "Makefile",
    "htdocs/luci-static/resources/view/mtk_wed/ds-tokens.js",
    "htdocs/luci-static/resources/view/mtk_wed/mtk-wed.css",
    "htdocs/luci-static/resources/view/mtk_wed/status.js",
    "htdocs/luci-static/resources/view/mtk_wed/ui.js",
    "po/templates/mtk_wed.pot",
    "po/zh_Hans/mtk_wed.po",
    "po/zh_Hant/mtk_wed.po",
    "root/etc/config/mtk_wed",
    "root/etc/init.d/mtk-wed",
    "root/usr/libexec/rpcd/luci.mtk_wed",
    "root/usr/share/luci/menu.d/luci-app-mtk-wed.json",
    "root/usr/share/rpcd/acl.d/luci-app-mtk-wed.json",
}

EXPECTED_READ_RPCS = {
    "getMacStats",
    "getPorts",
    "getPpeEntries",
    "getStatus",
    "getWifiStats",
}
EXPECTED_WRITE_RPCS = {
    "setCpuSettings",
    "setFlowOffload",
    "setWedEnable",
}
EXPECTED_ALL_RPCS = EXPECTED_READ_RPCS | EXPECTED_WRITE_RPCS

SKIP_WALK_DIRS = {".git", "__pycache__", ".pytest_cache", "node_modules"}
FORBIDDEN_SUFFIXES = (".zip", ".ipk", ".apk", ".pyc", ".tmp", ".bak", ".swp")

PASS_COUNT = 0
FAIL_COUNT = 0


def ok(label: str) -> None:
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"PASS [{PASS_COUNT:02d}] {label}")


def fail(label: str, detail: str) -> None:
    global FAIL_COUNT
    FAIL_COUNT += 1
    print(f"FAIL [{label}] {detail}", file=sys.stderr)


def check(cond: bool, label: str, detail: str = "") -> None:
    if cond:
        ok(label)
    else:
        fail(label, detail or "assertion failed")


# ── Faithful Crockford jsmin (2013-03-29 C reference state machine) ─────────


def _is_alphanum(c: str) -> bool:
    if not c or c == "\x00":
        return False
    o = ord(c)
    return (
        (ord("a") <= o <= ord("z"))
        or (ord("0") <= o <= ord("9"))
        or (ord("A") <= o <= ord("Z"))
        or c in ("_", "$", "\\")
        or o > 126
    )


def crockford_jsmin(src: str) -> str:
    """Port of Douglas Crockford's jsmin.c (2013-03-29), used by OpenWrt feeds/luci."""
    n = len(src)
    idx = 0
    lookahead = ""
    the_a = "\n"
    the_b = ""
    the_x = ""
    the_y = ""
    out = []

    def get() -> str:
        nonlocal idx, lookahead, the_x, the_y
        c = lookahead
        lookahead = ""
        if not c:
            if idx < n:
                c = src[idx]
                idx += 1
            else:
                c = ""
        if c == "" or c >= " " or c == "\n":
            return c
        if c == "\r":
            return "\n"
        return " "

    def peek() -> str:
        nonlocal lookahead
        lookahead = get()
        return lookahead

    def next_tok() -> str:
        c = get()
        if c == "/":
            p = peek()
            if p == "/":
                while True:
                    c = get()
                    if c == "" or c <= "\n":
                        return c
            if p == "*":
                get()
                while c != " ":
                    ch = get()
                    if ch == "*":
                        if peek() == "/":
                            get()
                            c = " "
                    elif ch == "":
                        raise ValueError("jsmin: unterminated /* comment */")
        return c

    def putc(c: str) -> None:
        nonlocal the_x, the_y
        out.append(c)
        the_y = the_x
        the_x = c

    def action(d: int) -> None:
        nonlocal the_a, the_b
        if d == 1:
            putc(the_a)
            if (
                (the_y in ("\n", " "))
                and (the_a in ("+", "-", "*", "/"))
                and (the_b in ("+", "-", "*", "/"))
            ):
                putc(the_y)
        if d in (1, 2):
            the_a = the_b
            if the_a in ("'", '"', "`"):
                while True:
                    putc(the_a)
                    the_a = get()
                    if the_a == the_b:
                        break
                    if the_a == "\\":
                        putc(the_a)
                        the_a = get()
                    if the_a == "":
                        raise ValueError("jsmin: unterminated string literal")
        if d in (1, 2, 3):
            the_b = next_tok()
            if the_b == "/" and the_a in (
                "(", ",", "=", ":", "[", "!", "&", "|", "?", "+", "-", "~", "*", "/", "{", "\n", ";"
            ):
                putc(the_a)
                if the_a in ("/", "*"):
                    putc(" ")
                putc(the_b)
                while True:
                    the_a = get()
                    if the_a == "[":
                        while True:
                            putc(the_a)
                            the_a = get()
                            if the_a == "]":
                                break
                            if the_a == "\\":
                                putc(the_a)
                                the_a = get()
                            if the_a == "":
                                raise ValueError("jsmin: unterminated regex character class")
                    elif the_a == "/":
                        p = peek()
                        if p in ("/", "*"):
                            raise ValueError("jsmin: invalid comment token immediately after regex literal")
                        break
                    elif the_a == "\\":
                        putc(the_a)
                        the_a = get()
                    if the_a == "" or the_a == "\n":
                        raise ValueError("jsmin: unterminated regular expression literal")
                    putc(the_a)
                the_b = next_tok()

    if peek() == "\xef":
        get()
        get()
        get()
    the_a = "\n"
    action(3)
    while the_a != "":
        if the_a == " ":
            action(1 if _is_alphanum(the_b) else 2)
        elif the_a == "\n":
            if the_b in ("{", "[", "(", "+", "-", "!", "~"):
                action(1)
            elif the_b == " ":
                action(3)
            else:
                action(1 if _is_alphanum(the_b) else 2)
        else:
            if the_b == " ":
                action(1 if _is_alphanum(the_a) else 3)
            elif the_b == "\n":
                if the_a in ("}", "]", ")", "+", "-", '"', "'", "`"):
                    action(1)
                else:
                    action(1 if _is_alphanum(the_a) else 3)
            else:
                action(1)

    res = "".join(out)
    return res[1:] if res.startswith("\n") else res


# ── Exact OpenWrt po2lmo SuperFastHash (32-bit Paul Hsieh sfh_hash) ─────────


def _schar(b: int) -> int:
    return (b - 256) if b >= 128 else b


def _get16le(buf: bytes, off: int) -> int:
    return buf[off] | (buf[off + 1] << 8)


def sfh_hash(data: bytes) -> int:
    """Bit-exact port of sfh_hash() from OpenWrt luci-base/src/template_lmo.c."""
    length = len(data)
    if length <= 0:
        return 0
    h = length & 0xFFFFFFFF
    rem = length & 3
    n_quads = length >> 2
    off = 0

    for _ in range(n_quads):
        h = (h + _get16le(data, off)) & 0xFFFFFFFF
        tmp = ((_get16le(data, off + 2) << 11) ^ h) & 0xFFFFFFFF
        h = ((h << 16) ^ tmp) & 0xFFFFFFFF
        off += 4
        h = (h + (h >> 11)) & 0xFFFFFFFF

    if rem == 3:
        h = (h + _get16le(data, off)) & 0xFFFFFFFF
        h = (h ^ (h << 16)) & 0xFFFFFFFF
        h = (h ^ ((_schar(data[off + 2]) << 18) & 0xFFFFFFFF)) & 0xFFFFFFFF
        h = (h + (h >> 11)) & 0xFFFFFFFF
    elif rem == 2:
        h = (h + _get16le(data, off)) & 0xFFFFFFFF
        h = (h ^ (h << 11)) & 0xFFFFFFFF
        h = (h + (h >> 17)) & 0xFFFFFFFF
    elif rem == 1:
        h = (h + _schar(data[off])) & 0xFFFFFFFF
        h = (h ^ (h << 10)) & 0xFFFFFFFF
        h = (h + (h >> 1)) & 0xFFFFFFFF

    h = (h ^ (h << 3)) & 0xFFFFFFFF
    h = (h + (h >> 5)) & 0xFFFFFFFF
    h = (h ^ (h << 4)) & 0xFFFFFFFF
    h = (h + (h >> 17)) & 0xFFFFFFFF
    h = (h ^ (h << 25)) & 0xFFFFFFFF
    h = (h + (h >> 6)) & 0xFFFFFFFF
    return h


# ── Helpers for PO/POT & Source Extraction ──────────────────────────────────


def unescape_po(s: str) -> str:
    return s.replace(r"\n", "\n").replace(r"\t", "\t").replace(r"\"", '"').replace(r"\\", "\\")


def extract_c_format_specs(s: str) -> list:
    cleaned = s.replace("%%", "")
    return re.findall(r"%(?:\d+\$)?[+-]?(?:\d+)?(?:\.\d+)?[sdifuxXo]", cleaned)


def parse_po_strict(raw_bytes: bytes, is_pot: bool) -> dict:
    raw_lines = raw_bytes.split(b"\n")
    max_line_bytes = max((len(l) for l in raw_lines), default=0)
    text = raw_bytes.decode("utf-8")

    entries = {}
    duplicates = []
    fuzzy_ids = []
    cformat_flags = {}
    empty_msgstrs = []
    nonempty_pot_msgstrs = []
    multiline_entries = []

    mode = None
    cur_id = None
    cur_str = None
    cur_flags = set()
    id_cont_lines = 0
    str_cont_lines = 0

    def commit():
        nonlocal cur_id, cur_str, mode, cur_flags, id_cont_lines, str_cont_lines
        if cur_id is not None and cur_id != "":
            if cur_id in entries:
                duplicates.append(cur_id)
            if "fuzzy" in cur_flags:
                fuzzy_ids.append(cur_id)
            cformat_flags[cur_id] = "c-format" in cur_flags
            entries[cur_id] = cur_str or ""
            if is_pot and cur_str:
                nonempty_pot_msgstrs.append(cur_id)
            if not is_pot and not (cur_str or "").strip():
                empty_msgstrs.append(cur_id)
            if id_cont_lines > 0 or str_cont_lines > 0:
                multiline_entries.append(cur_id)
        cur_id = None
        cur_str = None
        mode = None
        cur_flags = set()
        id_cont_lines = 0
        str_cont_lines = 0

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            commit()
            continue
        if line.startswith("#,"):
            for fl in line[2:].split(","):
                fl = fl.strip()
                if fl:
                    cur_flags.add(fl)
            continue
        if line.startswith("#"):
            continue
        m = re.match(r'^msgid\s+"(.*)"$', line)
        if m:
            if mode == "msgstr":
                commit()
            mode = "msgid"
            cur_id = unescape_po(m.group(1))
            continue
        m = re.match(r'^msgstr\s+"(.*)"$', line)
        if m:
            mode = "msgstr"
            cur_str = unescape_po(m.group(1))
            continue
        m = re.match(r'^"(.*)"$', line)
        if m:
            if mode == "msgid":
                cur_id = (cur_id or "") + unescape_po(m.group(1))
                id_cont_lines += 1
            elif mode == "msgstr":
                cur_str = (cur_str or "") + unescape_po(m.group(1))
                str_cont_lines += 1
    commit()
    return {
        "entries": entries,
        "duplicates": duplicates,
        "fuzzy": fuzzy_ids,
        "cformat_flags": cformat_flags,
        "empty_msgstrs": empty_msgstrs,
        "nonempty_pot_msgstrs": nonempty_pot_msgstrs,
        "multiline_entries": multiline_entries,
        "max_line_bytes": max_line_bytes,
    }


def strip_js_comments(src: str) -> str:
    no_block = re.sub(r"/\*[\s\S]*?\*/", "", src)
    return re.sub(r"(^|[^:\\])//[^\n]*", r"\1", no_block, flags=re.MULTILINE)


def extract_js_msgids(src: str) -> set:
    stripped = strip_js_comments(src)
    out = set()
    for m in re.finditer(r"(?:^|[^A-Za-z0-9_$])_\(\s*('(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")", stripped):
        lit = m.group(1)
        if lit.startswith("'"):
            val = lit[1:-1].replace("\\'", "'").replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
        else:
            val = json.loads(lit)
        if val:
            out.add(val)
    return out


def extract_rpcd_errors(src: str) -> set:
    out = set()
    for m in re.finditer(r'"error":"([^"]+)"', src):
        val = m.group(1)
        if val != "%s":
            out.add(val)
    for m in re.finditer(r"WED_STAGE_ERROR='([^']+)'", src):
        out.add(m.group(1))
    return out


# ── Gate Runners ────────────────────────────────────────────────────────────


def check_encoding_and_tree() -> None:
    repo_files = []
    pkg_files = set()
    forbidden = []

    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_WALK_DIRS)
        files.sort()
        for fname in files:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, REPO_ROOT).replace("\\", "/")
            repo_files.append((rel, full))
            if fname == ".DS_Store" or fname.lower().endswith(FORBIDDEN_SUFFIXES):
                forbidden.append(rel)
            if rel.startswith("luci-app-mtk-wed/"):
                pkg_files.add(rel[len("luci-app-mtk-wed/"):])

    check(not forbidden, "Tree hygiene: zero .zip/.ipk/.apk/temp artifacts in repo", f"found: {forbidden}")
    check(
        pkg_files == EXPECTED_PKG_FILES,
        "Package isolation: luci-app-mtk-wed/ contains exact 14 OpenWrt package files",
        f"extra={sorted(pkg_files - EXPECTED_PKG_FILES)} missing={sorted(EXPECTED_PKG_FILES - pkg_files)}",
    )

    cr_bad, bom_bad, utf8_bad, eof_bad = [], [], [], []
    for rel, full in repo_files:
        data = open(full, "rb").read()
        if b"\r" in data:
            cr_bad.append(rel)
        if data.startswith(b"\xef\xbb\xbf"):
            bom_bad.append(rel)
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            utf8_bad.append(rel)
        if len(data) > 0 and not data.endswith(b"\n"):
            eof_bad.append(rel)

    check(not cr_bad, f"Encoding: pure LF (CR=0) across all {len(repo_files)} repo files", f"CR in: {cr_bad}")
    check(not bom_bad and not utf8_bad, f"Encoding: valid UTF-8 without BOM across all {len(repo_files)} repo files", f"bom={bom_bad} utf8={utf8_bad}")
    check(not eof_bad, f"Encoding: trailing newline present on all {len(repo_files)} repo files", f"missing newline: {eof_bad}")


def check_makefile_and_permissions() -> None:
    mk_path = os.path.join(PKG_DIR, "Makefile")
    mk_text = open(mk_path, "r", encoding="utf-8").read()
    mk_lines = mk_text.splitlines()

    has_pkg_id = (
        os.path.basename(PKG_DIR) == "luci-app-mtk-wed"
        and "define Package/luci-app-mtk-wed/conffiles" in mk_text
        and "define Build/Prepare/luci-app-mtk-wed" in mk_text
        and "include $(TOPDIR)/feeds/luci/luci.mk" in mk_text
    )
    check(has_pkg_id, "Makefile: package identity luci-app-mtk-wed + luci.mk structure")
    check(
        f"PKG_VERSION:={EXPECTED_PKG_VERSION}\n" in mk_text and f"PKG_RELEASE:={EXPECTED_PKG_RELEASE}\n" in mk_text,
        f"Makefile: PKG_VERSION:={EXPECTED_PKG_VERSION} and PKG_RELEASE:={EXPECTED_PKG_RELEASE}",
    )
    check(
        "LUCI_MINIFY_CSS:=0\n" in mk_text and "override CONFIG_LUCI_CSSTIDY:=\n" in mk_text,
        "Makefile: LUCI_MINIFY_CSS:=0 and override CONFIG_LUCI_CSSTIDY:=",
    )
    check(
        "\n/etc/config/mtk_wed\n" in mk_text,
        "Makefile: /etc/config/mtk_wed declared in conffiles without leading spaces",
    )

    in_prepare = False
    prep_lines = []
    space_indented_recipe = []
    for idx, ln in enumerate(mk_lines, 1):
        if ln == "define Build/Prepare/luci-app-mtk-wed":
            in_prepare = True
            continue
        if in_prepare and ln == "endef":
            in_prepare = False
            continue
        if in_prepare and ln.strip():
            prep_lines.append(ln)
            if not ln.startswith("\t"):
                space_indented_recipe.append((idx, ln))

    prep_joined = " ".join(l.strip().rstrip("\\").strip() for l in prep_lines)
    has_0755 = (
        "chmod 0755" in prep_joined
        and "root/usr/libexec/rpcd/luci.mtk_wed" in prep_joined
        and "root/etc/init.d/mtk-wed" in prep_joined
    ) or (
        "$(INSTALL_BIN)" in mk_text
        and "luci.mtk_wed" in mk_text
        and "mtk-wed" in mk_text
    )
    check(not space_indented_recipe and len(prep_lines) > 0, "Makefile: real \\t tab indentation on recipe lines", f"bad lines: {space_indented_recipe}")
    check(has_0755, "Makefile: 0755 executable mode enforced on luci.mtk_wed and init.d/mtk-wed")


def check_rpc_acl_js_contract() -> None:
    rpcd_path = os.path.join(PKG_DIR, "root/usr/libexec/rpcd/luci.mtk_wed")
    rpcd_src = open(rpcd_path, "r", encoding="utf-8").read()

    m_list = re.search(r"^\s*list\)\s*\n\s*printf\s+'(\{[^\n']+\})'", rpcd_src, flags=re.MULTILINE)
    check(m_list is not None, "RPC contract: luci.mtk_wed list) JSON signature parsed")
    rpcd_list_obj = json.loads(m_list.group(1)) if m_list else {}
    rpcd_methods = set(rpcd_list_obj.keys())
    check(
        rpcd_methods == EXPECTED_ALL_RPCS,
        "RPC contract: luci.mtk_wed exposes exact 8 expected methods",
        f"got={sorted(rpcd_methods)}",
    )

    acl_path = os.path.join(PKG_DIR, "root/usr/share/rpcd/acl.d/luci-app-mtk-wed.json")
    acl_obj = json.loads(open(acl_path, "r", encoding="utf-8").read())
    acl_entry = acl_obj.get("luci-app-mtk-wed", {})
    read_sec = acl_entry.get("read", {})
    write_sec = acl_entry.get("write", {})
    acl_read = set(read_sec.get("ubus", {}).get("luci.mtk_wed", []))
    acl_write = set(write_sec.get("ubus", {}).get("luci.mtk_wed", []))
    has_uci_grant = ("uci" in read_sec) or ("uci" in write_sec)
    has_unauth = "unauthenticated" in acl_obj or "unauthenticated" in acl_entry

    check(
        list(acl_obj.keys()) == ["luci-app-mtk-wed"]
        and acl_read == EXPECTED_READ_RPCS
        and acl_write == EXPECTED_WRITE_RPCS
        and not has_uci_grant
        and not has_unauth,
        "ACL contract: exact 5 read / 3 write ubus methods, 0 uci grant, 0 unauthenticated grant",
        f"read={sorted(acl_read)} write={sorted(acl_write)} uci={has_uci_grant} unauth={has_unauth}",
    )

    status_path = os.path.join(PKG_DIR, "htdocs/luci-static/resources/view/mtk_wed/status.js")
    status_stripped = strip_js_comments(open(status_path, "r", encoding="utf-8").read())
    js_methods = set()
    for m_decl in re.finditer(r"rpc\.declare\(\s*\{([\s\S]*?)\}\s*\)", status_stripped):
        body = m_decl.group(1)
        m_obj = re.search(r"object\s*:\s*['\"]([^'\"]+)['\"]", body)
        m_met = re.search(r"method\s*:\s*['\"]([^'\"]+)['\"]", body)
        if m_obj and m_met and m_obj.group(1) == "luci.mtk_wed":
            js_methods.add(m_met.group(1))

    check(
        js_methods == rpcd_methods == (acl_read | acl_write),
        "3-way RPC parity: luci.mtk_wed list == acl.d (read|write) == status.js rpc.declare (8/8)",
        f"js={sorted(js_methods)} rpcd={sorted(rpcd_methods)}",
    )


def check_strict_csp_and_jsmin() -> None:
    node_bin = shutil.which("node")
    check(node_bin is not None, "Runtime: node binary available for syntax & jsmin checks")
    if not node_bin:
        return

    js_rel_paths = [
        "htdocs/luci-static/resources/view/mtk_wed/ds-tokens.js",
        "htdocs/luci-static/resources/view/mtk_wed/ui.js",
        "htdocs/luci-static/resources/view/mtk_wed/status.js",
    ]

    with tempfile.TemporaryDirectory(prefix="mtkw-jsmin-") as tmpdir:
        for rel in js_rel_paths:
            name = os.path.basename(rel)
            full = os.path.join(PKG_DIR, rel.replace("/", os.sep))
            src = open(full, "r", encoding="utf-8").read()
            code = strip_js_comments(src)

            has_style_tag = bool(
                re.search(r"<style\b", code, re.I)
                or re.search(r"(?:createElement|E)\(\s*['\"]style['\"]", code)
            )
            has_style_attr = bool(
                re.search(r"style\s*=\s*['\"]", code)
                or re.search(r"['\"]style['\"]\s*:", code)
                or re.search(r"(?<![A-Za-z0-9_$])style\s*:\s*['\"]", code)
                or re.search(r"setAttribute\(\s*['\"]style['\"]", code)
            )
            has_inner_html = bool(re.search(r"\.(?:innerHTML|outerHTML)\b|insertAdjacentHTML\b", code))
            has_eval = bool(re.search(r"(?<![A-Za-z0-9_$.])eval\s*\(|new\s+Function\s*\(", code))

            check(
                not (has_style_tag or has_style_attr or has_inner_html or has_eval),
                f"Strict-CSP & DOM hygiene ({name}): 0 <style>, 0 style=, 0 innerHTML/outerHTML, 0 eval()",
                f"styleTag={has_style_tag} styleAttr={has_style_attr} innerHTML={has_inner_html} eval={has_eval}",
            )

            r_orig = subprocess.run([node_bin, "--check", full], capture_output=True, text=True)
            check(r_orig.returncode == 0, f"JS syntax ({name}): node --check original exit 0", r_orig.stderr.strip())

            minified = crockford_jsmin(src)
            min_path = os.path.join(tmpdir, f"{name}.min.js")
            with open(min_path, "w", encoding="utf-8", newline="\n") as mf:
                mf.write(minified + "\n")
            r_min = subprocess.run([node_bin, "--check", min_path], capture_output=True, text=True)
            req_orig = re.findall(r"['\"]require\s+[A-Za-z0-9_.-]+(?:\s+as\s+[A-Za-z0-9_$]+)?['\"]", code)
            req_min = re.findall(r"['\"]require\s+[A-Za-z0-9_.-]+(?:\s+as\s+[A-Za-z0-9_$]+)?['\"]", minified)
            check(
                r_min.returncode == 0 and len(minified) > 0 and req_orig == req_min,
                f"Crockford jsmin ({name}): {len(src)} B -> {len(minified)} B, node --check exit 0 & directives intact",
                r_min.stderr.strip(),
            )

    css_path = os.path.join(PKG_DIR, "htdocs/luci-static/resources/view/mtk_wed/mtk-wed.css")
    css_src = re.sub(r"/\*[\s\S]*?\*/", "", open(css_path, "r", encoding="utf-8").read())
    check(
        css_src.count("{") == css_src.count("}")
        and "@import" not in css_src
        and "url(" not in css_src
        and "data:" not in css_src,
        "Stylesheet (mtk-wed.css): balanced braces and 0 @import/url()/data: URIs",
    )


def check_po_and_po2lmo() -> None:
    js_msgids = set()
    for rel in [
        "htdocs/luci-static/resources/view/mtk_wed/ds-tokens.js",
        "htdocs/luci-static/resources/view/mtk_wed/ui.js",
        "htdocs/luci-static/resources/view/mtk_wed/status.js",
    ]:
        js_msgids |= extract_js_msgids(open(os.path.join(PKG_DIR, rel.replace("/", os.sep)), "r", encoding="utf-8").read())

    menu_obj = json.loads(open(os.path.join(PKG_DIR, "root/usr/share/luci/menu.d/luci-app-mtk-wed.json"), encoding="utf-8").read())
    acl_obj = json.loads(open(os.path.join(PKG_DIR, "root/usr/share/rpcd/acl.d/luci-app-mtk-wed.json"), encoding="utf-8").read())
    meta_msgids = {v["title"] for v in menu_obj.values() if isinstance(v, dict) and v.get("title")}
    meta_msgids |= {v["description"] for v in acl_obj.values() if isinstance(v, dict) and v.get("description")}

    rpcd_errors = extract_rpcd_errors(
        open(os.path.join(PKG_DIR, "root/usr/libexec/rpcd/luci.mtk_wed"), "r", encoding="utf-8").read()
    )
    expected_union = js_msgids | meta_msgids | rpcd_errors

    check(
        len(expected_union) == EXPECTED_MSGID_COUNT,
        f"i18n source scan: {len(js_msgids)} JS + {len(meta_msgids)} meta + {len(rpcd_errors)} RPCD -> {len(expected_union)} unique msgids",
        f"expected {EXPECTED_MSGID_COUNT}, got {len(expected_union)}",
    )

    catalogs = {
        "pot": ("po/templates/mtk_wed.pot", True),
        "zh_Hant": ("po/zh_Hant/mtk_wed.po", False),
        "zh_Hans": ("po/zh_Hans/mtk_wed.po", False),
    }

    parsed_map = {}
    for name, (rel, is_pot) in catalogs.items():
        raw = open(os.path.join(PKG_DIR, rel.replace("/", os.sep)), "rb").read()
        p = parse_po_strict(raw, is_pot=is_pot)
        parsed_map[name] = p

        keys = set(p["entries"].keys())
        missing = sorted(expected_union - keys)
        extra = sorted(keys - expected_union)

        cformat_bad = []
        spec_bad = []
        for mid, mstr in p["entries"].items():
            specs_id = extract_c_format_specs(mid)
            has_cf = p["cformat_flags"].get(mid, False)
            if bool(specs_id) != has_cf:
                cformat_bad.append(mid)
            if not is_pot:
                specs_str = extract_c_format_specs(mstr)
                if specs_id != specs_str:
                    spec_bad.append((mid, specs_id, specs_str))

        check(
            len(p["entries"]) == EXPECTED_MSGID_COUNT and not missing and not extra and not p["duplicates"],
            f"PO bijection ({name}): {len(p['entries'])}/{EXPECTED_MSGID_COUNT} entries, 0 missing, 0 extra, 0 duplicates",
            f"missing={missing[:5]} extra={extra[:5]} dups={p['duplicates'][:5]}",
        )
        check(
            not p["fuzzy"]
            and not p["empty_msgstrs"]
            and not p["nonempty_pot_msgstrs"]
            and not cformat_bad
            and not spec_bad
            and p["max_line_bytes"] < 1024,
            f"PO format & po2lmo line cap ({name}): 0 fuzzy, 0 empty, c-format & %d/%s order exact, max_line={p['max_line_bytes']} B < 1024 B",
            f"fuzzy={p['fuzzy']} empty={p['empty_msgstrs']} cf={cformat_bad} spec={spec_bad}",
        )

    # Verify 0 32-bit SuperFastHash (sfh_hash) collisions across all msgids
    seen_hashes = {}
    collisions = []
    for mid in sorted(parsed_map["pot"]["entries"].keys()):
        h = sfh_hash(mid.encode("utf-8"))
        if h in seen_hashes:
            collisions.append((hex(h), seen_hashes[h], mid))
        else:
            seen_hashes[h] = mid

    check(
        not collisions and len(seen_hashes) == EXPECTED_MSGID_COUNT,
        f"po2lmo SuperFastHash: {len(seen_hashes)}/{EXPECTED_MSGID_COUNT} unique 32-bit key hashes (0 collisions)",
        f"collisions={collisions}",
    )


def check_ci_workflow() -> None:
    ci_path = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yml")
    if not os.path.isfile(ci_path):
        fail("CI workflow (.github/workflows/ci.yml)", "missing file")
        return
    ci_txt = open(ci_path, "r", encoding="utf-8").read()
    required_snippets = [
        "name: CI",
        "contents: read",
        "shellcheck -s sh",
        "dash tests/test_backend.sh",
        'TEST_SHELL="busybox ash" busybox ash tests/test_backend.sh',
        "node --test tests/test_frontend.mjs",
        "python3 tests/test_packaging.py",
    ]
    missing = [s for s in required_snippets if s not in ci_txt]
    has_static_bb = "busybox-static" in ci_txt
    check(
        not missing and not has_static_bb,
        "CI workflow (.github/workflows/ci.yml): least-privilege permissions, dynamic busybox, & all 5 gates wired",
        f"missing={missing} busybox_static={has_static_bb}",
    )


def main() -> int:
    check_encoding_and_tree()
    check_makefile_and_permissions()
    check_rpc_acl_js_contract()
    check_strict_csp_and_jsmin()
    check_po_and_po2lmo()
    check_ci_workflow()

    total = PASS_COUNT + FAIL_COUNT
    print(f"\nSummary: {PASS_COUNT}/{total} checks passed, {FAIL_COUNT} failed.")
    return 0 if FAIL_COUNT == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
