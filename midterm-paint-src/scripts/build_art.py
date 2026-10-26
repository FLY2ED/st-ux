"""paint-art/ 의 생성 원본을 잘라 src/assets 에 잉크만 남긴 webp 로 저장한다.

흰 종이는 투명하게, 선은 검정으로 바꿔서 어떤 바탕(종이, 형광펜) 위에도 얹을 수 있게 한다.
실행: uv run --with pillow python scripts/build_art.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
ART = ROOT / 'paint-art'
OUT = ROOT / 'midterm-paint-src' / 'src' / 'assets'
OUT.mkdir(exist_ok=True)


def ink(img, keep_color=False):
    """흰색은 투명, 어두울수록 진한 잉크"""
    rgb = img.convert('RGB')
    gray = ImageOps.grayscale(rgb)
    alpha = gray.point(lambda v: 0 if v > 238 else min(255, int((255 - v) * 1.25)))
    base = rgb if keep_color else Image.new('RGB', rgb.size, (27, 27, 27))
    base.putalpha(alpha)
    return base


def sprite(img):
    """바깥 흰 바탕만 투명하게. 선 안쪽의 흰 칸(간판 판, 몸통)은 스티커처럼 그대로 남긴다"""
    rgba = ImageOps.expand(img.convert('RGB'), 4, (255, 255, 255)).convert('RGBA')
    ImageDraw.floodfill(rgba, (0, 0), (255, 255, 255, 0), thresh=70)
    return rgba.crop((4, 4, rgba.width - 4, rgba.height - 4))


def trim(img, pad=8):
    box = img.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    if not box:
        return img
    l, t, r, b = box
    return img.crop((max(0, l - pad), max(0, t - pad), min(img.width, r + pad), min(img.height, b + pad)))


def grid(name, cols, rows, names, size, keep_color=False, mode='ink'):
    src = Image.open(ART / name)
    cw, ch = src.width / cols, src.height / rows
    for i, n in enumerate(names):
        if not n:
            continue
        c, r = i % cols, i // cols
        cell = src.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
        out = trim(sprite(cell) if mode == 'sprite' else ink(cell, keep_color))
        out.thumbnail((size, size), Image.LANCZOS)
        out.save(OUT / f'{n}.webp', quality=88, method=6)
        print(n, out.size)


def whole(name, out, width, keep_color=False):
    src = Image.open(ART / name)
    img = trim(ink(src, keep_color), 2)
    img.thumbnail((width, width * 4), Image.LANCZOS)
    img.save(OUT / f'{out}.webp', quality=88, method=6)
    print(out, img.size)


grid('char-sheet.png', 3, 2, ['face-happy', 'face-shock', 'face-panic', 'face-proud', 'face-sleepy', 'face-think'], 360)
grid('icons.png', 3, 3, ['doodle-fame', 'doodle-kkeut', 'doodle-near', 'doodle-open', 'doodle-map', 'doodle-world', 'doodle-twins', 'doodle-highlow', 'doodle-building'], 200)
whole('street.png', 'street-row', 1600)
if (ART / 'shop-front.png').exists():
    whole('shop-front.png', 'shop-front', 420)
if (ART / 'npc-sheet.png').exists():
    grid('npc-sheet.png', 5, 1, ['npc-snack', 'npc-busker', 'npc-office', 'npc-print', 'npc-prof'], 320)

# 오프닝 4컷: 컷마다 잘라 둔다 (글씨가 그림에 들어 있어 색은 그대로)
src = Image.open(ART / 'c2-intro4cut.png').convert('RGB')
w, h = src.size
for i in range(4):
    c, r = i % 2, i // 2
    cell = src.crop((int(c * w / 2), int(r * h / 2), int((c + 1) * w / 2), int((r + 1) * h / 2)))
    cell = trim(ink(cell, True), 0)
    cell.thumbnail((640, 640), Image.LANCZOS)
    cell.save(OUT / f'intro-{i + 1}.webp', quality=86, method=6)
    print('intro', i + 1, cell.size)


# 공책 화면: 그림 그대로(종이까지) 쓴다
def flat(name, out, width, box=None):
    src = Image.open(ART / name).convert('RGB')
    if box:
        w, h = src.size
        src = src.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    src.thumbnail((width, width * 4), Image.LANCZOS)
    src.save(OUT / f'{out}.webp', quality=84, method=6)
    print(out, src.size)


def cut(name, out, width, box):
    src = Image.open(ART / name).convert('RGB')
    w, h = src.size
    img = trim(sprite(src.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))), 2)
    img.thumbnail((width, width * 4), Image.LANCZOS)
    img.save(OUT / f'{out}.webp', quality=88, method=6)
    print(out, img.size)


def have(name):
    return (ART / name).exists()


if have('home-spread.png'):
    flat('home-spread.png', 'home', 1920)
if have('cover.png'):
    flat('cover.png', 'cover', 1000)
if have('paper-page.png'):
    flat('paper-page.png', 'paper-page', 1200)
if have('scratch.png'):
    cut('scratch.png', 'ticket', 1000, (0, 0, 0.66, 1))
    flat('scratch.png', 'foil', 400, (0.7, 0.26, 0.95, 0.76))
icons = 'icons3.png' if have('icons3.png') else 'icons2.png'
if have(icons):
    grid(icons, 3, 3, ['game-rain', 'game-dodge', 'game-scratch', 'game-booth', 'game-song', 'game-near', 'game-building', 'game-world', 'game-open'], 280, mode='sprite')
if have('char-full.png'):
    grid('char-full.png', 3, 1, ['me-wave', 'me-point', 'me-note'], 520, mode='sprite')
if have('char-act.png'):
    grid('char-act.png', 3, 1, ['me-run', 'me-eat', 'me-sing'], 520, mode='sprite')
if have('signs.png'):
    grid('signs.png', 1, 4, ['sign-plain', 'sign-hl', 'sign-awning', 'sign-broken'], 640, mode='sprite')
if have('booth-frame.png'):
    flat('booth-frame.png', 'booth-frame', 700)
if have('stage.png'):
    flat('stage.png', 'stage', 1600)
if have('prologue-1.png'):
    flat('prologue-1.png', 'prologue', 1086)
