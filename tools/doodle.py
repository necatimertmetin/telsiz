# Sohbet arka planı için dikişsiz doodle deseni üretir (src/ui/doodle-line.svg, doodle-tone.svg).
# Çalıştır: python tools/doodle.py   (sabit tohum: her çalıştırmada aynı çıktı)
import math, random, sys

W = H = 520
SW = 3
rnd = random.Random(7)

def f(v): return f'{v:.1f}'.rstrip('0').rstrip('.')

def blob(r, n=9, wob=.22):
    pts = []
    for i in range(n):
        a = i / n * math.tau
        rr = r * (1 - wob / 2 + rnd.random() * wob)
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    return smooth(pts)

def smooth(pts, closed=True):
    n = len(pts)
    d = f'M{f(pts[0][0])} {f(pts[0][1])}'
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n] if closed or i > 0 else pts[0]
        p1, p2 = pts[i], pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if closed or i + 2 < n else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f'C{f(c1[0])} {f(c1[1])} {f(c2[0])} {f(c2[1])} {f(p2[0])} {f(p2[1])}'
    return d + ('Z' if closed else '')

class Ctx:
    def __init__(s, tone): s.tone, s.out = tone, []
    def path(s, d, fill=0.0, solid=False):
        if solid: s.out.append(f'<path d="{d}" fill="#000"/>'); return
        a = f' fill="#000" fill-opacity="{fill:.2f}"' if s.tone and fill else ''
        s.out.append(f'<path d="{d}"{a}/>')
    def circle(s, x, y, r, fill=0.0, solid=False):
        if solid: s.out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" fill="#000" stroke="none"/>'); return
        a = f' fill="#000" fill-opacity="{fill:.2f}"' if s.tone and fill else ''
        s.out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}"{a}/>')
    def line(s, x1, y1, x2, y2): s.out.append(f'<path d="M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}"/>')

def tone(): return rnd.choice([.16, .24, .32, .45])

def eyes(c, r, y, n=None):
    n = n or rnd.choice([1, 2, 2, 2, 3])
    er = r * (.24 if n == 1 else .17)
    xs = [0] if n == 1 else [-r * .3, r * .3] if n == 2 else [-r * .42, 0, r * .42]
    for x in xs:
        yy = y + (rnd.random() - .5) * r * .1
        c.circle(x, yy, er)
        kind = rnd.random()
        if kind < .7: c.circle(x + er * .25, yy + er * .15, er * .45, solid=True)
        elif kind < .85: c.line(x - er * .6, yy, x + er * .6, yy)
        else: c.path(f'M{f(x - er*.6)} {f(yy + er*.2)}Q{f(x)} {f(yy - er*.7)} {f(x + er*.6)} {f(yy + er*.2)}')

def mouth(c, r, y):
    k = rnd.randrange(5)
    w = r * (.35 + rnd.random() * .25)
    if k == 0: c.path(f'M{f(-w)} {f(y)}Q0 {f(y + r*.35)} {f(w)} {f(y)}')
    elif k == 1:
        c.path(f'M{f(-w)} {f(y)}Q0 {f(y + r*.5)} {f(w)} {f(y)}Z', solid=True)
    elif k == 2:
        h = r * .2
        c.path(f'M{f(-w)} {f(y)}h{f(2*w)}v{f(h)}h{f(-2*w)}Z')
        for i in range(1, 4): c.line(-w + 2 * w * i / 4, y, -w + 2 * w * i / 4, y + h)
    elif k == 3:
        pts = ' '.join(f'{"M" if i == 0 else "L"}{f(-w + 2*w*i/6)} {f(y + (r*.14 if i % 2 else 0))}' for i in range(7))
        c.path(pts)
    else:
        c.path(f'M{f(-w)} {f(y)}Q0 {f(y + r*.3)} {f(w)} {f(y)}')
        c.path(f'M{f(w*.1)} {f(y + r*.12)}q{f(r*.12)} {f(r*.35)} {f(r*.22)} 0', fill=.4)

