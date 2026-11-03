from io import BytesIO
from pathlib import Path
import struct

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build"
source_path = ROOT / "src" / "app-icon.png"
source = Image.open(source_path).convert("RGBA")
size = source.width

# The supplied SVG is a square rounded-corner tile. Keep its corners transparent
# when the browser rasterizes it against a white page background.
mask_scale = 4
mask = Image.new("L", (size * mask_scale, size * mask_scale), 0)
radius = round(size * (81 / 413) * mask_scale)
ImageDraw.Draw(mask).rounded_rectangle(
    (0, 0, size * mask_scale - 1, size * mask_scale - 1),
    radius=radius,
    fill=255,
)
source.putalpha(mask.resize((size, size), Image.Resampling.LANCZOS))
source.save(source_path, format="PNG", optimize=True)

linux_icon = source.resize((512, 512), Image.Resampling.LANCZOS)
linux_icon.save(BUILD_DIR / "icon.png", format="PNG", optimize=True)
source.resize((256, 256), Image.Resampling.LANCZOS).save(
    BUILD_DIR / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

chunks = []
for chunk_type, icon_size in zip(
    ("icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"),
    (16, 32, 64, 128, 256, 512, 1024),
):
    image_buffer = BytesIO()
    source.resize((icon_size, icon_size), Image.Resampling.LANCZOS).save(image_buffer, format="PNG")
    payload = image_buffer.getvalue()
    chunks.append(chunk_type.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload)

icns_data = b"icns" + struct.pack(">I", 8 + sum(map(len, chunks))) + b"".join(chunks)
(BUILD_DIR / "icon.icns").write_bytes(icns_data)
