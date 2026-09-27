"""src-tauri/icons/ をアイコンの SVG から作り直す。

3 つの SVG を使い分ける。1024px の絵をそのまま 16px に縮めると稲妻が潰れるので、
小さいサイズには要素を減らした絵を当てる（Windows は ICO の中から表示サイズに
近い絵を選ぶ）。

  icon.svg        64px 以上と PNG/ICNS 全般（完全版）
  icon-small.svg  32px・48px（帯と稲妻だけ）
  icon-tiny.svg   16px・24px（カードと帯を背景に、稲妻を大きく）

`tauri icon` は 1 枚の元絵からしか生成できないので、3 回走らせて ICO を組み直す。
要 Pillow（pip install pillow）。実行: python scripts/make-icons.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
TIERS = {  # ICO に入れるサイズ → 元絵
    16: "icon-tiny.svg", 24: "icon-tiny.svg",
    32: "icon-small.svg", 48: "icon-small.svg",
    64: "icon.svg", 256: "icon.svg",
}


def generate(svg: Path, out: Path) -> None:
    npx = "npx.cmd" if os.name == "nt" else "npx"
    # tauri icon は生成した全ファイル（iOS/Android 分も）を stderr に列挙するので黙らせる
    subprocess.run([npx, "tauri", "icon", str(svg), "-o", str(out)], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ico_frames(path: Path) -> dict[int, Image.Image]:
    im = Image.open(path)
    frames = {}
    for size in im.info.get("sizes", []):
        im.size = size
        im.load()
        frames[size[0]] = im.copy().convert("RGBA")
    return frames


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        outs = {}
        for name in sorted(set(TIERS.values())):
            out = Path(tmp) / name.removesuffix(".svg")
            generate(ICONS / name, out)
            outs[name] = out
        full = outs["icon.svg"]
        # PNG / ICNS は完全版。64x64.png は tauri.conf.json が参照しないので置かない
        for f in full.iterdir():
            if f.suffix in (".png", ".icns") and f.name != "64x64.png":
                shutil.copy(f, ICONS / f.name)
        # ウィンドウアイコン（32x32.png）は小サイズ用の絵
        ico_frames(outs["icon-small.svg"] / "icon.ico")[32].save(ICONS / "32x32.png")
        # ICO は 3 段構えで組み直す
        frames = {size: ico_frames(outs[src] / "icon.ico")[size] for size, src in TIERS.items()}
        largest = max(frames)
        frames[largest].save(
            ICONS / "icon.ico", format="ICO",
            sizes=[(s, s) for s in frames],
            append_images=[frames[s] for s in sorted(frames) if s != largest],
        )
    print("icons written:", sorted(ico_frames(ICONS / "icon.ico")))


if __name__ == "__main__":
    sys.exit(main())
