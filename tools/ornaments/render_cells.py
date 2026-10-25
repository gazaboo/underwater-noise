"""
Rendu des imposteurs (vignettes) des ornements du monde illustré, avec Blender (Cycles).

    blender -b --factory-startup -noaudio --python tools/ornaments/render_cells.py -- <Blends> <sortie>

<Blends> : dossier « Blends » du pack *Ultimate Stylized Nature* de Quaternius (CC0 1.0, domaine
public ; https://quaternius.com). Les montagnes, volcans, fumées et nuages sont modélisés ici, de façon
procédurale. Sortie : une image PNG par vignette et cells.json (catégorie, point d'ancrage au sol,
échelle). Ensuite : python3 tools/ornaments/pack_atlas.py <sortie>.

Tout est artistique : compositions des bosquets, teintes, tailles relatives, lumière, angle de vue.
La lumière vient de la gauche et d'en haut, comme le relief précalculé des terres (nord-ouest).
"""
import bpy
import bmesh
import json
import math
import random
import sys
from pathlib import Path
from mathutils import Vector, noise

args = sys.argv[sys.argv.index("--") + 1:]
BLENDS, OUT = Path(args[0]), Path(args[1])
ONLY = set(args[2].split(",")) if len(args) > 2 else None
OUT.mkdir(parents=True, exist_ok=True)
RES = 512
ELEV = math.radians(34)  # hauteur de la caméra au-dessus de l'horizon (vue de trois quarts)
PIVOT_Y = 0.24  # position verticale du point d'ancrage dans la vignette

# ----------------------------------------------------------------------------- scène

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = RES
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
bg.inputs["Strength"].default_value = 0.7
scene.world = world

sun_data = bpy.data.lights.new("Soleil", "SUN")
sun_data.energy = 3.4
sun_data.angle = math.radians(9)
sun_data.color = (1.0, 0.96, 0.88)
sun = bpy.data.objects.new("Soleil", sun_data)
scene.collection.objects.link(sun)
to_light = Vector((-1.0, 0.5, 1.15)).normalized()
sun.rotation_euler = to_light.to_track_quat("Z", "Y").to_euler()

cam_data = bpy.data.cameras.new("Vue")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("Vue", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.pi / 2 - ELEV, 0, 0)

bpy.ops.mesh.primitive_plane_add(size=40)
catcher = bpy.context.object
catcher.name = "Ombres"
catcher.is_shadow_catcher = True
for c in list(catcher.users_collection):
    c.objects.unlink(catcher)
scene.collection.objects.link(catcher)

# ----------------------------------------------------------------------------- matériaux


def vertex_material(name: str, emission_attr: bool = False) -> bpy.types.Material:
    """Matériau mat dont la couleur vient de l'attribut de sommet « Pigment »."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "Pigment"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    if emission_attr:
        glow = nt.nodes.new("ShaderNodeAttribute")
        glow.attribute_name = "Lueur"
        nt.links.new(glow.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 3.0
    return m


ROCK_MAT = vertex_material("Roche peinte", emission_attr=True)
SOFT_MAT = vertex_material("Vapeur")
SOFT_MAT.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0

_tinted: dict = {}


def tinted(mat: bpy.types.Material, tint) -> bpy.types.Material:
    """Copie du matériau dont la couleur de base est multipliée par `tint` (feuillages par milieu)."""
    key = (mat.name, tuple(round(t, 3) for t in tint))
    if key in _tinted:
        return _tinted[key]
    m = mat.copy()
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type in ("BSDF_PRINCIPLED", "BSDF_DIFFUSE")), None)
    if bsdf is not None:
        base = bsdf.inputs["Base Color" if bsdf.type == "BSDF_PRINCIPLED" else "Color"]
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        a = next(s for s in mix.inputs if s.identifier == "A_Color")
        b = next(s for s in mix.inputs if s.identifier == "B_Color")
        if base.is_linked:
            nt.links.new(base.links[0].from_socket, a)
        else:
            a.default_value = base.default_value
        b.default_value = (*tint, 1.0)
        nt.links.new(next(s for s in mix.outputs if s.identifier == "Result_Color"), base)
    _tinted[key] = m
    return m


# ----------------------------------------------------------------------------- modèles du pack

_templates: dict = {}


def template(name: str):
    if name not in _templates:
        with bpy.data.libraries.load(str(BLENDS / f"{name}.blend")) as (src, dst):
            dst.objects = list(src.objects)
        meshes = [o for o in dst.objects if o is not None and o.type == "MESH"]
        _templates[name] = meshes
    return _templates[name]


def place(coll, name: str, loc, height: float, rot: float, tint=None, squash=(1.0, 1.0)):
    """Instance d'un modèle du pack, mise à la hauteur voulue (unités de scène), posée au sol."""
    objs = template(name)
    zmax = max(o.dimensions.z for o in objs)
    s = height / zmax
    for t in objs:
        o = t.copy()
        coll.objects.link(o)
        o.location = Vector(loc)
        o.rotation_euler = (0, 0, rot)
        o.scale = (t.scale.x * s * squash[0], t.scale.y * s * squash[0], t.scale.z * s * squash[1])
        if tint is not None:
            o.data = t.data.copy()
            for i, m in enumerate(o.data.materials):
                if m is not None:
                    o.data.materials[i] = tinted(m, tint)


