import os
# 柔らかい胃：BodyParts3D の胃の表面を膜にし、体位ごとにバリウム（重い）とガス（軽い）による圧力で形を決める
import sys, io, zipfile, heapq, numpy as np, trimesh
from scipy.spatial import cKDTree
SRC = os.environ.get('BP3D', 'bp3d')
rows = [l.rstrip('\n').split('\t') for l in open(f'{SRC}/partof_element_parts.txt', encoding='utf-8')][1:]
zf = zipfile.ZipFile(f'{SRC}/partof_BP3D_4.0_obj_99.zip')
def load(fma):
    ms = [trimesh.load(io.BytesIO(zf.read(f'partof_BP3D_4.0_obj_99/{r[2]}.obj')), file_type='obj', process=False, force='mesh') for r in rows if r[0] == fma]
    m = trimesh.util.concatenate(ms); m.merge_vertices(); return m

RHO_BA, RHO_ABD = 2.56, 1.0     # 200 w/v% の懸濁液の密度（g/mL）、まわりの組織（水と同じとみなす）

def up_bp(tilt, roll):          # 体の座標の上向き → BodyParts3D の座標（x 左, y 腹側が負, z 頭側）
    t, r = np.radians(tilt), np.radians(roll)
    ub = np.array([-np.sin(r) * np.cos(t), np.sin(t), np.cos(r) * np.cos(t)])
    return np.array([ub[0], -ub[2], ub[1]])

