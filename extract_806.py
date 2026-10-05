"""Extract Glenair Series 806 contact coordinates into source/glenair_806_contacts.csv.

The coordinates come from the X/Y location tables in Glenair's "Series 806 Mil-Aero
PCB layouts and footprints" appendix (pages 218-262 of the 806 catalog):

    https://cdn.glenair.com/mil-aero-connectors/pdf/appendix/pcb-layouts-and-footprints.pdf

The tables are in inches, +X right and +Y toward the master key, and number the
contacts as on the mating face of the pin insert (Glenair 806-015 shows the same
layouts as "mating face of pin connector"), which is the convention MIL-STD-1560C
uses, so they drop straight into the tool.  Small arrangements are dimensioned on
the drawing instead of tabulated and are not extracted.

Each table is checked against the arrangement's contact complement from 806-015
Table I before it is written.  Needs PyMuPDF; run only when the source changes:

    python extract_806.py path/to/pcb-layouts-and-footprints.pdf
"""
import csv, re, sys, collections
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
OUT = HERE / "source" / "glenair_806_contacts.csv"

# 806-015 Table I: contacts per size.  Numbered contacts are the 22HD/20HD/16 ones
# in single-size arrangements; in combinations the large contacts are lettered.
TABLE_I = {
    **{k: {"22HD": n} for k, n in {
        "7-3": 3, "8-4": 4, "8-7": 7, "9-11": 11, "10-15": 15, "11-19": 19, "12-26": 26,
        "14-39": 39, "16-60": 60, "18-85": 85, "20-110": 110, "22-140": 140, "24-186": 186}.items()},
    **{k: {"20HD": n} for k, n in {
        "8-3": 3, "9-5": 5, "10-8": 8, "11-10": 10, "12-15": 15, "14-20": 20, "16-31": 31,
        "18-41": 41, "20-55": 55, "22-69": 69, "24-92": 92}.items()},
    **{k: {"16": n} for k, n in {
        "8-1": 1, "10-2": 2, "11-4": 4, "12-5": 5, "14-7": 7, "16-12": 12, "18-15": 15,
        "20-22": 22, "22-24": 24, "24-35": 35}.items()},
    **{k: {"12": n} for k, n in {
        "9-1": 1, "12-2": 2, "14-3": 3, "16-4": 4, "16-7": 7, "18-8": 8, "20-11": 11,
        "22-13": 13, "24-19": 19}.items()},
    **{k: {"8": n} for k, n in {
        "10-1": 1, "16-2": 2, "18-3": 3, "20-4": 4, "22-5": 5, "24-8": 8}.items()},
    **{k: {"22HD": a, "16": b} for k, (a, b) in {
        "10-8A": (6, 2), "11-13": (11, 2), "12-27": (26, 1), "14-21": (17, 4),
        "16-41": (37, 4), "18-59": (55, 4)}.items()},
    **{k: {"22HD": a, "12": b} for k, (a, b) in {
        "11-14": (13, 1), "12-14": (12, 2), "14-22": (20, 2), "16-32": (28, 4),
        "16-42": (40, 2), "18-62": (60, 2)}.items()},
    **{k: {"22HD": a, "8": b} for k, (a, b) in {
        "14-20A": (19, 1), "16-22": (20, 2), "18-21": (18, 3), "20-28": (24, 4),
        "22-44": (40, 4), "24-97": (93, 4)}.items()},
}

NUM = re.compile(r"^[+-]?\d*\.\d+\.?$")          # 20-11 prints one value as ".000."
ID = re.compile(r"^([A-Z]|\d{1,3})$")
HDR = re.compile(r"Arrangement No\.\s*(\d+-\d+A?)")


def triples(page):
    """(id, x, y, page_y) for every ID followed by two numbers on one text line."""
    rows = collections.defaultdict(list)
    for w in page.get_text("words"):
        rows[round((w[1] + w[3]) / 2)].append(w)
    out = []
    for y, ws in rows.items():
        ws.sort(key=lambda w: w[0])
        t = [w[4] for w in ws]
        k = 0
        while k + 2 < len(t):
            if ID.match(t[k]) and NUM.match(t[k + 1]) and NUM.match(t[k + 2]):
                out.append((t[k], float(t[k + 1].rstrip(".")), float(t[k + 2].rstrip(".")), y))
                k += 3
            else:
                k += 1
    return out


def size_of(cid, sizes):
    if len(sizes) == 1:
        return next(iter(sizes))
    small, large = sorted(sizes, key=lambda s: s != "22HD")   # 22HD is always the numbered size
    return large if cid.isalpha() else small


def check(key, rows):
    sizes = TABLE_I[key]
    ids = [r[0] for r in rows]
    if len(set(ids)) != len(ids):
        return "duplicate IDs"
    got = collections.Counter(size_of(i, sizes) for i in ids)
    if got != collections.Counter(sizes):
        return f"complement {dict(got)} != Table I {sizes}"
    nums = sorted(int(i) for i in ids if i.isdigit())
    if nums != list(range(1, len(nums) + 1)):
        return "numbered contacts are not 1..N"
    return None


def main(pdf):
    doc = pymupdf.open(pdf)
    found = {}
    for pno, page in enumerate(doc):
        keys = HDR.findall(page.get_text())
        rows = triples(page) if keys else []
        if not rows:
            continue
        # A page holds one to four arrangements but at most a table or two.  Offer each
        # arrangement the whole page's rows and the rows below its own heading (down to
        # the next one), and keep whichever matches its Table I complement.
        heads = sorted((page.search_for("Arrangement No. " + k)[0].y0, k) for k in keys)
        for n, (top, key) in enumerate(heads):
            bottom = heads[n + 1][0] if n + 1 < len(heads) else float("inf")
            for rs in (rows, [r for r in rows if top < r[3] < bottom]):
                if key not in found and check(key, rs) is None:
                    found[key] = (pno + 1, rs)

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["arrangement", "id", "x_in", "y_in", "size", "pdf_page"])
        order = lambda k: tuple(int(re.sub(r"\D", "", v)) for v in k.split("-"))
        for key in sorted(found, key=order):
            page, rs = found[key]
            for cid, x, y, _ in rs:
                w.writerow([key, cid, f"{x:.3f}", f"{y:.3f}", size_of(cid, TABLE_I[key]), page])
    print(f"wrote {OUT}: {len(found)} arrangements, {sum(len(v[1]) for v in found.values())} contacts")
    missing = [k for k in TABLE_I if k not in found]
    print(f"no usable table ({len(missing)}):", " ".join(missing))


if __name__ == "__main__":
    main(sys.argv[1])
