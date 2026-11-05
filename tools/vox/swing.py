import os
# 胃（＋十二指腸）を噴門のまわりに回したとき、外れた項目を満たせる向きがあるかを調べる
import sys, runpy, io, contextlib, pickle, numpy as np, itertools
sys.path.insert(0, '.')
sys.argv = ['fit_stomach.py', os.environ.get('BP3D', 'bp3d')]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/tools/fit_stomach.py')
from soft import Soft, up_bp
from fill import neighbors, settle
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation
S = Soft(fit); d = pickle.load(open('duo_vox.pkl', 'rb')); P, isduo = d['P'], d['isduo']; VS = 3.0
nb = neighbors(P, VS)        # つながりは回しても変わらない
_, vi = cKDTree(S.X0).query(P); reg = S.vreg[vi].astype(object); reg[isduo] = 'duode'
nrm = S.mesh(S.X0).vertex_normals; _, cv = cKDTree(P).query(S.X0[S.cardzone] - nrm[S.cardzone] * VS * 0.8)
nst = (~isduo).sum(); kba = int(round(150 / 566.46 * nst)); C = S.cardia
f0 = np.zeros(len(P), bool); f0[np.random.RandomState(1).choice(np.where(~isduo)[0], kba, replace=False)] = True
def meas(f):
    tot = f[~isduo].sum(); sh = {k: (f & (reg == k)).sum() / max(tot, 1) * 100 for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']}
    sh['antPyl'] = sh['antrum'] + sh['pylorus']; sh['cardia'] = f[cv].mean() * 100; return sh
ITEMS = {'6': (0, 289, lambda m: m['cardia'] <= 5, lambda m: m['cardia']),
         '7': (25, 307, lambda m: m['fundus'] <= 5, lambda m: m['fundus']),
         '3': (0, 315, lambda m: m['fundus'] >= 10 and m['antPyl'] >= 10 and m['body'] < min(m['fundus'], m['antPyl']), lambda m: m['body'] - min(m['fundus'], m['antPyl'])),
         '4': (-30, 180, lambda m: m['fundus'] + m['body'] > 50, lambda m: 50 - m['fundus'] - m['body'])}
angs = [-40, -20, 0, 20, 40]
for it, (t, r, ok, sc) in ITEMS.items():
    up = up_bp(t, r); best = None; hits = []
    for a, b, c in itertools.product(angs, angs, angs):
        R = Rotation.from_euler('xyz', [a, b, c], degrees=True).as_matrix()
        Q = (P - C) @ R.T + C
        m = meas(settle(Q, nb, up, f0))
        if ok(m): hits.append((abs(a) + abs(b) + abs(c), (a, b, c)))
        s = sc(m)
        if best is None or s < best[0]: best = (s, (a, b, c), {k: round(v) for k, v in m.items()})
    hits.sort()
    print('項目', it, '満たす向きの数', len(hits), '回転が小さい順', [h[1] for h in hits[:5]], '| 最良', best[1], best[2])
