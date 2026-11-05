# fit_stomach.py を実行して、胃のメッシュ・中心の線・部位の境目・噴門を取り出し、ボクセルにして保存する
import sys, runpy, numpy as np, pickle
VS = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
SRC = sys.argv[2] if len(sys.argv) > 2 else 'bp3d'   # BodyParts3D を落としたフォルダ
sys.argv = ['fit_stomach.py', SRC]
import io, contextlib
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    g = runpy.run_path('/home/user/stomach/tools/fit_stomach.py')
st = g['st']
print('watertight', st.is_watertight, 'volume mL', st.volume / 1000 if st.is_watertight else None, 'faces', len(st.faces))

vg = st.voxelized(pitch=VS).fill()
P = vg.points                       # 中の点（mm）
print('voxels', len(P), 'vol mL', len(P) * VS ** 3 / 1000)
s_pyl = g['s_acc'][g['nst'] - 1]
data = dict(P=P, VS=VS, cen=g['cen_all'], s_acc=g['s_acc'], s_fund=g['s_fund'], s_ang=g['s_ang'], s_pyl=s_pyl,
            cardia=g['cardia_c'], verts=st.vertices, normals=st.vertex_normals, C0=g['C0'])
pickle.dump(data, open(f'vox_{VS:g}.pkl', 'wb'))
