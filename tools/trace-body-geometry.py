"""Regenerate src/lib/bodyGeometry.ts from the two flat-colour anatomy renders.

    python3 tools/trace-body-geometry.py

Run it from the repo root. Inputs are tools/body-renders/{front,back}.png,
which are committed for exactly this reason: without them the geometry can
never be adjusted, only replaced.

Those renders are the generated art with every pixel snapped to the PALETTE
below — the same decision this script's classifier makes anyway, so they are
equivalent input, minus the generator's faint per-pixel noise. That is worth
doing: it takes the pair from 2.6 MB to 56 KB, and re-tracing them reproduces
the checked-in geometry exactly. Do not let a quantiser choose the palette
instead; asked to pick 14 colours it spends nine of them on shades of white and
mashes the muscle colours into three.

The renders were generated to be segmentable — one flat colour per muscle
group, ringed by an unbroken black outline — because neither of the obvious
routes works. A stock anatomy PNG has no notion of "the lats" and flood-filling
its linework leaks through the soft shading; auto-tracing one to SVG gives
hundreds of anonymous paths grouped by grey level, which is the same problem in
XML. Here a colour plus a vertical band names a muscle exactly.

Requires: pillow, numpy, scipy, scikit-image.

The renders were generated to be segmentable: every muscle group is one flat
colour ringed by a solid black outline, so a colour plus a vertical band names
a muscle exactly. Nothing here guesses at an outline.

Two things make the edges clean rather than ragged:
  * every pixel is assigned to its NEAREST flat colour, so the anti-aliased
    fringe between a fill and the ink lands on one side or the other instead of
    being dropped and leaving a torn boundary;
  * the ink itself is then absorbed by whichever region is closest, so
    neighbours meet along the old outline's centreline and no gutter is left.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from skimage import measure

HERE = Path(__file__).resolve().parent
FRONT_PNG = HERE / 'body-renders' / 'front.png'
BACK_PNG = HERE / 'body-renders' / 'back.png'
OUT_TS = HERE.parent / 'src' / 'lib' / 'bodyGeometry.ts'

# The artwork's palette. Reused colours are told apart by vertical band.
# One entry per hue, not per shade: the artwork's two greens and two purples
# are the same intent a few values apart, and giving each its own slot only
# split one muscle across two labels. Position tells the reuses apart.
PALETTE = {
    'purple': (128, 48, 224), 'yellow': (224, 192, 0), 'red': (224, 32, 32),
    'green': (32, 176, 32), 'cyan': (0, 192, 224), 'pink': (224, 64, 128),
    'blue': (0, 128, 224),
}
FRONT_MAP = [  # (palette key, ymin, ymax, muscle)
    ('purple', 0.00, 0.19, 'traps'),
    ('yellow', 0.00, 0.25, 'delts'),            # split into front/side below
    ('red', 0.00, 0.30, 'chest'),
    ('green', 0.20, 0.50, 'biceps'),
    ('cyan', 0.20, 0.50, 'abs'),
    ('pink', 0.25, 0.50, 'obliques'),
    ('blue', 0.30, 0.50, 'forearms'),
    ('yellow', 0.45, 0.62, 'adductors'),
    ('purple', 0.45, 0.70, 'quads'),
    ('green', 0.65, 1.00, 'calves'),
]
BACK_MAP = [
    ('purple', 0.00, 0.25, 'traps'),
    ('yellow', 0.00, 0.25, 'rear_delts'),
    ('pink', 0.00, 0.27, 'upper_back'),
    ('pink', 0.27, 0.45, 'lats'),
    ('green', 0.20, 0.40, 'triceps'),
    ('blue', 0.30, 0.50, 'forearms'),
    ('cyan', 0.30, 0.45, 'lower_back'),
    ('purple', 0.40, 0.55, 'glutes'),
    ('yellow', 0.50, 0.70, 'hamstrings'),
    ('green', 0.65, 1.00, 'calves'),
]

MIN_PX = 3000        # real groups are 6k+; anything smaller is classifier litter
VIEW_H = 200.0        # normalised height; width follows the figure's aspect
DESPECKLE = 3         # opening radius, kills classifier confetti
ABSORB = 4            # px of ink a region may claim, so two meet on its centreline
TOLERANCE = 1.2       # polygon simplification, in source pixels


def classify(path):
    """Per-COMPONENT labels, ink absorbed, plus the body mask.

    Components rather than colours, because absorbing the ink between two
    same-coloured neighbours would otherwise weld them together — which is
    exactly what happened to the upper back and the lats, both drawn pink.
    """
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.int16)
    h, w = a.shape[:2]

    names = list(PALETTE)
    ref = np.array([PALETTE[n] for n in names], np.int16)
    dist = np.linalg.norm(a[:, :, None, :] - ref[None, None, :, :], axis=-1)
    nearest = dist.argmin(axis=-1)
    strength = dist.min(axis=-1)

    # Ink is dark in EVERY channel. Testing mean luminance called #20a020
    # green ink and deleted the biceps and calves outright.
    ink = a.max(axis=-1) < 110
    paper = a.min(axis=-1) > 225
    # A fill is a pixel that is neither ink nor paper and lands near a palette
    # colour. The threshold is loose: classification is by nearest, not by match.
    fill = (~ink) & (~paper) & (strength < 150)

    body = ndimage.binary_fill_holes(~paper)

    # One globally-unique id per connected patch of one colour.
    comps = np.zeros((h, w), np.int32)
    colour_of = {}
    for i, name in enumerate(names):
        core = ndimage.binary_opening(fill & (nearest == i), np.ones((DESPECKLE, DESPECKLE)))
        lab, n = ndimage.label(core)
        for c in range(1, n + 1):
            piece = lab == c
            if piece.sum() < MIN_PX:
                continue
            new = len(colour_of) + 1
            comps[piece] = new
            colour_of[new] = name

    # Absorb the ink, and ONLY the ink, within a few pixels: two regions then
    # meet along their old outline's centreline. Absorbing every unlabelled
    # body pixel instead swallowed the white head into the traps.
    gap = comps == 0
    dist, (iy, ix) = ndimage.distance_transform_edt(gap, return_indices=True)
    holes = body & gap & ink & (dist <= ABSORB)
    comps = np.where(holes, comps[iy, ix], comps)

    return comps, colour_of, body, (w, h)


def masks_for(path, table):
    comps, colour_of, body, size = classify(path)
    h = size[1]
    out, claimed = {}, set()
    for cid, colour in colour_of.items():
        piece = comps == cid
        if not piece.any():
            continue
        cy = np.nonzero(piece)[0].mean() / h
        muscle = next((m for (k, y0, y1, m) in table if k == colour and y0 <= cy < y1), None)
        if muscle is None:
            continue
        claimed.add(cid)
        out[muscle] = out.get(muscle, np.zeros_like(piece)) | piece
    missed = set(colour_of) - claimed
    if missed:
        print('   unclaimed components:', [(colour_of[c], int((comps == c).sum())) for c in missed])
    return out, body, size


def split_delts(mask):
    """The front cap is one shape; the anterior head is its inner half."""
    front = np.zeros_like(mask)
    side = np.zeros_like(mask)
    lab, n = ndimage.label(mask)
    cols = np.arange(mask.shape[1])[None, :]
    mid = mask.shape[1] / 2
    for i in range(1, n + 1):
        piece = lab == i
        xs = np.nonzero(piece)[1]
        cut = (xs.min() + xs.max()) / 2
        # Inner means toward the body's centre line, whichever arm this is.
        inner = piece & ((cols >= cut) if xs.max() < mid else (cols <= cut))
        front |= inner
        side |= piece & ~inner
    return front, side


def to_paths(mask, sx, sy, ox, oy):
    """Simplified SVG subpaths for one mask, in normalised coordinates."""
    clean = ndimage.binary_fill_holes(mask)
    subpaths = []
    for contour in measure.find_contours(clean.astype(float), 0.5):
        if len(contour) < 16:
            continue
        poly = measure.approximate_polygon(contour, tolerance=TOLERANCE)
        if len(poly) < 4:
            continue
        pts = [f'{(x - ox) * sx:.1f} {(y - oy) * sy:.1f}' for y, x in poly]
        subpaths.append('M' + 'L'.join(pts) + 'Z')
    return subpaths


def build(path, table, is_front):
    muscles, body, (w, h) = masks_for(path, table)
    if is_front:
        muscles['front_delts'], muscles['side_delts'] = split_delts(muscles.pop('delts'))

    ys, xs = np.nonzero(body)
    ox, oy = xs.min(), ys.min()
    scale = VIEW_H / (ys.max() - ys.min())
    return {
        'width': round((xs.max() - xs.min()) * scale, 1),
        'height': VIEW_H,
        'body': to_paths(body, scale, scale, ox, oy),
        'muscles': {m: to_paths(k, scale, scale, ox, oy) for m, k in sorted(muscles.items())},
    }


HEADER = """import type { MuscleId } from '../db/types';