def monster(c, r):
    c.path(blob(r * .86), fill=tone())
    extra = rnd.random()
    if extra < .3:
        for sx in (-1, 1):
            c.path(f'M{f(sx*r*.35)} {f(-r*.7)}L{f(sx*r*.55)} {f(-r*1.05)}L{f(sx*r*.62)} {f(-r*.6)}', fill=.3)
    elif extra < .55:
        x = (rnd.random() - .5) * r * .6
        c.path(f'M{f(x)} {f(-r*.8)}q{f(r*.15)} {f(-r*.2)} {f(r*.05)} {f(-r*.35)}')
        c.circle(x + r * .05, -r * 1.2, r * .08, solid=True)
    elif extra < .75:
        for sx in (-1, 1):
            c.path(f'M{f(sx*r*.8)} {f(r*.1)}q{f(sx*r*.3)} {f(r*.1)} {f(sx*r*.25)} {f(r*.4)}')
    eyes(c, r, -r * .18)
    mouth(c, r, r * .25)

def ghost(c, r):
    w = r * .7
    d = f'M{f(-w)} {f(r*.6)}V{f(-r*.1)}A{f(w)} {f(w)} 0 0 1 {f(w)} {f(-r*.1)}V{f(r*.6)}'
    for i in range(4): d += f'q{f(-w/4)} {f(-r*.25 if i % 2 else r*.25)} {f(-w/2)} 0'
    c.path(d + 'Z', fill=tone())
    eyes(c, r, -r * .15, 2)
    c.circle(0, r * .25, r * .1, solid=True)

def eyeball(c, r):
    c.circle(0, 0, r * .8, fill=.0)
    c.circle(r * .15, r * .05, r * .4, fill=tone())
    c.circle(r * .2, r * .08, r * .18, solid=True)
    for a in (2.2, 2.8, 3.5):
        c.path(f'M{f(math.cos(a)*r*.8)} {f(math.sin(a)*r*.8)}q{f(r*.1)} {f(r*.1)} {f(math.cos(a)*r*-.25)} {f(math.sin(a)*r*-.2)}')

def flower(c, r):
    n = rnd.choice([5, 6, 7])
    for i in range(n):
        a = i / n * math.tau
        c.circle(math.cos(a) * r * .55, math.sin(a) * r * .55, r * .3, fill=.18)
    c.circle(0, 0, r * .42, fill=.4)
    c.circle(-r * .14, -r * .07, r * .05, solid=True); c.circle(r * .14, -r * .07, r * .05, solid=True)
    c.path(f'M{f(-r*.14)} {f(r*.1)}q{f(r*.14)} {f(r*.14)} {f(r*.28)} 0')

def cloud(c, r):
    d = (f'M{f(-r*.8)} {f(r*.35)}a{f(r*.3)} {f(r*.3)} 0 0 1 {f(r*.1)} {f(-r*.55)}a{f(r*.38)} {f(r*.38)} 0 0 1 {f(r*.7)} {f(-r*.2)}'
         f'a{f(r*.33)} {f(r*.33)} 0 0 1 {f(r*.6)} {f(r*.35)}a{f(r*.25)} {f(r*.25)} 0 0 1 {f(-r*.1)} {f(r*.4)}Z')
    c.path(d, fill=.16)
    c.circle(-r * .2, 0, r * .06, solid=True); c.circle(r * .2, 0, r * .06, solid=True)
    c.path(f'M{f(-r*.1)} {f(r*.15)}q{f(r*.1)} {f(r*.08)} {f(r*.2)} 0')

