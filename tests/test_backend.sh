#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Self-contained POSIX shell regression suite for luci-app-mtk-wed rpcd backend.
# Runs cleanly under /bin/sh, /usr/bin/sh, /usr/bin/dash, and busybox ash with
# zero external runtime dependencies (pure POSIX sh + awk mocks in isolated
# mktemp -d roots).

set -eu

if [ -d /usr/bin ]; then PATH="${PATH:+$PATH:}/usr/bin"; fi
if [ -d /bin ]; then PATH="${PATH:+$PATH:}/bin"; fi
export PATH

t_self=$(printf '%s' "$0" | tr '\\' '/')
case "$t_self" in
	*/*) SCRIPT_DIR=$(CDPATH='' cd -- "${t_self%/*}" && pwd) ;;
	*)   SCRIPT_DIR=$(pwd) ;;
esac
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd)
RPCD="$REPO_ROOT/luci-app-mtk-wed/root/usr/libexec/rpcd/luci.mtk_wed"
INITD="$REPO_ROOT/luci-app-mtk-wed/root/etc/init.d/mtk-wed"

case "$(uname -s 2>/dev/null || true)" in
	MINGW*|MSYS*|CYGWIN*)
		if ! sort -rn </dev/null >/dev/null 2>&1; then
			PATH="/usr/bin:/bin${PATH:+:$PATH}"
			export PATH
		fi
		MSYS="winsymlinks:lnk"
		export MSYS
		;;
esac

WORK=$(mktemp -d "${TMPDIR:-/tmp}/mtkw-backend-test.XXXXXX")
cleanup_work() {
	trap - EXIT INT TERM HUP
	chmod -R u+rwX "$WORK" 2>/dev/null || true
	rm -rf "$WORK" 2>/dev/null || true
}
trap 'cleanup_work' EXIT
trap 'cleanup_work; exit 130' INT
trap 'cleanup_work; exit 143' TERM
trap 'cleanup_work; exit 129' HUP

# Detect shell binary executing this script so child invocations of luci.mtk_wed
# run under the exact same shell (/bin/sh, dash, busybox ash via $WORK/ash, etc.).
PROC_EXE=
if [ -r "/proc/$$/exe" ] && [ -x "/proc/$$/exe" ]; then
	PROC_EXE=$(readlink "/proc/$$/exe" 2>/dev/null || true)
fi
SH_CAND=${TEST_SHELL:-$PROC_EXE}
[ -n "$SH_CAND" ] || SH_CAND='/bin/sh'
case "$SH_CAND" in
	"busybox ash"|*busybox*)
		BB_BIN=
		case "$PROC_EXE" in
			*busybox*)
				if [ -x "$PROC_EXE" ]; then BB_BIN=$PROC_EXE; fi
				;;
		esac
		if [ -z "$BB_BIN" ]; then
			case "${TEST_SHELL:-}" in
				/*busybox)
					if [ -x "${TEST_SHELL:-}" ]; then BB_BIN=$TEST_SHELL; fi
					;;
				/*busybox\ ash)
					BB_CAND=${TEST_SHELL% ash}
					if [ -x "$BB_CAND" ]; then BB_BIN=$BB_CAND; fi
					;;
			esac
		fi
		if [ -z "$BB_BIN" ]; then
			BB_BIN=$(command -v busybox 2>/dev/null || true)
		fi
		if [ -n "$BB_BIN" ] && [ -x "$BB_BIN" ]; then
			ln -sf "$BB_BIN" "$WORK/ash"
			SH_BIN="$WORK/ash"
		else
			SH_BIN='/bin/sh'
		fi
		;;
	*dash*)
		if [ -x "$SH_CAND" ]; then
			SH_BIN=$SH_CAND
		else
			SH_BIN=$(command -v dash 2>/dev/null || printf '/bin/sh')
		fi
		;;
	*ash*)
		if [ -x "$SH_CAND" ]; then
			SH_BIN=$SH_CAND
		else
			SH_BIN=$(command -v ash 2>/dev/null || printf '/bin/sh')
		fi
		;;
	*sh*)
		if [ -x "$SH_CAND" ]; then
			SH_BIN=$SH_CAND
		else
			SH_BIN=$(command -v "$SH_CAND" 2>/dev/null || printf '/bin/sh')
		fi
		;;
	*)
		SH_BIN='/bin/sh'
		;;
esac

# Preserve real system binaries before prepending $MOCKBIN to PATH.
REAL_MV=$(command -v mv)
REAL_CP=$(command -v cp)
REAL_RM=$(command -v rm)
REAL_READLINK=$(command -v readlink)
export REAL_MV REAL_CP REAL_RM REAL_READLINK

MOCKBIN="$WORK/mockbin"
mkdir -p "$MOCKBIN"

PASS_CNT=0
FAIL_CNT=0

pass() {
	PASS_CNT=$((PASS_CNT + 1))
	printf 'ok %d - %s\n' "$PASS_CNT" "$1"
}

fail() {
	FAIL_CNT=$((FAIL_CNT + 1))
	printf 'not ok - %s: %s\n' "$1" "${2:-assertion failed}" >&2
}

assert_eq() {
	if [ "$2" = "$3" ]; then
		pass "$1"
	else
		fail "$1" "expected [$3], got [$2]"
	fi
}

assert_contains() {
	case "$2" in
		*"$3"*) pass "$1" ;;
		*) fail "$1" "expected [$2] to contain [$3]" ;;
	esac
}

assert_not_contains() {
	case "$2" in
		*"$3"*) fail "$1" "expected [$2] NOT to contain [$3]" ;;
		*) pass "$1" ;;
	esac
}

# ── Mock Binaries (pure POSIX sh + awk, zero Python/Node needed) ────────

# 1. Pure-POSIX awk RFC 8259 jsonfilter supporting:
#    -s <str>, stdin input, -e <expr>, -e <var>=<expr>, -t <var>=<expr>,
#    bracketed keys (@.values[".name"]), and array wildcards (@.a.b[*]).
cat > "$MOCKBIN/jsonfilter" <<'EOF'
#!/bin/sh
jf_src=""
jf_has_s=0
jf_ops=""
jf_nl='
'
while [ $# -gt 0 ]; do
	case "$1" in
		-s)
			jf_src=$2
			jf_has_s=1
			shift 2
			;;
		-e)
			jf_ops="${jf_ops}E	$2${jf_nl}"
			shift 2
			;;
		-t)
			jf_ops="${jf_ops}T	$2${jf_nl}"
			shift 2
			;;
		-q)
			shift
			;;
		*)
			shift
			;;
	esac
done
if [ "$jf_has_s" = 0 ]; then
	jf_src=$(cat)
fi
JF_SRC=$jf_src JF_OPS=$jf_ops awk '
function skip_ws(   c) {
	while (POS <= LEN) {
		c = substr(S, POS, 1)
		if (c != " " && c != "\t" && c != "\n" && c != "\r") break
		POS++
	}
}
function parse_str(   out, c, esc, hex) {
	if (substr(S, POS, 1) != "\"") { ERR = 1; return "" }
	POS++
	out = ""
	while (POS <= LEN) {
		c = substr(S, POS, 1)
		POS++
		if (c == "\"") return out
		if (c == "\\") {
			if (POS > LEN) { ERR = 1; return "" }
			esc = substr(S, POS, 1)
			POS++
			if (esc == "\"" || esc == "\\" || esc == "/") out = out esc
			else if (esc == "n") out = out "\n"
			else if (esc == "r") out = out "\r"
			else if (esc == "t") out = out "\t"
			else if (esc == "b") out = out "\b"
			else if (esc == "f") out = out "\f"
			else if (esc == "u") {
				hex = substr(S, POS, 4)
				if (length(hex) < 4 || hex !~ /^[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]$/) { ERR = 1; return "" }
				POS += 4
				out = out "?"
			} else { ERR = 1; return "" }
		} else {
			out = out c
		}
	}
	ERR = 1
	return ""
}
function parse_val(path,   c, st, k, idx, tok) {
	skip_ws()
	if (ERR || POS > LEN) { ERR = 1; return }
	st = POS
	c = substr(S, POS, 1)
	if (c == "{") {
		TYPE[path] = "object"
		POS++
		skip_ws()
		if (substr(S, POS, 1) == "}") {
			POS++
			RAW[path] = substr(S, st, POS - st)
			return
		}
		while (!ERR && POS <= LEN) {
			skip_ws()
			k = parse_str()
			if (ERR) return
			skip_ws()
			if (substr(S, POS, 1) != ":") { ERR = 1; return }
			POS++
			parse_val(path "\034" k)
			if (ERR) return
			skip_ws()
			c = substr(S, POS, 1)
			if (c == "}") {
				POS++
				RAW[path] = substr(S, st, POS - st)
				return
			}
			if (c != ",") { ERR = 1; return }
			POS++
		}
		ERR = 1
	} else if (c == "[") {
		TYPE[path] = "array"
		POS++
		skip_ws()
		idx = 0
		if (substr(S, POS, 1) == "]") {
			POS++
			ALEN[path] = 0
			RAW[path] = substr(S, st, POS - st)
			return
		}
		while (!ERR && POS <= LEN) {
			parse_val(path "\034[" idx "]")
			if (ERR) return
			idx++
			skip_ws()
			c = substr(S, POS, 1)
			if (c == "]") {
				POS++
				ALEN[path] = idx
				RAW[path] = substr(S, st, POS - st)
				return
			}
			if (c != ",") { ERR = 1; return }
			POS++
		}
		ERR = 1
	} else if (c == "\"") {
		VAL[path] = parse_str()
		if (ERR) return
		TYPE[path] = "string"
		RAW[path] = substr(S, st, POS - st)
	} else if (substr(S, POS, 4) == "true") {
		POS += 4
		TYPE[path] = "boolean"; VAL[path] = "true"; RAW[path] = "true"
	} else if (substr(S, POS, 5) == "false") {
		POS += 5
		TYPE[path] = "boolean"; VAL[path] = "false"; RAW[path] = "false"
	} else if (substr(S, POS, 4) == "null") {
		POS += 4
		TYPE[path] = "null"; VAL[path] = ""; RAW[path] = "null"
	} else if (c == "-" || (c >= "0" && c <= "9")) {
		tok = substr(S, POS)
		if (!match(tok, /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/)) { ERR = 1; return }
		tok = substr(tok, 1, RLENGTH)
		POS += RLENGTH
		TYPE[path] = (tok ~ /[.eE]/ ? "double" : "int")
		VAL[path] = tok
		RAW[path] = tok
	} else {
		ERR = 1
	}
}
function sh_quote(s,   sq, r, i, ch) {
	sq = "\047"
	r = sq
	for (i = 1; i <= length(s); i++) {
		ch = substr(s, i, 1)
		if (ch == sq) r = r sq "\\" sq sq
		else r = r ch
	}
	return r sq
}
function norm_expr(e,   p, rest, m, k) {
	WILD = 0
	if (substr(e, 1, 1) != "@") return ""
	rest = substr(e, 2)
	p = "@"
	while (length(rest) > 0) {
		if (substr(rest, 1, 1) == ".") {
			rest = substr(rest, 2)
			if (match(rest, /^[^.\[]+/)) {
				k = substr(rest, 1, RLENGTH)
				rest = substr(rest, RLENGTH + 1)
				p = p "\034" k
			} else return ""
		} else if (substr(rest, 1, 3) == "[*]") {
			rest = substr(rest, 4)
			WILD = 1
			return p
		} else if (substr(rest, 1, 2) == "[\"") {
			rest = substr(rest, 3)
			m = index(rest, "\"]")
			if (!m) return ""
			k = substr(rest, 1, m - 1)
			rest = substr(rest, m + 2)
			p = p "\034" k
		} else if (match(rest, /^\[[0-9]+\]/)) {
			k = substr(rest, 1, RLENGTH)
			rest = substr(rest, RLENGTH + 1)
			p = p "\034" k
		} else return ""
	}
	return p
}
BEGIN {
	S = ENVIRON["JF_SRC"]
	LEN = length(S); POS = 1; ERR = 0
	parse_val("@")
	skip_ws()
	if (ERR || POS <= LEN) exit 1
	nops = split(ENVIRON["JF_OPS"], lines, "\n")
	any_matched = 0
	has_assign = 0
	for (i = 1; i <= nops; i++) {
		if (lines[i] == "") continue
		kind = substr(lines[i], 1, 1)
		body = substr(lines[i], 3)
		var = ""; expr = body
		eq = index(body, "=")
		if (eq > 0 && substr(body, 1, 1) != "@") {
			var = substr(body, 1, eq - 1)
			expr = substr(body, eq + 1)
			has_assign = 1
		}
		p = norm_expr(expr)
		if (p == "") continue
		if (kind == "T") {
			if (p in TYPE) {
				any_matched = 1
				if (var != "") printf "%s=%s;\n", var, sh_quote(TYPE[p])
				else print TYPE[p]
			}
		} else if (WILD) {
			if (TYPE[p] == "array") {
				for (j = 0; j < ALEN[p]; j++) {
					ep = p "\034[" j "]"
					if (ep in TYPE && TYPE[ep] != "null") {
						any_matched = 1
						if (TYPE[ep] == "object" || TYPE[ep] == "array") print RAW[ep]
						else print VAL[ep]
					}
				}
			}
		} else if (p in TYPE) {
			t = TYPE[p]
			if (var != "") {
				if (t == "string" || t == "int" || t == "double") {
					any_matched = 1
					printf "%s=%s;\n", var, sh_quote(VAL[p])
				} else if (t == "boolean") {
					any_matched = 1
					printf "%s=%s;\n", var, (VAL[p] == "true" ? "1" : "0")
				}
			} else {
				if (t == "null") continue
				any_matched = 1
				if (t == "object" || t == "array") print RAW[p]
				else print VAL[p]
			}
		}
	}
	if (!has_assign && !any_matched) exit 1
	exit 0
}'
EOF

# 2. Gate-controlled mock flock (supports transient busy count & lock gates).
cat > "$MOCKBIN/flock" <<'EOF'
#!/bin/sh
while [ $# -gt 0 ]; do
	case "$1" in -s|-x|-n) shift ;; *) break ;; esac
done
fd="${1:-}"
if [ -n "${MOCK_FLOCK_BUSY_ONCE:-}" ] && [ -f "$MOCK_FLOCK_BUSY_ONCE" ]; then
	"$REAL_RM" -f "$MOCK_FLOCK_BUSY_ONCE"
	exit 1
fi
if [ "$fd" = "4" ] && [ -n "${MOCK_SETTINGS_GATE:-}" ] && [ -f "$MOCK_SETTINGS_GATE" ]; then exit 1; fi
if [ "$fd" = "8" ] && [ -n "${MOCK_CPU_LOCK_GATE:-}" ] && [ -f "$MOCK_CPU_LOCK_GATE" ]; then exit 1; fi
if [ "$fd" = "9" ] && [ -n "${MOCK_WED_LOCK_GATE:-}" ] && [ -f "$MOCK_WED_LOCK_GATE" ]; then exit 1; fi
exit 0
EOF

# 3. Mock uci (faithfully models OpenWrt UCI files + /tmp/.uci/<pkg> delta quirk).
cat > "$MOCKBIN/uci" <<'EOF'
#!/bin/sh
confdir="${MTKW_ROOT:-}/etc/config"
tmp_uci="${MTKW_ROOT:-}/tmp/.uci"
savedir="$tmp_uci"
while [ $# -gt 0 ]; do
	case "$1" in
		-c) confdir=$2; shift 2 ;;
		-t) savedir=$2; shift 2 ;;
		-q) shift ;;
		*) break ;;
	esac
done
cmd="${1:-}"; shift || true
mkdir -p "$confdir" "$savedir" 2>/dev/null || true
case "$cmd" in
	get)
		full="$1"
		pkg="${full%%.*}"
		rel="${full#*.}"
		[ -f "$confdir/$pkg" ] || exit 1
		if [ "$rel" = "@defaults[0]" ]; then
			grep -q '^@defaults\[0\]=defaults$' "$confdir/$pkg" 2>/dev/null && { printf 'defaults\n'; exit 0; }
			exit 1
		fi
		val=""; found=0
		while IFS= read -r line; do
			case "$line" in
				"$rel="*) val="${line#*=}"; found=1 ;;
			esac
		done < "$confdir/$pkg"
		for d in "$tmp_uci" "$savedir"; do
			[ -f "$d/$pkg" ] || continue
			while IFS= read -r line; do
				case "$line" in
					"SET $rel="*) val="${line#*=}"; found=1 ;;
					"DEL $rel") val=""; found=0 ;;
				esac
			done < "$d/$pkg"
		done
		[ "$found" = 1 ] || exit 1
		printf '%s\n' "$val"
		;;
	set)
		kv="$1"
		full="${kv%%=*}"
		pkg="${full%%.*}"
		rel="${full#*.}"
		v="${kv#*=}"
		printf 'SET %s=%s\n' "$rel" "$v" >> "$savedir/$pkg"
		;;
	delete)
		full="$1"
		pkg="${full%%.*}"
		rel="${full#*.}"
		printf 'DEL %s\n' "$rel" >> "$savedir/$pkg"
		;;
	commit)
		[ "${MOCK_UCI_FAIL_COMMIT:-0}" != 1 ] || exit 1
		pkg="$1"
		[ -f "$confdir/$pkg" ] || : > "$confdir/$pkg"
		for d in "$tmp_uci" "$savedir"; do
			[ -f "$d/$pkg" ] || continue
			while IFS= read -r line; do
				case "$line" in
					"SET "*)
						kv="${line#SET }"
						k="${kv%%=*}"
						grep -v -F "$k=" "$confdir/$pkg" > "$confdir/$pkg.tmp" 2>/dev/null || : > "$confdir/$pkg.tmp"
						printf '%s\n' "$kv" >> "$confdir/$pkg.tmp"
						"$REAL_MV" -f "$confdir/$pkg.tmp" "$confdir/$pkg"
						;;
					"DEL "*)
						k="${line#DEL }"
						grep -v -F "$k=" "$confdir/$pkg" > "$confdir/$pkg.tmp" 2>/dev/null || : > "$confdir/$pkg.tmp"
						"$REAL_MV" -f "$confdir/$pkg.tmp" "$confdir/$pkg"
						;;
				esac
			done < "$d/$pkg"
			[ "$d" = "$savedir" ] && : > "$d/$pkg"
		done
		;;
esac
EOF

# 4. Mock ubus (session + service + uci transaction engine for MTKW_TEST_RPCD=1).
cat > "$MOCKBIN/ubus" <<'EOF'
#!/bin/sh
while [ $# -gt 0 ]; do
	case "$1" in -S|-t) shift ;; *) break ;; esac
done
sub="${1:-}"; obj="${2:-}"; method="${3:-}"; payload="${4:-}"
[ -n "$payload" ] || payload='{}'
[ "$sub" = "call" ] || exit 1
R="${MTKW_ROOT:-}"
RPCD_DIR="$R/var/run/mock-rpcd"
mkdir -p "$RPCD_DIR" 2>/dev/null || true
[ -n "${MOCK_UBUS_LOG:-}" ] && printf '%s.%s\n' "$obj" "$method" >> "$MOCK_UBUS_LOG"

sync_live_nft_from_disk() {
	fo=$(grep '^@defaults\[0\]\.flow_offloading=' "$R/etc/config/firewall" 2>/dev/null | tail -n 1 | cut -d= -f2-)
	foh=$(grep '^@defaults\[0\]\.flow_offloading_hw=' "$R/etc/config/firewall" 2>/dev/null | tail -n 1 | cut -d= -f2-)
	if [ "$fo" = 1 ] && [ "$foh" = 1 ]; then
		printf 'hw\n' > "$R/var/run/mock-nft-mode"
	elif [ "$fo" = 1 ]; then
		printf 'sw\n' > "$R/var/run/mock-nft-mode"
	else
		printf 'no_ft\n' > "$R/var/run/mock-nft-mode"
	fi
}

rotate_fw4_state() {
	printf 'state-%s\n' "$$" > "$R/var/run/fw4.state.new"
	"$REAL_MV" -f "$R/var/run/fw4.state.new" "$R/var/run/fw4.state"
}

case "$obj:$method" in
	session:create)
		printf '{"ubus_rpc_session":"0123456789abcdef0123456789abcdef"}\n'
		;;
	session:grant)
		printf '{}\n'
		;;
	session:destroy)
		sid=$(printf '%s' "$payload" | jsonfilter -e '@.ubus_rpc_session' 2>/dev/null || true)
		[ -n "$sid" ] && "$REAL_RM" -f "$RPCD_DIR/$sid.stage"
		printf '{}\n'
		;;
	service:list)
		if [ "${MOCK_FW_TRIGGER:-1}" = 1 ]; then
			printf '{"firewall":{"triggers":[["config.change",["if",["eq","package","firewall"],["run_script","/etc/init.d/firewall","reload"]],1000]]}}\n'
		else
			printf '{"firewall":{"triggers":[]}}\n'
		fi
		;;
	uci:get)
		[ -f "$R/etc/config/firewall" ] || exit 1
		grep -q '^@defaults\[0\]=defaults$' "$R/etc/config/firewall" || exit 1
		fo=$(grep '^@defaults\[0\]\.flow_offloading=' "$R/etc/config/firewall" | tail -n 1 | cut -d= -f2-)
		foh=$(grep '^@defaults\[0\]\.flow_offloading_hw=' "$R/etc/config/firewall" | tail -n 1 | cut -d= -f2-)
		extra=""
		[ -n "$fo" ] && extra="${extra},\"flow_offloading\":\"$fo\""
		[ -n "$foh" ] && extra="${extra},\"flow_offloading_hw\":\"$foh\""
		printf '{"values":{".type":"defaults",".name":"cfg01e63d"%s}}\n' "$extra"
		;;
	uci:set)
		sid=$(printf '%s' "$payload" | jsonfilter -e '@.ubus_rpc_session')
		fo=$(printf '%s' "$payload" | jsonfilter -e '@.values.flow_offloading' 2>/dev/null || true)
		foh=$(printf '%s' "$payload" | jsonfilter -e '@.values.flow_offloading_hw' 2>/dev/null || true)
		: > "$RPCD_DIR/$sid.stage"
		[ -n "$fo" ] && printf 'SET @defaults[0].flow_offloading=%s\n' "$fo" >> "$RPCD_DIR/$sid.stage"
		[ -n "$foh" ] && printf 'SET @defaults[0].flow_offloading_hw=%s\n' "$foh" >> "$RPCD_DIR/$sid.stage"
		printf '{}\n'
		;;
	uci:commit)
		if [ "${MOCK_FW_TRIGGER:-1}" = 1 ]; then
			rotate_fw4_state
			[ "${MOCK_NFT_VERIFY_FAIL:-0}" = 1 ] || sync_live_nft_from_disk
		fi
		printf '{}\n'
		;;
	uci:apply)
		if [ -n "${MOCK_APPLY_RC:-}" ] && [ "$MOCK_APPLY_RC" != 0 ]; then
			exit "$MOCK_APPLY_RC"
		fi
		sid=$(printf '%s' "$payload" | jsonfilter -e '@.ubus_rpc_session')
		"$REAL_CP" "$R/etc/config/firewall" "$RPCD_DIR/$sid.backup"
		if [ -f "$RPCD_DIR/$sid.stage" ]; then
			while IFS= read -r line; do
				case "$line" in
					"SET "*)
						kv="${line#SET }"; k="${kv%%=*}"
						grep -v -F "$k=" "$R/etc/config/firewall" > "$R/etc/config/firewall.tmp" 2>/dev/null || : > "$R/etc/config/firewall.tmp"
						printf '%s\n' "$kv" >> "$R/etc/config/firewall.tmp"
						"$REAL_MV" -f "$R/etc/config/firewall.tmp" "$R/etc/config/firewall"
						;;
				esac
			done < "$RPCD_DIR/$sid.stage"
			"$REAL_RM" -f "$RPCD_DIR/$sid.stage"
		fi
		if [ "${MOCK_FW_TRIGGER:-1}" = 1 ]; then
			rotate_fw4_state
			[ "${MOCK_NFT_VERIFY_FAIL:-0}" = 1 ] || sync_live_nft_from_disk
		fi
		printf '{}\n'
		;;
	uci:confirm)
		if [ -n "${MOCK_CONFIRM_RC:-}" ] && [ "$MOCK_CONFIRM_RC" != 0 ]; then
			exit "$MOCK_CONFIRM_RC"
		fi
		sid=$(printf '%s' "$payload" | jsonfilter -e '@.ubus_rpc_session')
		"$REAL_RM" -f "$RPCD_DIR/$sid.backup"
		printf '{}\n'
		;;
	uci:rollback)
		sid=$(printf '%s' "$payload" | jsonfilter -e '@.ubus_rpc_session')
		if [ -f "$RPCD_DIR/$sid.backup" ]; then
			"$REAL_MV" -f "$RPCD_DIR/$sid.backup" "$R/etc/config/firewall"
		fi
		if [ "${MOCK_FW_TRIGGER:-1}" = 1 ] && [ "${MOCK_ROLLBACK_NO_RELOAD:-0}" != 1 ]; then
			rotate_fw4_state
			sync_live_nft_from_disk
		fi
		if [ -n "${MOCK_ROLLBACK_RC:-}" ] && [ "$MOCK_ROLLBACK_RC" != 0 ]; then
			exit "$MOCK_ROLLBACK_RC"
		fi
		printf '{}\n'
		;;
	network.interface.*:status)
		printf '{"device":"eth1"}\n'
		;;
	*)
		exit 1
		;;
esac
EOF

# 5. Mock nft & fw4
cat > "$MOCKBIN/fw4" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "$MOCKBIN/nft" <<'EOF'
#!/bin/sh
R="${MTKW_ROOT:-}"
mode="unavailable"
[ -f "$R/var/run/mock-nft-mode" ] && mode=$(cat "$R/var/run/mock-nft-mode")
case "$mode" in
	unavailable) exit 1 ;;
	no_ft)
		cat <<'NFT_EOF'
table inet fw4 {
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
}
NFT_EOF
		;;
	sw)
		cat <<'NFT_EOF'
table inet fw4 {
	flowtable ft {
		hook ingress priority 0
		devices = { lan1, wan }
		# flags offload; commented out must not count as hardware offload!
	}
}
NFT_EOF
		;;
	hw)
		cat <<'NFT_EOF'
table inet fw4 {
	flowtable ft {
		hook ingress priority 0
		devices = { lan1, wan }
		flags offload;
	}
}
NFT_EOF
		;;
	*) exit 1 ;;
esac
EOF

# 6. Mock ethtool, iw, dmesg
cat > "$MOCKBIN/ethtool" <<'EOF'
#!/bin/sh
if [ "${1:-}" = "-S" ]; then
	dev="${2:-}"
	if [ "$dev" = "eth0" ]; then
		printf 'NIC statistics:\n     tx_bytes: 123456\n     tx_packets: 100\n     rx_bytes: 654321\n     rx_packets: 200\n     rx_fcs_errors: 0\n'
		exit 0
	fi
	exit 1
fi
printf 'Settings for %s:\n\tSupported ports: [ TP ]\n\tSupported link modes:   100baseT/Full 2500baseT/Full\n\tPort: Twisted Pair\n' "${1:-eth0}"
EOF

cat > "$MOCKBIN/iw" <<'EOF'
#!/bin/sh
case "$*" in
	"dev")
		printf 'phy#0\n\tInterface phy0-ap0\n\t\ttype AP\n'
		;;
	"dev phy0-ap0 info")
		printf 'Interface phy0-ap0\n\ttype AP\n\tchannel 36 (5180 MHz), width: 160 MHz\n'
		;;
	"dev phy0-ap0 station dump")
		cat <<'IW_EOF'
Station aa:bb:cc:dd:ee:01 (on phy0-ap0)
	tx bytes:	1000000
	tx packets:	800
	tx retries:	12
	tx failed:	1
	signal:  	-58 dBm
	tx bitrate:	1200.0 MBit/s
	expected throughput:	900.0Mbps
	connected time:	120 seconds
Station aa:bb:cc:dd:ee:02 (on phy0-ap0)
	tx bytes:	500000
	tx packets:	400
	tx retries:	8
	tx failed:	0
	signal avg:	-64 dBm
	tx bitrate:	2400.0 MBit/s
	connected time:	90 seconds
IW_EOF
		;;
	*) exit 1 ;;
esac
EOF

cat > "$MOCKBIN/dmesg" <<'EOF'
#!/bin/sh
exit 0
EOF

# 7. Hookable mv, cp, rm wrappers for deterministic SIGKILL / ENOSPC / order injection.
cat > "$MOCKBIN/mv" <<'EOF'
#!/bin/sh
if [ -n "${MOCK_MV_MODE:-}" ]; then
	last=""; for a in "$@"; do last=$a; done
	case "$MOCK_MV_MODE" in
		cpu_pause_at_uci_committing)
			case "$last" in
				*/cpu-save.*/state)
					st_val=$(cat "${1}" 2>/dev/null || cat "${2}" 2>/dev/null || true)
					"$REAL_MV" "$@"
					rc=$?
					if [ "$st_val" = "uci_committing" ]; then
						: > "$MOCK_READY"
						sleep 5
					fi
					exit "$rc" ;;
			esac ;;
		cpu_pause_after_uci_mv)
			case "$last" in
				*/etc/config/mtk_wed)
					"$REAL_MV" "$@"
					rc=$?
					: > "$MOCK_READY"
					sleep 5
					exit "$rc" ;;
			esac ;;
		wed_pause_inflight)
			case "$last" in
				*/modules.conf|*/modules.d/*)
					"$REAL_MV" "$@"
					rc=$?
					if [ ! -f "$MOCK_READY" ]; then
						: > "$MOCK_WED_LOCK_GATE"
						: > "$MOCK_SETTINGS_GATE"
						: > "$MOCK_READY"
						w=0
						while [ ! -f "$MOCK_RESUME" ] && [ "$w" -lt 100 ]; do
							sleep 0.05 2>/dev/null || sleep 1
							w=$((w + 1))
						done
					fi
					exit "$rc" ;;
			esac ;;
		wed_fail_step2)
			case "$last" in
				*/modules.conf|*/modules.d/*)
					n=0; [ -f "$MOCK_MV_CNT" ] && n=$(cat "$MOCK_MV_CNT")
					n=$((n + 1)); printf '%d\n' "$n" > "$MOCK_MV_CNT"
					if [ "$n" = 2 ]; then exit 1; fi ;;
			esac ;;
		wed_del_old1_fail_step2)
			case "$last" in
				*/modules.conf|*/modules.d/*)
					n=0; [ -f "$MOCK_MV_CNT" ] && n=$(cat "$MOCK_MV_CNT")
					n=$((n + 1)); printf '%d\n' "$n" > "$MOCK_MV_CNT"
					if [ "$n" = 1 ]; then
						"$REAL_MV" "$@"
						rc=$?
						"$REAL_RM" -f "$MOCK_ETC_DIR"/.mtkw-old.* 2>/dev/null || true
						exit "$rc"
					elif [ "$n" = 2 ]; then
						exit 1
					fi ;;
			esac ;;
		wed_pause_after_modules_conf)
			case "$last" in
				*/modules.conf)
					"$REAL_MV" "$@"
					rc=$?
					: > "$MOCK_READY"
					sleep 5
					exit "$rc" ;;
			esac ;;
	esac
