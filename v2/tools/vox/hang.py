import os
# 噴門で吊られた胃が、バリウム（重い）とガス（軽い）で回り、靭帯のばね k とつり合う向きを求める
import sys, runpy, io, contextlib, pickle, numpy as np
ARGS = sys.argv[1:]
sys.path.insert(0, '.')
sys.argv = ['fit_stomach.py', os.environ.get('BP3D', 'bp3d')]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/v2/tools/fit_stomach.py')
from soft import Soft, up_bp, RHO_BA, RHO_ABD
from fill import neighbors, settle
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation
S = Soft(fit); d = pickle.load(open('duo_vox.pkl', 'rb')); P, isduo = d['P'], d['isduo']; VS = 3.0
nb = neighbors(P, VS)
_, vi = cKDTree(S.X0).query(P); reg = S.vreg[vi].astype(object); reg[isduo] = 'duode'
nrm = S.mesh(S.X0).vertex_normals; _, cv = cKDTree(P).query(S.X0[S.cardzone] - nrm[S.cardzone] * VS * 0.8)
nst = (~isduo).sum(); kba = int(round(150 / 566.46 * nst)); C = S.cardia
f0 = np.zeros(len(P), bool); f0[np.random.RandomState(1).choice(np.where(~isduo)[0], kba, replace=False)] = True
def meas(f):
    tot = f[~isduo].sum(); sh = {k: (f & (reg == k)).sum() / max(tot, 1) * 100 for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']}
    sh['antPyl'] = sh['antrum'] + sh['pylorus']; sh['cardia'] = f[cv].mean() * 100; return sh
def state(th, up):
    R = Rotation.from_rotvec(np.radians(th)).as_matrix(); Q = (P - C) @ R.T + C
    f = settle(Q, nb, up, f0); h = (Q - C) @ up
    # 位置のエネルギー（まわりの組織を基準）：バリウムは (2.56 − 1)、ガスは (0 − 1) の重さ
    U = ((RHO_BA - RHO_ABD) * h[f].sum() + (0 - RHO_ABD) * h[~f & ~isduo].sum()) * VS ** 3 / 1000   # g·mm
    return U, f
def hang(t, r, k, step=5, maxit=40):
    up = up_bp(t, r); th = np.zeros(3)
    U, f = state(th, up); E = U + 0.5 * k * (np.radians(th) ** 2).sum()
    for _ in range(maxit):
        best = None
        for ax in range(3):
            for s in (step, -step):
                t2 = th.copy(); t2[ax] += s
                U2, f2 = state(t2, up); E2 = U2 + 0.5 * k * (np.radians(t2) ** 2).sum()
                if E2 < E - 1e-6 and (best is None or E2 < best[0]): best = (E2, t2, f2)
        if best is None: break
        E, th, f = best
    return th, f
POSES = [('2/5a', 0, 0), ('3', 0, 315), ('4水平', 0, 180), ('4頭低', -30, 180), ('5b', 0, 35), ('5c', -30, 307), ('5d', -30, 155), ('6', 0, 289), ('7', 25, 307), ('8', 25, 225)]
def judge(res):
    m = res; out = {}
    out['2'] = max(['fundus', 'body', 'angle', 'antrum', 'pylorus'], key=lambda k: m['2/5a'][k]) == 'fundus'
    out['5a'] = m['2/5a']['antPyl'] <= 5
    a = m['3']; out['3'] = a['fundus'] >= 10 and a['antPyl'] >= 10 and a['body'] < min(a['fundus'], a['antPyl'])
    out['4'] = m['4頭低']['antPyl'] < m['4水平']['antPyl'] and m['4頭低']['fundus'] + m['4頭低']['body'] > 50
    for k in ['5b', '5c', '5d']: out[k] = m[k]['antPyl'] <= 5
    out['6'] = m['6']['cardia'] <= 5; out['7'] = m['7']['fundus'] <= 5; out['8'] = m['8']['cardia'] <= 5
    return out
if __name__ == '__main__':
    ks = [float(x) for x in ARGS] or [1e9]
    for k in ks:
        res = {}; ths = {}
        for nm, t, r in POSES:
            th, f = hang(t, r, k); res[nm] = meas(f); ths[nm] = th
        j = judge(res)
        print(f'k={k:g}  一致 {sum(j.values())}/10  ' + ' '.join(f'{a}{"○" if b else "×"}' for a, b in j.items()))
        for nm in res: print('   ', nm, 'rot', ths[nm].astype(int).tolist(), {kk: round(v) for kk, v in res[nm].items() if kk in ('fundus', 'body', 'antPyl', 'cardia')})
