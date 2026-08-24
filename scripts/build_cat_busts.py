"""Turn flat-cyan cat renders into the site's bust portraits."""
from PIL import Image, ImageFilter
import argparse, json
from pathlib import Path
import numpy as np, os, glob
from scipy import ndimage

KEY = np.array([58.3, 189.8, 209.8], np.float32)   # fallback; measure_key() prefers the real one

def measure_key(arr):
    """Read the backdrop colour off the corners rather than trusting a constant.
       Different batches have shipped different cyans -- 58,190,210 and 59,219,228
       so far -- and a key tuned to the wrong one eats fur or leaves backdrop."""
    h, w = arr.shape[:2]; c = max(8, min(h, w) // 20)
    patch = np.concatenate([arr[:c, :c, :3].reshape(-1, 3), arr[:c, -c:, :3].reshape(-1, 3),
                            arr[-c:, :c, :3].reshape(-1, 3), arr[-c:, -c:, :3].reshape(-1, 3)])
    patch = patch[patch.sum(1) > 30]                      # ignore zeroed transparent corners
    if len(patch) < 100 or patch.std(0).mean() > 12: return KEY
    return patch.mean(0).astype(np.float32)
LO, HI = 60.0, 140.0                               # fur sits >=150 away; backdrop std is 6
# Target head width as a share of the frame. Driving the crop from the head
# rather than from a fixed fraction of the body is what keeps every portrait at
# the same scale, whatever proportions the source render happened to have.
HEAD = 0.67
HEAD_OVERRIDE = {'grace-dominica-blh': 0.55}      # a longhair needs her ruff to read

def build(arr, name, key_it, strip_dark_outline=False):
    if key_it:
        d = np.linalg.norm(arr[:, :, :3] - measure_key(arr), axis=2)
        arr[:, :, 3] *= np.clip((d - LO) / (HI - LO), 0, 1)

    rgb = arr[:, :, :3]; mx = rgb.max(2); mn = rgb.min(2)
    # Some old sources had a drawn near-black outline.  Do not apply this repair
    # by default: it can amputate a real black/black-smoke/tortie silhouette.
    # It is deliberately an explicit recovery option for a visually verified
    # source, never a global "cleanup" rule.
    if strip_dark_outline:
        inky = (mx < 95) & ((mx - mn) < 26)
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
    # Distrust the rim on colour as well as on brightness. On a white bib the
    # contaminated pixels are the same brightness as the fur beside them and only
    # a cyan cast gives them away, so a luminance test alone leaves a green
    # fringe down every white-patched cat.
    cyan = (rgb[:, :, 1] + rgb[:, :, 2]) / 2 - rgb[:, :, 0]
    trust = (arr[:, :, 3] >= 250) & ~(band & ((lum > ref + 22) | (cyan > 10)))
    if trust.any():
        _, idx = ndimage.distance_transform_edt(~trust, return_indices=True)
        fix = vis & ~trust
        arr[:, :, :3][fix] = arr[:, :, :3][idx[0][fix], idx[1][fix]]

    R, G, B, A = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    # Despill the rim, scaled to the image. A fixed 5x5 erosion is about two
    # pixels, which at 768 leaves a green fringe down every white-patched cat
    # because the contamination reaches further in. The cap only fires where
    # green and blue genuinely exceed red by more than 8, which measurement
    # shows never happens inside a coat -- including a blue one, whose interior
    # is close to neutral -- so widening the band does not risk neutralising it.
    k = max(5, int(round(vis.shape[0] * 0.03)) | 1)
    edge = vis & ~ndimage.binary_erosion(vis, np.ones((k, k)))
    cap = R + 8; f = edge & (((G + B) / 2) > cap)
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
    # Both of these follow the source rather than being fixed. `side` is how many
    # real pixels the crop actually contains: ~350 from the old 512 renders, ~1190
    # from a genuine high-resolution one.
    #
    #  - Store 768 only when there is detail to keep. Storing 768 of mush measured
    #    no better than 512 and cost three times the bytes.
    #  - Sharpen only when there is not. Unsharp exists to paper over an upscale;
    #    on a real source it just looks crunchy.
    rich = side >= 700
    out = Image.fromarray(sq.round().clip(0, 255).astype(np.uint8), 'RGBA')\
               .resize((768, 768) if rich else (512, 512), Image.LANCZOS)
    if rich:
        return out
    ch = out.split()
    rgb = Image.merge('RGB', ch[:3]).filter(ImageFilter.UnsharpMask(radius=1.1, percent=115, threshold=2))
    return Image.merge('RGBA', (*rgb.split(), ch[3]))

def source_report(path):
    """Numbers that establish whether a flat-background source is usable.

    Detail is measured only well inside the detected cat, so cyan fringe cannot
    inflate it.  The report deliberately records source dimensions rather than
    accepting a resolution encoded in a filename.
    """
    im = Image.open(path)
    arr = np.asarray(im.convert('RGBA')).astype(np.float32)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3]
    h, w = rgb.shape[:2]; c = max(8, min(h, w) // 20)
    corners = np.concatenate([rgb[:c,:c].reshape(-1,3), rgb[:c,-c:].reshape(-1,3),
                              rgb[-c:,:c].reshape(-1,3), rgb[-c:,-c:].reshape(-1,3)])
    key = measure_key(arr)
    dist = np.linalg.norm(rgb - key, axis=2)
    sure = dist > 140
    # A conservative interior mask prevents boundary/background transitions
    # (or an un-despilled cyan rim) from gaming the sharpness figure.
    interior = ndimage.binary_erosion(sure, np.ones((11, 11)))
    grey = rgb.mean(2)
    if interior.any():
        lap = ndimage.laplace(grey)
        detail = float(np.var(lap[interior]))
        separation = float(np.percentile(dist[interior], 5))
    else:
        detail = separation = 0.0
    return {
        'source': str(path), 'dimensions': [w, h], 'mode': im.mode,
        'has_alpha': im.mode in ('RGBA', 'LA') or 'transparency' in im.info,
        'background_rgb': [round(float(x), 2) for x in key],
        'background_stddev': round(float(corners.std(axis=0).mean()), 3),
        'fur_background_separation_p05': round(separation, 3),
        'source_detail_score': round(detail, 3),
        'opaque_alpha_range': [int(alpha.min()), int(alpha.max())],
    }

def output_report(im, magenta_path):
    arr = np.asarray(im.convert('RGBA')).astype(np.float32)
    rgb, a = arr[:, :, :3], arr[:, :, 3]
    solid = a > 20
    labels, count = ndimage.label(solid)
    areas = [int((labels == i).sum()) for i in range(1, count + 1)]
    largest = max(areas, default=0)
    debris = sum(x for x in areas if x != largest)
    holes = int((ndimage.binary_fill_holes(solid) & ~solid).sum())
    eroded = ndimage.binary_erosion(solid, np.ones((7, 7)))
    rim = solid & ~eroded
    # Cyan spill is evaluated on the visible rim after despill, not globally.
    cyan = rim & (rgb[:, :, 1] + rgb[:, :, 2] > 2 * rgb[:, :, 0] + 32)
    head_band = solid[:max(1, im.height // 4)]
    xs = np.where(head_band.max(0))[0]
    head_scale = float((xs.max() - xs.min() + 1) / im.width) if len(xs) else 0.0
    bg = np.zeros_like(rgb) + np.array([255, 0, 255], np.float32)
    composite = rgb * (a[:, :, None] / 255) + bg * (1 - a[:, :, None] / 255)
    Image.fromarray(composite.round().astype(np.uint8), 'RGB').save(magenta_path)
    return {'dimensions': [im.width, im.height], 'has_alpha': True,
            'components': count, 'debris_pixels': debris, 'holes_pixels': holes,
            'cyan_rim_pixels': int(cyan.sum()), 'head_scale': round(head_scale, 4),
            'magenta_verification': str(magenta_path)}

def asset_report(path, magenta_path):
    """Audit a shipped WebP without pretending it still has a keyable backdrop."""
    im = Image.open(path).convert('RGBA')
    report = output_report(im, magenta_path)
    arr = np.asarray(im).astype(np.float32)
    interior = ndimage.binary_erosion(arr[:, :, 3] > 20, np.ones((11, 11)))
    lap = ndimage.laplace(arr[:, :, :3].mean(2))
    report.update({'asset': str(path), 'mode': Image.open(path).mode,
                   'source_detail_score': round(float(np.var(lap[interior])), 3) if interior.any() else 0,
                   'background_rgb': None, 'background_stddev': None,
                   'note': 'Key-background measurements require the original flat-background source.'})
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, help='flat-cyan PNG source directory')
    parser.add_argument('--output', type=Path, help='destination for processed WebPs')
    parser.add_argument('--qa-dir', type=Path, help='destination for magenta verification PNGs')
    parser.add_argument('--report', type=Path, help='write deterministic JSON QA report')
    parser.add_argument('--audit-assets', type=Path,
                        help='audit every shipped WebP in this directory (requires --qa-dir and --report)')
    parser.add_argument('--strip-dark-outline', action='store_true',
                        help='only for a source visually proven to have an artificial dark outline')
    args = parser.parse_args()
    if args.sources:
        if not args.output or not args.qa_dir or not args.report:
            parser.error('--sources requires --output, --qa-dir and --report')
        args.output.mkdir(parents=True, exist_ok=True)
        args.qa_dir.mkdir(parents=True, exist_ok=True)
        report = []
        for source in sorted(args.sources.glob('*-source.png')):
            name = source.name.removesuffix('-source.png')
            entry = source_report(source)
            out = build(np.asarray(Image.open(source).convert('RGBA')).astype(np.float32), name, True,
                        strip_dark_outline=args.strip_dark_outline)
            output = args.output / f'{name}.webp'
            out.save(output, 'WEBP', quality=88, method=6)
            entry['output'] = output_report(out, args.qa_dir / f'{name}-magenta.png')
            report.append(entry)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
        print(f'processed {len(report)} sources; report: {args.report}')
        raise SystemExit(0)

    if args.audit_assets:
        if not args.qa_dir or not args.report:
            parser.error('--audit-assets requires --qa-dir and --report')
        args.qa_dir.mkdir(parents=True, exist_ok=True)
        report = [asset_report(path, args.qa_dir / f'{path.stem}-magenta.png')
                  for path in sorted(args.audit_assets.glob('*.webp'))]
        args.report.write_text(json.dumps(report, indent=2) + '\n')
        print(f'audited {len(report)} shipped assets; report: {args.report}')
        raise SystemExit(0)

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
