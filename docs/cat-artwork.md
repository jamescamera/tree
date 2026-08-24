# The generated cat portraits

`assets/cats/*.webp` are pre-rendered British Shorthair portraits, chosen per cat
by `fur.js` from `node.cols` and the EMS code. This note records how they are
made, what the failures were, and what to ask for next time.

## How to commission them

Ask for the cats **on a flat, saturated backdrop, un-cut**. Do not accept a
finished cutout.

This matters more than it sounds. Every British Shorthair colour is desaturated
by definition, so a neutral studio backdrop sits right on top of the coat: across
the four million fur pixels in this set, **29% are within ΔRGB 60 of the pale grey
backdrop the first batch used, and the closest are identical to it**. No matter
who does the cutout, it is guessing at that point — which is why the first batch
came back with amputated paws and, in two cases, no head.

| Backdrop | Min ΔRGB to any fur pixel | Fur within ΔRGB 60 |
|---|---|---|
| Pale grey studio | 1 | 29.3% |
| White | 0 | 7.1% |
| Green | 111 | 0% |
| Cyan | 145 | 0% |
| Magenta | 179 | 0% |

Any saturated colour is safe; cyan is what the current set used. Two further
requirements: the backdrop must be **flat, not a gradient** — a gradient needs a
different threshold at the top than the bottom — and the cut must not be applied,
because WebP zeroes the colour channels wherever alpha is 0. Once a bad matte is
baked in, the pixels under the holes are gone and no repair is possible.

## How they are processed here

1. **Despill.** Cyan lifts green and blue above red at the silhouette. Cap both at
   red. Verified against every asset: this touches *zero* interior pixels, so it
   only ever neutralises the fringe and can be applied globally.
2. **Bust crop** from a head-width-derived frame, preserving enough chest to
   avoid an unnatural straight lower edge (Grace retains extra ruff).
3. **Fade** alpha to zero, smoothstepped, over the bottom 18%, so the crop line
   dissolves instead of showing as a straight cut.
4. **Square on the head**, not on the widest part of the body: side = crop height
   × 1.16, centred on the head's horizontal midpoint. Squaring on the body leaves
   a full-body source small in a lot of empty canvas.
5. Export 768×768 only when the measured source crop has at least 700 real
   pixels; otherwise export 512×512 rather than presenting an upscale as detail.
   `yoshi.webp` is 1024 from a 1224px source and is *not* replaced by a generated
   asset.

Both slots that use these — `.portrait` and `.bigcat` — are square, so the CSS is
`object-fit: contain; object-position: center`.

## Historical substitutions

- **Red → cream** was a temporary fallback and is no longer used:
  `red-white-03.webp` now routes the actual pedigree phenotype.
- **Cinnamon tortie → cinnamon** remains an explicit fallback. Two generated
  candidates were rejected: one drifted grey and the other lost its tortie
  patches. Do not install a substitute until a real cinnamon-and-cream tortie
  source exists.
- **Tabbies that are neither blue nor chocolate → brown tabby**, no generic
  tabby artwork.
**Grace Dominica is no longer a substitution.** Her artwork is fawn and white,
matching `BLH p 03`. Her crop keeps more chest than the others (80% rather than
60%) so the ruff actually reads — at the standard crop a longhair looks
shorthaired.

## The pipeline

`scripts/build_cat_busts.py` is the whole thing, run against the flat-cyan
sources in `assets/cats/sources/`. In order: chroma key, open-and-keep-the-largest
blob, harden the interior, fill small holes, recover edge colour, despill, crop,
fade, frame, export. Dark-outline removal is an explicit, visually verified option,
not a global cleanup rule.

Four of those steps exist because of specific failures, all found by measuring
rather than by looking:

- **Open before keeping the largest blob.** Plain component labelling is not
  enough. One batch carried a full-width strip along the top of the frame that
  *touched the ears*, so it counted as part of the cat and rode through onto the
  site as a white line across four portraits.
- **Harden the interior.** The key's soft ramp let pale fur near the threshold
  come out part-transparent, so the background showed through the body. Only the
  outermost pixels should carry partial alpha.
- **Size the frame from the head, never from a fixed fraction of the body.** Head
  width targets 0.67 of the frame (0.55 for Grace, so her ruff reads). A fixed
  crop fraction cannot hold scale steady across sources with different body
  proportions, and framing on the widest point instead sliced sixteen cats' 
  shoulders off at a hard vertical edge.
- **Fade the frame edges, do not cut them.** Any body still reaching the edge
  dissolves, ramped in vertically so it never touches the head.

## Two more repairs the pipeline does

Later batches needed two steps beyond the key and despill, both kept because they
cost nothing when there is nothing to fix:

- **Colour un-contamination.** Where a source has already blended cat into
  backdrop, its partial-alpha pixels are part cyan, and despilling those just
  turns them dark — a dirty outline. Take their colour from the nearest fully
  opaque pixel and let alpha alone carry the soft edge.
- **Stroked outlines.** One source arrived with a thin near-black line drawn
  round the cat, opaque, so no key touches it. Dark neutral pixels sitting
  against the backdrop are cut. Safe here because no cat in the set is black at
  the silhouette — revisit this if one ever is.

## Auditing

Run the deterministic processor and then audit every installed WebP:

```sh
python scripts/build_cat_busts.py \
  --sources assets/cats/sources --output assets/cats \
  --qa-dir audit/cat-artwork --report audit/cat-artwork/report.json

python scripts/build_cat_busts.py \
  --audit-assets assets/cats --qa-dir audit/cat-artwork/live-magenta \
  --report audit/cat-artwork/live-assets.json
```

The source files use the exact name `<phenotype>-source.png`; they are input
material, not browser assets. The eleven replacement sources currently measure
**1254×1254 RGB**, rather than the nominal 2048×2048 requested in the brief. The
JSON report is authoritative: it records actual dimensions, alpha, background
colour sampled from four corners, background flatness, fur/background separation,
an interior-only detail score, silhouette components/holes, cyan-rim count, head
scale, and a magenta verification render. The installed-WebP audit repeats the
alpha/silhouette/detail/magenta checks for all live assets. Its background fields
are null by design—alpha WebPs no longer contain the original backdrop.

The detail score erodes the detected silhouette by 11 pixels before measuring;
cyan fringe cannot inflate it. Never sharpen alpha. The optional
`--strip-dark-outline` recovery must be checked manually on black/black-smoke
silhouettes before use.

Check the mattes by measurement, not by eye and not by HTTP status. Four numbers
catch everything that has gone wrong so far, per asset:

| Measure | How | Fail at |
|---|---|---|
| Body clipped by the frame | opaque pixels on column 0 and column −1 | > 40 |
| Debris | total area of every connected blob but the largest | > 200 px |
| Halo | mean rim brightness minus mean brightness just inside | > 14 |
| Head scale | head width as a share of frame width | outside 0.58–0.80 |

Before the audit that produced this section: worst clip 418, worst debris 4,844
px, worst halo 28.9. After: 5, 10, 10.8, with nothing failing.

Earlier states are in git history: the original full-body cutouts at `4febd11`,
the first bust crop at `16adfc0`.
