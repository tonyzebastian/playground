# Builds the Flock in Flight model kit in Blender and exports it as one GLB.
# Run inside Blender:  exec(open("scripts/flock/build_models.py").read())
#
# Blender space: X right, Y forward (noses point +Y), Z up. The exporter turns
# that into three.js space with noses toward -Z. Colour lives in a vertex colour
# attribute ("Col"); the game supplies its own painterly material. Tree foliage
# is greyscale so the game can tint each tree.
import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Euler

ROOT = bpy.path.abspath("//") or os.getcwd()
OUT = globals().get("FLOCK_KIT_OUT", os.path.join(ROOT, "public/models/flock/flock-kit.glb"))
COLLECTION = "FlockKit"


def lin(c):
    if not isinstance(c, str):
        return c
    c = c.lstrip("#")
    f = lambda u: u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4
    return tuple(f(int(c[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1.0,)


def mix(a, b, k):
    a, b = lin(a), lin(b)
    return tuple(a[i] + (b[i] - a[i]) * k for i in range(4))


def trs(loc, rot=None, scale=(1, 1, 1)):
    m = Matrix.Translation(Vector(loc))
    if rot is not None:
        m = m @ Euler(rot).to_matrix().to_4x4()
    return m @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1))


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new("Col")

    def _faces(self, verts):
        return list({f for v in verts for f in v.link_faces})

    def paint(self, faces, color, smooth=True):
        c = lin(color)
        for f in faces:
            f.smooth = smooth
            for l in f.loops:
                l[self.col] = c
        return faces

    def shade(self, faces, lo, hi, axis=2):
        """Vertical gradient across a set of faces (dark below, light above)."""
        zs = [v.co[axis] for f in faces for v in f.verts]
        z0, z1 = min(zs), max(zs)
        for f in faces:
            for l in f.loops:
                l[self.col] = mix(lo, hi, (l.vert.co[axis] - z0) / max(1e-6, z1 - z0))
        return faces

    def ell(self, c, r, color, u=12, v=8, rot=None, smooth=True):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1, matrix=trs(c, rot, r))
        return self.paint(self._faces(res["verts"]), color, smooth)

    def ico(self, c, r, color, sub=2, scale=(1, 1, 1), smooth=True):
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=1, matrix=trs(c, None, tuple(r * s for s in scale)))
        return self.paint(self._faces(res["verts"]), color, smooth)

    def box(self, c, size, color, rot=None):
        res = bmesh.ops.create_cube(self.bm, size=1, matrix=trs(c, rot, size))
        return self.paint(self._faces(res["verts"]), color, False)

    def cyl(self, p0, p1, r0, r1, color, seg=8, smooth=True, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        m = Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=d.length, matrix=m)
        faces = self.paint(self._faces(res["verts"]), color, smooth)
        for f in faces:
            if len(f.verts) > 4:
                f.smooth = False
        return faces

    def grid(self, pts, color, smooth=True):
        """pts[i][j] -> quads. `color` is a colour or fn(i, j)."""
        vs = [[self.bm.verts.new(p) for p in row] for row in pts]
        faces = []
        for i in range(len(vs) - 1):
            for j in range(len(vs[i]) - 1):
                f = self.bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
                self.paint([f], color(i, j) if callable(color) else color, smooth)
                faces.append(f)
        return faces

    def prism(self, outline, m, depth, color):
        """Extrude a 2D outline (local XY) along local Z by `depth`, placed by matrix m."""
        a = [self.bm.verts.new(m @ Vector((x, y, 0))) for x, y in outline]
        b = [self.bm.verts.new(m @ Vector((x, y, depth))) for x, y in outline]
        faces = [self.bm.faces.new(a), self.bm.faces.new(list(reversed(b)))]
        n = len(a)
        for i in range(n):
            faces.append(self.bm.faces.new((a[i], b[i], b[(i + 1) % n], a[(i + 1) % n])))
        return self.paint(faces, color, False)

    def lathe(self, c, profile, seg, color, smooth=True):
        """Revolve (radius, z) pairs around Z. `color` is a colour or fn(seg, ring)."""
        rings = []
        for r, z in profile:
            rings.append([Vector((c[0] + r * math.cos(a), c[1] + r * math.sin(a), c[2] + z))
                          for a in (i / seg * math.tau for i in range(seg + 1))])
        cols = list(zip(*rings))
        return self.grid([list(col) for col in cols], color, smooth)

    def tube(self, path, seg, color, smooth=True):
        """Sweep ellipses along stations (y, z, rx[, rz]) in the YZ plane."""
        rings = []
        for st in path:
            y, z, rx = st[0], st[1], st[2]
            rz = st[3] if len(st) > 3 else rx
            rings.append([Vector((rx * math.cos(a), y, z + rz * math.sin(a))) for a in (i / seg * math.tau for i in range(seg + 1))])
        return self.grid(rings, color, smooth)

    def finish(self, name, location=(0, 0, 0)):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        ob.location = location
        coll.objects.link(ob)
        me.materials.append(material)
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = 0
        return ob


# ----------------------------------------------------------------- scene setup
coll = bpy.data.collections.get(COLLECTION)
if coll:
    for ob in list(coll.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
else:
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)

material = bpy.data.materials.get("FlockKitPaint") or bpy.data.materials.new("FlockKitPaint")
material.use_nodes = True
nt = material.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
if not any(n.type == "VERTEX_COLOR" for n in nt.nodes):
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9

WHITE, WING_MID, WING_TIP = "#f7f9f1", "#e3e9ea", "#c4cfd6"


