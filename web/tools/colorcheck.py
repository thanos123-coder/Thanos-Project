"""Contrast checker for palette work: WCAG 2 contrast ratio and APCA (0.0.98G) for token pairs.

Usage: python3 web/tools/colorcheck.py palette.json
palette.json: {"themes": {"light": {"ink": "#182437", "canvas": "98.2 0.006 250"}},
               "pairs": {"light": [["ink", "canvas"]]}}
Colors are hex or "L C h" OKLCH (L in percent or 0-1).
"""
import math, sys
def oklch_to_srgb(L,C,h):
    a=C*math.cos(math.radians(h)); b=C*math.sin(math.radians(h))
    l_=L+0.3963377774*a+0.2158037573*b
    m_=L-0.1055613458*a-0.0638541728*b
    s_=L-0.0894841775*a-1.2914855480*b
    l,m,s=l_**3,m_**3,s_**3
    r=4.0767416621*l-3.3077115913*m+0.2309699292*s
    g=-1.2684380046*l+2.6097574011*m-0.3413193965*s
    bb=-0.0041960863*l-0.7034186147*m+1.7076147010*s
    def enc(x):
        inside = -1e-4<=x<=1+1e-4
        x=min(max(x,0),1)
        return (12.92*x if x<=0.0031308 else 1.055*x**(1/2.4)-0.055), inside
    out=[enc(v) for v in (r,g,bb)]
    return tuple(o[0] for o in out), all(o[1] for o in out)
def hex_to_rgb(hx):
    hx=hx.lstrip('#'); return tuple(int(hx[i:i+2],16)/255 for i in (0,2,4))
def rgb_to_hex(c): return '#'+''.join(f'{round(v*255):02X}' for v in c)
def srgb_to_oklch(c):
    def dec(x): return x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4
    r,g,b=[dec(v) for v in c]
    l=0.4122214708*r+0.5363325363*g+0.0514459929*b
    m=0.2119034982*r+0.6806995451*g+0.1073969566*b
    s=0.0883024619*r+0.2817188376*g+0.6299787005*b
    l_,m_,s_=[v**(1/3) for v in (l,m,s)]
    L=0.2104542553*l_+0.7936177850*m_-0.0040720468*s_
    A=1.9779984951*l_-2.4285922050*m_+0.4505937099*s_
    B=0.0259040371*l_+0.7827717662*m_-0.8086757660*s_
    return L, math.hypot(A,B), (math.degrees(math.atan2(B,A))%360)
def rel_lum(c):
    def dec(x): return x/12.92 if x<=0.04045 else ((x+0.055)/1.055)**2.4
    r,g,b=[dec(v) for v in c]; return 0.2126*r+0.7152*g+0.0722*b
def wcag(a,b):
    la,lb=rel_lum(a),rel_lum(b); hi,lo=max(la,lb),min(la,lb); return (hi+0.05)/(lo+0.05)
def apca(txt,bg):
    def Y(c): return 0.2126729*c[0]**2.4+0.7151522*c[1]**2.4+0.0721750*c[2]**2.4
    yt,yb=Y(txt),Y(bg)
    def clamp(y): return y+(0.022-y)**1.414 if y<0.022 else y
    yt,yb=clamp(yt),clamp(yb)
    if abs(yb-yt)<0.0005: return 0.0
    if yb>yt:
        s=(yb**0.56-yt**0.57)*1.14; return 0.0 if s<0.1 else (s-0.027)*100
    else:
        s=(yb**0.65-yt**0.62)*1.14; return 0.0 if s>-0.1 else (s+0.027)*100
def parse(spec):
    spec=spec.strip()
    if spec.startswith('#'): return hex_to_rgb(spec), True
    L,C,h=[float(x) for x in spec.split()]
    return oklch_to_srgb(L/100 if L>1 else L,C,h)
if __name__=='__main__':
    import json
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    data=json.load(open(sys.argv[1]))
    cols={}
    for theme,tokens in data['themes'].items():
        print(f'\n=== {theme}')
        rgb={}
        for k,v in tokens.items():
            c,ok=parse(v); rgb[k]=c
            L,C,h=srgb_to_oklch(c)
            print(f'  {k:18s} {v:22s} -> {rgb_to_hex(c)}  oklch({L*100:.1f}% {C:.3f} {h:.0f}){"" if ok else "  [OUT OF sRGB]"}')
        for fg,bg in data['pairs'].get(theme,[]):
            print(f'  {fg:>16s} on {bg:<14s} WCAG {wcag(rgb[fg],rgb[bg]):5.2f}:1  APCA Lc {apca(rgb[fg],rgb[bg]):6.1f}')
