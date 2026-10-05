"""Build data.js for the D38999 pinout tool.

Coordinates come from MIL-STD-1560C w/Change 3 (front face of the PIN insert).
Decode tables, shell interface dimensions and Series III polarization come from
the reviewed CSVs in source/, which were extracted from MIL-DTL-38999N.
Glenair Series 806 coordinates come from source/glenair_806_contacts.csv
(see extract_806.py).

Run:  python build_data.py
"""
import csv, json, re, sys, collections
from pathlib import Path

HERE = ROOT = Path(__file__).resolve().parent
SOURCE = HERE / "source"   # copies of the inputs, taken from the parent research project
TEXT = SOURCE / "MIL-STD-1560C.txt"
DATA = SOURCE

# --------------------------------------------------------------------------
# MIL-STD-1560C contact coordinate tables
# --------------------------------------------------------------------------
pages = {}
for chunk in TEXT.read_text(encoding="utf-8").split("=== PDF PAGE ")[1:]:
    num, _, body = chunk.partition(" ===")
    pages[int(num)] = body.replace("−", "-")

ID = r"([A-Za-z]{1,2}|\d{1,3})"
# Values print as "+.325 (8.26)". The source has stray spaces after the sign or
# the decimal point and occasionally drops an opening paren or a leading sign.
VAL = r"([+-]?\s*\d*\.\s*\d+)\s*\(?\s*([+-]?\s*\d*\.?\s*\d+)\s*\)"
COORD = re.compile(rf"(?<![\w.]){ID}\s+{VAL}\s+{VAL}")
ARR = re.compile(r"Insert arrangement\s*:?\s*\(?\s*(\d+)\s*-\s*(\d+)\)?"
                 r"(?:\s+or\s+\(?\s*(\d+)\s*-\s*(\d+)\)?)?", re.I)

# MIL-STD-1560C prints lowercase contact IDs as underlined capitals, and text
# extraction loses the underline, so an ID can appear twice in one arrangement.
UPPER = "ABCDEFGHJKLMNPRSTUVWXYZ"
LOWER = "abcdefghjkmnpqrstuvwxyz"

# Documented corrections to the source text.
CORRECTIONS = {
    ("16-35", "53", "x"): (-0.312, 0.312,
                           "MIL-STD-1560C p197 prints -.312; contacts 54 and 55 "
                           "share +.312 and twin arrangement 17-35 reads +.312"),
}

# 20-41 has no coordinate table in MIL-STD-1560C (only the summary row and the
# pictorial). Every other even/odd shell pair shares identical coordinates.
ALIASES = {"20-41": "21-41"}


def f(s):
    return float(s.replace(" ", ""))


def fix_duplicate_ids(rows):
    """Resolve repeated IDs by matching each candidate to its sequence neighbours."""
    counts = collections.Counter(r[0] for r in rows)
    dupes = [k for k, v in counts.items() if v > 1]
    if not dupes:
        return [dict(id=r[0], x=r[1], y=r[2]) for r in rows]
    out = [dict(id=r[0], x=r[1], y=r[2]) for r in rows]
    for dup in dupes:
        idx = [i for i, r in enumerate(out) if r["id"] == dup]
        if len(idx) != 2 or dup not in UPPER:
            # Fall back to a positional suffix rather than dropping a contact.
            for n, i in enumerate(idx[1:], 2):
                out[i]["id"] = f"{dup}#{n}"
            continue
        k = UPPER.index(dup)
        up = [UPPER[j] for j in (k - 1, k + 1) if 0 <= j < len(UPPER)]
        lo = [LOWER[j] for j in (k - 1, k + 1) if 0 <= j < len(LOWER)]
        pos = {r["id"]: (r["x"], r["y"]) for r in out}

        def cost(i, names):
            here = (out[i]["x"], out[i]["y"])
            d = [((here[0] - pos[n][0]) ** 2 + (here[1] - pos[n][1]) ** 2) ** .5
                 for n in names if n in pos]
            return sum(d) / len(d) if d else 0.0

        a, b = idx
        if cost(a, up) + cost(b, lo) <= cost(b, up) + cost(a, lo):
            out[b]["id"] = dup.lower()
        else:
            out[a]["id"] = dup.lower()
    return out


