import os
import sys, runpy, io, contextlib, numpy as np
sys.path.insert(0, '.')
sys.argv = ['fit_stomach.py', os.environ.get('BP3D', 'bp3d')]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/tools/fit_stomach.py')
from soft import Soft, load
S = Soft(fit)
sp = load('FMA9140'); spc = sp.vertices[:, 0].mean()   # 胸椎の左右の中心
du = load('FMA7206')
X = S.X0
print('midline x (thoracic spine mean) %.0f mm' % spc)
print('cardia x %.0f  z %.0f' % (S.cardia[0] - spc, S.cardia[2]))
for k in ['fundus', 'body', 'angle', 'antrum', 'pylorus']:
    m = S.vreg == k; print(k, 'x %.0f..%.0f (mean %.0f)' % (X[m, 0].min() - spc, X[m, 0].max() - spc, X[m, 0].mean() - spc), 'z mean %.0f' % X[m, 2].mean())
print('duodenum x %.0f..%.0f' % (du.vertices[:, 0].min() - spc, du.vertices[:, 0].max() - spc))
print('stomach volume mL', S.V0 / 1000)
# 右側臥位（重力が患者の右 = -x）：噴門の高さより下（x が小さい）にある胃の容積
import trimesh
vg = S.mesh(X).voxelized(3).fill(); P = vg.points
for th in [0, 10, 20]:
    print('volume right of cardia-%dmm: %.0f mL' % (th, (P[:, 0] < S.cardia[0] - th).sum() * 27 / 1000))
