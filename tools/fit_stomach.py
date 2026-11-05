"""BodyParts3D の胃（と十二指腸の始まり）から、v2 の胃の管の形（中心の線と太さ）を作る。

使い方：python3 tools/fit_stomach.py <BodyParts3D を落としたフォルダ> <目標の容量（模型の mL）>
  フォルダには partof_element_parts.txt と partof_BP3D_4.0_obj_99.zip を置く（build_anatomy.py と同じ）。
  pip install numpy scipy trimesh networkx

手順（結果は js/data.js の TYPES.hook に手で写す。写した値は data.js のコメントに残す）：
  1. 胃の面の上で、胃底部の頂点（いちばん頭側の点）を 0、幽門（十二指腸に接するところ）を 1 とする
     なめらかな場（ラプラス方程式の解）を作る。
  2. 場の値が等しい線で胃を輪切りにし、輪ごとの中心と、断面積が等しくなる太さを求める。
     太さは、v2 の管の断面（前後に 0.78 倍の楕円）と面積が等しくなるよう r = √(A ÷ (π × 0.78)) とする。
  3. 十二指腸も同じように幽門側から輪切りにし、はじめの 4 cm（球部）をつなぐ。
  4. 中心の線を長さで等分して制御点にする。
  5. 噴門（食道に接するところ）、胃底部の下端（噴門の高さ）、胃角（下っていた中心の線が水平に近づくところ）、
     幽門の位置を制御点の番号で求め、部位の境目にする。
  6. BodyParts3D の胃は空の状態なので、検査中（発泡剤でふくらんだ状態）の大きさにするため、
     容量が目標の値になるよう全体を相似に拡大する。
座標：BodyParts3D の胃の外接箱の中心を原点にし、build_anatomy.py と同じ向き（x = 左、y = 頭側、z = 腹側）、
      単位は 実寸 cm ÷ BODY_SCALE（1.2）。"""
import sys, io, zipfile, json
import numpy as np, trimesh, networkx as nx
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve
from scipy.spatial import cKDTree

SRC = sys.argv[1]; TARGET_CAP = float(sys.argv[2]) if len(sys.argv) > 2 else None
BODY_SCALE, FLAT, NCTL = 1.2, 0.78, 12
rows = [l.rstrip('\n').split('\t') for l in open(f'{SRC}/partof_element_parts.txt', encoding='utf-8')][1:]
zf = zipfile.ZipFile(f'{SRC}/partof_BP3D_4.0_obj_99.zip')
def load(fma):
    ms = [trimesh.load(io.BytesIO(zf.read(f'partof_BP3D_4.0_obj_99/{r[2]}.obj')), file_type='obj', process=False, force='mesh')
          for r in rows if r[0] == fma]
    m = trimesh.util.concatenate(ms); m.merge_vertices(); return m
st, du, es = load('FMA7148'), load('FMA7206'), load('FMA7131')
C0 = (st.bounds[0] + st.bounds[1]) / 2
def to_model(p):   # mm → 模型の座標
    d = (np.atleast_2d(p) - C0) / 10.0 / BODY_SCALE
    return np.stack([d[:, 0], d[:, 2], -d[:, 1]], 1)

def harmonic(m, src, dst):   # src で 0、dst で 1 の調和関数（重みは辺の長さの逆数）
    n = len(m.vertices); A = lil_matrix((n, n)); b = np.zeros(n)
    g = nx.Graph(); g.add_edges_from(m.edges_unique.tolist())
    fixed = {**{i: 0.0 for i in src}, **{i: 1.0 for i in dst}}
    for i in range(n):
        if i in fixed: A[i, i] = 1; b[i] = fixed[i]; continue
        ws = 0
        for j in g.neighbors(i):
            w = 1.0 / max(1e-6, np.linalg.norm(m.vertices[i] - m.vertices[j])); A[i, j] = -w; ws += w
        A[i, i] = ws
    return spsolve(A.tocsr(), b)

def slices(m, t, levels):   # 場 t の等値線で輪切りにして、中心と断面積を求める
    out = []
    E = m.edges_unique; V = m.vertices
    for lv in levels:
        ta, tb = t[E[:, 0]], t[E[:, 1]]
        hit = (ta - lv) * (tb - lv) < 0
        if hit.sum() < 3: continue
        f = (lv - ta[hit]) / (tb[hit] - ta[hit])
        P = V[E[hit, 0]] + (V[E[hit, 1]] - V[E[hit, 0]]) * f[:, None]
        c = P.mean(0)
        # 断面の面：点のまとまりの主成分。法線まわりの角度で並べて多角形の面積を出す
        u, s, vt = np.linalg.svd(P - c); nrm = vt[2]; e1 = vt[0]; e2 = np.cross(nrm, e1)
        ang = np.arctan2((P - c) @ e2, (P - c) @ e1); Q = (P - c)[np.argsort(ang)]
        x, y = Q @ e1, Q @ e2
        area = 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
        out.append((lv, c, area))
    return out

def near(m, other, tol):   # other の頂点に tol mm 以内まで近づく頂点
    d, _ = cKDTree(other.vertices).query(m.vertices)
    return np.where(d < tol)[0]