# ------------------------------------------------------------------------ birds
# Wings are single sheets (drawn double-sided) lying beyond the shoulder line,
# because the game flaps every vertex further out than `shoulder` from the body.
def add_wings(b, span, root, chord, sweep, inner, flight, tip, n=14, m=6, fingers=5, tip_chord=0.36):
    rows = []
    reach = root + (span - root) * 0.78
    for i in range(n):
        t = i / (n - 1)
        x = root + t * (reach - root)
        lead = 0.5 * chord + 0.22 * chord * math.sin(t * math.pi * 0.85) - sweep * t * t
        c = chord * (1 - (1 - tip_chord) * t ** 1.5)
        row = []
        for q in range(m):
            k = q / (m - 1)
            scallop = 0.06 * chord * abs(math.sin(i * 1.9)) * k ** 3
            row.append(Vector((x, lead - c * k - scallop, 0.1 * math.sin(k * math.pi) * (1 - 0.5 * t) + 0.03)))
        rows.append(row)
    feathers = []
    last = rows[-1]
    for f in range(fingers):
        u = f / (fingers - 1)
        p0 = last[0].lerp(last[-1], 0.06 + u * 0.86)
        ang = math.radians(6 + 38 * u)
        length = (span - reach) * (1.05 - 0.3 * abs(u - 0.25))
        d = Vector((math.cos(ang), -math.sin(ang), 0))
        w = Vector((math.sin(ang), math.cos(ang), 0)) * 0.1 * chord
        feathers.append([[p0 - w * 0.5, p0 + w * 0.5], [p0 + d * length * 0.6 - w * 0.62, p0 + d * length * 0.6 + w * 0.62],
                         [p0 + d * length - w * 0.12 + Vector((0, 0, -0.03)), p0 + d * length + w * 0.12 + Vector((0, 0, -0.03))]])

    def color(i, q):
        return mix(inner, flight, 1.0 if q >= m - 3 else 0.0) if i < n - 3 else mix(mix(inner, flight, 1.0 if q >= m - 4 else 0.3), tip, 0.5)

    flip = lambda grid: [[Vector((-p.x, p.y, p.z)) for p in row] for row in reversed(grid)]
    b.grid(rows, color)
    b.grid(flip(rows), lambda i, q: color(n - 2 - i, q))
    for fe in feathers:
        b.grid(fe, tip)
        b.grid(flip(fe), tip)


def add_tail(b, y, width, length, color, tip, feathers=7):
    for f in range(feathers):
        u = f / (feathers - 1) - 0.5
        ang = u * 0.9
        d = Vector((math.sin(ang), -math.cos(ang), 0))
        w = Vector((math.cos(ang), math.sin(ang), 0)) * width / feathers * 0.75
        p0 = Vector((u * width * 0.5, y, 0.02 - abs(u) * 0.04))
        ln = length * (1 - 0.25 * abs(u) * 2)
        b.grid([[p0 - w * 0.6, p0 + w * 0.6], [p0 + d * ln * 0.7 - w, p0 + d * ln * 0.7 + w], [p0 + d * ln - w * 0.4, p0 + d * ln + w * 0.4]],
               lambda i, q: mix(color, tip, 0.25 + 0.5 * i))


def feather(b, root, direction, length, width, c0, c1, lift=0.0, layer=0.0):
    """One flat feather: rounded tip, widest a third of the way out, shaded root to tip."""
    d = Vector((direction[0], direction[1], direction[2] if len(direction) > 2 else 0)).normalized()
    side = Vector((-d.y, d.x, 0))
    rows = []
    for t, w in ((0, 0.55), (0.3, 1.0), (0.62, 0.96), (0.86, 0.62), (1.0, 0.1)):
        p = Vector(root) + d * length * t + Vector((0, 0, layer + lift * t * t))
        rows.append([p - side * width * w * 0.5, p + Vector((0, 0, 0.012 * w)), p + side * width * w * 0.5])
    b.grid(rows, lambda i, q: mix(c0, c1, (i + 0.5) / 4 + (0.08 if q else -0.04)))


def lerp2(a, b, k):
    return (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k)


def wing_plan(u):
    """Planform of a soaring stork's wing, from photographs. For u in 0..1 running
    from the body out to the leading primary, returns where a flight feather is
    rooted and where its tip lies. The feathers turn steadily, from pointing back
    beside the body to pointing along the span at the wingtip, so the outline is one
    continuous curve: a long, gently bowed trailing edge that opens into fingers."""
    if u < 0.52:  # secondaries, along the arm
        k = u / 0.52
        root = lerp2((0.42, 0.02), (2.45, 0.52), k)
        tip = (0.44 + 2.2 * k + 0.08 * math.sin(k * math.pi), -0.86 - 0.08 * math.sin(k * math.pi * 0.9) + 0.12 * k * k)
    else:  # primaries, fanned from the hand
        k = (u - 0.52) / 0.48
        root = lerp2((2.45, 0.52), (3.1, 0.55), k ** 0.8)
        a = math.radians(-96 + 106 * k ** 0.9)
        r = 1.24 + 1.0 * math.sin(k ** 1.05 * math.pi * 0.6)
        tip = (2.68 + r * math.cos(a), 0.42 + r * math.sin(a))
    return root, tip


def lead_edge(u):
    """Leading edge: forward to the wrist, then back along the outer primary."""
    if u < 0.52:
        k = u / 0.52
        return (0.3 + 2.2 * k, 0.74 + 0.28 * math.sin(k * math.pi * 0.5) ** 1.4)
    k = (u - 0.52) / 0.48
    return lerp2((2.5, 1.02), (3.2, 0.76), k)


def stork_wing(b, sx):
    white, soft, black, sheen = "#fdfcf6", "#dcdfdb", "#191b1f", "#3a3f45"
    P = lambda xy, z=0.0: Vector((xy[0] * sx, xy[1], z))
    N = 28
    # Under-sheet: fills between the feathers so no sky shows through.
    rows = []
    for i in range(15):
        u = i / 14
        le, (root, tip) = lead_edge(u), wing_plan(u)
        back = lerp2(root, tip, 0.1)
        rows.append([P(le, 0.09), P(lerp2(le, back, 0.4), 0.13), P(lerp2(le, back, 0.75), 0.1), P(back, 0.05)])
    b.grid(rows if sx > 0 else rows[::-1], lambda i, q: mix(white, soft, 0.15 * q))
    for i in range(14):
        b.cyl(P(lead_edge(i / 14), 0.09), P(lead_edge((i + 1) / 14), 0.09), 0.07 - 0.035 * i / 14, 0.07 - 0.035 * (i + 1) / 14,
              white if i < 8 else black, 6)

    def row(count, f0, f1, width, c0, c1, z, primaries_dark=False, u0=0.0, u1=1.0):
        for i in range(count):
            u = u0 + (u1 - u0) * i / (count - 1)
            root, tip = wing_plan(u)
            a, c = lerp2(root, tip, f0), lerp2(root, tip, f1)
            d = (c[0] - a[0], c[1] - a[1])
            dark = primaries_dark and u > 0.5
            feather(b, P(a, z), (d[0] * sx, d[1]), math.hypot(*d), width, sheen if dark else c0, black if dark else c1,
                    lift=0.0, layer=-i * 0.0015)

    # Flight feathers: black, the outer ones narrow and lifting at the tip.
    for i in range(N):
        # 15 secondaries along the arm, then 11 primaries spread wide enough to show sky between them.
        u = 0.52 * i / 17 if i < 17 else 0.52 + 0.48 * (i - 17) / 10
        root, tip = wing_plan(u)
        d = (tip[0] - root[0], tip[1] - root[1])
        outer = max(0.0, (u - 0.6) / 0.4)
        feather(b, P(lerp2(root, tip, 0.1), -0.01), (d[0] * sx, d[1]), math.hypot(*d) * 0.9, 0.25 - 0.1 * outer, sheen, black,
                lift=0.28 * outer, layer=-0.012 - i * 0.002)
    # Coverts, in three overlapping rows of smaller feathers; white on the arm,
    # dark over the hand, as on the real bird.
    row(26, -0.02, 0.33, 0.21, white, soft, 0.035, primaries_dark=True)
    row(20, -0.14, 0.17, 0.21, white, soft, 0.06, u1=0.6)
    row(16, -0.26, 0.04, 0.21, white, soft, 0.085, u1=0.55)
    # Scapulars: long white feathers lying back over the wing root.
    for i in range(5):
        k = i / 4
        feather(b, P((0.28 + 0.1 * k, 0.5 - 0.22 * k), 0.12), ((0.25 + 0.3 * k) * sx, -1), 0.8 + 0.25 * k, 0.2, white, soft, layer=0.012 * (4 - i))


