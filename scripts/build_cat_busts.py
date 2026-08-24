"""Turn flat-cyan cat renders into the site's bust portraits."""
from PIL import Image, ImageFilter
import numpy as np, os, glob
from scipy import ndimage

KEY = np.array([58.3, 189.8, 209.8], np.float32)   # measured off the flat backdrop
LO, HI = 60.0, 140.0                               # fur sits >=150 away; backdrop std is 6
# Target head width as a share of the frame. Driving the crop from the head
# rather than from a fixed fraction of the body is what keeps every portrait at
# the same scale, whatever proportions the source render happened to have.
HEAD = 0.67
HEAD_OVERRIDE = {'grace-dominica-blh': 0.55}      # a longhair needs her ruff to read

def build(arr, name, key_it):
    if key_it:
        d = np.linalg.norm(arr[:, :, :3] - KEY, axis=2)
        arr[:, :, 3] *= np.clip((d - LO) / (HI - LO), 0, 1)

    rgb = arr[:, :, :3]; mx = rgb.max(2); mn = rgb.min(2)
    inky = (mx < 95) & ((mx - mn) < 26)             # some sources stroke a black outline
    arr[:, :, 3][inky & ndimage.binary_dilation(arr[:, :, 3] < 20, np.ones((11, 11)))] = 0

    # Keep the cat, drop every scrap. Plain component labelling is not enough:
    # some sources carry a full-width strip along the top that touches the ears,
    # so it counts as part of the cat. Open the mask first — a few-pixel-tall
    # strip cannot survive that, and the body can — then keep the biggest blob
    # and everything within reach of it, so fur wisps are not eaten.
    core = ndimage.binary_opening(arr[:, :, 3] > 20, np.ones((9, 9)))
    lbl, k = ndimage.label(core)
    if k:
        keep = 1 + int(np.argmax([(lbl == i).sum() for i in range(1, k + 1)]))
        arr[:, :, 3][~ndimage.binary_dilation(lbl == keep, np.ones((13, 13)))] = 0

    # Harden the interior. The key's soft ramp let pale fur that sits near the
    # threshold come out part-transparent, so the backdrop showed through the
    # body. Only the outermost pixels should carry partial alpha.
    arr[:, :, 3][ndimage.binary_erosion(arr[:, :, 3] > 100, np.ones((5, 5)))] = 255

    solid = arr[:, :, 3] > 20
    lbl, k = ndimage.label(ndimage.binary_fill_holes(solid) & ~solid)
    for i in range(1, k + 1):
        m = lbl == i
        if m.sum() < 4000: arr[:, :, 3][ndimage.binary_dilation(m, np.ones((5, 5)))] = 255

    # Edge colour recovery. Contamination is not confined to partial alpha: a hard
    # key leaves fully opaque boundary pixels carrying backdrop grey, which is the
    # halo on the dark cats. Distrust rim pixels markedly brighter than the fur
    # just inside, and take colour from what is left.
    vis = arr[:, :, 3] > 20; lum = rgb.mean(2)
    ref = ndimage.grey_erosion(np.where(ndimage.binary_erosion(vis, np.ones((9, 9))), lum, 255), size=17)
    band = vis & ~ndimage.binary_erosion(vis, np.ones((7, 7)))
    trust = (arr[:, :, 3] >= 250) & ~(band & (lum > ref + 22))
    if trust.any():
        _, idx = ndimage.distance_transform_edt(~trust, return_indices=True)
        fix = vis & ~trust
        arr[:, :, :3][fix] = arr[:, :, :3][idx[0][fix], idx[1][fix]]

    R, G, B, A = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    cap = R + 8; f = (A > 20) & (((G + B) / 2) > cap)   # despill: cyan lifts G and B
    G[f] = np.minimum(G[f], cap[f]); B[f] = np.minimum(B[f], cap[f])
    im = Image.fromarray(arr.round().clip(0, 255).astype(np.uint8), 'RGBA')

    a = np.array(im)[:, :, 3]
    ys, xs_all = np.where(a > 10)
    y0, y1 = int(ys.min()), int(ys.max())

    # measure the head, then size the whole frame off it
    band = a[y0:y0 + max(1, int((y1 - y0) * 0.25))]
    hc = np.where(band.max(0) > 10)[0]
    head_w = hc.max() - hc.min() + 1
    side = int(head_w / HEAD_OVERRIDE.get(name, HEAD))
    H = int(min(side / 1.16, y1 - y0 + 1))

    im = im.crop((0, y0, im.width, y0 + H))
    A2 = np.array(im).astype(np.float32)
    nf = int(H * 0.18)
    t = np.linspace(0, 1, nf, dtype=np.float32)
    A2[H - nf:, :, 3] *= (1 - (t * t * (3 - 2 * t)))[:, None]     # dissolve the crop line

    cx = int((hc.min() + hc.max()) // 2)
    x0, y0b = cx - side // 2, -(side - H) // 2

    # whatever body reaches the frame edge dissolves rather than being cut square,
    # ramped in vertically so it never touches the head
    wfade = max(1, int(side * 0.07))
    ramp = np.linspace(0, 1, wfade, dtype=np.float32); ramp = ramp * ramp * (3 - 2 * ramp)
    depth = np.clip((np.arange(H, dtype=np.float32) / H - 0.45) / 0.35, 0, 1)[:, None]
    L, R = max(0, x0), min(A2.shape[1], x0 + side)
    for lo, hi, r in ((L, min(L + wfade, R), ramp), (max(L, R - wfade), R, ramp[::-1])):
        if hi > lo: A2[:, lo:hi, 3] *= (1 - depth * (1 - r[:hi - lo][None, :]))

    sq = np.zeros((side, side, 4), np.float32)
    sx, sy = max(0, x0), max(0, y0b); dx, dy = max(0, -x0), max(0, -y0b)
    w = min(A2.shape[1] - sx, side - dx); h = min(H - sy, side - dy)
    sq[dy:dy + h, dx:dx + w] = A2[sy:sy + h, sx:sx + w]
    out = Image.fromarray(sq.round().clip(0, 255).astype(np.uint8), 'RGBA').resize((512, 512), Image.LANCZOS)

    # These sources carry only ~350px of real detail in a 512px file, and a phone
    # renders the card portrait near 900px, so everything upscales. A light
    # unsharp on colour only — never on alpha, which would ring along the
    # silhouette — buys back some apparent crispness. It is a mitigation, not a
    # fix: the fix is sources rendered larger than 512.
    ch = out.split()
    rgb = Image.merge('RGB', ch[:3]).filter(ImageFilter.UnsharpMask(radius=1.1, percent=115, threshold=2))
    return Image.merge('RGBA', (*rgb.split(), ch[3]))

if __name__ == '__main__':
    REF = {'lilac': 'audit/reference/lilac_final.png', 'cream': 'audit/reference/cream_final.png',
           'cream-white-03': 'audit/reference/cream-white-03_final.png',
           'grace-dominica-blh': 'audit/reference/grace_final.png'}
    os.makedirs('rebuilt', exist_ok=True)
    for n, s in REF.items():
        build(np.array(Image.open(s).convert('RGBA')).astype(np.float32), n, True)\
            .save(f'rebuilt/{n}.webp', 'WEBP', quality=88, method=6)
    for p in sorted(glob.glob('cyan/assets/cats/*.webp')):
        n = os.path.basename(p)[:-5]
        if n in REF or n == 'yoshi': continue
        build(np.array(Image.open(p).convert('RGBA')).astype(np.float32), n, False)\
            .save(f'rebuilt/{n}.webp', 'WEBP', quality=88, method=6)
