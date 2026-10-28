import os
import sys, runpy, io, contextlib, time, numpy as np, pickle
sys.path.insert(0, '.')
SRC = os.environ.get('BP3D', 'bp3d')
sys.argv = ['fit_stomach.py', SRC]
with contextlib.redirect_stdout(io.StringIO()): fit = runpy.run_path('/home/user/stomach/v2/tools/fit_stomach.py')
from soft import Soft
S = Soft(fit)
comp = float(sys.argv[1]) if False else None
POSES = [('2/5a 背臥位', 0, 0), ('3 振り分け', 0, 315), ('4 腹臥位水平', 0, 180), ('4 腹臥位頭低位', -30, 180), ('5b 背臥位第1斜位', 0, 35),
         ('5c 背臥位第2斜位頭低位', -30, 307), ('5d 腹臥位第2斜位頭低位', -30, 155), ('6 右側臥位', 0, 289), ('7 半臥位第2斜位', 25, 307), ('8 腹臥位第1斜位半臥位', 25, 225)]
for c in [0.0, 0.02, 0.05]:
    t0 = time.time(); out = []
    for nm, t, r in POSES:
        if c == 0: X = S.X0; H = S.hydro(X, __import__('soft').up_bp(t, r), 150)
        else: X, H = S.solve(t, r, comp=c, outer=4, iters=30)
        m = S.measure(X, H); disp = np.linalg.norm(X - S.X0, axis=1).max()
        out.append(f"{nm}: 底{m['fundus']:.0f} 体{m['body']:.0f} 前幽{m['antPyl']:.0f} 噴門{m['cardia']:.0f} 最大変位{disp:.0f}mm")
    print('comp', c, f'{time.time()-t0:.0f}s'); print('\n'.join('  ' + o for o in out))