def build_bird():
    b = Builder()
    white, soft, bill, eye = "#fbfaf4", "#dfe2de", "#d9482b", "#17181a"
    body = [(-1.25, 0.0, 0.02), (-1.05, 0.0, 0.16, 0.13), (-0.7, -0.02, 0.28, 0.24), (-0.25, -0.04, 0.35, 0.31), (0.2, -0.04, 0.36, 0.32),
            (0.6, -0.01, 0.31, 0.28), (0.9, 0.03, 0.22, 0.2), (1.2, 0.07, 0.15, 0.14), (1.6, 0.11, 0.125), (1.95, 0.14, 0.115),
            (2.12, 0.16, 0.15, 0.14), (2.26, 0.17, 0.16, 0.145), (2.4, 0.16, 0.12, 0.105), (2.5, 0.15, 0.065, 0.06)]
    b.tube(body, 16, lambda i, q: mix(soft, white, 0.5 + 0.5 * math.sin((q + 0.5) / 16 * math.tau)))
    b.tube([(2.48, 0.15, 0.062, 0.056), (2.85, 0.13, 0.046, 0.04), (3.25, 0.1, 0.028, 0.022), (3.52, 0.075, 0.005)], 8,
           lambda i, q: mix(bill, "#b5361f", i / 3))
    for sx in (-1, 1):
        b.ell((sx * 0.125, 2.28, 0.215), (0.03, 0.036, 0.03), eye, 8, 5)
        b.cyl((sx * 0.09, -0.9, -0.12), (sx * 0.1, -1.95, -0.09), 0.036, 0.026, bill, 6)
        b.ell((sx * 0.1, -1.95, -0.09), (0.04, 0.05, 0.04), bill, 6, 4)
        b.cyl((sx * 0.1, -1.95, -0.09), (sx * 0.115, -2.7, -0.06), 0.024, 0.018, bill, 6)
        for toe in (-0.06, 0, 0.06):
            b.cyl((sx * 0.115, -2.7, -0.06), (sx * 0.115 + toe, -2.95, -0.07), 0.014, 0.008, bill, 4)
        stork_wing(b, sx)
    for i in range(9):
        u = i / 8 - 0.5
        feather(b, (u * 0.34, -1.0, 0.02 - abs(u) * 0.05), (math.sin(u * 0.9), -math.cos(u * 0.9)), 0.62 - abs(u) * 0.2, 0.17, white, soft, layer=0.004 * i)
    return b.finish("bird")


def build_hawk():
    b = Builder()
    brown, dark, pale, bill = "#7d5638", "#33241b", "#dcc9a6", "#e6b84a"
    body = [(-1.15, 0.0, 0.02), (-0.9, 0.0, 0.2, 0.15), (-0.4, -0.02, 0.33, 0.29), (0.15, -0.02, 0.36, 0.32), (0.6, 0.02, 0.3, 0.27),
            (0.9, 0.07, 0.24, 0.22), (1.12, 0.1, 0.22, 0.2), (1.3, 0.1, 0.13, 0.12), (1.38, 0.08, 0.05)]
    b.tube(body, 14, lambda i, q: mix(pale, brown, 0.35 + 0.65 * (0.5 + 0.5 * math.sin((q + 0.5) / 14 * math.tau))))
    b.tube([(1.36, 0.08, 0.06, 0.055), (1.5, 0.05, 0.04), (1.6, -0.02, 0.006)], 8, bill)
    for sx in (-1, 1):
        b.ell((sx * 0.17, 1.2, 0.2), (0.035, 0.04, 0.035), "#141210", 6, 4)
    add_tail(b, -0.95, 0.75, 0.95, pale, brown, 9)
    add_wings(b, 3.0, 0.3, 1.55, 0.4, brown, "#5a3d29", dark, fingers=6, tip_chord=0.55)
    return b.finish("hawk")


# ----------------------------------------------------------------------- planes
def build_airliner():
    b = Builder()
    body, belly, accent, grey = "#f4f1ea", "#cfd6dc", "#e2664a", "#8b949c"
    f = b.cyl((0, -13, 0), (0, 13, 0), 1.9, 1.9, body, 14, caps=False)
    b.shade(f, belly, body)
    b.ell((0, 13, 0), (1.9, 4.2, 1.9), body, 14, 8)
    b.ell((0, 15.6, 0.45), (1.25, 1.3, 0.75), "#39485a", 10, 6)
    b.cyl((0, -13, 0), (0, -19.5, 0.9), 1.9, 0.35, body, 14)
    for sx in (-1, 1):
        m = trs((0, 0, -0.95)) @ Matrix.Diagonal((sx, 1, 1, 1))
        b.prism([(1.2, 4.5), (17, -5.2), (17, -7.2), (1.2, -3.6)], m, 0.42, body)
        b.prism([(0.6, -14.2), (6.4, -18.2), (6.4, -19.4), (0.6, -17.6)], trs((0, 0, 0.5)) @ Matrix.Diagonal((sx, 1, 1, 1)), 0.26, body)
        b.cyl((sx * 6, 1.6, -1.9), (sx * 6, -2.4, -1.9), 0.95, 0.8, grey, 10)
        b.cyl((sx * 6, 1.62, -1.9), (sx * 6, 1.9, -1.9), 0.8, 0.5, "#2f3a46", 10)
        b.prism([(17, -5.2), (17, -7.2), (17.2, -7.9), (17.2, -6.3)], trs((0, 0, -0.95)) @ Matrix.Diagonal((sx, 1, 1, 1)), 1.7, accent)
    fin = Matrix.Translation((-0.16, 0, 0)) @ Euler((math.pi / 2, 0, math.pi / 2)).to_matrix().to_4x4()
    b.prism([(-13.2, 1.2), (-17.4, 6.6), (-19.6, 6.6), (-18.6, 1.0)], fin, 0.32, accent)
    for sx in (-1, 1):
        b.box((sx * 1.86, 1, 0.45), (0.1, 21, 0.34), "#39485a")
    return b.finish("airliner")


