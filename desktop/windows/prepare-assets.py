from argparse import ArgumentParser
from pathlib import Path

from PIL import Image


def main():
    parser = ArgumentParser()
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    assets = Path(__file__).resolve().parents[2] / "lib" / "assets"
    args.output.mkdir(parents=True, exist_ok=True)
    for pose in ("idle", "blink", "curious", "happy"):
        with Image.open(assets / f"maid-{pose}.webp") as source:
            frame = source.convert("RGBA")
        frame.thumbnail((360, 390), Image.Resampling.LANCZOS)
        frame.save(args.output / f"{pose}.png", optimize=True)
        if pose == "idle":
            icon = Image.new("RGBA", (64, 64))
            frame.thumbnail((60, 60), Image.Resampling.LANCZOS)
            icon.alpha_composite(frame, ((64 - frame.width) // 2, (64 - frame.height) // 2))
            icon.save(args.output / "pet.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)])


if __name__ == "__main__":
    main()
