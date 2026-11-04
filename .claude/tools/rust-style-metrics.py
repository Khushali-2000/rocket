"""Count Google-style-guide signals in non-test Rust code, per file."""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
PATTERNS = {
    "unwrap": re.compile(r"\.unwrap\(\)"),
    "expect": re.compile(r"\.expect\("),
    "panic": re.compile(r"\b(panic|todo|unimplemented|unreachable)!"),
    "clone": re.compile(r"\.clone\(\)"),
    "ref_opt": re.compile(r"&\s*Option<"),
    "ref_vec": re.compile(r"&\s*(Vec<|String\b|Box<)"),
    "glob": re.compile(r"^\s*(pub\s+)?use\s+[^;]*::\*;", re.M),
    "nested_use": re.compile(r"^\s*(pub\s+)?use\s+[^;{]*\{[^;}]*::[^;}]*\};", re.M),
    "res_unit": re.compile(r"Result<[^>]*,\s*\(\)>"),
    "push_fmt": re.compile(r"push_str\(&format!"),
    "for_each": re.compile(r"\.for_each\("),
    "unsafe": re.compile(r"\bunsafe\b"),
    "arc_rc": re.compile(r"\b(Arc|Rc)<"),
    "get_fn": re.compile(r"\bfn get_\w+"),
}
PUB_ITEM = re.compile(r"^\s*pub(\([a-z]+\))?\s+(fn|struct|enum|trait|type|const|static|mod)\b")


def non_test_lines(text):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "#[cfg(test)]":
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if nxt.startswith(("mod ", "pub mod ", "pub(crate) mod ", "pub(super) mod ")) and not nxt.rstrip().endswith(";"):
                return lines[:i]
    return lines


def undocumented(lines):
    count = 0
    for i, line in enumerate(lines):
        if not PUB_ITEM.match(line) or "(crate)" in line or "(super)" in line:
            continue
        j = i - 1
        while j >= 0 and lines[j].strip().startswith("#["):
            j -= 1
        if j < 0 or not lines[j].strip().startswith(("///", "//!")):
            count += 1
    return count


rows = []
for path in sorted(ROOT.rglob("*.rs")):
    parts = path.parts
    if "target" in parts or "tests" in parts or "bin" in parts:
        continue
    name = path.name
    if name.endswith("_tests.rs") or name in ("tests.rs", "test_doubles.rs", "test_server.rs", "test_support.rs") or name.startswith("test_") or "contracts" in name:
        continue
    text = path.read_text(errors="replace")
    lines = non_test_lines(text)
    body = "\n".join(lines)
    row = {k: len(p.findall(body)) for k, p in PATTERNS.items()}
    row["undoc"] = undocumented(lines)
    row["loc"] = len(lines)
    row["file"] = str(path.relative_to(ROOT))
    rows.append(row)

keys = ["loc", "unwrap", "expect", "panic", "clone", "ref_opt", "ref_vec", "glob", "nested_use", "res_unit", "push_fmt", "arc_rc", "get_fn", "undoc"]
totals = {k: sum(r[k] for r in rows) for k in keys}
print("TOTAL", " ".join(f"{k}={totals[k]}" for k in keys))
if len(sys.argv) > 2:
    top = int(sys.argv[2])
    score = lambda r: r["unwrap"] * 3 + r["expect"] * 2 + r["panic"] * 3 + r["ref_opt"] + r["ref_vec"] + r["nested_use"] + r["glob"] + r["res_unit"] + r["push_fmt"] + r["undoc"] * 0.2 + r["clone"] * 0.1
    for r in sorted(rows, key=score, reverse=True)[:top]:
        print(f'{r["file"]:60s} ' + " ".join(f"{k}={r[k]}" for k in keys))
