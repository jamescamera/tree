# The generated cat portraits

`assets/cats/*.webp` are pre-rendered British Shorthair portraits, chosen per cat
by `fur.js` from `node.cols` and the EMS code. This note records what was done to
them and why, because the change is not reversible from what is in the tree.

## What arrived

The artwork was delivered as 35 full-body cutouts — a sitting cat on
transparency. The painting itself is good. The alpha channel is not.

The mattes had eaten into the cats. On a light page this mostly hides; composited
over a saturated colour it is obvious:

| Asset | Damage |
|---|---|
| `black-white-03` | body gone below the chest — a head above a white ribbon |
| `blue` | lower right quarter missing, paws amputated, ragged tail stub |
| `lilac-white-03`, `chocolate-white-03` | legs cut away, bite out of one flank |
| `black-smoke` | lower body chewed off along a ragged edge |
| `cream`, `cream-white-03`, `cinnamon`, `chocolate`, `brown-tabby`, `white`, and others | paws sliced off flat at the base |
| `tabby` | deep notch through the top of the skull, ears detached |
| `grace-dominica-blh` | head erased entirely — a ruff and an ear tuft |

Nothing could be repaired. WebP zeroes the colour channels wherever alpha is 0,
so the pixels under the holes are not merely hidden, they are gone: sampling RGB
in the transparent regions returns near-black compression noise, not fur.

## What was done

All the damage sits below the chest, so **the assets are stored cropped to a
bust** — the top 58% of the cat's own bounding box, re-tightened horizontally,
padded 6% and squared. Alpha is then ramped to zero (smoothstepped) over the
bottom 18%, so the crop line dissolves rather than showing as a straight cut.
Output is 512×512, except `yoshi.webp` at 1024×1024 for the hero.

This is also a better portrait than the full body was at 160px, and it made the
set 4.4 MB → 1.1 MB.

Both slots that use these images — `.portrait` and `.bigcat` — are square, so the
CSS is `object-fit: contain; object-position: center`.

`tabby.webp` and `grace-dominica-blh.webp` were deleted: their heads were the
damaged part, so there was nothing left to crop to. `fur.js` now sends tabbies
that are neither blue nor chocolate to `brown-tabby`, and picks longhairs by
colour like everyone else — Grace Dominica loses her coat length in the picture.
Two new renders would bring both back; nothing else needs to change.

The originals are in git history at commit `4febd11`.
