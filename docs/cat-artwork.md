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
2. **Bust crop** to the top 60% of the cat's bounding box — 80% for Grace, below.
3. **Fade** alpha to zero, smoothstepped, over the bottom 18%, so the crop line
   dissolves instead of showing as a straight cut.
4. **Square on the head**, not on the widest part of the body: side = crop height
   × 1.16, centred on the head's horizontal midpoint. Squaring on the body leaves
   a full-body source small in a lot of empty canvas.
5. 512×512 WebP, quality 88. `yoshi.webp` is 1024 from a 1224px source and is
   *not* replaced by a 512 one — the hero renders at 260 CSS px and the difference
   is obvious.

Both slots that use these — `.portrait` and `.bigcat` — are square, so the CSS is
`object-fit: contain; object-position: center`.

## Substitutions, all deliberate

- **Red → cream**, no red artwork exists.
- **Cinnamon tortie → cinnamon**, likewise. This is why Hennessy Olivia Charm
  shows as a solid cinnamon despite being `BSH q 03`.
- **Tabbies that are neither blue nor chocolate → brown tabby**, no generic
  tabby artwork.
**Grace Dominica is no longer a substitution.** Her artwork is fawn and white,
matching `BLH p 03`. Her crop keeps more chest than the others (80% rather than
60%) so the ruff actually reads — at the standard crop a longhair looks
shorthaired.

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

Earlier states are in git history: the original full-body cutouts at `4febd11`,
the first bust crop at `16adfc0`.