def scatter(rng, n, radius, min_d):
    """Positions au sol d'un bosquet : disque, espacement minimal, les plus en arrière d'abord."""
    pts = []
    tries = 0
    while len(pts) < n and tries < 4000:
        tries += 1
        a, r = rng.uniform(0, math.tau), radius * math.sqrt(rng.random())
        p = (r * math.cos(a), r * math.sin(a) * 0.8)
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > min_d * min_d for q in pts):
            pts.append(p)
    return sorted(pts, key=lambda p: -p[1])


# ----------------------------------------------------------------------------- modèles procéduraux


def srgb_to_linear(c):
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def color_mesh(obj, fn, glow_fn=None):
    """Couleurs choisies en sRGB (comme sur une palette), converties en linéaire pour le rendu."""
    me = obj.data
    layer = me.color_attributes.new("Pigment", "FLOAT_COLOR", "POINT")
    glow = me.color_attributes.new("Lueur", "FLOAT_COLOR", "POINT") if glow_fn else None
    for v in me.vertices:
        layer.data[v.index].color = (*srgb_to_linear(fn(v.co, v.normal)), 1.0)
        if glow:
            glow.data[v.index].color = (*glow_fn(v.co), 1.0)


def heightfield(coll, name, fn, size=1.3, n=64):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=n, y_segments=n, size=size)
    for v in bm.verts:
        v.co.z = fn(v.co.x, v.co.y)
    # Retire la jupe plate (z = 0) : elle se confondrait avec le plan qui reçoit les ombres.
    flat = [f for f in bm.faces if all(v.co.z < 0.004 for v in f.verts)]
    bmesh.ops.delete(bm, geom=flat, context="FACES")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def mountain(coll, seed: int, snowy: bool, mesa: bool = False):
    rng = random.Random(seed)
    peaks = [(0.0, 0.05, 1.0, 0.95)]
    for _ in range(rng.randint(1, 3)):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.45, 0.7)
        peaks.append((d * math.cos(a), d * math.sin(a) * 0.7, rng.uniform(0.45, 0.72), rng.uniform(0.5, 0.7)))
    off = Vector((seed * 7.1, seed * 3.3, 0))

    def h(x, y):
        z = 0.0
        for px, py, ph, pr in peaks:
            r = math.hypot(x - px, y - py) / pr
            z = max(z, ph * max(0.0, 1 - r) ** 1.25)
        ridge = 1 - abs(noise.noise(Vector((x * 3.2, y * 3.2, 0)) + off))
        ridge2 = 1 - abs(noise.noise(Vector((x * 7.5, y * 7.5, 0)) + off * 1.7))
        z *= 0.7 + 0.32 * ridge + 0.12 * ridge2
        if mesa:
            z = min(z, 0.55) * (1.0 + 0.04 * noise.noise(Vector((x * 9, y * 9, 0)) + off))
        edge = max(0.0, 1 - (math.hypot(x, y) / 1.25) ** 6)
        return 1.35 * z * edge

    ob = heightfield(coll, f"Montagne {seed}", h)
    snow_line = 0.78 + 0.1 * rng.random()
    rock = (0.66, 0.47, 0.42) if snowy else ((0.78, 0.52, 0.34) if mesa else (0.62, 0.5, 0.38))

    def col(co, n):
        z = co.z / 1.35
        jitter = 0.06 * noise.noise(co * 6 + off)
        c = rock
        c = tuple(x * (0.86 + 0.22 * max(0.0, n.z)) for x in c)  # pigment un peu plus clair sur les replats
        if z < 0.1 + jitter and not mesa:
            c = mix((0.42, 0.58, 0.3), c, (z - 0.02) / 0.1)  # pied verdoyant
        if mesa:
            band = 0.5 + 0.5 * math.sin(co.z * 38 + jitter * 20)
            c = mix(c, (0.86, 0.66, 0.46), 0.35 * band)
        if snowy and z > snow_line * 0.62 + jitter:
            c = mix(c, (0.97, 0.97, 1.0), (z - snow_line * 0.62 - jitter) / 0.06)
        return c

    color_mesh(ob, col, lambda co: (0, 0, 0))
    ob.data.materials.append(ROCK_MAT)


