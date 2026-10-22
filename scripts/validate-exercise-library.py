#!/usr/bin/env python3
"""Independent artifact validator for the bundled exercise library (#1578).

Checks schema/vocabulary, unique IDs, reference integrity, normalized
name/alias collisions, ambiguity records, redirects, and claimed summary values
against actual contents. Fixture results against the application resolver are
asserted in mobile/tests/exercise-library.test.js, not here.

Usage:
  validate-exercise-library.py [library.json]
  validate-exercise-library.py --mutations negative.json [library.json]
  validate-exercise-library.py --regen-casefold fixture.json index.js

--regen-casefold rewrites the "casefold_expected" and "normalize_expected"
sections of the shared test fixture from Python str.casefold() and normalize(),
for the code points listed in the CASEFOLD_EXCEPTIONS table of index.js (plus
fixed extras and sample names). Jest asserts the JS resolver against that
committed output, so tests need no live Python for case folding.
"""
import copy
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

DEFAULT = Path(__file__).resolve().parent.parent / "mobile/lib/data/exerciseLibrary/v3.json"
LIST_FIELDS = {"movement_patterns": "movement_patterns", "primary_muscles": "muscles",
               "secondary_muscles": "muscles", "equipment": "equipment"}
SCALAR_FIELDS = ["activity_type", "loading_type", "logging_type", "laterality", "compound_status"]
EXERCISE_KEYS = {"id", "name", "aliases", "family_id", "activity_type", "movement_patterns",
                 "primary_muscles", "secondary_muscles", "equipment", "loading_type",
                 "logging_type", "laterality", "compound_status", "variant",
                 "cardio_modality", "classification_notes"}


def normalize(text):
    t = unicodedata.normalize("NFKC", unicodedata.normalize("NFKC", text).casefold())
    t = re.sub(r"['‘’`]", "", t)
    t = re.sub(r"[^\w]+|_", " ", t).strip()
    out, run = [], ""
    for tok in t.split():
        if len(tok) == 1 and tok.isalpha():
            run += tok
        else:
            if run:
                out.append(run)
                run = ""
            out.append(tok)
    if run:
        out.append(run)
    return " ".join(out)


def validate(d):
    issues = []
    bad = issues.append
    if d.get("schema_version") != 3:
        bad("schema_version must be 3")
    vocab = d.get("vocabulary", {})
    fams = d.get("families", [])
    exs = d.get("exercises", [])
    amb = d.get("ambiguous_names", [])
    fam_ids = [f["id"] for f in fams]
    ex_ids = [e["id"] for e in exs]
    for label, ids in (("family", fam_ids), ("exercise", ex_ids)):
        for k, n in Counter(ids).items():
            if n > 1:
                bad(f"duplicate {label} id {k}")
    if sorted(fam_ids) != sorted(vocab.get("family_ids", [])):
        bad("vocabulary.family_ids does not match families")
    for e in exs:
        eid = e.get("id")
        if set(e) != EXERCISE_KEYS:
            bad(f"{eid}: unexpected/missing keys")
            continue
        if e["family_id"] not in fam_ids:
            bad(f"{eid}: unknown family_id {e['family_id']}")
        for f in SCALAR_FIELDS:
            if e[f] not in vocab.get(f, []):
                bad(f"{eid}: {f} {e[f]!r} not in vocabulary")
        for f, v in LIST_FIELDS.items():
            for x in e[f]:
                if x not in vocab.get(v, []):
                    bad(f"{eid}: {f} {x!r} not in vocabulary")
        for k, x in e["variant"].items():
            if x not in vocab["variant"].get(k, []):
                bad(f"{eid}: variant {k}={x!r} not in vocabulary")
        if e["cardio_modality"] is not None and e["cardio_modality"] not in vocab["cardio_modality"]:
            bad(f"{eid}: bad cardio_modality")
    # normalized exercise name/alias collisions across distinct exercises
    owner = {}
    for e in exs:
        for label in [e["name"], *e.get("aliases", [])]:
            k = normalize(label)
            if k in owner and owner[k] != e["id"]:
                bad(f"normalized collision {k!r}: {owner[k]} vs {e['id']}")
            owner.setdefault(k, e["id"])
    famkeys = {}
    for f in fams:
        for label in [f["name"], *f["aliases"]]:
            k = normalize(label)
            if k in famkeys and famkeys[k] != f["id"]:
                bad(f"family collision {k!r}: {famkeys[k]} vs {f['id']}")
            famkeys.setdefault(k, f["id"])
    seen = set()
    for a in amb:
        k = normalize(a["input"])
        if k in seen:
            bad(f"duplicate ambiguity {k!r}")
        seen.add(k)
        if k in owner:
            bad(f"ambiguity {k!r} shadowed by exercise {owner[k]}")
        if len(set(a["candidate_ids"])) < 2:
            bad(f"ambiguity {k!r} needs >=2 distinct candidates")
        for c in a["candidate_ids"]:
            if c not in ex_ids:
                bad(f"ambiguity {k!r}: unknown candidate {c}")
        if not a["missing_discriminators"]:
            bad(f"ambiguity {k!r}: no discriminators")
        if a["family_id"] is not None and a["family_id"] not in fam_ids:
            bad(f"ambiguity {k!r}: unknown family_id")
    for old, new in d.get("deprecated_id_redirects", {}).items():
        if old in ex_ids:
            bad(f"redirect source {old} is still a live exercise")
        if new not in ex_ids:
            bad(f"redirect {old} -> unknown {new}")
    cases = d.get("matching_test_cases", [])
    for c in cases:
        if c["expected_match_type"] not in vocab.get("match_types", []):
            bad(f"case {c['input']!r}: bad match type")
        if c["expected_exercise_id"] is not None and c["expected_exercise_id"] not in ex_ids:
            bad(f"case {c['input']!r}: unknown exercise id")
        if c["expected_family_id"] is not None and c["expected_family_id"] not in fam_ids:
            bad(f"case {c['input']!r}: unknown family id")
    s = d.get("validation_summary", {})
    claims = {
        "exercise_count": len(exs), "family_count": len(fams),
        "ambiguous_name_count": len(amb), "matching_test_case_count": len(cases),
        "activity_counts": dict(Counter(e["activity_type"] for e in exs)),
        "loading_type_counts": dict(Counter(e["loading_type"] for e in exs)),
        "logging_type_counts": dict(Counter(e["logging_type"] for e in exs)),
        "equipment_counts": dict(Counter(q for e in exs for q in e["equipment"])),
    }
    for k, v in claims.items():
        if s.get(k) != v:
            bad(f"summary {k} does not match contents")
    return issues


