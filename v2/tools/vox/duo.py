import os
# 胃＋十二指腸（BodyParts3D）を一つの内腔としてボクセルにし、硬いまま教科書の 10 項目を見る
import sys, runpy, io, contextlib, numpy as np, trimesh
sys.path.insert(0, '.')
sys.argv = ['fit_stomach.py', os.environ.get('BP3D', 'bp3d')]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/v2/tools/fit_stomach.py')
from soft import Soft, load, up_bp
S = Soft(fit)
du = load('FMA7206'); print('duodenum watertight', du.is_watertight, 'vol mL', du.volume / 1000 if du.is_watertight else None)
VS = 3.0
gs = S.mesh(S.X0).voxelized(VS).fill(); gd = du.voxelized(VS).fill()
# 同じ格子に合わせて合わせる
P = np.vstack([gs.points, gd.points]); key = np.round(P / VS).astype(int)
_, u = np.unique(key, axis=0, return_index=True); P = P[np.sort(u)]
isduo = np.zeros(len(P), bool); from scipy.spatial import cKDTree
d1, _ = cKDTree(gs.points).query(P); isduo = d1 > 0.1
print('stomach vox', (~isduo).sum(), 'duo vox', isduo.sum())
# 胃と十二指腸がつながっているか
k = np.round(P / VS).astype(int); idx = {tuple(x): i for i, x in enumerate(k)}
conn = sum(1 for i in np.where(isduo)[0] for t in [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)] if (tuple(k[i] + t) in idx) and not isduo[idx[tuple(k[i] + t)]])
print('stomach-duodenum contacts', conn)
import pickle; pickle.dump(dict(P=P, isduo=isduo), open('duo_vox.pkl', 'wb'))
