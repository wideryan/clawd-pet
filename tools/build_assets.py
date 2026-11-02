"""把 clawd-400 的 GIF 转成 assets/*.svg，并生成 hooks/catalog.ts。

桌面端在 isInteractive 模式下不允许 <image>，所以每一帧都画成路径：相邻帧相同的像素
放进静态层，只有变化的像素进帧层，用 visibility 的离散动画切换。

用法: build_assets.py <gif目录> <manifest.json> <mod目录>
需要 Pillow。GIF 与 manifest 来自 https://github.com/khiqwq/clawd-400
"""
import json
import os
import sys

from PIL import Image

SCALE = 12
GRID = 40
MAX_CHARS = 90000  # Client 的 props 与绘制树上限都是 100000 字符


def load_frames(path):
    """读 GIF，返回 (每帧 40×40 的不透明像素表, 每帧毫秒数)。"""
    im = Image.open(path)
    frames, durations = [], []
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        rgba = im.convert("RGBA")
        if rgba.size != (GRID * SCALE, GRID * SCALE):
            raise ValueError(f"{path}: unexpected size {rgba.size}")
        px = rgba.load()
        frame = {}
        for y in range(GRID):
            for x in range(GRID):
                r, g, b, a = px[x * SCALE + SCALE // 2, y * SCALE + SCALE // 2]
                if a >= 128:
                    frame[(x, y)] = (r, g, b)
        frames.append(frame)
        durations.append(im.info.get("duration", 100) or 100)
    return frames, durations


def merge_same(frames, durations):
    """合并连续相同的帧，时长累加。"""
    out_f, out_d = [], []
    for f, d in zip(frames, durations):
        if out_f and out_f[-1] == f:
            out_d[-1] += d
        else:
            out_f.append(f)
            out_d.append(d)
    return out_f, out_d


def color_hex(c):
    s = "%02x%02x%02x" % c
    if s[0] == s[1] and s[2] == s[3] and s[4] == s[5]:
        s = s[0] + s[2] + s[4]
    return "#" + s


def paths(pixels):
    """{(x,y):rgb} → 每色一条用 1 像素高水平线段表示的 stroke 路径。"""
    by_color = {}
    for (x, y), c in pixels.items():
        by_color.setdefault(c, []).append((y, x))
    out = []
    for c, pts in sorted(by_color.items()):
        pts.sort()
        d, cx, cy, i = [], 0, 0, 0
        while i < len(pts):
            y, x = pts[i]
            j = i + 1
            while j < len(pts) and pts[j] == (y, pts[j - 1][1] + 1):
                j += 1
            d.append(f"m{x - cx} {y - cy}h{j - i}")
            cx, cy = x + (j - i), y
            i = j
        out.append(f'<path stroke="{color_hex(c)}" d="{"".join(d).replace(" -", "-")}"/>')
    return "".join(out)


def build_svg(frames, durations):
    static = dict(frames[0])
    for f in frames[1:]:
        for k in list(static):
            if f.get(k) != static[k]:
                del static[k]
    total = sum(durations)
    # 整张图下移，让最低的像素贴住画布底边：Clawd 才是站在输入框上，而不是飘着
    ground = max((y for f in frames for (_, y) in f), default=GRID - 1)
    drop = GRID - 1 - ground
    body = [paths(static)]
    if len(frames) > 1:
        t = 0
        for f, d in zip(frames, durations):
            layer = {k: v for k, v in f.items() if k not in static}
            a, b = t / total, (t + d) / total
            t += d
            if not layer:
                continue
            if b >= 0.99999:
                values, times = ("visible", "0") if a == 0 else ("hidden;visible", f"0;{a:.4g}")
            elif a == 0:
                values, times = "visible;hidden", f"0;{b:.4g}"
            else:
                values, times = "hidden;visible;hidden", f"0;{a:.4g};{b:.4g}"
            body.append(
                f'<g visibility="hidden">{paths(layer)}'
                f'<animate attributeName="visibility" calcMode="discrete" values="{values}" '
                f'keyTimes="{times}" dur="{total / 1000:.4g}s" repeatCount="indefinite"/></g>'
            )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
        f'<g shape-rendering="crispEdges" stroke-width="1" fill="none" transform="translate(0 {drop + .5:g})">'
        + "".join(body)
        + "</g></svg>"
    )


def convert(path):
    frames, durations = merge_same(*load_frames(path))
    svg = build_svg(frames, durations)
    # 超过上限就隔帧抽样，时长并入保留帧，保持总时长不变
    while len(svg) > MAX_CHARS and len(frames) > 2:
        frames, durations = merge_same(
            [frames[i] for i in range(0, len(frames), 2)],
            [sum(durations[i:i + 2]) for i in range(0, len(frames), 2)],
        )
        svg = build_svg(frames, durations)
    return svg, sum(durations)


def ts_str(s):
    return json.dumps(s, ensure_ascii=False)


def main():
    gifs, manifest, mod = sys.argv[1:4]
    entries = json.load(open(manifest, encoding="utf-8"))
    assets = os.path.join(mod, "assets")
    os.makedirs(assets, exist_ok=True)
    rows = []
    biggest = 0
    for g in entries:
        stem = os.path.splitext(os.path.basename(g["file"]))[0]
        svg, ms = convert(os.path.join(gifs, stem + ".gif"))
        biggest = max(biggest, len(svg))
        with open(os.path.join(assets, stem + ".svg"), "w", encoding="utf-8", newline="") as f:
            f.write(svg)
        rows.append(
            f"  {{ n: {g['n']}, stem: {ts_str(stem)}, zh: {ts_str(g['zh'])}, en: {ts_str(g['en'])}, ms: {ms} }},"
        )
    catalog = (
        "// 由 tools/build_assets.py 生成，不要手改。\n"
        "export type Gif = { n: number; stem: string; zh: string; en: string; ms: number }\n\n"
        "export const CATALOG: readonly Gif[] = [\n" + "\n".join(rows) + "\n]\n"
    )
    with open(os.path.join(mod, "hooks", "catalog.ts"), "w", encoding="utf-8", newline="\n") as f:
        f.write(catalog)
    print("gifs", len(rows), "biggest svg", biggest)


if __name__ == "__main__":
    main()
