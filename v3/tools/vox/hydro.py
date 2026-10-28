# ボクセルで胃の中のバリウムの溜まり方を求める（重力のもとでの静的な平衡。窪みごとの溜まり・あふれを扱う）
import numpy as np, heapq, pickle
from scipy.spatial import cKDTree

class Stomach:
    def __init__(self, pkl):
        d = pickle.load(open(pkl, 'rb')); self.__dict__.update(d)
        P = self.P; VS = self.VS
        # BodyParts3D（x 左, y 腹側が負, z 頭側, mm）→ 体の座標（x 左, y 頭側, z 腹側）
        self.B = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)
        key = np.round((P - P.min(0)) / VS).astype(int)
        idx = {tuple(k): i for i, k in enumerate(key)}
        nb = [[] for _ in range(len(P))]
        for i, k in enumerate(key):
            for dx, dy, dz in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
                j = idx.get((k[0]+dx, k[1]+dy, k[2]+dz))
                if j is not None: nb[i].append(j)
        self.nb = nb; self.n = len(P)
        # 部位：中心の線のいちばん近い点の長さ s で分ける（fit_stomach.py と同じ境目）
        _, ci = cKDTree(self.cen).query(P); s = self.s_acc[ci]
        sf, sa, sp = self.s_fund, self.s_ang, self.s_pyl
        reg = np.full(len(P), 'body', dtype=object)
        reg[s < sf] = 'fundus'; reg[(s >= sa - 18) & (s < sa + 18)] = 'angle'
        reg[(s >= sa + 18) & (s < sp - 20)] = 'antrum'; reg[(s >= sp - 20)] = 'pylorus'
        self.reg = reg
        # 噴門部：噴門から実寸 2 cm 以内の胃の壁（頂点）。壁のすぐ内側のボクセルで沈んでいるかを見る
        V = self.verts; m = np.linalg.norm(V - self.cardia, axis=1) <= 20
        inner = V[m] - self.normals[m] * VS * 0.8
        _, self.card_vox = cKDTree(P).query(inner)

    def up(self, tilt, roll):
        t, r = np.radians(tilt), np.radians(roll)
        return np.array([-np.sin(r) * np.cos(t), np.sin(t), np.cos(r) * np.cos(t)])

    def settle(self, filled, tilt, roll):
        """filled（各ボクセルのバリウムの有無）から、重力 (tilt, roll) での平衡の filled を返す"""
        h = self.B @ self.up(tilt, roll) + np.random.RandomState(0).rand(self.n) * 1e-6
        order = np.argsort(h); nb = self.nb
        lab = np.full(self.n, -1)
        nb_low = np.full(self.n, -1)
        nbas = 0
        for v in order:   # いちばん低い隣へ下っていく先の窪み
            lo = -1; hl = h[v]
            for j in nb[v]:
                if h[j] < hl: hl = h[j]; lo = j
            if lo < 0: lab[v] = nbas; nbas += 1
            else: lab[v] = lab[lo]
        vol = np.bincount(lab[filled], minlength=nbas).astype(float)
        parent = list(range(nbas))
        def find(a):
            while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
            return a
        lake = np.full(self.n, -1)              # そのボクセルを満たした湖（窪みの番号）
        front = {}; cap = np.zeros(nbas); level = np.full(nbas, -np.inf); inq = {}
        mins = {lab[v]: v for v in order[::-1]}  # 各窪みの最下点
        def start(b):
            v = mins[b]; front[b] = [(h[v], v)]; inq[b] = {v}
        todo = [b for b in range(nbas) if vol[b] > 0]
        for b in todo: start(b)
        while todo:
            b = find(todo.pop())
            if vol[b] <= cap[b] + 1e-9: continue
            F = front[b]
            while cap[b] < vol[b] - 1e-9 and F:
                hv, v = heapq.heappop(F)
                if lake[v] >= 0 and find(lake[v]) != b:          # ほかの湖に届いた：一つにする
                    o = find(lake[v]); parent[o] = b
                    vol[b] += vol[o]; cap[b] += cap[o]; level[b] = max(level[b], level[o])
                    for x in front[o]: heapq.heappush(F, x)
                    inq[b] |= inq[o]; continue
                if lake[v] >= 0: continue
                if hv < level[b] - 1e-9 and find(lab[v]) != b:  # 縁を越えて下り：あふれた分を下の窪みへ
                    o = find(lab[v]); extra = vol[b] - cap[b]; vol[b] = cap[b]; vol[o] += extra
                    heapq.heappush(F, (hv, v))
                    if o not in front: start(o)
                    todo.append(o); break
                lake[v] = b; cap[b] += 1; level[b] = max(level[b], hv)
                for j in nb[v]:
                    if j not in inq[b] and lake[j] != b: inq[b].add(j); heapq.heappush(F, (h[j], j))
        return lake >= 0

    def initial(self, ml):
        n = int(round(ml / (566.46) * self.n))     # 胃の容積 566 mL に対する割合でボクセル数にする
        f = np.zeros(self.n, bool); f[np.random.RandomState(1).choice(self.n, n, replace=False)] = True
        return f

    def shares(self, f):
        tot = f.sum(); r = {k: (f & (self.reg == k)).sum() / tot * 100 for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']}
        r['antPyl'] = r['antrum'] + r['pylorus']; return r

    def cardia_sub(self, f): return f[self.card_vox].mean() * 100
