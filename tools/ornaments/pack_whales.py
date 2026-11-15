"""
Assemble l'atlas des silhouettes peintes des cétacés : data/ornaments/whales.png et whales.json.

    blender -b --factory-startup -noaudio --python tools/ornaments/render_whales.py -- <dossier>
    python3 tools/ornaments/pack_whales.py <dossier>

Une ligne par espèce, quatre cases de 512×256 : couleur (tête à droite), masque, couleur (tête à gauche), masque.
La couleur est prémultipliée par l'alpha. Le masque est la silhouette élargie et adoucie : l'application y lit
le liseré de couleur de l'espèce, le halo de l'appel et l'ombre portée (client/src/whales/glyphs.ts).
`scale` [A] : taille relative à l'écran, pour suggérer l'ordre des tailles sans prétendre à une échelle.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parents[2] / "data" / "ornaments"
CELL = (512, 256)
SPECIES = {"blue": 1.0, "fin": 0.94, "humpback": 0.86, "sperm": 0.9, "orca": 0.72}

atlas = Image.new("RGBA", (CELL[0] * 4, CELL[1] * len(SPECIES)), (0, 0, 0, 0))
for row, sp in enumerate(SPECIES):
    for col, tag in enumerate("rl"):
        a = np.asarray(Image.open(SRC / f"whale-{sp}-{tag}.png").convert("RGBA")).astype(np.float32) / 255
        premult = np.concatenate([a[..., :3] * a[..., 3:], a[..., 3:]], axis=2)
        small = Image.fromarray((premult * 255 + 0.5).astype(np.uint8), "RGBA").resize(CELL, Image.LANCZOS)
        atlas.paste(small, (col * 2 * CELL[0], row * CELL[1]))
        # Masque : silhouette élargie (flou large, renforcé), puis adoucie.
        alpha = small.getchannel("A")
        wide = alpha.filter(ImageFilter.GaussianBlur(9)).point(lambda v: min(255, int(v * 2.6)))
        mask = wide.filter(ImageFilter.GaussianBlur(3))
        # Alpha nul : à petite taille (mipmaps), le bord d'une case de masque ne déteint pas sur sa voisine.
        atlas.paste(Image.merge("RGBA", (mask, mask, mask, Image.new("L", CELL, 0))), ((col * 2 + 1) * CELL[0], row * CELL[1]))

OUT.mkdir(parents=True, exist_ok=True)
atlas.save(OUT / "whales.png", optimize=True)
(OUT / "whales.json").write_text(json.dumps({
    "cell": list(CELL),
    "columns": ["droite", "masque droite", "gauche", "masque gauche"],
    "species": {sp: {"row": row, "scale": scale} for row, (sp, scale) in enumerate(SPECIES.items())},
}, indent=1) + "\n")
print(f"whales.png {atlas.size[0]}×{atlas.size[1]}, {(OUT / 'whales.png').stat().st_size // 1024} Ko")
