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

def grey(v):
    h = f'{max(0, min(255, round(v * 255))):02x}'
    return '#' + h * 3

# Çizimler üst üste biner: öndeki şeklin içi arkadakini kapatır. Bunun için çizim SVG'nin kendi
# maskesinde yapılır (siyah = boş, beyaz = çizgi, gri = ton); sonuç saydamlık olarak çıkar,
# CSS bu saydamlığı maske olarak kullanır, rengi tema verir.
class Ctx:
    def __init__(s, tone): s.tone, s.out = tone, []
    def _fill(s, fill, closed):
        if not closed: return ''
        if not (s.tone and fill): return ' fill="#000"'
        return f' fill="{grey(.88) if fill > 1 else grey(fill * .55)}"'
    def path(s, d, fill=0.0, solid=False):
        if solid: s.out.append(f'<path d="{d}" fill="#fff"/>'); return
        s.out.append(f'<path d="{d}"{s._fill(fill, d.rstrip().endswith(("Z", "z")))}/>')
    def circle(s, x, y, r, fill=0.0, solid=False):
        if solid: s.out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" fill="#fff" stroke="none"/>'); return
        s.out.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}"{s._fill(fill, True)}/>')
    def hatch(s, r, ang=45):
        # Gölge çizgileri, sadece tonlu desende.
        if not s.tone: return
        gap = max(3.5, r / 5)
        t = math.radians(ang); out = []
        k = -r + gap / 2
        while k < r:
            l = math.sqrt(max(0, r * r - k * k)) * .8
            ct, st = math.cos(t), math.sin(t)
            out.append(f'M{f(-l*ct - k*st)} {f(-l*st + k*ct)}L{f(l*ct - k*st)} {f(l*st + k*ct)}')
            k += gap
        s.out.append(f'<path d="{"".join(out)}" stroke-width="{SW * .45:.1f}" opacity=".6"/>')
    def line(s, x1, y1, x2, y2): s.out.append(f'<path d="M{f(x1)} {f(y1)}L{f(x2)} {f(y2)}"/>')

def tone(): return rnd.choice([.3, .45, .6, .75, .9])

def eyes(c, r, y, n=None):
    n = n or rnd.choice([1, 2, 2, 2, 3])
    er = r * (.24 if n == 1 else .17)
    xs = [0] if n == 1 else [-r * .3, r * .3] if n == 2 else [-r * .42, 0, r * .42]
    for x in xs:
        yy = y + (rnd.random() - .5) * r * .1
        c.circle(x, yy, er, fill=1.6)
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
    if rnd.random() < .4: c.hatch(r * .7, rnd.choice([30, 60, -45]))
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
    c.out.append(f'<path d="{line}"/>')
    c.out.append('</g>')

def arrow(c, r):
    c.path(f'M{f(-r*.8)} {f(r*.3)}Q0 {f(-r*.6)} {f(r*.7)} {f(-r*.1)}')
    c.path(f'M{f(r*.35)} {f(-r*.35)}L{f(r*.75)} {f(-r*.1)}L{f(r*.45)} {f(r*.25)}')

def drop(c, r):
    c.path(f'M0 {f(-r*.85)}C{f(r*.3)} {f(-r*.3)} {f(r*.6)} {f(r*.05)} {f(r*.6)} {f(r*.35)}A{f(r*.6)} {f(r*.6)} 0 0 1 {f(-r*.6)} {f(r*.35)}C{f(-r*.6)} {f(r*.05)} {f(-r*.3)} {f(-r*.3)} 0 {f(-r*.85)}Z', fill=tone())
    c.path(f'M{f(-r*.3)} {f(r*.3)}q0 {f(r*.25)} {f(r*.2)} {f(r*.3)}')

def planet(c, r):
    c.path(f'M{f(-r*.95)} {f(r*.1)}C{f(-r*1.2)} {f(r*.5)} {f(r*1.2)} {f(-r*.2)} {f(r*.95)} {f(-r*.25)}')
    c.circle(0, 0, r * .55, fill=tone())
    c.hatch(r * .5, -30)
    c.path(f'M{f(-r*.95)} {f(r*.1)}C{f(-r*.6)} {f(-r*.15)} {f(r*.6)} {f(-r*.5)} {f(r*.95)} {f(-r*.25)}')

