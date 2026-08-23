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
