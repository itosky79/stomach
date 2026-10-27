"""TotalSegmentator の CT（CC BY 4.0）の胃・食道・十二指腸のマスクから、tools/fit_stomach.py と同じ手順で胃の管の形を作る。

使い方：python3 tools/ct/fit_ct.py <TotalSegmentator を展開したフォルダ> <被験者 ID の一覧のファイル> <出力 JSON>
  フォルダには <ID>/segmentations/{stomach,esophagus,duodenum}.nii.gz を置く。
  pip install numpy scipy trimesh networkx nibabel scikit-image fast-simplification

座標：CT の RAS（x 右、y 腹側、z 頭側、mm）を BodyParts3D と同じ向き（x 左、y 腹側が負、z 頭側、mm）に直してから、
fit_stomach.py の手順（調和関数で輪切り → 中心の線と太さ → 噴門・胃底部・胃角・幽門 → 模型の座標）をそのまま実行する。
大きさは変えない（検査中の大きさへの合わせ方はアプリ側で、解剖モデルと同じく太さだけを変える）。"""
import sys, io, os, json, contextlib, traceback
import numpy as np, nibabel as nib, trimesh, fast_simplification
from skimage import measure
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(HERE, '..', 'fit_stomach.py'), encoding='utf-8').read()
HEAD, BODY = SRC.split("st, du, es = load('FMA7148'), load('FMA7206'), load('FMA7131')\n")
# HEAD の import と定数、関数だけを使う（BodyParts3D を読む部分は使わない）
HEAD = HEAD.split("SRC = sys.argv[1]")[0] + "BODY_SCALE, FLAT, NCTL = 1.2, 0.78, 12\nTARGET_CAP = None\n"

def mesh_of(path, faces=6000):
    img = nib.load(path); m = np.asarray(img.dataobj) > 0
    if m.sum() < 50: return None
    lab = measure.label(m); big = np.argmax(np.bincount(lab.ravel())[1:]) + 1; m = lab == big   # いちばん大きな塊だけ
    m = np.pad(m, 1)
    v, f, _, _ = measure.marching_cubes(m.astype(np.float32), 0.5)
    v = v - 1
    ras = nib.affines.apply_affine(img.affine, v)
    bp = np.stack([-ras[:, 0], -ras[:, 1], ras[:, 2]], 1)          # RAS → x 左、y 腹側が負、z 頭側
    if len(f) > faces:
        bp, f = fast_simplification.simplify(bp.astype(np.float32), f.astype(np.int32), 1 - faces / len(f))
    t = trimesh.Trimesh(bp, f, process=True)
    trimesh.smoothing.filter_taubin(t, iterations=10)
    t.fix_normals()
    return t

def fit_one(args):
    root, sid = args
    try:
        seg = os.path.join(root, sid, 'segmentations')
        st, du, es = (mesh_of(os.path.join(seg, n + '.nii.gz')) for n in ('stomach', 'duodenum', 'esophagus'))
        if st is None or du is None or es is None: return sid, {'error': 'mask missing'}
        g = {'st': st, 'du': du, 'es': es}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf): exec(HEAD + BODY, g)
        out = json.loads(buf.getvalue().strip().splitlines()[-1])
        img = nib.load(os.path.join(seg, 'stomach.nii.gz'))
        out['volume_ml'] = round(float((np.asarray(img.dataobj) > 0).sum() * abs(np.linalg.det(img.affine[:3, :3])) / 1000), 1)   # マスクの容積
        return sid, out
    except Exception as e:
        return sid, {'error': repr(e)[:200]}

if __name__ == '__main__':
    root, idfile, outp = sys.argv[1:4]
    ids = open(idfile).read().split()
    res = {}
    with Pool(int(os.environ.get('NPROC', '4'))) as p:
        for k, (sid, out) in enumerate(p.imap_unordered(fit_one, [(root, i) for i in ids])):
            res[sid] = out
            if k % 25 == 0: print(k, sid, 'error' in out, flush=True)
    json.dump(res, open(outp, 'w'), ensure_ascii=False)
    print('ok', sum('error' not in v for v in res.values()), '/', len(res))