fi
exec "$REAL_MV" "$@"
EOF

cat > "$MOCKBIN/cp" <<'EOF'
#!/bin/sh
if [ -n "${MOCK_CP_MODE:-}" ]; then
	last=""; for a in "$@"; do last=$a; done
	case "$MOCK_CP_MODE" in
		fail_enospc)
			case "$last" in */.mtkw-old.*) exit 1 ;; esac ;;
	esac
fi
exec "$REAL_CP" "$@"
EOF

cat > "$MOCKBIN/rm" <<'EOF'
#!/bin/sh
if [ -n "${MOCK_CPU_RM_LOG:-}" ]; then
	for a in "$@"; do
		case "$a" in
			-*) ;;
			*/cpu-save.*/*) printf '%s\n' "${a#*/cpu-save.*/}" >> "$MOCK_CPU_RM_LOG" ;;
			*/cpu-save.*) printf 'TXN_DIR\n' >> "$MOCK_CPU_RM_LOG" ;;
		esac
	done
fi
exec "$REAL_RM" "$@"
EOF

chmod 0755 "$MOCKBIN"/*
PATH="$MOCKBIN:$PATH"
export PATH

# ── Fixture Builders ────────────────────────────────────────────────────

mk_root() {
	d=$1
	mkdir -p \
		"$d/etc/config" \
		"$d/etc/init.d" \
		"$d/etc/modules.d" \
		"$d/etc/modules-boot.d" \
		"$d/var/run/mtk-wed" \
		"$d/tmp/sysinfo" \
		"$d/tmp/.uci" \
		"$d/proc/device-tree" \
		"$d/sys/module/mt7996e/parameters" \
		"$d/sys/devices/system/cpu/cpufreq/policy0" \
		"$d/sys/devices/system/cpu/cpufreq/policy1" \
		"$d/sys/class/thermal/thermal_zone0" \
		"$d/sys/kernel/debug/ppe0" \
		"$d/sys/kernel/debug/wed0" \
		"$d/sys/class/ieee80211/phy0" \
		"$d/sys/bus/platform/devices/15110000.ethernet/of_node/mac@0" \
		"$d/sys/bus/platform/devices/15110000.ethernet/of_node/mac@1" \
		"$d/sys/class/net/eth0" \
		"$d/sys/class/net/eth1"
	printf 'Test Filogic Router\n' > "$d/tmp/sysinfo/model"
	printf 'bananapi,bpi-r4\0mediatek,mt7988a\0' > "$d/proc/device-tree/compatible"
	printf 'processor\t: 0\nCPU part\t: 0xd09\nprocessor\t: 1\n' > "$d/proc/cpuinfo"
	printf '100.50 200.00\n' > "$d/proc/uptime"
	printf 'cpu  1000 0 500 8000 100 50 120 0 0 0\ncpu0 600 0 300 4000 40 33 77 0 0 0\ncpu1 400 0 200 4000 60 17 43 0 0 0\n' > "$d/proc/stat"
	printf 'cpu-thermal\n' > "$d/sys/class/thermal/thermal_zone0/type"
	printf '52000\n' > "$d/sys/class/thermal/thermal_zone0/temp"
	for pol in policy0 policy1; do
		printf 'powersave schedutil performance\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/scaling_available_governors"
		printf '1100000 1500000 1800000\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/scaling_available_frequencies"
		printf 'powersave\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/scaling_governor"
		printf '1100000\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/scaling_max_freq"
		printf '1100000\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/scaling_cur_freq"
		printf '800000\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/cpuinfo_min_freq"
		printf '1800000\n' > "$d/sys/devices/system/cpu/cpufreq/$pol/cpuinfo_max_freq"
	done
	printf 'cpu=cpu\ncpu.governor=powersave\ncpu.max_freq=1100000\n' > "$d/etc/config/mtk_wed"
	printf 'N\n' > "$d/sys/module/mt7996e/parameters/wed_enable"
	printf 'options mt7996e wed_enable=N\n# keep comment\n' > "$d/etc/modules.conf"
	printf 'mt7996e wed_enable=N other=1\n' > "$d/etc/modules.d/mt7996e"
	printf '@defaults[0]=defaults\n@defaults[0].flow_offloading=0\n@defaults[0].flow_offloading_hw=0\n' > "$d/etc/config/firewall"
	printf 'no_ft\n' > "$d/var/run/mock-nft-mode"
	printf 'state-init\n' > "$d/var/run/fw4.state"
	cat > "$d/etc/init.d/firewall" <<'FW_EOF'
#!/bin/sh
R="${MTKW_ROOT:-}"
[ -n "${MOCK_FW_RELOAD_LOG:-}" ] && printf 'reload\n' >> "$MOCK_FW_RELOAD_LOG"
[ "${MOCK_FW_RELOAD_FAIL:-0}" != 1 ] || exit 1
fo=$(grep '^@defaults\[0\]\.flow_offloading=' "$R/etc/config/firewall" 2>/dev/null | tail -n 1 | cut -d= -f2-)
foh=$(grep '^@defaults\[0\]\.flow_offloading_hw=' "$R/etc/config/firewall" 2>/dev/null | tail -n 1 | cut -d= -f2-)
if [ "$fo" = 1 ] && [ "$foh" = 1 ]; then
	printf 'hw\n' > "$R/var/run/mock-nft-mode"
elif [ "$fo" = 1 ]; then
	printf 'sw\n' > "$R/var/run/mock-nft-mode"
else
	printf 'no_ft\n' > "$R/var/run/mock-nft-mode"
fi
exit 0
FW_EOF
	chmod 0755 "$d/etc/init.d/firewall"
	ln -s "../../bus/platform/devices/15110000.ethernet/of_node/mac@0" "$d/sys/class/net/eth0/of_node" 2>/dev/null || true
	ln -s "../../bus/platform/devices/15110000.ethernet/of_node/mac@1" "$d/sys/class/net/eth1/of_node" 2>/dev/null || true
	cat > "$d/sys/kernel/debug/ppe0/entries" <<'PPE_EOF'
0010a BND IPv4 HNAT orig=192.168.1.10:52344->1.1.1.1:443 new=203.0.113.5:52344->1.1.1.1:443 eth=aa:bb:cc:00:00:01->aa:bb:cc:00:00:02 etype=0800 vlan=1,0 ib1=2040057f ib2=007f0060 packets=1500 bytes=2100000
0010b UNB IPv6 HNAPT orig=2001:db8::1:1234->2001:db8::2:80 eth=aa:bb:cc:00:00:03->aa:bb:cc:00:00:04 etype=86dd vlan=0,0 ib1=10000000 ib2=00000000 packets=12 bytes=960
PPE_EOF
}

count_cpu_txns() {
	n=0
	for f in "$1/var/run/mtk-wed"/cpu-save.*; do
		[ -e "$f" ] && n=$((n + 1))
	done
	printf '%d' "$n"
}

count_wed_leaks() {
	n=0
	for f in "$1/etc"/.mtkw-* "$1/etc/modules.d"/.mtkw-* "$1/var/run/mtk-wed"/wed-save.*; do
		[ -e "$f" ] && n=$((n + 1))
	done
	printf '%d' "$n"
}

wait_file() {
	wf_i=0
	while [ ! -f "$1" ] && [ "$wf_i" -lt 60 ]; do
		sleep 0.05 2>/dev/null || sleep 1
		wf_i=$((wf_i + 1))
	done
}

# ==============================================================================
# SECTION 0 & 1: Syntax Check & RPC list Contract
# ==============================================================================

"$SH_BIN" -n "$RPCD" && pass "syntax check: luci.mtk_wed ($SH_BIN -n)" || fail "syntax check: luci.mtk_wed"
"$SH_BIN" -n "$INITD" && pass "syntax check: init.d/mtk-wed ($SH_BIN -n)" || fail "syntax check: init.d/mtk-wed"

LIST_OUT=$("$SH_BIN" "$RPCD" list)
for m in getStatus getPorts getPpeEntries getMacStats getWifiStats setFlowOffload setWedEnable setCpuSettings; do
	assert_contains "list RPC exposes $m" "$LIST_OUT" "\"$m\":"
done

D="$WORK/t_unknown"; mk_root "$D"
UNK_OUT=$(printf '{}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call noSuchMethod)
assert_eq "unknown RPC method rejected" "$UNK_OUT" '{"error":"unknown method"}'

# ==============================================================================
# SECTION 2: CPU Settings & Cross-Invocation SIGKILL Crash Recovery
# ==============================================================================

# 2a. Normal multi-policy save + UCI persistence + cpu_cleanup unlink order
D="$WORK/t_cpu_ok"; mk_root "$D"
: > "$D/cpu_rm.log"
OUT=$(printf '{"governor":"performance","freq":1800000}\n' | MTKW_ROOT="$D" MOCK_CPU_RM_LOG="$D/cpu_rm.log" "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU normal multi-policy save JSON" "$OUT" '{"result":"ok","governor":"performance","freq":1800000}'
assert_eq "CPU policy0 governor updated" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "performance"
assert_eq "CPU policy1 max_freq updated" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_max_freq")" "1800000"
assert_contains "CPU UCI persisted governor" "$(cat "$D/etc/config/mtk_wed")" "cpu.governor=performance"
assert_contains "CPU UCI persisted max_freq" "$(cat "$D/etc/config/mtk_wed")" "cpu.max_freq=1800000"
assert_eq "CPU normal save leaves 0 cpu-save.* dirs" "$(count_cpu_txns "$D")" "0"
RM_ORD=$(tr '\n' ' ' < "$D/cpu_rm.log" | sed 's/ $//')
assert_eq "CPU cleanup unlinks steps and metadata strictly before state" "$RM_ORD" "1 2 steps target_gov target_freq .state.tmp state TXN_DIR"

# 2b. Validation errors
OUT=$(printf '{"governor":"ondemand","freq":1800000}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU unsupported governor rejected" "$OUT" '{"error":"unsupported governor"}'
OUT=$(printf '{"governor":"performance","freq":9999999}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU unsupported frequency rejected" "$OUT" '{"error":"unsupported frequency"}'

# 2c. Partial sysfs write failure rolls back earlier policy cleanly
D="$WORK/t_cpu_partial"; mk_root "$D"
# policy1 supports freq only (governor list = schedutil only), and its scaling_max_freq is read-only
printf 'schedutil\n' > "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_available_governors"
chmod 0444 "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_max_freq"
if [ ! -w "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_max_freq" ]; then
	OUT=$(printf '{"governor":"performance","freq":1800000}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
	assert_eq "CPU partial sysfs failure returns error" "$OUT" '{"error":"cannot apply the CPU settings"}'
	assert_eq "CPU partial sysfs failure rolls policy0 governor back" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "powersave"
	assert_eq "CPU partial sysfs failure rolls policy0 freq back" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq")" "1100000"
	assert_eq "CPU partial sysfs failure cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"
fi

# 2d. UCI commit failure rolls back both policies
D="$WORK/t_cpu_ucifail"; mk_root "$D"
OUT=$(printf '{"governor":"performance","freq":1800000}\n' | MTKW_ROOT="$D" MOCK_UCI_FAIL_COMMIT=1 "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU UCI commit failure error message" "$OUT" '{"error":"cannot save the CPU settings; previous settings restored"}'
assert_eq "CPU UCI failure rolls back policy0" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "powersave"
assert_eq "CPU UCI failure rolls back policy1" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_max_freq")" "1100000"
assert_eq "CPU UCI failure cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

# 2e. SIGTERM pre-UCI rollback vs post-UCI non-rollback
D="$WORK/t_cpu_term_pre"; mk_root "$D"
printf '{"governor":"performance","freq":1800000}\n' > "$D/in.json"
MTKW_ROOT="$D" MOCK_MV_MODE=cpu_pause_at_uci_committing MOCK_READY="$D/ready" \
	"$SH_BIN" "$RPCD" call setCpuSettings < "$D/in.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/ready"
kill -TERM "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
assert_eq "CPU SIGTERM before UCI commit restores policy0" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "powersave"
assert_eq "CPU SIGTERM before UCI commit cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

D="$WORK/t_cpu_term_post"; mk_root "$D"
printf '{"governor":"performance","freq":1800000}\n' > "$D/in.json"
MTKW_ROOT="$D" MOCK_MV_MODE=cpu_pause_after_uci_mv MOCK_READY="$D/ready" \
	"$SH_BIN" "$RPCD" call setCpuSettings < "$D/in.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/ready"
kill -TERM "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
assert_eq "CPU SIGTERM after UCI commit preserves new governor" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "performance"
assert_eq "CPU SIGTERM after UCI commit preserves new max_freq" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_max_freq")" "1800000"
assert_eq "CPU SIGTERM after UCI commit cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

# 2f. SIGKILL after sysfs mutation before UCI commit -> getStatus restores sysfs & reports restored values!
D="$WORK/t_cpu_kill_pre"; mk_root "$D"
printf '{"governor":"performance","freq":1800000}\n' > "$D/in.json"
MTKW_ROOT="$D" MOCK_MV_MODE=cpu_pause_at_uci_committing MOCK_READY="$D/ready" \
	"$SH_BIN" "$RPCD" call setCpuSettings < "$D/in.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/ready"
kill -9 "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
assert_eq "CPU SIGKILL pre-UCI leaves mutated sysfs before recovery" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "performance"
assert_eq "CPU SIGKILL pre-UCI leaves 1 cpu-save.* journal" "$(count_cpu_txns "$D")" "1"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "getStatus after CPU SIGKILL reports restored governor" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.cpu.governor')" "powersave"
assert_eq "getStatus after CPU SIGKILL reports restored max_freq" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.cpu.max_freq')" "1100000"
assert_eq "getStatus after CPU SIGKILL restores policy1 sysfs" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_governor")" "powersave"
assert_eq "getStatus after CPU SIGKILL cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

# 2g. SIGKILL in uci_committing AFTER on-disk UCI updated -> getStatus preserves/reapplies new sysfs & cleans!
D="$WORK/t_cpu_kill_post"; mk_root "$D"
printf '{"governor":"performance","freq":1800000}\n' > "$D/in.json"
MTKW_ROOT="$D" MOCK_MV_MODE=cpu_pause_after_uci_mv MOCK_READY="$D/ready" \
	"$SH_BIN" "$RPCD" call setCpuSettings < "$D/in.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/ready"
kill -9 "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
# Simulate drifted policy1 to verify cpu_apply_targets forward-reconciles sysfs to committed UCI
printf 'powersave\n' > "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_governor"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "getStatus after post-UCI SIGKILL reports committed governor" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.cpu.governor')" "performance"
assert_eq "getStatus after post-UCI SIGKILL reports committed max_freq" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.cpu.max_freq')" "1800000"
assert_eq "getStatus after post-UCI SIGKILL forward-syncs policy1" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy1/scaling_governor")" "performance"
assert_eq "getStatus after post-UCI SIGKILL cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

# 2h. Dual SIGKILL mid-cpu_restore -> next getStatus idempotently finishes remaining policy!
D="$WORK/t_cpu_dual_kill"; mk_root "$D"
J="$D/var/run/mtk-wed/cpu-save.dual1"
mkdir -p "$J/1" "$J/2"
printf 'committing\n' > "$J/state"
printf '2 1\n' > "$J/steps"
printf 'performance\n' > "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
printf '1800000\n' > "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_max_freq"
# Simulate step 2 already restored before 2nd SIGKILL hit, while step 1 is still un-restored
printf '%s/sys/devices/system/cpu/cpufreq/policy0\n' "$D" > "$J/1/path"
printf '1\n' > "$J/1/do_gov"; printf '1\n' > "$J/1/do_freq"
printf 'powersave\n' > "$J/1/gov"; printf '1100000\n' > "$J/1/freq"
printf '%s/sys/devices/system/cpu/cpufreq/policy1\n' "$D" > "$J/2/path"
printf '1\n' > "$J/2/do_gov"; printf '1\n' > "$J/2/do_freq"
printf 'powersave\n' > "$J/2/gov"; printf '1100000\n' > "$J/2/freq"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "CPU dual-SIGKILL mid-restore finishes policy0" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.cpu.governor')" "powersave"
assert_eq "CPU dual-SIGKILL mid-restore cleans cpu-save.*" "$(count_cpu_txns "$D")" "0"

# 2i. Active cpu.lock held -> concurrent getStatus does NOT clobber in-flight cpu-save.*
D="$WORK/t_cpu_lock_busy"; mk_root "$D"
J="$D/var/run/mtk-wed/cpu-save.inflight"
mkdir -p "$J/1"
printf 'committing\n' > "$J/state"
printf '%s/sys/devices/system/cpu/cpufreq/policy0\n' "$D" > "$J/1/path"
printf '1\n' > "$J/1/do_gov"; printf '0\n' > "$J/1/do_freq"; printf 'powersave\n' > "$J/1/gov"
printf 'performance\n' > "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
: > "$D/cpu.gate"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" MOCK_CPU_LOCK_GATE="$D/cpu.gate" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "Active cpu.lock leaves in-flight cpu-save.* intact" "$(count_cpu_txns "$D")" "1"
assert_eq "Active cpu.lock does not revert in-flight sysfs" "$(cat "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor")" "performance"

# 2j. restore_failed blocks subsequent setCpuSettings until sysfs becomes writable again
D="$WORK/t_cpu_rf"; mk_root "$D"
J="$D/var/run/mtk-wed/cpu-save.rf1"
mkdir -p "$J/1"
printf 'committing\n' > "$J/state"
printf '1\n' > "$J/steps"
printf '%s/sys/devices/system/cpu/cpufreq/policy0\n' "$D" > "$J/1/path"
printf '1\n' > "$J/1/do_gov"; printf '0\n' > "$J/1/do_freq"; printf 'powersave\n' > "$J/1/gov"
# Replace scaling_governor with a directory so redirect fails with EISDIR even as uid 0
"$REAL_RM" -f "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
mkdir "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
OUT=$(printf '{"governor":"schedutil","freq":1500000}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU restore_failed blocks new setCpuSettings" "$OUT" '{"error":"cannot restore previous CPU settings"}'
assert_eq "CPU restore_failed marks state=restore_failed" "$(cat "$J/state")" "restore_failed"
# Restore writable sysfs file -> next setCpuSettings recovers previous state and applies new settings!
rmdir "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
printf 'performance\n' > "$D/sys/devices/system/cpu/cpufreq/policy0/scaling_governor"
OUT=$(printf '{"governor":"schedutil","freq":1500000}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
assert_eq "CPU setCpuSettings succeeds once sysfs writable again" "$OUT" '{"result":"ok","governor":"schedutil","freq":1500000}'
assert_eq "CPU restore_failed journal cleaned after recovery" "$(count_cpu_txns "$D")" "0"

# 2k. Pre-stage cpu-save.* with regular .state.tmp cleaned, symlink .state.tmp fails closed
D="$WORK/t_cpu_prestage"; mk_root "$D"
mkdir -p "$D/var/run/mtk-wed/cpu-save.pre1"
printf 'staging\n' > "$D/var/run/mtk-wed/cpu-save.pre1/.state.tmp"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "CPU pre-stage regular .state.tmp cleaned" "$(count_cpu_txns "$D")" "0"
mkdir -p "$D/var/run/mtk-wed/cpu-save.sym1"
if ln -s /nonexistent/target "$D/var/run/mtk-wed/cpu-save.sym1/.state.tmp" 2>/dev/null; then
	OUT=$(printf '{"governor":"performance","freq":1800000}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setCpuSettings)
	assert_eq "CPU symlink .state.tmp fails closed" "$OUT" '{"error":"cannot restore previous CPU settings"}'
fi

# ==============================================================================
# SECTION 3: WED Multi-File Transactions & Crash Recovery
# ==============================================================================

# 3a. Normal save preserving symlink, comments, and unrelated module options
D="$WORK/t_wed_ok"; mk_root "$D"
"$REAL_MV" "$D/etc/modules.conf" "$D/etc/modules.conf.real"
ln -s "$D/etc/modules.conf.real" "$D/etc/modules.conf" 2>/dev/null || "$REAL_CP" "$D/etc/modules.conf.real" "$D/etc/modules.conf"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setWedEnable)
assert_eq "WED normal save JSON" "$OUT" '{"result":"ok","enabled":1,"module":"mt7996e","reboot_required":true}'
assert_contains "WED modules.conf preserves comment" "$(cat "$D/etc/modules.conf")" "# keep comment"
assert_contains "WED modules.d preserves unrelated arg" "$(cat "$D/etc/modules.d/mt7996e")" "mt7996e other=1"
assert_not_contains "WED modules.d strips duplicate wed_enable" "$(cat "$D/etc/modules.d/mt7996e")" "wed_enable="
assert_eq "WED normal save leaves 0 leaks" "$(count_wed_leaks "$D")" "0"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "WED getStatus reports configured=true" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.wed_param.configured')" "true"

# 3b. Step-2 failure rollback
D="$WORK/t_wed_rb"; mk_root "$D"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MOCK_MV_MODE=wed_fail_step2 MOCK_MV_CNT="$D/cnt" "$SH_BIN" "$RPCD" call setWedEnable)
assert_eq "WED step-2 failure rolls back cleanly" "$OUT" '{"error":"cannot save the WED settings; previous settings restored"}'
assert_contains "WED step-2 rollback restores modules.conf=N" "$(cat "$D/etc/modules.conf")" "wed_enable=N"
assert_eq "WED step-2 rollback leaves 0 leaks" "$(count_wed_leaks "$D")" "0"

# 3c & 3d. SIGKILL after step-1 commit mv -> dual SIGKILL inside wed_restore right after mv before restored marker!
D="$WORK/t_wed_dual"; mk_root "$D"
printf '{"enabled":1}\n' > "$D/in_set.json"
printf '{"skip_ppe":true}\n' > "$D/in_st.json"
MTKW_ROOT="$D" MOCK_MV_MODE=wed_pause_after_modules_conf MOCK_READY="$D/r1" \
	"$SH_BIN" "$RPCD" call setWedEnable < "$D/in_set.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/r1"
kill -9 "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
J=$(for f in "$D/var/run/mtk-wed"/wed-save.*; do [ -d "$f" ] && printf '%s' "$f" && break; done)
OLD1=$(cat "$J/1/old")
# 2nd SIGKILL right after restore mv -f $rtmp $target succeeds and BEFORE : > $J/1/restored
MTKW_ROOT="$D" MOCK_MV_MODE=wed_pause_after_modules_conf MOCK_READY="$D/r2" \
	"$SH_BIN" "$RPCD" call getStatus < "$D/in_st.json" >/dev/null 2>&1 &
BG=$!; wait_file "$D/r2"
kill -9 "$BG" 2>/dev/null || true; wait "$BG" 2>/dev/null || true
assert_eq 'WED copy-and-rename keeps $old intact across 2nd SIGKILL' "$([ -f "$OLD1" ] && echo 1 || echo 0)" "1"
assert_eq "WED 2nd SIGKILL occurred before restored marker" "$([ -f "$J/1/restored" ] && echo 1 || echo 0)" "0"
ST_OUT=$(MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus < "$D/in_st.json")
assert_eq "WED 2nd getStatus finishes recovery (configured=false)" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.wed_param.configured')" "false"
assert_not_contains "WED 2nd getStatus has no recovery_path" "$ST_OUT" "recovery_path"
assert_eq "WED dual-SIGKILL leaves 0 leaks" "$(count_wed_leaks "$D")" "0"

# 3e. Missing $old backup fails closed with recovery_path
D="$WORK/t_wed_missold"; mk_root "$D"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MOCK_MV_MODE=wed_del_old1_fail_step2 MOCK_MV_CNT="$D/cnt" MOCK_ETC_DIR="$D/etc" "$SH_BIN" "$RPCD" call setWedEnable)
assert_contains 'WED missing $old fails closed with recovery files' "$OUT" "cannot save or restore the WED settings; recovery files:"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_contains 'WED missing $old exposes recovery_path in getStatus' "$ST_OUT" "\"recovery_path\":"

# 3f. Legacy state-less 2.0.0-4 journal: valid recovers, corrupt preserves backups
D="$WORK/t_wed_leg_ok"; mk_root "$D"
J="$D/var/run/mtk-wed/wed-save.leg1"; mkdir -p "$J/1"
printf 'options mt7996e wed_enable=Y\n' > "$D/etc/modules.conf"
printf 'options mt7996e wed_enable=N\n' > "$D/etc/.mtkw-old.leg1"
printf '%s/etc/modules.conf\n' "$D" > "$J/1/path"
printf '%s/etc/.mtkw-new.leg1\n' "$D" > "$J/1/new"
printf '%s/etc/.mtkw-old.leg1\n' "$D" > "$J/1/old"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "WED valid legacy state-less journal recovers" "$(printf '%s' "$ST_OUT" | jsonfilter -e '@.wed_param.configured')" "false"
assert_eq "WED valid legacy state-less journal cleans up" "$(count_wed_leaks "$D")" "0"

D="$WORK/t_wed_leg_bad"; mk_root "$D"
J="$D/var/run/mtk-wed/wed-save.leg2"; mkdir -p "$J/1" "$J/2"
printf '%s/etc/modules.conf\n' "$D" > "$J/1/path"
printf '%s/etc/.mtkw-new.gone\n' "$D" > "$J/1/new"
printf '%s/etc/.mtkw-old.missing\n' "$D" > "$J/1/old"
printf 'mt7996e wed_enable=N\n' > "$D/etc/modules.d/.mtkw-old.keep"
printf '%s/etc/modules.d/mt7996e\n' "$D" > "$J/2/path"
printf '%s/etc/modules.d/.mtkw-new.keep\n' "$D" > "$J/2/new"
printf '%s/etc/modules.d/.mtkw-old.keep\n' "$D" > "$J/2/old"
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_eq "WED unrecoverable legacy journal preserves step-2 backup" "$([ -f "$D/etc/modules.d/.mtkw-old.keep" ] && echo 1 || echo 0)" "1"
assert_contains "WED unrecoverable legacy journal reports recovery_path" "$ST_OUT" "wed-save.leg2"

# 3g. wed.lock busy -> saving:true, then settles
D="$WORK/t_wed_busy"; mk_root "$D"
printf '{"enabled":1}\n' > "$D/in.json"
MTKW_ROOT="$D" MOCK_MV_MODE=wed_pause_inflight MOCK_READY="$D/ready" MOCK_RESUME="$D/resume" \
	MOCK_WED_LOCK_GATE="$D/wed.gate" MOCK_SETTINGS_GATE="$D/set.gate" \
	"$SH_BIN" "$RPCD" call setWedEnable < "$D/in.json" > "$D/set.out" 2>&1 &
BG=$!; wait_file "$D/ready"
ST_BUSY=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" MOCK_WED_LOCK_GATE="$D/wed.gate" MOCK_SETTINGS_GATE="$D/set.gate" "$SH_BIN" "$RPCD" call getStatus)
: > "$D/resume"; wait "$BG"
"$REAL_RM" -f "$D/wed.gate" "$D/set.gate"
ST_SETTLED=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_contains "WED in-flight save reports configured:null,saving:true" "$ST_BUSY" '"wed_param":{"module":"mt7996e","active":false,"configured":null,"saving":true}'
assert_eq "WED post-save settles to configured=true" "$(printf '%s' "$ST_SETTLED" | jsonfilter -e '@.wed_param.configured')" "true"
assert_not_contains "WED post-save clears saving flag" "$ST_SETTLED" '"saving":'

# ==============================================================================
# SECTION 4: Flow Offload (Live MTKW_TEST_RPCD=1 Transaction + Offline CAS + 9-State)
# ==============================================================================

# 4a. Live rpcd/uci transaction with procd trigger=1
D="$WORK/t_flow_rpcd_t1"; mk_root "$D"
: > "$D/ubus.log"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MTKW_TEST_RPCD=1 MOCK_FW_TRIGGER=1 MOCK_UBUS_LOG="$D/ubus.log" "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow live rpcd trigger=1 enable succeeds" "$OUT" '{"result":"ok","enabled":1}'
assert_contains "Flow live rpcd ran uci.apply" "$(cat "$D/ubus.log")" "uci.apply"
assert_contains "Flow live rpcd ran uci.confirm" "$(cat "$D/ubus.log")" "uci.confirm"
assert_contains "Flow live rpcd destroyed session" "$(cat "$D/ubus.log")" "session.destroy"

# 4b. Live rpcd/uci transaction with trigger=0 (manual firewall reload)
D="$WORK/t_flow_rpcd_t0"; mk_root "$D"
: > "$D/fw_reload.log"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MTKW_TEST_RPCD=1 MOCK_FW_TRIGGER=0 MOCK_FW_RELOAD_LOG="$D/fw_reload.log" "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow live rpcd trigger=0 enable succeeds" "$OUT" '{"result":"ok","enabled":1}'
assert_eq "Flow live rpcd trigger=0 ran 1 manual reload" "$(wc -l < "$D/fw_reload.log" | tr -d ' ')" "1"

# 4c. External apply_sid lock contention (rc=6)
D="$WORK/t_flow_locked"; mk_root "$D"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MTKW_TEST_RPCD=1 MOCK_APPLY_RC=6 "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow live rpcd rc=6 reports locked pending apply" "$OUT" '{"error":"firewall settings are locked by another pending apply"}'

# 4d. nft verification failure -> automatic uci rollback
D="$WORK/t_flow_nftfail"; mk_root "$D"
: > "$D/ubus.log"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MTKW_TEST_RPCD=1 MOCK_FW_TRIGGER=1 MOCK_NFT_VERIFY_FAIL=1 MOCK_UBUS_LOG="$D/ubus.log" "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow nft verify failure triggers rollback error" "$OUT" '{"error":"firewall reload failed; flow offload setting reverted"}'
assert_contains "Flow nft verify failure invoked uci.rollback" "$(cat "$D/ubus.log")" "uci.rollback"
assert_contains "Flow nft verify failure restored firewall UCI" "$(cat "$D/etc/config/firewall")" "flow_offloading_hw=0"

# 4e. confirm failure + lost rollback reply (rc=7) with trigger=0 STILL runs 2nd manual reload
D="$WORK/t_flow_lostrb"; mk_root "$D"
: > "$D/fw_reload.log"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" MTKW_TEST_RPCD=1 MOCK_FW_TRIGGER=0 MOCK_CONFIRM_RC=1 MOCK_ROLLBACK_RC=7 MOCK_FW_RELOAD_LOG="$D/fw_reload.log" "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow confirm fail + lost rollback reply reports honest error" "$OUT" '{"error":"could not verify firewall transaction rollback"}'
assert_eq "Flow lost rollback reply with trigger=0 ran 2nd manual fw4 reload" "$(wc -l < "$D/fw_reload.log" | tr -d ' ')" "2"
assert_eq "Flow lost rollback reply reconciled live nft to no_ft" "$(cat "$D/var/run/mock-nft-mode")" "no_ft"

# 4f. Offline CAS path preserves uncommitted /tmp/.uci/firewall delta
D="$WORK/t_flow_cas"; mk_root "$D"
printf 'SET @defaults[0].synflood_protect=1\n' > "$D/tmp/.uci/firewall"
OUT=$(printf '{"enabled":1}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call setFlowOffload)
assert_eq "Flow offline CAS enable succeeds" "$OUT" '{"result":"ok","enabled":1}'
assert_eq "Flow offline CAS preserves /tmp/.uci/firewall delta" "$(cat "$D/tmp/.uci/firewall")" "SET @defaults[0].synflood_protect=1"
assert_not_contains "Flow offline CAS did not leak delta into committed firewall" "$(cat "$D/etc/config/firewall")" "synflood_protect"

# 4g. 9-state UCI (off / sw / hw) x live nft (unavailable / sw / hw) matrix in getStatus
D="$WORK/t_flow_matrix"; mk_root "$D"
M_PASS=0
for uci_st in off sw hw; do
	case "$uci_st" in
		off) printf '@defaults[0]=defaults\n@defaults[0].flow_offloading=0\n@defaults[0].flow_offloading_hw=0\n' > "$D/etc/config/firewall"; exp_sw=false; exp_hw=false ;;
		sw)  printf '@defaults[0]=defaults\n@defaults[0].flow_offloading=1\n@defaults[0].flow_offloading_hw=0\n' > "$D/etc/config/firewall"; exp_sw=true;  exp_hw=false ;;
		hw)  printf '@defaults[0]=defaults\n@defaults[0].flow_offloading=1\n@defaults[0].flow_offloading_hw=1\n' > "$D/etc/config/firewall"; exp_sw=true;  exp_hw=true ;;
	esac
	for nft_st in unavailable sw hw; do
		printf '%s\n' "$nft_st" > "$D/var/run/mock-nft-mode"
		case "$nft_st" in
			unavailable) exp_lsw=null; exp_lhw=null ;;
			sw)          exp_lsw=true; exp_lhw=false ;;
			hw)          exp_lsw=true; exp_lhw=true ;;
		esac
		ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
		want="\"flow_offload\":{\"software\":$exp_sw,\"hardware\":$exp_hw,\"live_software\":$exp_lsw,\"live_hardware\":$exp_lhw}"
		case "$ST_OUT" in
			*"$want"*) M_PASS=$((M_PASS + 1)) ;;
			*) fail "Flow 9-state matrix ($uci_st x $nft_st)" "got $ST_OUT" ;;
		esac
	done
done
assert_eq "Flow 9-state UCI x live nft matrix (all 9 combinations)" "$M_PASS" "9"

# ==============================================================================
# SECTION 5: Telemetry & Security (PPE Lock Wait, Eval Injection, IRQ, Wi-Fi, MAC)
# ==============================================================================

# 5a. PPE cold-cache lock contention waits and succeeds (no instant false error)
D="$WORK/t_ppe_wait"; mk_root "$D"
: > "$D/busy_once"
PPE_OUT=$(printf '{"page":0,"refresh":true,"interval":5}\n' | MTKW_ROOT="$D" MOCK_FLOCK_BUSY_ONCE="$D/busy_once" "$SH_BIN" "$RPCD" call getPpeEntries)
assert_eq "PPE cold-cache lock contention waits and succeeds" "$(printf '%s' "$PPE_OUT" | jsonfilter -e '@.available')" "true"
assert_eq "PPE total count parsed" "$(printf '%s' "$PPE_OUT" | jsonfilter -e '@.total')" "2"
assert_eq "PPE bound count parsed" "$(printf '%s' "$PPE_OUT" | jsonfilter -e '@.bound')" "1"

# 5b. getPpeEntries filtering + 8 eval injection payloads (0 command exec, valid JSON)
PPE_FILT=$(printf '{"page":0,"state":"BND","type":"IPv4","ppe":0}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getPpeEntries)
assert_eq "PPE filtered matched count" "$(printf '%s' "$PPE_FILT" | jsonfilter -e '@.matched')" "1"

PWN="$WORK/pwned_canary"
INJ_OK=0
for payload in \
	"{\"page\":\"0; touch $PWN\"}" \
	"{\"state\":\"\$(touch $PWN)\"}" \
	"{\"type\":\"\`touch $PWN\`\"}" \
	"{\"ppe\":\"0' || touch $PWN #\"}" \
	"{\"state\":\"BND\\ntouch $PWN\"}" \
	"{\"interval\":\"5;touch $PWN\"}" \
	"{\"page\":[1]}" \
	"{\"state\":true}"
do
	INJ_OUT=$(printf '%s\n' "$payload" | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getPpeEntries)
	if [ ! -e "$PWN" ] && printf '%s' "$INJ_OUT" | jsonfilter -e '@.error' >/dev/null 2>&1; then
		INJ_OK=$((INJ_OK + 1))
	else
		fail "getPpeEntries injection guard" "payload=$payload out=$INJ_OUT"
	fi
done
assert_eq "getPpeEntries blocks all 8 eval/type-confusion payloads with 0 exec" "$INJ_OK" "8"

# 5c. Pure SoftIRQ ($8) vs hard IRQ ($7) separation in cpu.cores
ST_OUT=$(printf '{"skip_ppe":true}\n' | MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getStatus)
assert_contains "CPU core0 separates sirq=77 and irq=33" "$ST_OUT" '{"id":0,"total":5050,"idle":4040,"sirq":77,"irq":33}'
assert_contains "CPU core1 separates sirq=43 and irq=17" "$ST_OUT" '{"id":1,"total":4720,"idle":4060,"sirq":43,"irq":17}'

# 5d. Wi-Fi paired airtime efficiency & signal: fallback when signal avg: absent
WIFI_OUT=$(MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getWifiStats)
assert_eq "Wi-Fi available=true" "$(printf '%s' "$WIFI_OUT" | jsonfilter -e '@.available')" "true"
assert_eq "Wi-Fi station count=2" "$(printf '%s' "$WIFI_OUT" | jsonfilter -e '@.stations')" "2"
# Station 1: phy=1200, exp=900 -> paired efficiency = 900/1200 = 75% (NOT diluted by station 2's 2400 without exp!)
# Signal: station 1 uses signal: -58 fallback, station 2 uses signal avg: -64 -> avg = -61, min = -64
assert_contains "Wi-Fi paired airtime_efficiency=75 and signal fallback (-61/-64)" "$WIFI_OUT" '"airtime_efficiency":75,"avg_signal":-61,"min_signal":-64'

# 5e. getMacStats per-GDM ok:true (eth0) vs ok:false (eth1)
MAC_OUT=$(MTKW_ROOT="$D" "$SH_BIN" "$RPCD" call getMacStats)
assert_contains "getMacStats eth0 ok:true with counters" "$MAC_OUT" '{"netdev":"eth0","gdm":0,"ok":true,"tx_bytes":123456'
assert_contains "getMacStats eth1 ok:false with null counters" "$MAC_OUT" '{"netdev":"eth1","gdm":1,"ok":false,"tx_bytes":null'

printf '\n1..%d\n# pass %d, fail %d\n' "$((PASS_CNT + FAIL_CNT))" "$PASS_CNT" "$FAIL_CNT"
[ "$FAIL_CNT" -eq 0 ]
