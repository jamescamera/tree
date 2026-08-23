> **Superseded.** The WebGL/GLB route was retired in favour of pre-rendered
> artwork in `assets/cats/`. Kept as the record of what was measured and why,
> in case a modelled cat is ever revisited. The model, the three.js vendor
> files and the validator went with it and remain in git history.

# British Shorthair 3D tree — corrected implementation

This is the second-pass implementation after the first GLB was rejected for exactly the two issues that matter: it looked like glued primitives and its UVs did not encode a belly-to-spine gradient.

## What changed

### 1. Real sitting BSH body
- Low-poly organic body generated as a continuous surface rather than a stack of spheres.
- Chunky British Shorthair proportions: broad seated body, full cheeks/jowls, short muzzle, low-set rounded ears and thick tail.
- 7,492 triangles across the complete asset.
- 140 KB GLB.
- 1.02 units tall, feet at Y=0, Y-up, front is +Z.

### 2. Face is real, not an orientation trick
The GLB contains explicit face/ear/muzzle/chin geometry plus separate eye/pupil meshes and named eye materials. The browser implementation also adds the dynamic nose, eyes and small face pads so eye colour and blinking remain driven by the EMS code.

### 3. UVs now have a testable biological meaning
The coat body's UVs use one non-mirrored cylindrical projection. V broadly follows physical Y from belly/feet (0) to spine/head (1), with a small front/chest lift so the same white threshold rises higher on the bib than the back.

The existing coat painter was rewritten to use this single continuous UV field instead of the previous arbitrary atlas regions. Thus 01/02/03/09 are once again meaningful thresholds rather than texture-space stripes.

### 4. Longhair stays a variant
The same mesh is used for BLH; only the fur-shell length changes, so the longhair ancestor does not require a second model.

### 5. Validator
`scripts/validate_bsh_asset.py` checks:
- GLB size
- triangle budget
- height/origin
- face geometry
- separate eye geometry/materials
- complete coat UVs
- UV orientation / mirroring signal
- belly-to-spine V correlation

Run:

```bash
python scripts/validate_bsh_asset.py assets/british_shorthair_base.glb
```

Current asset: **PASS**.

## Files

- `fur.js` — updated browser renderer
- `assets/british_shorthair_base.glb` — corrected BSH asset
- `scripts/validate_bsh_asset.py` — automated asset contract
- `bsh_preview.png` — optional local reference if present

The flat SVG portraits remain untouched as the 48px fallback/identifier system.

---

## Integration notes (added when wiring this into the site)

Three things had to be fixed before the patch would run at all:

1. **The coat mesh has no `NORMAL` attribute.** The loader read it
   unconditionally, which threw; `mountAll` caught that and returned false, so
   the toggle silently did nothing rather than reporting a failure. Normals are
   now derived with `computeVertexNormals()` when the file doesn't supply them.

2. **`flipY` was left at `true`.** This mesh unwraps with `v=0` at the crown and
   `v≈0.92` at the paws (measured: `corr(worldY, UV.v) = -0.996`), so an
   unflipped canvas painted the white bib across the cat's face. It is now
   `false`, which puts white on the chest and paws where the EMS codes mean it.

3. **Only `meshes[0]` was read.** The model ships its ears, muzzle, chin, eyes
   and pupils as separate meshes with their own materials, and all of it was
   being discarded, leaving a headless body. The loader now takes every
   primitive and keys off its material name: `Coat_Neutral` gets the painted
   coat and the fur shells, `Face_Neutral` the base colour, `Eye_Iris` the
   colour from the eye code, `Eye_Pupil` the ink.

Also: the model's origin is at its paws, so rotating to follow the pointer
swung the head out of frame. The camera now frames the union of the part
bounding boxes and the cat pivots about its own midpoint.

## Verifying a future asset

`scripts/validate_bsh_asset.py` checks a `.glb` against the contract. The two
measurements that actually matter:

- `corr(world Y, UV.v)` must be strongly signed (this model: **-0.996**). Near
  zero means the coat painting will smear across the body.
- Symmetric vertex pairs must not share `u` (this model: **915 pairs, 0
  mirrored**). Mirrored UVs make every tortie identical on both sides.