def volcano(coll, seed: int):
    rng = random.Random(seed)
    off = Vector((seed * 5.3, seed * 1.7, 0))
    crater_r = rng.uniform(0.17, 0.24)

    def h(x, y):
        r = math.hypot(x, y)
        cone = 1.7 * max(0.0, 1 - (r / 1.1)) ** 1.25
        lip = 1.7 * max(0.0, 1 - crater_r / 1.1) ** 1.25
        z = min(cone, lip)
        if r < crater_r:
            z = lip - 0.22 * (1 - (r / crater_r) ** 2)
        z *= 1 + 0.06 * noise.noise(Vector((x * 5, y * 5, 0)) + off)
        return z * max(0.0, 1 - (r / 1.2) ** 8)

    ob = heightfield(coll, f"Volcan {seed}", h, n=80)
    green = rng.random() < 0.5

    def col(co, n):
        r = math.hypot(co.x, co.y)
        stripe = 0.92 + 0.08 * math.sin(math.atan2(co.y, co.x) * 13 + 4 * noise.noise(co * 3 + off))
        c = tuple(x * stripe for x in (0.5, 0.4, 0.35))
        if co.z > 1.05:
            c = mix(c, (0.62, 0.55, 0.5), (co.z - 1.05) / 0.3)  # cendres claires vers le sommet
        if green and co.z < 0.3:
            c = mix((0.4, 0.56, 0.28), c, co.z / 0.3)
        if r < crater_r * 1.05:
            c = (0.75, 0.24, 0.08)
        return c

    def glow(co):
        r = math.hypot(co.x, co.y)
        return (1.0, 0.32, 0.06) if r < crater_r * 0.9 else (0, 0, 0)

    color_mesh(ob, col, glow)
    ob.data.materials.append(ROCK_MAT)


def puffs(coll, seed: int, n: int, spread, base_r, color, flatten=0.55, z0=0.0):
    rng = random.Random(seed)
    parts = []
    for i in range(n):
        x = rng.uniform(-spread[0], spread[0])
        y = rng.uniform(-spread[1], spread[1])
        r = base_r * rng.uniform(0.65, 1.15) * (1 - 0.45 * abs(x) / max(spread[0], 1e-6))
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=r, location=(x, y, z0 + r * 0.55 + rng.uniform(0, 0.12)))
        o = bpy.context.object
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        parts.append(o)
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    ob = parts[0]
    for v in ob.data.vertices:  # dessous aplati, comme un nuage peint
        if v.co.z < z0 + base_r * 0.25:
            v.co.z = z0 + base_r * 0.25 - (z0 + base_r * 0.25 - v.co.z) * (1 - flatten)
    for p in ob.data.polygons:
        p.use_smooth = True
    color_mesh(ob, lambda co, nn: color)
    ob.data.materials.append(SOFT_MAT)