def build_biplane():
    b = Builder()
    red, cream, dark = "#c8452f", "#f0dfb4", "#2c2f33"
    f = b.cyl((0, -5.2, 0.25), (0, 3.6, 0), 0.35, 0.95, red, 10)
    b.cyl((0, 3.6, 0), (0, 4.5, 0), 1.0, 0.85, dark, 10)
    b.ell((0, 0.2, 0.75), (0.5, 0.9, 0.42), "#9fc3cf", 8, 6)
    for z, y in ((1.75, 1.7), (-0.55, 1.0)):
        b.prism([(-7.4, -0.95), (7.4, -0.95), (7.7, -0.3), (7.4, 0.95), (-7.4, 0.95), (-7.7, -0.3)], trs((0, y, z)), 0.16, cream)
    for sx in (-1, 1):
        for x in (2.2, 5.6):
            b.cyl((sx * x, 1.1, -0.45), (sx * x, 1.9, 1.8), 0.06, 0.06, dark, 5)
        b.cyl((sx * 0.6, 1.2, -0.6), (sx * 1.3, 1.6, -1.75), 0.07, 0.07, dark, 5)
        b.cyl((sx * 1.2, 1.6, -1.75), (sx * 1.6, 1.6, -1.75), 0.55, 0.55, dark, 10)
        b.prism([(0.2, -4.2), (2.6, -4.6), (2.6, -5.5), (0.2, -5.5)], trs((0, 0, 0.25)) @ Matrix.Diagonal((sx, 1, 1, 1)), 0.1, cream)
    fin = Matrix.Translation((-0.05, 0, 0)) @ Euler((math.pi / 2, 0, math.pi / 2)).to_matrix().to_4x4()
    b.prism([(-4.0, 0.4), (-5.0, 1.9), (-5.7, 1.9), (-5.6, 0.3)], fin, 0.1, red)
    return b.finish("biplane")


def build_biplane_prop():
    b = Builder()
    b.cyl((0, 0, 0), (0, 0.55, 0), 0.34, 0.05, "#e9d9a8", 8)
    b.box((0, 0.12, 0), (0.34, 0.07, 4.4), "#3a2c22", (0, 0.35, 0))
    return b.finish("biplane_prop", (0, 4.5, 0))


def build_balloon():
    b = Builder()
    cols = ["#e8643c", "#f5efe0", "#f3c75a", "#f5efe0"]
    prof = [(0.01, 22.5)]
    for i in range(1, 11):
        a = i / 10
        ang = a * math.pi * 0.86
        r = 8.2 * math.sin(ang) * (1 + 0.1 * a)
        prof.append((r if i < 10 else 2.1, 14 + 8.5 * math.cos(ang) - (1.6 * a ** 3)))
    prof.append((1.7, 5.4))
    f = b.lathe((0, 0, 0), prof, 16, lambda s, r: mix(cols[s % 4], "#b8492c" if s % 2 == 0 else "#d9c9a8", 0.55 * max(0, (r - 5) / 6)))
    b.box((0, 0, 1.1), (2.4, 2.4, 2.0), "#8a5a34")
    b.box((0, 0, 2.15), (2.7, 2.7, 0.22), "#6b4226")
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl((sx * 1.2, sy * 1.2, 2.2), (sx * 1.25, sy * 1.25, 5.5), 0.045, 0.045, "#5a4636", 4)
    return b.finish("balloon")


# ------------------------------------------------------------------------ trees
# Foliage is greyscale: the game tints each tree. Crowns are heaps of small
# lumpy leaf masses on real branches, light on the outside and dark within.
TRUNK = "#4a4038"


def crown(b, center, size, n, rnd, lo="#565656", hi="#ffffff", gather=None):
    cx, cy, cz = center
    sx, sy, sz = size
    faces = []
    spots = []
    for _ in range(n):
        while True:
            p = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.75, 1)))
            if 0.3 < p.length < 1:
                break
        r = rnd.uniform(0.3, 0.46) * min(sx, sz) * (1.3 - 0.4 * p.length)
        c = (cx + p.x * sx * 0.72, cy + p.y * sy * 0.72, cz + p.z * sz * 0.72)
        spots.append(c)
        f = b.ico(c, r, "#ffffff", 2, (1, 1, 0.82))
        for v in {v for face in f for v in face.verts}:
            d = v.co - Vector(c)
            wob = math.sin(v.co.x * 2.7 + c[2]) * math.cos(v.co.y * 2.3 + c[0]) + rnd.uniform(-0.5, 0.5)
            v.co += d.normalized() * r * 0.2 * wob
        faces += f
    for f in faces:
        for l in f.loops:
            d = Vector(((l.vert.co.x - cx) / sx, (l.vert.co.y - cy) / sy, (l.vert.co.z - cz) / sz))
            l[b.col] = mix(lo, hi, max(0.0, min(1.0, 0.18 + 0.42 * d.length + 0.42 * d.z)))
    if gather is not None:
        gather.extend(spots)
    return faces


def limbs(b, top, spots, rnd, r=0.2, color=TRUNK, count=5):
    for c in rnd.sample(spots, min(count, len(spots))):
        mid = Vector(top).lerp(Vector(c), 0.5) + Vector((0, 0, -0.4))
        b.cyl(top, mid, r, r * 0.7, color, 5)
        b.cyl(mid, c, r * 0.7, r * 0.3, color, 5)