raw = collections.defaultdict(list)
arr_pages = collections.defaultdict(list)
current = ()
for num in sorted(pages):
    body = pages[num]
    m = ARR.search(body)
    if m:
        current = (f"{int(m[1])}-{int(m[2])}",)
        if m[3]:
            ALIASES[f"{int(m[3])}-{int(m[4])}"] = current[0]
    if not current:
        continue
    found = COORD.findall(body)
    if not found:
        continue
    raw[current[0]].extend(found)
    arr_pages[current[0]].append(num)

coords, applied = {}, []
for key, rows in raw.items():
    # A few pages tabulate mm first with inches in parentheses.
    prim = max(max(abs(f(r[1])), abs(f(r[3]))) for r in rows)
    paren = max(max(abs(f(r[2])), abs(f(r[4]))) for r in rows)
    inches_first = prim <= paren
    picked = [(r[0], f(r[1] if inches_first else r[2]), f(r[3] if inches_first else r[4]))
              for r in rows]
    contacts = fix_duplicate_ids(picked)
    for c in contacts:
        for axis in ("x", "y"):
            fix = CORRECTIONS.get((key, c["id"], axis))
            if fix and abs(c[axis] - fix[0]) < 1e-9:
                c[axis] = fix[1]
                applied.append(f"{key} contact {c['id']} {axis}: {fix[0]} -> {fix[1]} ({fix[2]})")
    coords[key] = [dict(id=c["id"], x=round(c["x"], 4), y=round(c["y"], 4)) for c in contacts]

# --------------------------------------------------------------------------
# Arrangement summary rows (contact count, contact sizes, service rating)
# --------------------------------------------------------------------------
tab = list(csv.DictReader(open(SOURCE / "extracted_tables_unreviewed.csv", encoding="utf-8")))
wanted = {(r["pdf_page"], r["table"]) for r in tab
          if r["file"] == "MIL-STD-1560C.pdf" and "Arrangement; no." in r["cells"]}
meta = {}
for r in tab:
    if r["file"] != "MIL-STD-1560C.pdf" or (r["pdf_page"], r["table"]) not in wanted:
        continue
    if "Arrangement; no." in r["cells"]:
        shell = arrno = None
        continue
    cells = ([c.strip() for c in r["cells"].split("|")] + [""] * 8)[:8]
    if re.fullmatch(r"\d+", cells[0]):
        shell = int(cells[0])
    am = re.fullmatch(r"-\s*(\d+)", cells[1])
    if am:
        arrno = int(am[1])
    if shell is None or arrno is None or not re.fullmatch(r"\d+", cells[2]) or not cells[3]:
        continue
    m = meta.setdefault(f"{shell}-{arrno}", dict(shell=shell, no=arrno, groups=[], pages=[]))
    m["groups"].append(dict(count=int(cells[2]), size=cells[3].replace(";", " ").strip(),
                            rating=cells[4], locations=cells[5].replace(";", "").strip()))
    if int(r["pdf_page"]) not in m["pages"]:
        m["pages"].append(int(r["pdf_page"]))