def swirl(c, r):
    d = ''
    for i in range(30):
        a = i * .45; q = r * .9 * i / 30
        d += f'{"M" if i == 0 else "L"}{f(math.cos(a)*q)} {f(math.sin(a)*q)}'
    c.path(d)

WORDS = ['GG', 'WIN', 'LOL', 'GO', 'OK', 'HEY', 'GOL', 'MIC', 'ZZZ', 'EZ', 'BRB', 'AFK']
def word(c, r):
    w = rnd.choice(WORDS)
    size = r * (1.1 if len(w) < 3 else .8)
    fill = grey(.35) if c.tone else '#000'
    c.out.append(f'<text x="0" y="{f(size*.35)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="{f(size)}" fill="{fill}" stroke-width="{SW*.9:.1f}" paint-order="stroke">{w}</text>')

def box(c, r):
    # Kaset, ekran, hoparlör gibi köşeli şeyler.
    w, h = r * .9, r * .6
    c.path(f'M{f(-w)} {f(-h)}h{f(2*w)}v{f(2*h)}h{f(-2*w)}Z', fill=tone())
    k = rnd.random()
    if k < .4:
        c.circle(-w * .45, 0, h * .45, fill=.3); c.circle(w * .45, 0, h * .45, fill=.3)
    elif k < .7:
        for i in range(3): c.line(-w * .7, -h * .5 + i * h * .5, w * .7, -h * .5 + i * h * .5)
    else:
        eyes(c, r * .8, -h * .1, 2); c.path(f'M{f(-w*.3)} {f(h*.5)}q{f(w*.3)} {f(h*.3)} {f(w*.6)} 0')

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
    if r < 12: return small(c, r)
    k = rnd.random()
    if r > 30:
        pick = [(monster, .34), (ghost, .08), (flower, .06), (cloud, .05), (box, .1), (planet, .07), (drop, .05), (eyeball, .07), (word, .06)]
    else:
        pick = [(monster, .14), (star, .1), (eyeball, .1), (box, .08), (drop, .07), (arrow, .08), (swirl, .06), (word, .08), (planet, .04)]
    for fn, p in pick:
        if k < p: return fn(c, r)
        k -= p
    icon(c, r, rnd.choice(list(ICONS)))

def place():
    # Büyükler önce ve birbirine binerek, ortanlar üstlerine, küçükler boşluklara.
    # k: iki merkez en az (r1+r2)*k uzak; 1'den küçükse üst üste biner.
    out = []
    def free(x, y, r, k):
        for (a, b, q) in out:
            dx = min(abs(x - a), W - abs(x - a)); dy = min(abs(y - b), H - abs(y - b))
            if math.hypot(dx, dy) < (r + q) * k: return False
        return True
    # İlk kat en altta kalır, üsttekiler kapatır; aradaki boşlukları doldurur.
    for _ in range(90):
        out.append((rnd.uniform(0, W), rnd.uniform(0, H), rnd.uniform(30, 48)))
    base = list(out)
    out.clear()
    for (lo, hi, tries, k) in [(40, 60, 1500, .72), (26, 38, 4000, .7), (15, 24, 8000, .8), (7, 13, 16000, .95), (3, 6, 16000, 1)]:
        for _ in range(tries):
            r = rnd.uniform(lo, hi); x = rnd.uniform(0, W); y = rnd.uniform(0, H)
            if free(x, y, r, k): out.append((x, y, r))
    return base + out