def broadleaf(name, seed, height, spread, trunk_h, n, bark=TRUNK, lo="#565656"):
    def build():
        rnd = random.Random(seed)
        b = Builder()
        lean = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4))
        top = (lean[0], lean[1], trunk_h)
        b.cyl((0, 0, -0.3), (lean[0] * 0.4, lean[1] * 0.4, trunk_h * 0.5), spread * 0.085 + 0.2, spread * 0.065 + 0.14, bark, 7)
        b.cyl((lean[0] * 0.4, lean[1] * 0.4, trunk_h * 0.5), top, spread * 0.065 + 0.14, spread * 0.045 + 0.1, bark, 7)
        spots = []
        crown(b, (lean[0], lean[1], trunk_h + (height - trunk_h) * 0.5), (spread, spread, (height - trunk_h) * 0.62), n, rnd, lo=lo, gather=spots)
        limbs(b, top, spots, rnd, spread * 0.04 + 0.08, bark)
        return b.finish(name)
    return build


def pine(name, seed, height, spread, tiers):
    def build():
        rnd = random.Random(seed)
        b = Builder()
        b.cyl((0, 0, -0.3), (0, 0, height * 0.9), 0.36, 0.08, TRUNK, 6)
        seg = 11
        for t in range(tiers):
            k = t / (tiers - 1)
            z = height * (0.2 + 0.68 * k)
            r = spread * (1 - 0.78 * k)
            h = height * 0.3 * (1 - 0.35 * k)
            rim = [r * rnd.uniform(0.78, 1.12) for _ in range(seg)] 
            rows = []
            for q in range(seg + 1):
                a = q / seg * math.tau
                rr = rim[q % seg]
                rows.append([Vector((rr * math.cos(a), rr * math.sin(a), z - h * 0.16)),
                             Vector((rr * 0.5 * math.cos(a), rr * 0.5 * math.sin(a), z + h * 0.42)),
                             Vector((0.04 * math.cos(a), 0.04 * math.sin(a), z + h))])
            b.grid(rows, lambda i, q: mix("#4c4c4c", "#f2f2f2", (0.25 + 0.5 * k) * (1.0 if q else 0.55) + 0.2 * rnd.random()))
        return b.finish(name)
    return build


def build_tree_poplar():
    rnd = random.Random(5)
    b = Builder()
    b.cyl((0, 0, -0.3), (0, 0, 5), 0.36, 0.2, TRUNK, 6)
    crown(b, (0, 0, 10.4), (2.0, 2.0, 7.6), 30, rnd)
    return b.finish("tree_poplar")


def build_bush():
    rnd = random.Random(9)
    b = Builder()
    crown(b, (0, 0, 1.1), (1.9, 1.9, 1.3), 7, rnd, lo="#4a4a4a")
    return b.finish("bush")


def build_tuft():
    """A clump of grass blades, greyscale so the game can tint it like the ground."""
    rnd = random.Random(3)
    b = Builder()
    for i in range(11):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0, 0.5)
        base = Vector((r * math.cos(a), r * math.sin(a), -0.1))
        out = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.15, 0.7)
        side = Vector((-math.sin(a), math.cos(a), 0)) * rnd.uniform(0.07, 0.12)
        h = rnd.uniform(0.9, 1.9)
        mid = base + out * 0.35 + Vector((0, 0, h * 0.6))
        tip = base + out + Vector((0, 0, h))
        b.grid([[base - side, base + side], [mid - side * 0.7, mid + side * 0.7], [tip - side * 0.08, tip + side * 0.08]],
               lambda i, q: mix("#6a6a6a", "#ffffff", 0.2 + 0.6 * i))
    return b.finish("tuft")


# ---------------------------------------------------------------------- animals
def build_cow():
    b = Builder()
    hide, dark = "#f2f2f2", "#3a3632"
    b.tube([(-1.75, 1.55, 0.05), (-1.6, 1.6, 0.42, 0.5), (-0.9, 1.65, 0.62, 0.68), (0.3, 1.6, 0.66, 0.7), (1.2, 1.6, 0.55, 0.62),
            (1.6, 1.75, 0.36, 0.42), (2.0, 1.85, 0.3, 0.34), (2.45, 1.7, 0.24, 0.26), (2.7, 1.6, 0.2, 0.2), (2.78, 1.58, 0.05)], 10,
           lambda i, q: mix("#bdbdbd", hide, 0.5 + 0.5 * math.sin((q + 0.5) / 10 * math.tau)))
    for sx in (-1, 1):
        for y in (-1.25, 1.1):
            b.cyl((sx * 0.36, y, 1.25), (sx * 0.36, y, 0.12), 0.17, 0.11, hide, 6)
            b.cyl((sx * 0.36, y, 0.12), (sx * 0.36, y, -0.05), 0.12, 0.12, dark, 6)
        b.cyl((sx * 0.2, 2.2, 2.05), (sx * 0.45, 2.15, 2.3), 0.05, 0.02, "#e8e0cf", 5)
        b.ell((sx * 0.33, 2.1, 1.95), (0.14, 0.06, 0.09), hide, 6, 4)
    b.cyl((0, -1.72, 1.6), (0, -1.9, 0.75), 0.05, 0.03, dark, 5)
    return b.finish("cow")


def build_sailboat():
    b = Builder()
    hull = [(-1.5, -3.6), (1.5, -3.6), (1.9, -0.5), (1.3, 2.6), (0, 4.6), (-1.3, 2.6), (-1.9, -0.5)]
    b.prism(hull, trs((0, 0, -0.3)), 1.3, "#f1e9da")
    b.prism([(x * 1.04, y * 1.03) for x, y in hull], trs((0, 0, 1.0)), 0.16, "#8a4b32")
    b.cyl((0, 0.6, 1.0), (0, 0.6, 11), 0.11, 0.07, "#6b4a33", 6)
    b.cyl((0, 0.6, 2.0), (0, -3.6, 2.2), 0.07, 0.05, "#6b4a33", 5)
    sail = lambda pts, col: b.grid([[Vector(pts[0]), Vector(pts[1])], [Vector(pts[2]), Vector(pts[2])]], col)
    for k in range(6):
        t0, t1 = k / 6, (k + 1) / 6
        f = lambda t: Vector((0.35 * math.sin(t * math.pi), 0.6 - 3.9 * (1 - t), 2.3 + 8.4 * t))
        g = lambda t: Vector((0, 0.6, 2.3 + 8.4 * t))
        b.grid([[g(t0), f(t0)], [g(t1), f(t1) if k < 5 else g(t1)]], mix("#f7f3ea", "#e2dccd", k / 6))
        h = lambda t: Vector((0.25 * math.sin(t * math.pi), 0.75 + 3.2 * (1 - t), 2.0 + 6.6 * t))
        g2 = lambda t: Vector((0, 0.75, 2.0 + 6.6 * t))
        b.grid([[g2(t0), h(t0)], [g2(t1), h(t1) if k < 5 else g2(t1)]], mix("#efe7d6", "#d9d0bd", k / 6))
    return b.finish("sailboat")