# --- 1〜2. 胃 ---
apex = int(np.argmax(st.vertices[:, 2]))
pyl = near(st, du, 6.0)
card = near(st, es, 6.0)
assert len(pyl) and len(card), (len(pyl), len(card))
t = harmonic(st, [apex], pyl.tolist())
S = slices(st, t, np.linspace(0.005, 0.985, 80))
cen = np.array([s[1] for s in S]); area = np.array([s[2] for s in S])
# 胃底部の頂点のすぐ近くは断面が小さく、管の端としては尖ってしまう。断面の太さが胃底部の最大の 6 割に
# 達したところから中心の線を始め、そこから先の丸みは管の端の丸め（model.js の taper）にまかせる
rr = np.sqrt(area); k0 = int(np.argmax(rr[:len(rr) // 3] >= 0.6 * rr[:len(rr) // 3].max()))
cen, area = cen[k0:], area[k0:]
# --- 3. 十二指腸球部（幽門側から 4 cm）---
dpy = near(du, st, 6.0)
far = int(np.argmax(np.linalg.norm(du.vertices - du.vertices[dpy].mean(0), axis=1)))
td = harmonic(du, dpy.tolist(), [far])
SD = slices(du, td, np.linspace(0.01, 0.4, 40))
dc, da = [], []
L = 0; prev = cen[-1]
for s in SD:
    L += np.linalg.norm(s[1] - prev); prev = s[1]
    if L > 40: break
    dc.append(s[1]); da.append(s[2])
cen_all = np.vstack([cen, np.array(dc)]); area_all = np.concatenate([area, np.array(da)])
nst = len(cen)                                                      # 幽門の位置（胃の輪の数）
# --- 4. 長さで等分 ---
# 輪切りの重心は細かく揺れ、管が自分に折れ重なる原因になるので、長さに沿ってなめらかにする（ガウス、σ = 12 mm）
seg = np.linalg.norm(np.diff(cen_all, axis=0), axis=1); s_acc = np.concatenate([[0], np.cumsum(seg)])
SIG = 12.0
W = np.exp(-0.5 * ((s_acc[:, None] - s_acc[None, :]) / SIG) ** 2); W /= W.sum(1, keepdims=True)
cen_all = np.vstack([cen_all[:1], (W @ cen_all)[1:-1], cen_all[-1:]])   # 両端は動かさない
seg = np.linalg.norm(np.diff(cen_all, axis=0), axis=1); s_acc = np.concatenate([[0], np.cumsum(seg)])
su = np.linspace(0, s_acc[-1], NCTL)
pts = np.stack([np.interp(su, s_acc, cen_all[:, k]) for k in range(3)], 1)
r_mm = np.sqrt(np.interp(su, s_acc, area_all) / (np.pi * FLAT))
def ctl(s): return float(np.interp(s, su, np.arange(NCTL)))         # 長さ → 制御点の番号
# --- 5. 部位の境目 ---
cardia_c = st.vertices[card].mean(0)
s_card = s_acc[np.argmin(np.linalg.norm(cen_all[:nst] - cardia_c, axis=1))]
below = np.where((cen_all[:nst, 2] < cardia_c[2]) & (s_acc[:nst] > s_card * 0.5))[0]
s_fund = s_acc[below[0]] if len(below) else s_card                   # 胃底部の下端：噴門の高さ
# 胃角：胃体部を下ってきた中心の線が、前庭部に向かって水平に近づくところ。
# 正面から見た（前後方向を除いた）中心の線の下り勾配が 45° を下回った最初の位置とする（胃底部の下端より先で探す）。
# 胃角は正面の透視像で見る目印なので、前後方向の動きは数えない
def descent(s, h=10.0):
    p = lambda x: np.array([np.interp(x, s_acc, cen_all[:, q]) for q in range(3)])
    d = p(s + h) - p(s - h)
    return np.degrees(np.arctan2(-d[2], abs(d[0])))   # 正面での下り勾配（°）。BodyParts3D の x が左右、z が頭側
cand = np.linspace(s_fund, s_acc[nst - 1] - 20, 200)
steep = [x for x in cand if descent(x) > 45]
after = [x for x in cand if steep and x > steep[0] and descent(x) <= 45]
s_ang = float(after[0]) if after else float(cand[len(cand) // 2])
s_pyl = s_acc[nst - 1]                                              # 幽門
half_ang = 18.0                                                     # 胃角部の幅（片側 18 mm）
reg = [('fundus', '胃底部', 0, ctl(s_fund)), ('body', '胃体部', ctl(s_fund), ctl(s_ang - half_ang)),
       ('angle', '胃角部', ctl(s_ang - half_ang), ctl(s_ang + half_ang)), ('antrum', '前庭部', ctl(s_ang + half_ang), ctl(s_pyl - 20)),
       ('pylorus', '幽門部', ctl(s_pyl - 20), ctl(s_pyl + 5)), ('duode', '十二指腸球部', ctl(s_pyl + 5), NCTL - 1)]
# --- 6. 大きさ ---
P = to_model(pts); R = r_mm / 10.0 / BODY_SCALE
def capacity(P, R):   # 管の容量（模型の mL）：Σ π r² × 0.78 × 長さ（胃の部分だけ）
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    x = np.linspace(0, s[-1], 400); r = np.interp(x, s, R); k = np.interp(x, s, np.arange(len(P)))
    m = k < reg[-1][2]
    return float(np.sum(np.pi * r[m] ** 2 * FLAT) * (x[1] - x[0]))
cap0 = capacity(P, R); sc = (TARGET_CAP / cap0) ** (1 / 3) if TARGET_CAP else 1.0
c = (P.max(0) + P.min(0)) / 2; P = c + (P - c) * sc; R = R * sc
out = {'pts': np.round(P, 2).tolist(), 'rad': np.round(R, 2).tolist(), 'cardia': round(ctl(s_card), 2),
       'regions': [[k, n, round(a, 2), round(b, 2)] for k, n, a, b in reg],
       'scale': round(sc, 3), 'capBefore': round(cap0, 1), 'capAfter': round(capacity(P, R), 1)}
print(json.dumps(out, ensure_ascii=False))