# Taktik takım: genel nişancı oyunu eşyaları. Belirli bir oyunun logosu, silah görünümü ya da haritası yok.
# Her eşya parçalardan oluşur ve yandan, gerçek oranlarıyla çizilir: ('f', yol) dolu parça, sonraki
# parça öncekini kapatır; ('d', yol) ayrıntı çizgisi; ('w', yol) beyaz dolu (ekran, delik). Merkez (0,0).
# Son değer eşyanın en uzun boyu (birim): desende bu boy, yerin büyüklüğüne göre ölçeklenir.
TAC = {
    # Kavisli şarjörlü, ahşap dipçikli taarruz tüfeği.
    'rifle': ([
        ('f', 'M-44 -2.2L-25 -4L-25 2L-44 8.5Z'),
        ('f', 'M-46 -2.6h2.4v11.5h-2.4Z'),
        ('f', 'M-18 1L-12.5 1L-14.5 11.5L-20 10.5Z'),
        ('f', 'M-4.5 1.5L1.5 1.5Q3.5 8.5 9 13.5L3.5 16.5Q-2.5 9.5 -4.5 1.5Z'),
        ('f', 'M-25 -4.5L3.5 -4.5L3.5 2.2L-25 2.2Z'),
        ('d', 'M-16 2.2Q-16 5.8 -10.5 5.8L-7.5 2.2M-11 2.2q1.4 1.6 .2 2.8M-23 -5.6Q-10 -7.2 2.5 -5.6M-5 -1.6h4.5M-22 -2.2h12'),
        ('f', 'M3.5 -3.8L19.5 -3.2L19.5 1.6L3.5 2.2Z'),
        ('d', 'M7 -1.5h9M7 .2h9'),
        ('f', 'M3.5 -6.6L21.5 -6.6L21.5 -4.2L3.5 -4.2Z'),
        ('f', 'M19.5 -2L40 -2L40 .3L19.5 .3Z'),
        ('f', 'M33 -6.8L35 -6.8L36.2 -2L31.8 -2Z'),
        ('f', 'M40 -2.8h4.5v3.9h-4.5Z'),
    ], 91),
    # Dürbünlü, sürgü mekanizmalı keskin nişancı tüfeği.
    'sniper': ([
        ('f', 'M-46 -3L-30 -3L-22 0L12 0L12 4.2L-13 4.2L-16 12L-22 12L-22 5.5L-30 5.5L-46 8.5Z'),
        ('d', 'M-28 1.5q3.5 -1.2 5 2.2q-3 1.6 -5 -2.2Z'),
        ('f', 'M-48.5 -3.6h2.6v12.6h-2.6Z'),
        ('f', 'M-6 4.2h6v5.5h-6Z'),
        ('f', 'M-22 -4.4L6 -4.4L6 .4L-22 .4Z'),
        ('d', 'M-14 4.2q0 3.6 4.6 3.6l1.6 -3.6M-11 4.2q1.2 1.5 0 2.8'),
        ('f', 'M-12.9 3a1.6 1.6 0 1 0 .01 0Z'),
        ('f', 'M6 -3.3L45 -2.7L45 -1.1L6 -.4Z'),
        ('f', 'M45 -4h5v4.2h-5Z'),
        ('d', 'M46.6 -4v4.2M48.3 -4v4.2'),
        ('f', 'M-12 -6.6h3.2v2.6h-3.2ZM3 -6.6h3.2v2.6h-3.2Z'),
        ('f', 'M-16 -9.6L11 -9.6L11 -6.4L-16 -6.4Z'),
        ('f', 'M11 -10.4L19.5 -11.8L19.5 -4.2L11 -5.6Z'),
        ('f', 'M-23 -11.2L-16 -10L-16 -6L-23 -4.8Z'),
        ('f', 'M-3.5 -13.2h4.6v3.6h-4.6Z'),
        ('d', 'M-11 -8h20'),
    ], 99),
    # Yarı otomatik tabanca.
    'pistol': ([
        ('f', 'M-10.5 -1L-2.5 -1L-4 15L-13 15Z'),
        ('d', 'M-9.5 3l5 0M-10 6l5 0M-10.5 9l5 0M-11 12l5 0'),
        ('f', 'M-14 15h10.5v2.4h-10.5Z'),
        ('f', 'M-12 -1.4L13 -1.4L13 3L1 3L-1 1Z'),
        ('d', 'M-2.6 3Q-2.6 8.4 3.6 7.4L5.6 3M.4 3q1.4 1.8 -.2 3.4'),
        ('f', 'M-13.5 -7.8L16 -7.8L16 -1.4L-13.5 -1.4Z'),
        ('d', 'M-11.5 -6.6v4M-10 -6.6v4M-8.5 -6.6v4M-7 -6.6v4M1 -6.4h5v2.4h-5Z'),
        ('f', 'M14 -9.6h1.6v1.8h-1.6ZM-12.5 -9.6h2.6v1.8h-2.6Z'),
    ], 31),
    # Kabzası tırtıklı, testere sırtlı savaş bıçağı.
    'knife': ([
        ('f', 'M-1 -3.6L14 -3.6L20 -1.2L28 .6Q18 5.4 -1 4.6Z'),
        ('d', 'M2 .4L17 .4M1.5 -3.6l1.2 -1.4l1.2 1.4l1.2 -1.4l1.2 1.4l1.2 -1.4l1.2 1.4l1.2 -1.4l1.2 1.4'),
        ('f', 'M-23 -3.2Q-12 -5 -3 -3.2L-3 4.2Q-12 6 -23 4.2Z'),
        ('d', 'M-19 -3.7v8.6M-15 -4v9.2M-11 -4.1v9.4M-7 -3.8v8.9'),
        ('f', 'M-4 -7.5h3.2v16h-3.2Z'),
        ('f', 'M-27.5 -4h4.6v9.2h-4.6Z'),
    ], 56),
    # Ananas biçimli el bombası, emniyet pimi ve kaşığıyla.
    'nade': ([
        ('f', 'M0 -6.2a9.6 10.4 0 1 0 .01 0Z'),
        ('d', 'M-9.2 -1h18.4M-9.6 3.4h19.2M-9.4 7.8h18.8M-5.6 12h11.2M-4.6 -5.2Q-6.8 4 -4.6 14M4.6 -5.2Q6.8 4 4.6 14M0 -6.2v20.8'),
        ('f', 'M-3.8 -9.6h7.6v4h-7.6Z'),
        ('f', 'M-4.8 -12.4h9.6v3h-9.6Z'),
        ('f', 'M3.8 -12.8L7 -12.8Q12.8 -8 10.6 4.4L8.8 4.6Q10 -5.4 3.8 -9.8Z'),
        ('d', 'M-4.8 -10.9h-2.6M-11 -10.9a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0'),
    ], 30),
    # Silindir sis bombası.
    'smoke': ([
        ('f', 'M-7 -6h14v20h-14Z'),
        ('d', 'M-7 -2.4h14M-7 10.4h14M-4.2 2.2h8.4M-4.2 5.4h8.4'),
        ('f', 'M-7.6 -8h15.2v2.4h-15.2Z'),
        ('f', 'M-2.6 -12h5.2v4h-5.2Z'),
        ('f', 'M2.6 -12.6L5.4 -12.6Q9.4 -11.2 8.6 -6L8.6 9L7 9L7 -6Q7 -9.6 2.6 -10.4Z'),
        ('d', 'M-2.6 -10.6h-2.6M-11.4 -10.6a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0M-9 -16q-4 -4 0 -7q1 -4 6 -2q4 -3 7 1'),
    ], 30),
    # Bantla sarılmış patlayıcı kalıpları, tuş takımı, ekran ve kablolar.
    'c4': ([
        ('f', 'M-21 -2h42v7h-42Z'),
        ('f', 'M-21 5h42v7h-42Z'),
        ('d', 'M-21 1.5h42M-21 8.5h42'),
        ('f', 'M-14 -2.6h4.6v15.2h-4.6ZM9.4 -2.6h4.6v15.2h-4.6Z'),
        ('d', 'M-14 2h4.6M9.4 2h4.6M-14 9h4.6M9.4 9h4.6'),
        ('f', 'M-11 -13.6h22v12h-22Z'),
        ('w', 'M-9.2 -11.8h9.4v4.4h-9.4Z'),
        ('d', 'M2 -11.8h2.2v2.2h-2.2ZM5 -11.8h2.2v2.2h-2.2ZM8 -11.8h1.4v2.2h-1.4ZM2 -8.6h2.2v2.2h-2.2ZM5 -8.6h2.2v2.2h-2.2ZM8 -8.6h1.4v2.2h-1.4ZM2 -5.4h2.2v2.2h-2.2ZM5 -5.4h2.2v2.2h-2.2ZM8 -5.4h1.4v2.2h-1.4ZM-9.2 -5h9.4M-11 -10Q-18 -10 -17 -4M-11 -6Q-15 -3 -19 3M11 -8Q18 -8 17 -2M9 -13.6L13 -20'),
        ('f', 'M13 -20.6a1.4 1.4 0 1 0 .01 0Z'),
    ], 44),
    # Askeri kask, kayışıyla.
    'helmet': ([
        ('f', 'M-15 4Q-15 -13 1 -13Q16 -13 16.5 2L19 6.4L-17 6.4Z'),
        ('d', 'M-14 -1Q1 -5 15.6 -1M-13 6.4Q-9 14 1 12.4M-4 -12.6Q-6 -6 -6 -1M7 -12.4Q9 -6 9 -1'),
    ], 37),
    'cross': ([
        ('d', 'M0 -10a10 10 0 1 0 .01 0Z'),
        ('d', 'M0 -16v9M0 7v9M-16 0h9M7 0h9M0 -1v2'),
    ], 32),
    # Fişek: kovan ve mermi çekirdeği.
    'bullet': ([
        ('f', 'M-3.6 -2h7.2v12h-7.2Z'),
        ('f', 'M-4.2 10h8.4v1.8h-8.4Z'),
        ('f', 'M-3.6 -2Q-3.6 -10 0 -14Q3.6 -10 3.6 -2Z'),
        ('d', 'M-3.6 7.4h7.2'),
    ], 26),
    # Kavisli tüfek şarjörü.
    'mag': ([
        ('f', 'M-4.6 -13L4.6 -13Q5.6 0 11 11.6L2 14.6Q-3.6 2 -4.6 -13Z'),
        ('d', 'M-3.6 -9.4h8.4M-3 -5h8.4M-2 -.6h8.6M-.4 3.8h8.6M1.6 8h8.4M-2.6 -13v-1.6h5.6v1.6'),
    ], 29),
    # Kablo kesme pensesi.
    'pliers': ([
        ('f', 'M-1.6 .6Q-6 8 -9.8 16.6L-6.6 17.8Q-2.4 9.6 1.6 1.4Z'),
        ('f', 'M1.6 .6Q6 8 9.8 16.6L6.6 17.8Q2.4 9.6 -1.6 1.4Z'),
        ('f', 'M-2.8 .4Q-4 -8 -.3 -14.4Q.8 -7 .9 .4Z'),
        ('f', 'M2.8 .4Q4 -8 .3 -14.4Q-.8 -7 -.9 .4Z'),
        ('f', 'M0 -2a2.2 2.2 0 1 0 .01 0Z'),
    ], 33),
    'skull': ([
        ('f', 'M0 -11a10 9 0 0 0 -7 15v5h14v-5a10 9 0 0 0 -7 -15z'),
        ('w', 'M-4 -2a3 3 0 1 0 .01 0zM4 -2a3 3 0 1 0 .01 0zM0 3.4l-1.4 2.4h2.8z'),
        ('d', 'M-3 9v-2.6M0 9v-2.6M3 9v-2.6'),
    ], 22),
    'site': ([('f', 'M0 -11a11 11 0 1 0 .01 0z')], 22),
    'head': ([
        ('d', 'M-11 3v-3a11 11 0 0 1 22 0v3M7 12q0 4 -6 4'),
        ('f', 'M-12 2h5v10h-5ZM12 2h-5v10h5Z'),
    ], 26),
}
LONG = ('rifle', 'sniper')
LONG_LEFT = 0  # bir karede en fazla bu kadar uzun silah; build() kurar
SMALL = ('bullet', 'mag', 'nade', 'cross', 'skull', 'site', 'smoke')
TAC_WORDS = ['GG', 'EZ', 'ACE', 'HS', 'NT', 'GG WP', '1v5', 'CLUTCH', 'BOOM', 'ECO', 'RUSH']