# Summary tables whose merged cells defeat the table finder, read from the page text.
# Each entry: (count, contact size, service rating, contact locations).
MANUAL = {
    "16-26": [(26, "20", "I", "All")],
    "19-18": [(4, "8", "Twinax", "B, F, K, P"), (14, "22D", "M", "All others")],
    "19-19": [(4, "8", "Twinax", "B, F, K, P"), (14, "22D", "M", "All others")],
    "21-76": [(4, "8", "Twinax", "All")],
    "25-7":  [(2, "8", "Twinax", "25, 75"), (97, "22D", "M", "All others")],
    "25-8":  [(8, "8", "Twinax", "All")],
    "25-9":  [(2, "8", "Twinax", "25, 75"), (97, "22D", "M", "All others")],
    "25-10": [(8, "8", "Twinax", "All")],
    "25-20": [(3, "8", "Twinax", "A, H, K"), (4, "12", "Coax", "2, 3, W, 5"),
              (13, "16", "I", "C,D,E,F,J,M,N,P,R,T,U,Y,Z"),
              (10, "20", "I", "B,G,L,S,V,X,1,4,6,7")],
    "25-21": [(3, "8", "Twinax", "A, H, K"), (4, "12", "Coax", "2, 3, W, 5"),
              (13, "16", "I", "C,D,E,F,J,M,N,P,R,T,U,Y,Z"),
              (10, "20", "I", "B,G,L,S,V,X,1,4,6,7")],
    "25-46": [(2, "8", "Coax", "z, w"), (4, "16", "I", "v, x, y, AA"),
              (40, "20", "I", "All others")],
    "25-47": [(2, "8", "Coax", "z, w"), (4, "16", "I", "v, x, y, AA"),
              (40, "20", "I", "All others")],
    "25-90": [(2, "8", "Twinax", "w, z"), (4, "16", "I", "v, x, y, AA"),
              (40, "20", "I", "All others")],
    "25-91": [(2, "8", "Twinax", "w, z"), (4, "16", "I", "v, x, y, AA"),
              (40, "20", "I", "All others")],
}
MANUAL_PAGES = {"16-26": [200], "19-18": [71], "19-19": [72], "21-76": [106],
                "25-7": [140], "25-8": [141], "25-9": [144], "25-10": [145],
                "25-20": [149], "25-21": [151], "25-46": [167], "25-47": [169],
                "25-90": [173], "25-91": [175]}
for key, groups in MANUAL.items():
    shell, no = (int(v) for v in key.split("-"))
    meta[key] = dict(shell=shell, no=no, pages=MANUAL_PAGES[key],
                     groups=[dict(count=c, size=s, rating=r, locations=l) for c, s, r, l in groups])

# --------------------------------------------------------------------------
# Per-contact size assignment
# --------------------------------------------------------------------------
ALL = re.compile(r"^all(\s+other[s]?)?$", re.I)


def canonical_size(text):
    """Reduce a printed size cell such as '8 (see note)' or 'Shielded, size 12A'."""
    s = re.sub(r"\(.*?\)", " ", text)
    m = re.search(r"size\s*(\d+)", s, re.I)
    if m:
        return m.group(1)
    m = re.match(r"\s*(\d+[A-Z]*(?:-\d+)?)", s)
    return m.group(1) if m else s.strip()


def split_locations(key, loc, ids, warnings):
    """Split a contact-location cell, repairing IDs merged by a lost line break."""
    names = []
    for token in (t.strip() for t in re.split(r"[,\s]+", loc) if t.strip()):
        if token in ids or len(token) < 2 or token[0] == token[1]:
            names.append(token)
            continue
        parts = list(token)
        if all(p in ids for p in parts):
            warnings.append(f"{key}: split merged contact location {token!r} into {parts}")
            names.extend(parts)
        else:
            names.append(token)
    return names


def assign_sizes(key, contacts, groups):
    warnings = []
    if len(groups) == 1:
        for c in contacts:
            c["size"] = canonical_size(groups[0]["size"])
        return warnings
    ids = {c["id"] for c in contacts}
    assigned, remainder_group = {}, None
    for g in groups:
        loc = g["locations"].strip()
        if not loc or ALL.match(loc) or loc == "N":
            remainder_group = g
            continue
        names = split_locations(key, loc, ids, warnings)
        unknown = [n for n in names if n not in ids]
        if unknown:
            warnings.append(f"{key}: size {g['size']} lists unknown contacts {unknown}")
        for n in names:
            if n in ids:
                assigned[n] = canonical_size(g["size"])
        if len(names) != g["count"]:
            warnings.append(f"{key}: size {g['size']} declares {g['count']} contacts "
                            f"but lists {len(names)} locations")
    fallback = canonical_size(remainder_group["size"]) if remainder_group else ""
    for c in contacts:
        c["size"] = assigned.get(c["id"], fallback)
        if not c["size"]:
            warnings.append(f"{key}: contact {c['id']} has no contact size")
    return warnings


