import os
import sys, runpy, io, contextlib, pickle, numpy as np
sys.path.insert(0, '.')
sys.argv = ['fit_stomach.py', os.environ.get('BP3D', 'bp3d')]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/tools/fit_stomach.py')
from soft import Soft, up_bp
from fill import neighbors, settle
from scipy.spatial import cKDTree
S = Soft(fit); d = pickle.load(open('duo_vox.pkl', 'rb')); P, isduo = d['P'], d['isduo']; VS = 3.0
nb = neighbors(P, VS)
_, vi = cKDTree(S.X0).query(P); reg = S.vreg[vi].astype(object); reg[isduo] = 'duode'
nrm = S.mesh(S.X0).vertex_normals; _, cv = cKDTree(P).query(S.X0[S.cardzone] - nrm[S.cardzone] * VS * 0.8)
nst = (~isduo).sum(); kba = int(round(150 / 566.46 * nst))
def run(t, r, init='stomach'):
    f0 = np.zeros(len(P), bool); pool = np.where(~isduo)[0]
    f0[np.random.RandomState(1).choice(pool, kba, replace=False)] = True
    f = settle(P, nb, up_bp(t, r), f0)
    tot = f[~isduo].sum(); sh = {k: (f & (reg == k)).sum() / max(tot, 1) * 100 for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']}
    sh['antPyl'] = sh['antrum'] + sh['pylorus']; sh['duo_mL'] = (f & isduo).sum() * 27 / 1000 * 566.46 / (nst * 27 / 1000)
    sh['cardia'] = f[cv].mean() * 100; return sh
POSES = [('2/5a 背臥位', 0, 0), ('3 振り分け', 0, 315), ('4 腹臥位水平', 0, 180), ('4 腹臥位頭低位', -30, 180), ('5b 背臥位第1斜位', 0, 35),
         ('5c 背臥位第2斜位頭低位', -30, 307), ('5d 腹臥位第2斜位頭低位', -30, 155), ('6 右側臥位', 0, 289), ('7 半臥位第2斜位', 25, 307), ('8 腹臥位第1斜位半臥位', 25, 225)]
for nm, t, r in POSES:
    m = run(t, r); print(f"{nm}: 底{m['fundus']:.0f} 体{m['body']:.0f} 前幽{m['antPyl']:.0f} 噴門{m['cardia']:.0f} 十二指腸{m['duo_mL']:.0f}mL")