def tac_draw(c, name, s):
    parts, _ = TAC[name]
    c.out.append(f'<g transform="scale({s:.3f})" stroke-width="{SW / s:.2f}">')
    for kind, d in parts:
        if kind == 'f': c.path(d, fill=tone())
        elif kind == 'w': c.out.append(f'<path d="{d}" fill="{grey(.95) if c.tone else "#000"}" stroke-width="{SW / s * .7:.2f}"/>')
        else: c.out.append(f'<path d="{d}" stroke-width="{SW / s * .7:.2f}"/>')
    if name == 'site':
        letter = rnd.choice('AB')
        fill = grey(.8) if c.tone else '#000'
        c.out.append(f'<text x="0" y="6" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="17" fill="{fill}" stroke-width="{SW / s * .6:.2f}">{letter}</text>')
    c.out.append('</g>')

def tac_item(c, r):
    # Döner: eşyanın merkezden en uzak ucu ve üstte çizilip çizilmeyeceği.
    if r < 12: small(c, r); return r, False
    if r < 26 and rnd.random() < .12:
        w = rnd.choice(TAC_WORDS)
        size = r * (1.0 if len(w) <= 2 else .75 if len(w) <= 4 else .5)
        fill = grey(.35) if c.tone else '#000'
        c.out.append(f'<text x="0" y="{f(size*.35)}" text-anchor="middle" font-family="Arial Black,Impact,sans-serif" font-weight="900" font-size="{f(size)}" fill="{fill}" stroke-width="{SW*.9:.1f}" paint-order="stroke">{w}</text>')
        return r * 1.3, False
    # Ayrıntılı eşyalar küçük yerde karalamaya döner: uzun silahlar büyük yerlere, küçükler küçüklere.
    global LONG_LEFT
    if r >= 40 and LONG_LEFT > 0 and rnd.random() < .5: names = list(LONG)
    elif r >= 34: names = [n for n in TAC if n not in LONG and n not in ('skull', 'site', 'cross', 'bullet', 'head')]
    elif r >= 22: names = [n for n in TAC if n not in LONG and n not in ('skull', 'site')]
    else: names = list(SMALL)
    weights = [5 if n in LONG else 3 if n in ('pistol', 'knife', 'nade', 'c4', 'smoke') else 1.2 for n in names]
    name = rnd.choices(names, weights)[0]
    size = TAC[name][1]
    s = r * 2 * (1.5 if name in LONG else 1.05) / size
    if name in LONG: LONG_LEFT -= 1
    tac_draw(c, name, s)
    return size * s / 2 + 4, name in LONG

