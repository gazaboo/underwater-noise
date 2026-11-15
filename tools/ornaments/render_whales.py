"""
Rendu des silhouettes peintes des cétacés (imposteurs), avec Blender (Cycles).

    blender -b --factory-startup -noaudio --python tools/ornaments/render_whales.py -- <sortie> [espèces]

Cinq espèces modélisées ici, de façon procédurale : rorqual bleu, rorqual commun, baleine à bosse, cachalot,
orque. Chaque animal est rendu deux fois (tête à droite, tête à gauche) pour que la lumière vienne toujours du
même côté que celle des terres et des vignettes (nord-ouest). Sortie : whale-<espèce>-<r|l>.png (1024×512, fond
transparent, sans ombre : elle est dessinée à l'écran). Ensuite : python3 tools/ornaments/pack_whales.py <sortie>.

Tout est artistique [A] : proportions simplifiées d'après les espèces (elles servent à les reconnaître, pas à
les mesurer), robes, lumière, angle de vue, taille (hors d'échelle, comme les vignettes du monde).
"""
import bpy
import bmesh
import math
import sys
from pathlib import Path
from mathutils import Vector, noise

args = sys.argv[sys.argv.index("--") + 1:]
OUT = Path(args[0])
ONLY = set(args[1].split(",")) if len(args) > 1 else None
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1024, 512
ELEV = math.radians(34)  # même hauteur de caméra que les vignettes du monde
PLUMP = 1.35

# ----------------------------------------------------------------------------- scène (comme render_cells.py)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
try:
    scene.view_settings.view_transform = "Standard"
except TypeError:
    pass

world = bpy.data.worlds.new("Ciel")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.62, 0.72, 0.9, 1)
bg.inputs["Strength"].default_value = 0.85
scene.world = world

