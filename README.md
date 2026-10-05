# D38999 Pinout Tool

A single-page tool for drawing D38999 pinout diagrams. Type the part number after
`D38999/`, and it decodes the connector, draws the contact arrangement relative to
the keying, and gives you a pin table for signal names, colours and groups.

Open `index.html` in a browser. There is no build step and no server: everything is
plain HTML/CSS/JS with the data preloaded from `data.js`.

## Using it

**Decode.** Enter the part-number suffix, for example `24FA35SN`. Two-letter classes
keep their trailing hyphen (`24AA-A35SN`). The decode strip reports the series, slash
sheet, class, shell size, insert arrangement, contact style, polarization and the
MIL-STD-1560C page the coordinates came from. Anything questionable — an inactive
class, a shell size the slash sheet does not list, a series whose keying is not
tabulated — appears in the notes bar rather than blocking the drawing.

The `or arrangement` menu loads any of the 166 D38999 arrangements directly and rewrites the
part number to match, keeping the current slash sheet, class, contact style and
polarization and changing only the shell code and arrangement (single-digit arrangements
are written with a leading zero, e.g. `24FA03SN`). The even (series II) shell sizes have
no D38999 shell code, so those arrangements load without a part number and are labelled
by arrangement, with a note saying why.

**Glenair Series 806.** The menu's last group, `Glenair 806`, holds 26 Glenair 806
Mil-Aero insert arrangements, among them 16-32 (28 × #22HD, 4 × #12). They are separate
from the D38999 arrangements of the same number, which are different layouts. They
load without a part number (806 part numbers are not decoded) and are titled "Glenair
806 arrangement 16-32"; type the real part number in `Output PN` to label exports. The
shell is drawn generically, with the master key at the top, because 806 shell
dimensions are not in the data. Glenair numbers its inserts the same way MIL-STD-1560C
does (pin mating face), so `Insert` and `Rear view` mirror the drawing the same way.

**Read the drawing.** By default it is the mating face of that connector; tick
`Rear view` to see it from the wire entry side, where both pins and sockets are
inserted. The main key/keyway is at the top and never rotates with the insert; the minor
keys sit at the polarization angles listed in the decode strip, measured
counter-clockwise from the main key on a receptacle and clockwise on a plug as seen on
the mating face, and the other way round from the rear (hover a key for its angle). Contact circles are the
socket cavity diameter for their contact size, enlarged by at most 1.3× so the labels
stay legible (`CONTACT_SCALE` in `app.js`; 1 is true size).

MIL-STD-1560C tabulates the **pin** insert's mating face. A socket insert's mating face
is its mirror image, and so is either insert seen from the rear, so the drawing is
mirrored in X when exactly one of those applies. The `Insert` pin/socket menu is set from
the part number and can be overridden.

**Signals and colours.** Click a contact to open a small text box beside it with the
current signal name selected, so typing replaces it. Enter saves, Tab / Shift+Tab save
and move to the next / previous contact, Esc restores the original name, and clicking
elsewhere keeps what was typed. You can also type straight into the table: Enter saves
and moves to the next listed contact with its name selected (Shift+Enter goes back;
both wrap around at the ends of the list), so
a whole connector can be named without the mouse.

Every contact starts as `NC`, drawn grey. Naming one gives it a colour no other contact
or group is using (the group palette first, then generated hues); renaming keeps that
colour, and clearing the name or typing `NC` (any case) returns it to NC and grey and takes
it out of its group. The swatch in
the table overrides the automatic colour. `Clear` (after confirming) resets every contact
on the connector to NC and removes all groups.

**Groups.** Marquee-drag or Ctrl/Shift-click to select two or more contacts, then
`Group selected` (it stays disabled for fewer than two, or when the selection already is
exactly one group). A group that drops below two contacts, by ungrouping or by moving
its contacts to another group, dissolves; its contacts keep their own colours.

Every pin in a group takes the group's colour, and each *adjacent bunch* of its pins gets
its own tinted outline: a circle round each pin, joined to its neighbours by bands whose
straight sides are tangent to both circles, with the space between three mutually
adjacent pins filled in. Each circle reaches at most 36% of the way to the nearest pin
outside the group (`GROUP_REACH` in `app.js`), so side-by-side groups keep a gap.

A group's area never covers a pin outside the group, but it may cross another group's
area — for example two Ethernet differential pairs on the crossing diagonals of four
pins. Links are judged per group (the Gabriel graph of the group's own pins, up to
`LINK_SPAN` times the local contact spacing); a link only has to clear every pin outside
the group. Where a full-width band would not clear, a narrower one is used if it joins
otherwise separate pieces, and the circles at its ends shrink to match so the sides stay
tangent. Pins that cannot be joined without covering another pin are outlined
separately. Groups are drawn in list order, so at a crossing the later group lies on top.

**Navigation.** Wheel zooms, right-drag or Space-drag pans, `Fit` resets, Esc clears
the selection.

**Output.** `SVG` and `PNG` export a compact image for schematics: the part number
centred over the view direction ("Viewed from mating face" or "Viewed from rear (wire
entry side)"), the drawing at the fitted
view, and to its right, vertically centred, a legend listing each group's pins and
signals, with the groups in name order (Group 2 before Group 10), then any ungrouped pins
that have a signal, then a `No Connect` section listing every NC contact. Long legends
flow into up to
four columns. Sizes are in `EX` in `app.js`; the PNG is rendered at 2×.
To label a connector the tool does not decode but that shares a supported arrangement
(another vendor's part number, another slash sheet), type its part number in
`Output PN`: it replaces the title on the image and names the exported files. Leave it
blank to use the decoded part number, shown as the field's placeholder. It is saved with
the project, kept when you change part number, and cleared when a fresh one is opened.
`Save`/`Load` round-trip the
whole pinout as JSON.

**One working pinout.** Signals, colours and groups follow you when you enter another
part number or pick another arrangement: they are carried across contact for contact in
MIL-STD-1560C designation order (A stays A and 1 stays 1; between a lettered and a
numbered insert, A becomes 1). If the new arrangement is smaller and contacts holding
data would fall off the end, you are asked first, with the affected contacts listed;
declining leaves everything as it was. A part number that does not decode shows an
error but keeps your work. The browser keeps the working pinout (and view settings) in
`localStorage`, so reloading the page resumes it; a `?pn=` link opens that part number
fresh instead.

## Data

`data.js` is generated; do not edit it by hand. Rebuild with:

```
python build_data.py
```

It needs only the Python standard library. `build_data.py` reads the extracted source
text and reviewed CSVs in `source/`, which are copies taken from the parent D38999
research project:

| Input | Gives |
| --- | --- |
| `source/MIL-STD-1560C.txt` | contact coordinates, per arrangement |
| `source/extracted_tables_unreviewed.csv` | contact counts, sizes, service ratings |
| `source/shell_sizes.csv`, `classes.csv`, `contact_styles.csv`, `connector_styles.csv` | part-number decoding |
| `source/polarization.csv` | series III minor key angles |
| `source/series_iii_interface.csv` | shell bore, keyway and insert diameters |
| `source/glenair_806_contacts.csv` | Glenair 806 contact coordinates and sizes |

166 D38999 arrangements and 6114 contacts are extracted. The build validates every
arrangement's coordinate count against the contact count printed in its own summary
table, and prints any mismatch; there are currently none.

### Glenair 806

`source/glenair_806_contacts.csv` is made by `extract_806.py`, which reads the X/Y
location tables in Glenair's [Series 806 PCB layouts and footprints][806pcb] appendix
(rev 10.29.25). It needs PyMuPDF and only has to be rerun if that document changes:

```
python extract_806.py pcb-layouts-and-footprints.pdf
```

Each table is accepted only if its contact complement matches 806-015 Table I exactly
(count per size, no repeated IDs, numbered contacts 1..N). In combination inserts the
lettered contacts are the large ones. That gives 26 of the 67 arrangements. The other 41
are dimensioned on their drawings rather than tabulated, so they are not included yet,
mostly the small shells plus 16-60, 18-85, 20-110, 22-140, 24-186, 16-22, 22-44 and 24-97.
The #22HD and #20HD contacts are drawn at the size 22 and 20 cavity diameters.

- **806 24-35 contact 13** is tabulated as (-.170, -.468), X and Y swapped. The drawing
  places it on the outer ring between 12 and 14 at (-.468, -.170), mirroring contact 6,
  so the build corrects it and reports the correction in the notes bar.

[806pcb]: https://cdn.glenair.com/mil-aero-connectors/pdf/appendix/pcb-layouts-and-footprints.pdf

### Known source handling

- **Lower-case contact IDs.** MIL-STD-1560C prints them as underlined capitals, and text
  extraction loses the underline, so an ID such as `J` can appear twice in one
  arrangement. The build assigns the lower-case member of the pair by matching each
  candidate against the positions of its neighbours in the designation sequence.
- **20-41** has no coordinate table in the standard, only a summary row and a pictorial.
  Its coordinates are taken from 21-41; every other even/odd shell pair in the document
  has byte-identical coordinates, which the build checks.
- **16-35 contact 53** is printed as `-.312` on printed page 197. Contacts 54 and 55 share
  `+.312` and the twin arrangement 17-35 reads `+.312`, so the build corrects it and
  reports the correction in the tool's notes bar.
- **25-24** lists its size-12 locations as `A,B,D,E,LM,P,R,S,T,X,Y`; a lost line break
  merged `L` and `M`, and the build splits them back.
- **20-39 / 21-39** contacts C and U differ by .001 in between the two printings. Both are
  self-consistent in inches and millimetres, so neither is changed.

### Scope

- Series IV minor key angles are a figure, not a table, in MIL-DTL-38999N, so only the
  main key is drawn for series IV part numbers.
- Shell interface dimensions exist for the odd (series I/III/IV) shell sizes only. Even
  shell sizes are drawn without a shell envelope.
- Slash sheets with non-standard part-number formats (dummy stowage, covers, lanyard
  release, fibre optic) are rejected with an explanation rather than guessed at.

This decodes and draws what the standards print. It is not a procurement check: a part
number that decodes cleanly is not necessarily a part anyone builds.

## Files

| File | |
| --- | --- |
| `index.html` | markup |
| `style.css` | interface styling |
| `app.js` | decoding, geometry, drawing, interaction |
| `data.js` | generated data (do not edit) |
| `build_data.py` | regenerates `data.js` |
| `extract_806.py` | regenerates `source/glenair_806_contacts.csv` from the Glenair PDF |
| `source/` | build inputs (copies from the research project, plus the 806 extract) |