/* -------------------------------------------------------------------------- */
/*  Body geometry for the Levels heat map.                                    */
/*                                                                            */
/*  GENERATED by tools/trace-body-geometry.py — do not hand-edit. Traced from  */
/*  two flat-colour anatomical renders in tools/body-renders, where every      */
/*  muscle group is one solid colour ringed by a black outline: a colour plus  */
/*  a vertical band names a muscle exactly, so these outlines come from the    */
/*  drawing rather than from a guess. Re-run the script to change them.       */
/*                                                                            */
/*  Both views are scaled to a common 200-unit height from the same origin,    */
/*  so front and back sit side by side at one scale. Left and right are        */
/*  separate subpaths, traced independently rather than mirrored: the renders  */
/*  are symmetric to within 1% by area, and a mirrored trace would claim a     */
/*  symmetry the drawing does not quite have.                                  */
/* -------------------------------------------------------------------------- */

export interface BodyView {
  /** Width in the same units as the 200-unit height. */
  width: number;
  height: number;
  /** The figure itself — head, hands and feet included. Never shaded. */
  body: string[];
  /** One entry per muscle this view can show, left and right as subpaths. */
  muscles: Partial<Record<MuscleId, string[]>>;
}
"""


def emit(name: str, view: dict, comment: str) -> str:
    lines = [f'\n/** {comment} */', f'export const {name}: BodyView = {{',
             f"  width: {view['width']},", f"  height: {view['height']},", '  body: [']
    lines += [f"    '{p}'," for p in view['body']]
    lines += ['  ],', '  muscles: {']
    for muscle in sorted(view['muscles']):
        lines.append(f'    {muscle}: [')
        lines += [f"      '{p}'," for p in view['muscles'][muscle]]
        lines.append('    ],')
    lines += ['  },', '};', '']
    return '\n'.join(lines)


front = build(FRONT_PNG, FRONT_MAP, True)
back = build(BACK_PNG, BACK_MAP, False)

OUT_TS.write_text(
    HEADER
    + emit('FRONT_VIEW', front,
           'Anterior groups. The only view that carries chest, abs, quads and adductors.')
    + emit('BACK_VIEW', back,
           'Posterior groups. The only view that carries lats, glutes and hamstrings.')
)

print(f'wrote {OUT_TS.relative_to(HERE.parent)}')
for tag, view in (('front', front), ('back', back)):
    size = sum(len(''.join(p)) for p in view['muscles'].values()) + len(''.join(view['body']))
    print(f"  {tag}: {view['width']}x{view['height']}  "
          f"{len(view['muscles'])} muscles  {size / 1024:.1f} KB of path data")