sun_data = bpy.data.lights.new("Soleil", "SUN")
sun_data.energy = 3.4
sun_data.angle = math.radians(12)
sun_data.color = (1.0, 0.96, 0.88)
sun = bpy.data.objects.new("Soleil", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = Vector((-1.0, 0.5, 1.15)).normalized().to_track_quat("Z", "Y").to_euler()

cam_data = bpy.data.cameras.new("Vue")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.5
cam = bpy.data.objects.new("Vue", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.pi / 2 - ELEV, 0, 0)

# Lumière d'appoint, froide, du côté de la caméra : elle modèle le flanc, que le soleil laisse dans l'ombre.
fill_data = bpy.data.lights.new("Appoint", "SUN")
fill_data.energy = 1.5
fill_data.angle = math.radians(40)
fill_data.color = (0.8, 0.9, 1.0)
fill = bpy.data.objects.new("Appoint", fill_data)
scene.collection.objects.link(fill)
fill.rotation_euler = Vector((0.35, -1.0, 0.55)).normalized().to_track_quat("Z", "Y").to_euler()

mat = bpy.data.materials.new("Peau peinte")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.5
attr = mat.node_tree.nodes.new("ShaderNodeAttribute")
attr.attribute_name = "Pigment"
mat.node_tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def interp(pts, x, k):
    """Interpolation lisse (cosinus) de la colonne k d'un profil [(x, hauteur, largeur, centre z)…]."""
    if x <= pts[0][0]:
        return pts[0][k]
    for a, b in zip(pts, pts[1:]):
        if x <= b[0]:
            t = (x - a[0]) / (b[0] - a[0])
            t = (1 - math.cos(math.pi * t)) / 2
            return a[k] + (b[k] - a[k]) * t
    return pts[-1][k]


# ----------------------------------------------------------------------------- formes
# Repère de l'animal : x de la queue (−1) au museau (+1), y latéral, z vers le haut. Demi-longueur = 1.


def body(coll, profile, rings=96, seg=48):
    """Corps : anneaux elliptiques le long de l'axe, d'après un profil (x, demi-hauteur, demi-largeur, centre z)."""
    bm = bmesh.new()
    x0, x1 = profile[0][0], profile[-1][0]
    loops = []
    for i in range(rings):
        # Anneaux resserrés aux extrémités, pour arrondir le museau et le pédoncule.
        u = (1 - math.cos(math.pi * i / (rings - 1))) / 2
        x = x0 + (x1 - x0) * u
        rh, rw, cz = (interp(profile, x, k) for k in (1, 2, 3))
        loop = []
        for j in range(seg):
            a = math.tau * j / seg
            # Ventre un peu plus plat que le dos.
            z = math.sin(a)
            loop.append(bm.verts.new((x, rw * math.cos(a), cz + rh * (z if z > 0 else z * 0.9))))
        loops.append(loop)
    for a, b in zip(loops, loops[1:]):
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    bm.faces.new(loops[0][::-1])
    bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Corps")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("Corps", me)
    coll.objects.link(ob)
    return ob


def blade(coll, name, outline, thickness, origin, rot):
    """Nageoire : contour plan (dans le plan x, y local), épaissi, puis posé et orienté."""
    bm = bmesh.new()
    top = [bm.verts.new((x, y, thickness / 2)) for x, y in outline]
    bottom = [bm.verts.new((x, y, -thickness / 2)) for x, y in outline]
    bm.faces.new(top)
    bm.faces.new(bottom[::-1])
    n = len(outline)
    for i in range(n):
        bm.faces.new((top[i], bottom[i], bottom[(i + 1) % n], top[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.location = origin
    ob.rotation_euler = rot
    bevel = ob.modifiers.new("Arrondi", "BEVEL")
    bevel.width = thickness * 0.45
    bevel.segments = 3
    return ob


def flukes(coll, x, span, chord, cz):
    """Caudale : deux lobes horizontaux, échancrure au milieu."""
    lobe = [(0.02, 0.0), (-0.3 * chord, 0.42 * span), (-0.95 * chord, 1.0 * span), (-1.1 * chord, 0.86 * span),
            (-0.82 * chord, 0.4 * span), (-0.62 * chord, 0.0)]
    outline = lobe + [(px, -py) for px, py in lobe[-2:0:-1]]
    return blade(coll, "Caudale", outline, 0.03, (x, 0, cz), (0, 0, 0))


def pectoral(coll, x, y, z, length, width, side, sweep, droop):
    """Pectorale : pale effilée, rabattue vers l'arrière (sweep) et vers le bas (droop), des deux côtés."""
    outline = [(0.0, 0.0), (0.16 * length, 0.55 * width), (0.6 * length, 0.62 * width), (1.0 * length, 0.2 * width),
               (0.92 * length, -0.1 * width), (0.4 * length, -0.38 * width), (0.05 * length, -0.3 * width)]
    # Le contour pointe vers +x local : on le tourne vers l'extérieur (±y), puis vers l'arrière et le bas.
    yaw = side * (math.pi / 2 + sweep)
    return blade(coll, "Pectorale", outline, 0.025, (x, side * y, z), (side * -droop, 0, yaw))


def dorsal(coll, x, z, base, height, hook):
    """Dorsale : dans le plan vertical de l'animal ; `hook` la recourbe vers l'arrière (faux)."""
    outline = [(0.5 * base, 0.0), (0.05 * base - hook * 0.2, 0.55 * height), (-0.25 * base - hook, height),
               (-0.42 * base - hook * 0.9, 0.86 * height), (-0.5 * base - hook * 0.15, 0.3 * height), (-0.5 * base, 0.0)]
    # Plan local (x, y) → plan (x, z) de l'animal.
    return blade(coll, "Dorsale", outline, 0.035, (x, 0, z), (math.pi / 2, 0, 0))


def paint(obj, fn):
    """Robe : couleur par sommet (sRGB, comme sur une palette), convertie en linéaire pour le rendu."""
    me = obj.data
    layer = me.color_attributes.new("Pigment", "FLOAT_COLOR", "POINT")
    mw = obj.matrix_world
    for v in me.vertices:
        layer.data[v.index].color = (*srgb_to_linear(fn(mw @ v.co)), 1.0)
    me.materials.append(mat)


# ----------------------------------------------------------------------------- espèces

SPECIES = {
    # Rorqual bleu : très long, fin, museau large et plat, toute petite dorsale très en arrière, robe bleu-gris marbrée.
    "blue": dict(
        profile=[(-0.86, 0.03, 0.028, 0.0), (-0.7, 0.05, 0.04, 0.0), (-0.4, 0.095, 0.09, 0.0), (0.0, 0.135, 0.135, 0.0),
                 (0.4, 0.13, 0.145, -0.005), (0.75, 0.09, 0.125, -0.015), (0.95, 0.04, 0.08, -0.02), (1.0, 0.004, 0.008, -0.02)],
        flukes=(0.36, 0.24), dorsal=(-0.55, 0.07, 0.035, 0.03), pectoral=(0.42, 0.26, 0.085, 0.75, 0.35),
        back=(0.33, 0.45, 0.58), belly=(0.62, 0.72, 0.8), fin=(0.3, 0.41, 0.54), mottle=0.07,
    ),
    # Rorqual commun : fin, museau en pointe, dorsale en faux plus haute, dos sombre et ventre blanc.
    "fin": dict(
        profile=[(-0.86, 0.03, 0.028, 0.0), (-0.68, 0.052, 0.042, 0.0), (-0.38, 0.1, 0.09, 0.0), (0.05, 0.14, 0.13, 0.0),
                 (0.45, 0.125, 0.125, -0.005), (0.78, 0.075, 0.085, -0.012), (0.96, 0.03, 0.04, -0.015), (1.0, 0.004, 0.006, -0.015)],
        flukes=(0.35, 0.23), dorsal=(-0.36, 0.14, 0.1, 0.07), pectoral=(0.4, 0.24, 0.08, 0.8, 0.35),
        back=(0.23, 0.27, 0.33), belly=(0.9, 0.91, 0.9), fin=(0.21, 0.25, 0.31), mottle=0.02,
    ),
    # Baleine à bosse : trapue, très longues pectorales blanches, petite dorsale sur une bosse, large caudale.
    "humpback": dict(
        profile=[(-0.8, 0.036, 0.032, 0.0), (-0.6, 0.07, 0.06, 0.0), (-0.28, 0.155, 0.14, 0.0), (0.12, 0.2, 0.19, -0.005),
                 (0.5, 0.185, 0.185, -0.012), (0.8, 0.125, 0.135, -0.02), (0.97, 0.055, 0.07, -0.02), (1.0, 0.004, 0.008, -0.02)],
        flukes=(0.46, 0.27), dorsal=(-0.26, 0.11, 0.06, 0.04), pectoral=(0.4, 0.66, 0.14, 0.62, 0.42),
        back=(0.13, 0.15, 0.19), belly=(0.88, 0.89, 0.88), fin=(0.9, 0.91, 0.9), mottle=0.02, hump=(-0.24, 0.035),
    ),
    # Cachalot : tête carrée massive (un tiers du corps), petite bosse dorsale, pectorales courtes, peau gris-brun.
    "sperm": dict(
        profile=[(-0.84, 0.032, 0.028, 0.0), (-0.6, 0.065, 0.055, 0.0), (-0.22, 0.14, 0.12, 0.0), (0.2, 0.185, 0.14, 0.01),
                 (0.6, 0.2, 0.14, 0.02), (0.9, 0.195, 0.135, 0.025), (0.985, 0.16, 0.11, 0.03), (1.0, 0.1, 0.07, 0.03)],
        flukes=(0.38, 0.24), dorsal=(-0.24, 0.16, 0.05, 0.0), pectoral=(0.28, 0.17, 0.11, 0.55, 0.45),
        back=(0.34, 0.33, 0.35), belly=(0.5, 0.49, 0.5), fin=(0.31, 0.3, 0.32), mottle=0.03,
    ),
    # Orque : compacte, très haute dorsale, pectorales en palette, robe noire, ventre et tache de l'œil blancs.
    "orca": dict(
        profile=[(-0.8, 0.036, 0.032, 0.0), (-0.58, 0.075, 0.062, 0.0), (-0.2, 0.165, 0.14, 0.0), (0.2, 0.195, 0.17, 0.0),
                 (0.55, 0.17, 0.155, -0.005), (0.84, 0.095, 0.1, -0.012), (0.975, 0.04, 0.05, -0.015), (1.0, 0.004, 0.006, -0.015)],
        flukes=(0.4, 0.25), dorsal=(0.04, 0.2, 0.44, 0.06), pectoral=(0.36, 0.26, 0.2, 0.5, 0.4),
        back=(0.06, 0.065, 0.08), belly=(0.95, 0.95, 0.94), fin=(0.06, 0.065, 0.08), mottle=0.0,
    ),
}


def build(sp: str, coll):
    s = SPECIES[sp]
    # Corps épaissi de 35 % [A] : à 60 pixels de long, un animal aux proportions réelles n'est qu'un trait.
    prof = [(x, rh * PLUMP, rw * PLUMP, cz) for x, rh, rw, cz in s["profile"]]
    if "hump" in s:
        hx, hh = s["hump"]
        prof = [(x, rh + hh * math.exp(-((x - hx) / 0.12) ** 2), rw, cz + 0.5 * hh * math.exp(-((x - hx) / 0.12) ** 2)) for x, rh, rw, cz in prof]
    span, chord = (v * 1.15 for v in s["flukes"])
    dx, dbase, dheight, dhook = s["dorsal"]
    dbase, dheight = dbase * 1.15, dheight * 1.2
    px, plength, pwidth, psweep, pdroop = s["pectoral"]
    pwidth *= 1.25
    parts = [body(coll, prof)]
    tail = prof[0]
    parts.append(flukes(coll, tail[0] + 0.02, span, chord, tail[3]))
    top = lambda x: interp(prof, x, 3) + interp(prof, x, 1)
    parts.append(dorsal(coll, dx, top(dx) - 0.012, dbase, dheight, dhook))
    for side in (-1, 1):
        parts.append(pectoral(coll, px, interp(prof, px, 2) * 0.82, interp(prof, px, 3) - interp(prof, px, 1) * 0.45, plength, pwidth, side, psweep, pdroop))
    bpy.context.view_layer.update()

    def skin(p):
        """Robe du corps : dos sombre, ventre clair, marbrures ; taches blanches et selle grise de l'orque."""
        rh, cz = interp(prof, p.x, 1), interp(prof, p.x, 3)
        h = (p.z - cz) / max(rh, 1e-3)
        limit = -0.25 if sp != "orca" else -0.35 + 0.25 * smooth(0.3, 0.9, p.x)
        if sp == "sperm":
            limit = -0.8
        c = mix(s["belly"], s["back"], smooth(limit - 0.18, limit + 0.18, h))
        if s["mottle"]:
            m = noise.noise(Vector((p.x * 9, p.y * 9, p.z * 9)))
            c = tuple(max(0.0, min(1.0, v + s["mottle"] * m)) for v in c)
        if sp == "orca":
            eye = ((p.x - 0.62) / 0.11) ** 2 + ((h - 0.2) / 0.3) ** 2
            if abs(p.y) > 0.02:
                c = mix(c, s["belly"], smooth(1.2, 0.8, eye))
            saddle = ((p.x + 0.2) / 0.16) ** 2 + ((h - 0.55) / 0.42) ** 2
            if saddle < 1:
                c = mix(c, (0.5, 0.52, 0.55), 0.8 * (1 - saddle))
        return c

    paint(parts[0], skin)
    for part in parts[1:]:
        if sp == "humpback" and part.name.startswith("Pectorale"):
            paint(part, lambda p: s["fin"])
        elif sp == "humpback":
            paint(part, lambda p: s["back"])
        else:
            paint(part, lambda p: s["fin"])
    return parts


# ----------------------------------------------------------------------------- rendu

D = 30.0
bpy.context.view_layer.update()
up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
colls = {}
for sp in SPECIES:
    if ONLY and sp not in ONLY:
        continue
    c = bpy.data.collections.new(sp)
    scene.collection.children.link(c)
    root = bpy.data.objects.new(f"{sp}-axe", None)
    c.objects.link(root)
    for part in build(sp, c):
        part.parent = root
    colls[sp] = (c, root)

for sp, (c, root) in colls.items():
    for other, _ in colls.values():
        other.hide_render = other is not c
    for tag, turn in (("r", 0.0), ("l", math.pi)):
        root.rotation_euler = (0, 0, turn)
        cam.location = Vector((0, -math.cos(ELEV) * D, math.sin(ELEV) * D))
        scene.render.filepath = str(OUT / f"whale-{sp}-{tag}.png")
        bpy.ops.render.render(write_still=True)
        print("CÉTACÉ", sp, tag, flush=True)