# --------------------------------------------------------------------------
# Reviewed CSV tables
# --------------------------------------------------------------------------
def rows(name):
    return list(csv.DictReader(open(DATA / f"{name}.csv", encoding="utf-8-sig")))


shell_sizes = {r["code"]: int(r["shell_size"]) for r in rows("shell_sizes")}
classes = {r["code"]: dict(material=r["material"], finish=r["finish"],
                           hermetic=r["hermetic"] == "true", notes=r["notes"],
                           tmin=int(r["temperature_min_c"]), tmax=int(r["temperature_max_c"]))
           for r in rows("classes")}
contact_styles = {r["code"]: dict(gender=r["gender"], description=r["description"],
                                  hermetic_only=r["hermetic_only"] == "true")
                  for r in rows("contact_styles")}
styles = {int(r["slash"]): dict(series=r["series"], kind=r["kind"], mounting=r["mounting"],
                                hermetic=r["hermetic"] == "true", contacts=r["contacts"],
                                shell_sizes=[int(s) for s in r["shell_sizes"].split(";") if s],
                                schema=r["pin_schema"])
          for r in rows("connector_styles")}
polarization = [dict(sizes=[int(s) for s in r["shell_sizes"].split(";")], position=r["position"],
                     angles=[float(r[k + "_deg"]) for k in "ABCD"])
                for r in rows("polarization")]
interface = {}
for r in rows("series_iii_interface"):
    mid = lambda a, b: (float(r[a]) + float(r[b])) / 2
    interface[int(r["shell_size"])] = dict(
        H=mid("H_min", "H_max"), J=mid("J_min", "J_max"), G=float(r["G_nom"]),
        W=mid("W_min", "W_max"), V=mid("V_min", "V_max"), F=mid("F_min", "F_max"),
        E=float(r["E_max"]))

# MIL-STD-1560C 5.1c: socket contact cavity diameter and pin engaging end
# diameter, inches, MIL-DTL-38999 / SAE-AS29600 column.
CONTACT_DIMS = {
    "23-22": dict(cavity=.032, pin=.0268), "22": dict(cavity=.036, pin=.030),
    "22D": dict(cavity=.035, pin=.030), "22M": dict(cavity=.036, pin=.030),
    "20": dict(cavity=.049, pin=.040), "16": dict(cavity=.071, pin=.0625),
    "12": dict(cavity=.103, pin=.094), "10": dict(cavity=.134, pin=.125),
    "8": dict(cavity=.227, pin=.218),
    # Glenair 806 high-density contacts: drawn at the size 22 / 20 diameters.
    "22HD": dict(cavity=.036, pin=.030), "20HD": dict(cavity=.049, pin=.040),
}
# MIL-DTL-38999N Figure 6, millimetres.
KEYS = dict(receptacle_main=3.20, receptacle_minor=1.60, plug_main=2.54, plug_minor=1.32)