# ----------------------------------------------------------------------------- compositions

TROPIC = (0.62, 0.86, 0.55)
PALM = (0.62, 0.9, 0.5)
BOREAL_T = (0.42, 0.66, 0.56)
SAVANNA_T = (1.0, 0.92, 0.55)
DRY_ROCK = (1.3, 1.05, 0.78)
TUNDRA_T = (0.55, 0.68, 0.6)


def grove(coll, rng, names, n, radius, height, tint=None, min_d=0.32, squash=(1, 1)):
    for (x, y) in scatter(rng, n, radius, min_d):
        name = rng.choice(names)
        h = height * rng.uniform(0.8, 1.15)
        t = tint(name) if callable(tint) else tint
        place(coll, name, (x, y, 0), h, rng.uniform(0, math.tau), t, squash)


def build(cat: str, seed: int, coll):
    rng = random.Random(seed * 97 + len(cat))
    if cat == "forest_tropical":
        grove(coll, rng, [f"PalmTree_{i}" for i in range(1, 6)] + [f"NormalTree_{i}" for i in range(1, 6)], rng.randint(6, 8), 0.75, 1.0,
              lambda n: PALM if n.startswith("Palm") else TROPIC, min_d=0.3)
        grove(coll, rng, ["Bush_Large", "Bush"], 3, 0.8, 0.3, TROPIC, min_d=0.25)
    elif cat == "forest_temperate":
        names = [f"NormalTree_{i}" for i in range(1, 6)] + [f"BirchTree_{i}" for i in range(1, 4)]
        if seed % 2 == 0:
            names += ["MapleTree_1", "MapleTree_3"]
        grove(coll, rng, names, rng.randint(5, 7), 0.7, 1.0, min_d=0.34)
        grove(coll, rng, ["Bush", "Bush_Flowers"], 2, 0.8, 0.28, min_d=0.25)
    elif cat == "forest_boreal":
        grove(coll, rng, [f"PineTree_{i}" for i in range(1, 6)], rng.randint(7, 9), 0.72, 1.05, BOREAL_T, min_d=0.26)
    elif cat == "savanna":
        place(coll, f"NormalTree_{rng.randint(1, 5)}", (rng.uniform(-0.15, 0.15), 0.1, 0), 0.75, rng.uniform(0, 6), SAVANNA_T, squash=(1.5, 0.75))
        grove(coll, rng, ["Bush_Small", "Bush", "Grass_Large"], 3, 0.45, 0.26, SAVANNA_T, min_d=0.28)
    elif cat == "meadow":
        grove(coll, rng, ["Bush_Flowers", "Bush_Large_Flowers", "Bush_Small_Flowers", "Bush", "Bush_Large"], rng.randint(4, 5), 0.34, 0.55, min_d=0.28)
    elif cat == "desert":
        grove(coll, rng, [f"Rock_{i}" for i in range(1, 6)], rng.randint(2, 4), 0.34, 0.6, DRY_ROCK, min_d=0.28)
        if seed == 0:
            place(coll, "DeadTree_3", (0.12, 0.12, 0), 0.75, 1.0, (1.1, 0.95, 0.8))
    elif cat == "tundra":
        grove(coll, rng, [f"PineTree_{i}" for i in range(1, 6)], rng.randint(2, 3), 0.32, 0.65, TUNDRA_T, min_d=0.26)
        grove(coll, rng, [f"Rock_{i}" for i in range(1, 6)], 2, 0.38, 0.26, (0.85, 0.85, 0.85), min_d=0.26)
    elif cat == "mountain_snow":
        mountain(coll, seed, snowy=True)
    elif cat == "mountain_rock":
        mountain(coll, seed + 50, snowy=False)
    elif cat == "mesa":
        mountain(coll, seed + 80, snowy=False, mesa=True)
    elif cat == "volcano":
        volcano(coll, seed)
    elif cat == "smoke":
        puffs(coll, seed, 5, (0.3, 0.15), 0.32, (0.86, 0.85, 0.83), flatten=0.2)
    elif cat == "cloud":
        puffs(coll, seed, rng.randint(6, 9), (0.85, 0.3), 0.4, (0.98, 0.98, 1.0))