def sheet():
    # Elle bakmak için: her eşya büyük ve tek başına.
    names = list(TAC); cols = 4; cw, ch = 300, 170
    if len(sys.argv) > 3: names = sys.argv[2].split(','); cols = 1; cw, ch = 1200, 260
    rows = -(-len(names) // cols); out = []
    for i, n in enumerate(names):
        c = Ctx(True)
        tac_draw(c, n, (cw - 20) / TAC[n][1] if len(names) < 5 else 250 / TAC[n][1] if n in LONG else 120 / TAC[n][1])
        out.append(f'<g transform="translate({cw * (i % cols) + cw / 2} {ch * (i // cols) + ch / 2})">{"".join(c.out)}</g>')
    Wd, Hd = cw * cols, ch * rows
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wd}" height="{Hd}"><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{Wd}" height="{Hd}">'
            f'<rect width="{Wd}" height="{Hd}" fill="#000"/><g fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">{"".join(out)}</g></mask>'
            f'<rect width="{Wd}" height="{Hd}" fill="#fff"/><rect width="{Wd}" height="{Hd}" mask="url(#m)"/></svg>')

def build(tone_on, kind='fun'):
    global rnd
    global LONG_LEFT
    rnd = random.Random(7 if kind == 'fun' else 11)
    LONG_LEFT = 9
    spots = place()
    body, top = [], []
    for (x, y, r) in spots:
        c = Ctx(tone_on)
        rot = rnd.uniform(-35, 35) if kind == 'fun' else rnd.uniform(-40, 40)
        if kind == 'fun': item(c, r); reach, up = r * 1.3, False
        else: reach, up = tac_item(c, r)
        g = ''.join(c.out)
        for ox in (-W, 0, W):
            for oy in (-H, 0, H):
                X, Y = x + ox, y + oy
                if -reach < X < W + reach and -reach < Y < H + reach:
                    (top if up else body).append(f'<g transform="translate({f(X)} {f(Y)}) rotate({rot:.0f})">{g}</g>')
    # Uzun silahlar en üste: altta kalırsa ne olduğu anlaşılmıyor.
    body += top
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">'
            f'<rect width="{W}" height="{H}" fill="#000"/>'
            f'<g fill="none" stroke="#fff" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round">{"".join(body)}</g></mask>'
            f'<rect width="{W}" height="{H}" mask="url(#m)"/></svg>')

if __name__ == '__main__':
    if 'sheet' in sys.argv: open(sys.argv[-1], 'w', encoding='utf8').write(sheet()); sys.exit()
    for name, t, kind in (('line', False, 'fun'), ('tone', True, 'fun'), ('tac-line', False, 'tac'), ('tac-tone', True, 'tac')):
        s = build(t, kind)
        open(f'src/ui/doodle-{name}.svg', 'w', encoding='utf8').write(s)
        print(name, len(s) // 1024, 'KB', file=sys.stderr)