# --------------------------------------------------------------------------
# Assemble
# --------------------------------------------------------------------------
warnings = []
arrangements = {}
for key in sorted(set(coords) | set(ALIASES), key=lambda k: tuple(int(v) for v in k.split("-"))):
    src = ALIASES.get(key, key)
    if src not in coords:
        warnings.append(f"{key}: alias target {src} has no coordinates")
        continue
    m = meta.get(key)
    contacts = [dict(c) for c in coords[src]]
    if m:
        warnings += assign_sizes(key, contacts, m["groups"])
        declared = sum(g["count"] for g in m["groups"])
        if declared != len(contacts):
            warnings.append(f"{key}: {len(contacts)} coordinates vs {declared} declared")
    else:
        warnings.append(f"{key}: no summary row; contact sizes unknown")
        for c in contacts:
            c["size"] = ""
    shell, no = (int(v) for v in key.split("-"))
    unknown_sizes = sorted({c["size"] for c in contacts} - set(CONTACT_DIMS) - {""})
    if unknown_sizes:
        warnings.append(f"{key}: no diameter for contact size(s) {unknown_sizes}")
    arrangements[key] = dict(
        family="D38999", shell=shell, no=no, count=len(contacts),
        groups=m["groups"] if m else [],
        pages=(m or {}).get("pages") or arr_pages.get(src, []),
        alias=src if src != key else None,
        contacts=[[c["id"], c["x"], c["y"], c["size"]] for c in contacts])

# --------------------------------------------------------------------------
# Glenair Series 806 (source/glenair_806_contacts.csv, made by extract_806.py)
# --------------------------------------------------------------------------
# Same convention as MIL-STD-1560C: inches, pin insert mating face, +Y to the
# master key.  Keys carry an "806:" prefix; arrangement numbers overlap D38999's.
CORRECTIONS_806 = {
    ("24-35", "13"): ((-0.170, -0.468), (-0.468, -0.170),
                      "the 806 PCB layout table swaps X and Y; its drawing puts 13 between "
                      "12 and 14 on the outer ring, mirroring 6 at (.468, -.170)"),
}
g806 = collections.defaultdict(list)
for r in csv.DictReader(open(SOURCE / "glenair_806_contacts.csv", encoding="utf-8")):
    g806[r["arrangement"]].append(r)
for arr_no, rs in g806.items():
    contacts = []
    for r in rs:
        x, y = float(r["x_in"]), float(r["y_in"])
        fix = CORRECTIONS_806.get((arr_no, r["id"]))
        if fix:
            if (x, y) != fix[0]:
                sys.exit(f"806 {arr_no} contact {r['id']}: expected {fix[0]} to correct, found {(x, y)}")
            x, y = fix[1]
            applied.append(f"806:{arr_no} contact {r['id']}: {fix[0]} -> {fix[1]} ({fix[2]})")
        contacts.append([r["id"], x, y, r["size"]])
    sizes = collections.Counter(c[3] for c in contacts)
    shell, no = arr_no.split("-")
    arrangements["806:" + arr_no] = dict(
        family="806", shell=int(shell), no=no, count=len(contacts),
        groups=[dict(count=n, size=s, rating="", locations="") for s, n in sizes.items()],
        pages=sorted({int(r["pdf_page"]) for r in rs}), alias=None, contacts=contacts)

payload = dict(
    generated=__import__("datetime").date.today().isoformat(),
    sources=["MIL-STD-1560C w/CHANGE 3 (insert arrangements)",
             "MIL-DTL-38999N w/AMENDMENT 2 (decode tables, interface dimensions, Series III keying)",
             "Glenair Series 806 Mil-Aero PCB layouts and footprints, rev 10.29.25 (806 arrangements)"],
    corrections=applied,
    warnings=warnings,
    shellSizes=shell_sizes, classes=classes, contactStyles=contact_styles,
    styles={str(k): v for k, v in styles.items()},
    polarization=polarization,
    interface={str(k): v for k, v in interface.items()},
    contactDims=CONTACT_DIMS, keyWidths=KEYS,
    arrangements=arrangements,
)

out = HERE / "data.js"
out.write_text("window.D38999_DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n",
               encoding="utf-8")
print(f"wrote {out} ({out.stat().st_size/1024:.0f} KB)")
print(f"{len(arrangements)} arrangements, {sum(a['count'] for a in arrangements.values())} contacts")
for c in applied:
    print("  correction:", c)
for w in warnings:
    print("  warning:", w)