# -------------------------------------------------------------------- buildings
def gable(b, c, w, d, h, roof_h, wall, roof, overhang=0.35):
    b.box((c[0], c[1], c[2] + h / 2), (w, d, h), wall)
    m = Matrix.Translation((c[0], c[1] - d / 2 - overhang, c[2] + h)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4()
    b.prism([(-w / 2 - overhang, 0), (w / 2 + overhang, 0), (0, roof_h)], m, -(d + overhang * 2), roof)


def build_house():
    b = Builder()
    gable(b, (0, 0, 0), 6.4, 8, 4.2, 3.2, "#efe2c6", "#c7603f")
    b.box((1.8, 1.6, 6.4), (0.9, 0.9, 2.2), "#b9a48a")
    b.box((3.22, 0, 1.3), (0.06, 1.3, 2.6), "#6f4a33")
    for y in (-2.4, 2.4):
        b.box((3.22, y, 2.4), (0.06, 1.2, 1.2), "#f6d98a")
        b.box((-3.22, y, 2.4), (0.06, 1.2, 1.2), "#f6d98a")
    return b.finish("house")


def gable_r(b, c, w, d, h, roof_h, wall, roof, overhang=0.35, yaw=0.0):
    """A gabled block whose ridge can be turned by `yaw` around the vertical."""
    b.box((c[0], c[1], c[2] + h / 2), (w, d, h), wall, (0, 0, yaw))
    m = (Matrix.Translation((c[0], c[1], c[2] + h)) @ Euler((0, 0, yaw)).to_matrix().to_4x4()
         @ Matrix.Translation((0, -d / 2 - overhang, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4())
    b.prism([(-w / 2 - overhang, 0), (w / 2 + overhang, 0), (0, roof_h)], m, -(d + overhang * 2), roof)


def hip(b, c, w, d, h, roof_h, wall, roof, overhang=0.4):
    """A block under a hipped roof: four slopes meeting at a short ridge."""
    b.box((c[0], c[1], c[2] + h / 2), (w, d, h), wall)
    ridge = max(0.5, d - w)
    x0, y0, z0 = w / 2 + overhang, d / 2 + overhang, c[2] + h
    pts = [(c[0] + sx * x0, c[1] + sy * y0, z0) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    pts += [(c[0], c[1] - ridge / 2, z0 + roof_h), (c[0], c[1] + ridge / 2, z0 + roof_h)]
    v = [b.bm.verts.new(p) for p in pts]
    faces = [b.bm.faces.new((v[0], v[1], v[4])), b.bm.faces.new((v[1], v[2], v[5], v[4])), b.bm.faces.new((v[2], v[3], v[5])),
             b.bm.faces.new((v[3], v[0], v[4], v[5])), b.bm.faces.new((v[3], v[2], v[1], v[0]))]
    b.paint(faces, roof, False)


def panes(b, x, ys, z, w=1.1, h=1.2, color="#f6d98a"):
    """Windows on both long walls."""
    for y in ys:
        for sx in (-1, 1):
            b.box((sx * x, y, z), (0.06, w, h), color)


def build_house2():
    """Two storeys under a slate hipped roof."""
    b = Builder()
    hip(b, (0, 0, 0), 6.2, 7.2, 6.6, 2.7, "#ebe6da", "#5d6670")
    b.box((-1.6, -1.8, 9.2), (0.9, 0.9, 2.0), "#a8623f")
    b.box((3.12, 0, 1.25), (0.06, 1.3, 2.5), "#3f4a57")
    panes(b, 3.12, (-2.2, 2.2), 2.3)
    panes(b, 3.12, (-2.2, 0, 2.2), 5.0)
    return b.finish("house2")


def build_house3():
    """A long low cottage under thatch."""
    b = Builder()
    gable(b, (0, 0, 0), 5.6, 11.5, 3.1, 3.5, "#f3ecda", "#a98a5a", 0.7)
    b.box((0, 4.6, 6.6), (1.0, 1.0, 2.2), "#9b9288")
    b.box((2.82, -3.4, 1.15), (0.06, 1.2, 2.3), "#496a4a")
    panes(b, 2.82, (-0.6, 2.0, 4.4), 1.9, 1.0, 1.0)
    b.box((2.5, -3.4, 0.1), (2.2, 2.2, 0.2), "#c9bfa9")
    return b.finish("house3")


def build_house4():
    """An L of two wings under terracotta."""
    b = Builder()
    gable(b, (0, 0, 0), 6, 10, 4.2, 3.0, "#f0dcbc", "#c0683f")
    gable_r(b, (4.4, -2.4, 0), 5.2, 6.4, 3.8, 2.6, "#f0dcbc", "#c0683f", 0.35, math.pi / 2)
    b.box((-1.5, 3, 6.5), (0.9, 0.9, 2.0), "#b9a48a")
    b.box((4.4, -5.02, 1.25), (1.3, 0.06, 2.5), "#6f4a33")
    panes(b, 3.02, (2.2, 3.8), 2.4)
    for x in (2.6, 6.2):
        b.box((x, 0.22, 2.3), (1.1, 0.06, 1.2), "#f6d98a")
    return b.finish("house4")


def build_house5():
    """A narrow three-storey townhouse with a steep roof."""
    b = Builder()
    gable(b, (0, 0, 0), 5, 6.4, 8.6, 3.8, "#dccdb0", "#8c4a38", 0.3)
    b.box((1.2, 1.6, 12.0), (0.8, 0.8, 2.4), "#8f8478")
    b.box((2.52, -1.4, 1.3), (0.06, 1.3, 2.6), "#2f4f5f")
    b.box((2.52, 1.4, 1.6), (0.06, 1.8, 1.8), "#bfe0ea")
    panes(b, 2.52, (-1.5, 1.5), 4.6, 1.0, 1.4)
    panes(b, 2.52, (-1.5, 1.5), 7.2, 1.0, 1.2)
    return b.finish("house5")


def build_terminal():
    """An airport terminal: a long glazed hall under a curved roof, with piers."""
    b = Builder()
    b.box((0, 0, 3.5), (16, 70, 7), "#e9ecee")
    for sx in (-1, 1):
        b.box((sx * 8.03, 0, 3.9), (0.1, 66, 3.6), "#6fa9c6")
        for y in range(-30, 31, 6):
            b.box((sx * 8.08, y, 3.9), (0.12, 0.35, 3.6), "#dfe4e8")
    arc = [(-9.2 + 18.4 * i / 10, 2.6 * math.sin(math.pi * i / 10)) for i in range(11)]
    m = Matrix.Translation((0, -36.5, 7)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4()
    b.prism(arc, m, -73, "#c3ccd3")
    for y in (-22, 0, 22):
        b.box((-15, y, 4.4), (14, 3, 2.6), "#dfe4e8")
        b.box((-21.5, y, 2.2), (1.2, 1.2, 4.4), "#aab3ba")
        b.box((-15, y, 4.5), (13, 3.06, 1.0), "#6fa9c6")
    b.box((8.6, 0, 1.6), (1.6, 18, 0.3), "#c9cfd4")
    return b.finish("terminal")


def build_control_tower():
    b = Builder()
    b.shade(b.cyl((0, 0, 0), (0, 0, 19), 2.5, 1.9, "#e6e2d8", 12), "#bdb9b0", "#efece4")
    b.cyl((0, 0, 3), (0, 0, 4.2), 2.46, 2.36, "#c9523e", 12)
    b.lathe((0, 0, 0), [(1.9, 19), (3.7, 20.3), (4.1, 23.2), (3.3, 23.7), (0.2, 24.5)], 12,
            lambda i, q: "#4f93b6" if q == 1 else "#dde1e3", smooth=False)
    b.cyl((0, 0, 24.4), (0, 0, 29), 0.12, 0.06, "#c9523e", 5)
    b.box((0, 0, 1.6), (9, 7, 3.2), "#dcd8ce")
    return b.finish("control_tower")


def build_hangar():
    b = Builder()
    arc = [(-12, 0)] + [(-12 * math.cos(math.pi * i / 10), 2.5 + 7.5 * math.sin(math.pi * i / 10)) for i in range(11)] + [(12, 0)]
    m = Matrix.Translation((0, -14, 0)) @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4()
    b.prism(arc, m, -28, "#b7c1c9")
    b.box((0, 14.05, 4.2), (18, 0.12, 8.4), "#6f7d88")
    b.box((0, 14.1, 8.8), (22, 0.1, 0.5), "#c9523e")
    return b.finish("hangar")


def build_sheep():
    b = Builder()
    wool, dark = "#f4f0e4", "#3b3530"
    b.shade(b.ell((0, 0, 1.05), (0.62, 0.98, 0.6), wool, 10, 7), "#cfc9ba", "#fbf8ee")
    b.ell((0, 1.0, 1.32), (0.25, 0.36, 0.27), dark, 8, 6)
    for sx in (-1, 1):
        b.ell((sx * 0.27, 0.92, 1.5), (0.16, 0.07, 0.07), dark, 6, 4)
        for y in (-0.55, 0.55):
            b.cyl((sx * 0.32, y, 0.7), (sx * 0.32, y, 0), 0.09, 0.07, dark, 5)
    return b.finish("sheep")


def build_windmill():
    """A stone tower mill with four lattice sails."""
    b = Builder()
    b.shade(b.cyl((0, 0, 0), (0, 0, 11), 3.3, 2.3, "#f2ecdf", 12), "#cfc6b4", "#f8f3e8")
    b.cyl((0, 0, 11), (0, 0, 14), 2.7, 0.15, "#6a4a38", 12)
    b.box((0, 3.1, 1.3), (1.3, 0.3, 2.6), "#6f4a33")
    for z in (5, 8.2):
        b.box((0, 2.75 - (z - 5) * 0.09, z), (0.9, 0.3, 1.1), "#57493f")
    hub = Vector((0, 3.0, 11.2))
    b.cyl((0, 2.2, 11.2), (0, 3.3, 11.2), 0.45, 0.35, "#57493f", 8)
    for i in range(4):
        a = 0.35 + i * math.pi / 2
        along = Vector((math.sin(a), 0, math.cos(a)))
        side = Vector((math.cos(a), 0, -math.sin(a)))
        b.box(hub + along * 5.0, (0.24, 0.14, 10), "#7a5a3c", (0, a, 0))
        b.box(hub + along * 6.0 + side * 0.95 + Vector((0, 0.05, 0)), (1.7, 0.06, 7.6), "#efe6d2", (0, a, 0))
        for k in range(5):
            b.box(hub + along * (2.8 + k * 1.6) + side * 0.95 + Vector((0, 0.1, 0)), (1.8, 0.08, 0.1), "#7a5a3c", (0, a, 0))
    return b.finish("windmill")


def build_barn():
    b = Builder()
    gable(b, (0, 0, 0), 9, 13, 5.2, 4.2, "#a24a35", "#6f6a66", 0.5)
    b.box((0, 6.52, 2.2), (3.6, 0.06, 4.4), "#f0e3cd")
    b.cyl((6.6, -3, 0), (6.6, -3, 8.4), 1.9, 1.9, "#d9d2c2", 10)
    b.cyl((6.6, -3, 8.4), (6.6, -3, 9.8), 1.95, 0.1, "#8b8f93", 10)
    return b.finish("barn")


def build_church():
    b = Builder()
    stone, slate = "#ddd2bd", "#58606b"
    gable(b, (0, -4, 0), 7.5, 14, 7, 4.4, stone, slate)
    b.box((0, 5.2, 7.5), (5, 5, 15), stone)
    m = trs((0, 5.2, 15))
    b.cyl((0, 5.2, 15), (0, 5.2, 26), 3.6, 0.05, slate, 4)
    b.box((0, 7.72, 11.5), (1.3, 0.06, 2.4), "#f6d98a")
    b.box((0, 7.72, 2), (1.8, 0.06, 4), "#6f4a33")
    return b.finish("church")


def build_lighthouse():
    b = Builder()
    for i in range(5):
        b.cyl((0, 0, i * 4), (0, 0, i * 4 + 4), 2.6 - i * 0.28, 2.6 - (i + 1) * 0.28, "#f4efe6" if i % 2 == 0 else "#d4553c", 12)
    b.cyl((0, 0, 20), (0, 0, 20.5), 2.0, 2.0, "#3a4047", 12)
    b.cyl((0, 0, 20.5), (0, 0, 22.6), 1.05, 1.05, "#ffe9a8", 10)
    b.cyl((0, 0, 22.6), (0, 0, 24.2), 1.5, 0.05, "#d4553c", 12)
    return b.finish("lighthouse")


def build_turbine_tower():
    b = Builder()
    b.shade(b.cyl((0, 0, 0), (0, 0, 31), 1.0, 0.55, "#f2f2ee", 10), "#cfd3d6", "#f6f6f2")
    b.box((0, -0.6, 31.4), (1.5, 3.6, 1.5), "#e9eaea")
    return b.finish("turbine_tower")


def build_turbine_rotor():
    b = Builder()
    b.cyl((0, 0, 0), (0, 1.3, 0), 0.75, 0.2, "#e9eaea", 10)
    for i in range(3):
        m = Euler((0, i * math.tau / 3, 0)).to_matrix().to_4x4() @ Euler((math.pi / 2, 0, 0)).to_matrix().to_4x4() @ Matrix.Translation((0, 0, -0.5))
        b.prism([(-0.42, 0.3), (0.5, 0.3), (0.34, 5), (0.1, 12.5), (-0.1, 12.5), (-0.3, 5)], m, 0.14, "#f4f4f0")
    return b.finish("turbine_rotor", (0, 1.25, 31.4))


def build_pylon():
    b = Builder()
    steel = "#7d8790"
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.cyl((sx * 2.3, sy * 2.3, 0), (sx * 0.45, sy * 0.45, 25), 0.16, 0.12, steel, 4)
    for z, w in ((5, 1.95), (10, 1.6), (15, 1.2)):
        for sx in (-1, 1):
            b.box((sx * w, 0, z), (0.12, w * 2, 0.12), steel)
            b.box((0, sx * w, z), (w * 2, 0.12, 0.12), steel)
    for z, w in ((17, 6.2), (21, 4.8)):
        b.box((0, 0, z), (w * 2, 0.3, 0.3), steel)
        for sx in (-1, 1):
            b.cyl((sx * w, 0, z - 0.1), (sx * w, 0, z - 1.0), 0.12, 0.12, "#3c4349", 5)
            b.cyl((sx * w, 0, z + 0.1), (0, 0, z + 2.6), 0.08, 0.08, steel, 4)
    return b.finish("pylon")


# ----------------------------------------------------------------------- people
def build_hunter():
    b = Builder()
    coat, skin, hat, trouser = "#5d6b3c", "#e3b48f", "#6b4a2e", "#4a4038"
    for sx in (-1, 1):
        b.box((sx * 0.38, 0, 0.95), (0.5, 0.55, 1.9), trouser)
        b.box((sx * 0.38, 0.12, 0.12), (0.52, 0.85, 0.24), "#2e2925")
    b.box((0, 0, 2.75), (1.35, 0.75, 1.75), coat)
    b.ell((0, 0.05, 4.0), (0.42, 0.42, 0.46), skin, 8, 6)
    b.cyl((0, 0.05, 4.22), (0, 0.05, 4.3), 0.85, 0.85, hat, 10)
    b.cyl((0, 0.05, 4.3), (0, 0.05, 4.75), 0.46, 0.4, hat, 10)
    b.cyl((0.72, 0.1, 3.3), (0.45, 0.95, 3.75), 0.2, 0.17, coat, 6)
    b.cyl((-0.72, 0.1, 3.3), (0.1, 1.45, 4.2), 0.2, 0.17, coat, 6)
    b.cyl((0.4, 0.5, 3.45), (0.05, 2.9, 5.55), 0.075, 0.055, "#2a2623", 6)
    b.box((0.44, 0.4, 3.38), (0.2, 0.75, 0.32), "#7a5232", (0.72, 0, 0.14))
    return b.finish("hunter")


def build_rock():
    b = Builder()
    f = b.ico((0, 0, 0.9), 1, "#9a9a92", 3, (2.4, 1.9, 1.5))
    for v in {v for face in f for v in face.verts}:
        h = math.sin(v.co.x * 3.1 + v.co.y * 1.7) * math.cos(v.co.z * 2.3 + v.co.x)
        v.co += v.co.normalized() * 0.28 * h
    b.shade(f, "#6f706c", "#b5b5aa")
    return b.finish("rock")


def build_haystack():
    b = Builder()
    b.shade(b.cyl((0, 0, 0), (0, 0, 2.2), 1.9, 1.8, "#e6c877", 14), "#b99548", "#ecd286")
    b.shade(b.ell((0, 0, 2.2), (1.85, 1.85, 1.3), "#ecd286", 10, 6), "#d6b565", "#f1dc97")
    return b.finish("haystack")


BUILDERS = [build_bird, build_hawk, build_airliner, build_biplane, build_biplane_prop, build_balloon,
            build_tuft, build_cow, build_sailboat, build_house, build_house2, build_house3, build_house4, build_house5, build_barn, build_church,
            build_terminal, build_control_tower, build_hangar, build_sheep, build_windmill,
            build_lighthouse, build_turbine_tower, build_turbine_rotor, build_pylon, build_hunter,
            build_rock, build_haystack]

objects = []
for build in BUILDERS:
    ob = build()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    closed = [f for f in bm.faces if all(len(e.link_faces) == 2 for e in f.edges)]
    bmesh.ops.recalc_face_normals(bm, faces=closed)
    bm.to_mesh(ob.data)
    bm.free()
    objects.append(ob)

# --------------------------------------------------------------------- export
if bpy.context.object and bpy.context.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.object.select_all(action="DESELECT")
for ob in objects:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objects[0]

props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
wanted = dict(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_materials="NONE", export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False,
              export_active_vertex_color_when_no_material=True, export_normals=True, export_texcoords=False,
              export_animations=False, export_cameras=False, export_lights=False)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in props or k == "filepath"})

# Lay the kit out in a row so it can be looked at in the viewport.
x = 0.0
for ob in objects:
    if ob.name in ("biplane_prop", "turbine_rotor"):
        ob.location.x = last_x
        continue
    w = max(ob.dimensions.x, 4)
    x += w / 2
    ob.location.x = last_x = x
    x += w / 2 + 3

tris = sum(len(p.vertices) - 2 for ob in objects for p in ob.data.polygons)
print("flock kit:", len(objects), "objects,", tris, "triangles ->", OUT, os.path.getsize(OUT), "bytes")