class Soft:
    def __init__(self, fit):
        st = fit['st']; self.F = st.faces.copy(); self.X0 = st.vertices.copy(); self.n = len(self.X0)
        es, du = load('FMA7131'), load('FMA7206')
        d_es, _ = cKDTree(es.vertices).query(self.X0); d_du, _ = cKDTree(du.vertices).query(self.X0)
        self.card = np.where(d_es < 6)[0]; self.pyl = np.where(d_du < 6)[0]
        self.cardia = self.X0[self.card].mean(0)
        # 部位（頂点ごと）：中心の線の長さ s で分ける（fit_stomach.py と同じ境目）
        _, ci = cKDTree(fit['cen_all']).query(self.X0); s = fit['s_acc'][ci]
        sf, sa, sp = fit['s_fund'], fit['s_ang'], fit['s_acc'][fit['nst'] - 1]
        reg = np.full(self.n, 'body', dtype=object)
        reg[s < sf] = 'fundus'; reg[(s >= sa - 18) & (s < sa + 18)] = 'angle'
        reg[(s >= sa + 18) & (s < sp - 20)] = 'antrum'; reg[s >= sp - 20] = 'pylorus'
        self.vreg = reg
        self.cardzone = np.where(np.linalg.norm(self.X0 - self.cardia, axis=1) <= 20)[0]   # 噴門部：噴門から 2 cm 以内の壁
        E = st.edges_unique; self.E = E; self.L0 = np.linalg.norm(self.X0[E[:, 0]] - self.X0[E[:, 1]], axis=1)
        # 曲げ：辺をはさむ 2 つの三角形の向かいの頂点どうしの距離
        fa = st.face_adjacency; ue = st.face_adjacency_unshared
        self.B = ue; self.B0 = np.linalg.norm(self.X0[ue[:, 0]] - self.X0[ue[:, 1]], axis=1)
        self.V0 = st.volume

    def mesh(self, X): return trimesh.Trimesh(X, self.F, process=False)

    # ---------- バリウムの溜まり方（ボクセル、窪みごとの溜まりとあふれ）----------
    def hydro(self, X, up, ml, VS=3.0):
        m = self.mesh(X); vg = m.voxelized(pitch=VS).fill(); P = vg.points; n = len(P)
        key = np.round((P - P.min(0)) / VS).astype(int); idx = {tuple(k): i for i, k in enumerate(key)}
        nb = [[idx[t] for t in ((k[0]+1,k[1],k[2]),(k[0]-1,k[1],k[2]),(k[0],k[1]+1,k[2]),(k[0],k[1]-1,k[2]),(k[0],k[1],k[2]+1),(k[0],k[1],k[2]-1)) if t in idx] for k in key]
        h = P @ up + np.random.RandomState(0).rand(n) * 1e-6
        order = np.argsort(h); lab = np.empty(n, int); nbas = 0
        for v in order:
            lo = -1; hl = h[v]
            for j in nb[v]:
                if h[j] < hl: hl = h[j]; lo = j
            if lo < 0: lab[v] = nbas; nbas += 1
            else: lab[v] = lab[lo]
        k = int(round(ml / (m.volume / 1000) * n))
        filled0 = np.zeros(n, bool); filled0[np.random.RandomState(1).choice(n, k, replace=False)] = True   # 胃全体に入れてから流す
        vol = np.bincount(lab[filled0], minlength=nbas).astype(float)
        parent = list(range(nbas))
        def find(a):
            while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
            return a
        lake = np.full(n, -1); front = {}; inq = {}; cap = np.zeros(nbas); level = np.full(nbas, -np.inf)
        mins = {}
        for v in order[::-1]: mins[lab[v]] = v
        def start(b): v = mins[b]; front[b] = [(h[v], v)]; inq[b] = {v}
        todo = [b for b in range(nbas) if vol[b] > 0]
        for b in todo: start(b)
        while todo:
            b = find(todo.pop())
            if vol[b] <= cap[b] + 1e-9: continue
            Fq = front[b]
            while cap[b] < vol[b] - 1e-9 and Fq:
                hv, v = heapq.heappop(Fq)
                if lake[v] >= 0 and find(lake[v]) != b:
                    o = find(lake[v]); parent[o] = b; vol[b] += vol[o]; cap[b] += cap[o]; level[b] = max(level[b], level[o])
                    for x in front[o]: heapq.heappush(Fq, x)
                    inq[b] |= inq[o]; continue
                if lake[v] >= 0: continue
                if hv < level[b] - 1e-9 and find(lab[v]) != b:
                    o = find(lab[v]); extra = vol[b] - cap[b]; vol[b] = cap[b]; vol[o] += extra
                    heapq.heappush(Fq, (hv, v))
                    if o not in front: start(o)
                    todo.append(o); break
                lake[v] = b; cap[b] += 1; level[b] = max(level[b], hv)
                for j in nb[v]:
                    if j not in inq[b] and lake[j] != b: inq[b].add(j); heapq.heappush(Fq, (h[j], j))
        filled = lake >= 0
        lev = np.full(n, np.nan); lev[filled] = [level[find(lake[v])] for v in np.where(filled)[0]]
        return dict(P=P, filled=filled, lev=lev, VS=VS)

    def wall_state(self, X, H):   # 頂点ごと：沈んでいるか、その溜まりの液面の高さ
        nrm = self.mesh(X).vertex_normals
        _, vi = cKDTree(H['P']).query(X - nrm * H['VS'] * 0.8)
        return H['filled'][vi], H['lev'][vi]

    # ---------- 形：圧力で膜を動かす（準静的）----------
    def deform(self, X, up, sub, lev, comp, iters=60, pbd=8, fixed=None):
        X = X.copy(); fixed = np.concatenate([self.card, self.pyl]) if fixed is None else fixed
        free = np.ones(self.n, bool); free[fixed] = False
        for it in range(iters):
            m = self.mesh(X); nrm = m.vertex_normals
            area = np.zeros(self.n); np.add.at(area, self.F.ravel(), np.repeat(m.area_faces / 3, 3))
            h = X @ up
            p = RHO_ABD * (h - h.mean())                                   # 外の組織の圧力の差（上ほど外に押し出される）
            p = p + np.where(sub, RHO_BA * np.nan_to_num(lev - h), 0)      # バリウムの重さ（深いほど外に押す）
            p = p - (p * area).sum() / area.sum()                          # 全体の膨らみは体積の決まりで決める
            X[free] += (comp * p[:, None] * nrm)[free]
            for _ in range(pbd):                                           # 辺の長さと曲げを元に戻す
                for (I, L0, w) in ((self.E, self.L0, 1.0), (self.B, self.B0, 0.5)):
                    d = X[I[:, 1]] - X[I[:, 0]]; L = np.linalg.norm(d, axis=1) + 1e-9
                    c = (w * 0.5 * (L - L0) / L)[:, None] * d
                    dx = np.zeros_like(X); np.add.at(dx, I[:, 0], c); np.add.at(dx, I[:, 1], -c)
                    cnt = np.zeros(self.n); np.add.at(cnt, I.ravel(), 1)
                    X[free] += (dx / np.maximum(cnt, 1)[:, None] * 2)[free]
                V = self.mesh(X).volume                                    # 体積をもとに戻す（ガスの量は一定）
                nrm = self.mesh(X).vertex_normals; A = (area).sum()
                X[free] += (nrm * ((self.V0 - V) / A))[free]
        return X

    def solve(self, tilt, roll, ml=150, comp=0.02, outer=6, **kw):
        up = up_bp(tilt, roll); X = self.X0.copy()
        H = self.hydro(X, up, ml)
        for k in range(outer):
            sub, lev = self.wall_state(X, H)
            X = self.deform(X, up, sub, lev, comp, **kw)
            H = self.hydro(X, up, ml)
        return X, H

    def measure(self, X, H):
        sub, lev = self.wall_state(X, H)
        P = H['P']; f = H['filled']
        _, vi = cKDTree(X).query(P); reg = self.vreg[vi]
        tot = f.sum(); r = {k: (f & (reg == k)).sum() / tot * 100 for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']}
        r['antPyl'] = r['antrum'] + r['pylorus']
        r['cardia'] = sub[self.cardzone].mean() * 100
        return r