def run_mutations(d, path):
    spec = json.loads(Path(path).read_text())
    failures = 0
    for m in spec["mutations"]:
        mutated = copy.deepcopy(d)
        for op in m["ops"]:
            target = mutated
            for part in op["path"][:-1]:
                target = target[part]
            if op["op"] == "set":
                target[op["path"][-1]] = op["value"]
            elif op["op"] == "append":
                target[op["path"][-1]].append(op["value"])
        issues = validate(mutated)
        ok = any(m["expect"] in i for i in issues)
        print(("rejected " if ok else "NOT REJECTED ") + m["id"])
        failures += not ok
    return failures


CASEFOLD_EXTRAS = ["A", "Z", "\u03a3", "\u03c2", "\u00df", "\u1e9e", "\u0130", "\u0131",
                   "\u01c5", "\u0345", "\u1fb2", "\u1f72"]
NORMALIZE_SAMPLES = [
    "Barbell Bench Pre\u00df", "Barbell Bench Press\u0345", "\u1f72", "\u1fb2", "\u1f70\u03b9",
    "\u03a3\u03a4\u0391\u03a3", "\u03c3\u03c4\u03b1\u03c2", "R.D.L.", " D.B.  RDL", "Push-Up",
    "\uFB01x", "\u0130stanbul", "Farmer\u2019s Walk", "\uFF22\uFF22 bench", "a_b",
    "5x5 @ 100kg", "\u1e97 bar row", "\u01f0 curl", "\u0390 raise", "Pre\u1e9e", "\u0131ncline", "\u13a0\uab70",
]


def regen_casefold(fixture_path, index_path):
    text = Path(index_path).read_text()
    block = text.split("const CASEFOLD_EXCEPTIONS", 1)[1].split("]\n    .join", 1)[0]
    cps = [int(m, 16) for m in re.findall(r"(?:'|\s)([0-9a-f]+)=[0-9a-f.]+", block)]
    chars = sorted({chr(c) for c in cps} | set(CASEFOLD_EXTRAS))
    fixture = json.loads(Path(fixture_path).read_text())
    fixture["casefold_expected"] = {
        "python_version_note": "Generated once with Python str.casefold(); regenerate with --regen-casefold.",
        "table_codepoints": len(cps),
        "cases": {format(ord(c), "x"): c.casefold() for c in chars},
    }
    fixture["normalize_expected"] = {x: normalize(x) for x in NORMALIZE_SAMPLES}
    Path(fixture_path).write_text(json.dumps(fixture, indent=2, ensure_ascii=True) + "\n")
    print(f"wrote {len(chars)} casefold cases, {len(NORMALIZE_SAMPLES)} normalize cases")
    return 0


def main(argv):
    args = argv[1:]
    if args and args[0] == "--regen-casefold":
        return regen_casefold(args[1], args[2])
    mut = None
    if args and args[0] == "--mutations":
        mut, args = args[1], args[2:]
    path = Path(args[0]) if args else DEFAULT
    d = json.loads(path.read_text())
    issues = validate(d)
    for i in issues:
        print("ISSUE:", i)
    if issues:
        return 1
    print(f"valid: {len(d['exercises'])} exercises, {len(d['families'])} families, "
          f"{len(d['ambiguous_names'])} ambiguous, {len(d['matching_test_cases'])} cases")
    if mut:
        return 1 if run_mutations(d, mut) else 0
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