# Konu: telsiz, oyun, müzik.
ICONS = {
    'mic': ('M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6', 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z'),
    'head': ('M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z', 'M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z'),
    'pad': ('M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 10v4M5 12h4M15.5 11.5h.01M18 13h.01', 'M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-2a4 4 0 0 1 4-4z'),
    'radio': ('M3 9h18v11H3zM6 9l11-6M14 13h4M14 16h4M10 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M3 9h18v11H3z'),
    'bolt': ('M13 2 4 14h7l-1 8 9-12h-7z', 'M13 2 4 14h7l-1 8 9-12h-7z'),
    'note': ('M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'),
    'bubble': ('M4 5h16v11H10l-5 4v-4H4zM12 13s-3-1.8-3-3.6a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.8-3 3.6-3 3.6z', 'M12 13s-3-1.8-3-3.6a1.6 1.6 0 0 1 3-.8 1.6 1.6 0 0 1 3 .8c0 1.8-3 3.6-3 3.6z'),
    'tape': ('M3 6h18v12H3zM6 18l2-4h8l2 4M9 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM18 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM9 10h6', 'M3 6h18v12H3z'),
    'stick': ('M7 21h10v-4H7zM12 17V8M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M12 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z'),
    'crown': ('M3 18h18l1-11-6 4-4-7-4 7-6-4zM3 21h18', 'M3 18h18l1-11-6 4-4-7-4 7-6-4z'),
    'skull': ('M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zM10 20v-2M14 20v-2M9 11a1.5 1.5 0 1 0 0 .01M15 11a1.5 1.5 0 1 0 0 .01', 'M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z'),
    'tower': ('M12 10v11M8 21h8M12 10l-4 11M12 10l4 11M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M6 4a8.5 8.5 0 0 0 0 12M18 4a8.5 8.5 0 0 1 0 12', ''),
}

def icon(c, r, name):
    line, fillp = ICONS[name]
    k = r * 1.7 / 24
    c.out.append(f'<g transform="scale({k:.3f}) translate(-12 -12)" stroke-width="{SW / k:.2f}">')
    if fillp: c.path(fillp, fill=tone())
    c.path(line)
    c.out.append('</g>')

def star(c, r):
    pts = []
    for i in range(10):
        a = i / 10 * math.tau - math.pi / 2
        rr = r * (.85 if i % 2 == 0 else .38)
        pts.append(f'{"M" if i == 0 else "L"}{f(math.cos(a)*rr)} {f(math.sin(a)*rr)}')
    c.path(''.join(pts) + 'Z', fill=tone())

def squiggle(c, r):
    n = rnd.randint(3, 5)
    d = f'M{f(-r)} 0'
    for i in range(n): d += f'q{f(r/n)} {f(r*(.6 if i % 2 else -.6))} {f(2*r/n)} 0'
    c.path(d)

def sparkle(c, r):
    for a in range(4):
        t = a * math.pi / 4
        c.line(math.cos(t) * r * .3, math.sin(t) * r * .3, math.cos(t) * r, math.sin(t) * r)

def small(c, r):
    k = rnd.random()
    if k < .3: c.circle(0, 0, r * .35, solid=True)
    elif k < .5: c.circle(0, 0, r * .6, fill=.3)
    elif k < .65: sparkle(c, r)
    elif k < .8: squiggle(c, r)
    elif k < .9: c.path(f'M0 {f(-r*.7)}L{f(r*.65)} {f(r*.5)}L{f(-r*.65)} {f(r*.5)}Z', fill=.35)
    else: c.line(-r * .6, 0, r * .6, 0); c.line(0, -r * .6, 0, r * .6)

def item(c, r):
    if r < 13: return small(c, r)
    k = rnd.random()
    if r > 30:
        if k < .55: monster(c, r)
        elif k < .65: ghost(c, r)
        elif k < .73: flower(c, r)
        elif k < .8: cloud(c, r)
        else: icon(c, r, rnd.choice(list(ICONS)))
    else:
        if k < .5: icon(c, r, rnd.choice(list(ICONS)))
        elif k < .65: star(c, r)
        elif k < .78: eyeball(c, r)
        elif k < .9: monster(c, r)
        else: squiggle(c, r)

def place():
    out = []
    def free(x, y, r, pad):
        for (a, b, q) in out:
            dx = min(abs(x - a), W - abs(x - a)); dy = min(abs(y - b), H - abs(y - b))
            if math.hypot(dx, dy) < r + q + pad: return False
        return True
    for (lo, hi, tries, pad) in [(38, 56, 900, -6), (24, 36, 3000, -3), (14, 22, 6000, 0), (6, 12, 12000, 1), (3, 6, 12000, 0)]:
        for _ in range(tries):
            r = rnd.uniform(lo, hi); x = rnd.uniform(0, W); y = rnd.uniform(0, H)
            if free(x, y, r, pad): out.append((x, y, r))
    return out

def build(tone_on):
    global rnd
    rnd = random.Random(7)
    spots = place()
    body = []
    for (x, y, r) in spots:
        c = Ctx(tone_on)
        rot = rnd.uniform(-35, 35)
        item(c, r)
        g = ''.join(c.out)
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                X, Y = x + ox, y + oy
                if -r * 1.3 < X < W + r * 1.3 and -r * 1.3 < Y < H + r * 1.3:
                    body.append(f'<g transform="translate({f(X)} {f(Y)}) rotate({rot:.0f})">{g}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" fill="none" stroke="#000" '
            f'stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">{"".join(body)}</svg>')

if __name__ == '__main__':
    for name, t in (('line', False), ('tone', True)):
        s = build(t)
        open(f'src/ui/doodle-{name}.svg', 'w', encoding='utf8').write(s)
        print(name, len(s) // 1024, 'KB', file=sys.stderr)