CELLS = (
    [("forest_tropical", s) for s in range(4)] + [("forest_temperate", s) for s in range(4)]
    + [("forest_boreal", s) for s in range(4)] + [("savanna", s) for s in range(3)]
    + [("meadow", s) for s in range(3)] + [("desert", s) for s in range(3)]
    + [("tundra", s) for s in range(3)] + [("mountain_snow", s) for s in range(4)]
    + [("mountain_rock", s) for s in range(4)] + [("mesa", s) for s in range(2)] + [("volcano", s) for s in range(3)]
    + [("smoke", s) for s in range(2)] + [("cloud", s) for s in range(4)]
)
FLOATING = {"smoke", "cloud"}

# ----------------------------------------------------------------------------- cadrage et rendu


def camera_space(objs):
    """Coordonnées (x, y) dans le plan de l'image, relatives au point d'ancrage (origine au sol)."""
    inv = cam.matrix_world.inverted()
    origin = inv @ Vector((0, 0, 0))
    pts = []
    deps = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        mw = o.matrix_world
        step = max(1, len(me.vertices) // 3000)
        for i in range(0, len(me.vertices), step):
            v = me.vertices[i]
            p = inv @ (mw @ v.co)
            pts.append((p.x - origin.x, p.y - origin.y))
        ev.to_mesh_clear()
    return pts


colls = {}
for cat, seed in CELLS:
    name = f"{cat}_{seed}"
    if ONLY and cat not in ONLY:
        continue
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    build(cat, seed, c)
    colls[name] = (cat, seed, c)

D = 30.0
cam.location = Vector((0, -math.cos(ELEV) * D, math.sin(ELEV) * D))
bpy.context.view_layer.update()

# Échelle commune à une catégorie : les variantes gardent leurs tailles relatives.
extent: dict = {}
for name, (cat, seed, c) in colls.items():
    pts = camera_space(c.all_objects)
    floating = cat in FLOATING
    piv = 0.5 if floating else PIVOT_Y
    half_w = max(abs(p[0]) for p in pts)
    top = max(p[1] for p in pts)
    bottom = -min(p[1] for p in pts)
    s = max(2 * half_w, top / (1 - piv), bottom / piv) * (1.08 if floating else 1.2)
    extent[cat] = max(extent.get(cat, 0.0), s)

manifest = []
for name, (cat, seed, c) in colls.items():
    for other in colls.values():
        other[2].hide_render = other[2] is not c
    catcher.hide_render = cat in FLOATING
    piv = 0.5 if cat in FLOATING else PIVOT_Y
    S = extent[cat]
    cam_data.ortho_scale = S
    # Décale la caméra dans son plan pour placer l'origine au point d'ancrage.
    right = cam.matrix_world.to_3x3() @ Vector((1, 0, 0))
    up = cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
    cam.location = Vector((0, -math.cos(ELEV) * D, math.sin(ELEV) * D)) + up * (S * (0.5 - piv))
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    manifest.append({"name": name, "category": cat, "pivot": [0.5, piv], "scale": S})
    print("VIGNETTE", name, round(S, 3), flush=True)

prev = OUT / "cells.json"
old = json.loads(prev.read_text()) if prev.exists() and ONLY else []
keep = [m for m in old if m["name"] not in {x["name"] for x in manifest}]
prev.write_text(json.dumps(keep + manifest, indent=1))
