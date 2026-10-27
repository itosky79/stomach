"""BodyParts3D から患者の体表と骨を取り出し、軽くして、v2 の座標に変換して js/anatomy-data.js に書き出す。

使い方：
  1. https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html から次の 2 つを 1 つのフォルダに落とす
     - partof_element_parts.txt
     - partof_BP3D_4.0_obj_99.zip
  2. pip install numpy scipy trimesh fast-simplification
  3. python3 tools/build_anatomy.py <落としたフォルダ> js/anatomy-data.js

座標：BodyParts3D は mm、x = 左(+)、y = 腹側が負、z = 頭側(+)。
v2 の bodyGroup の座標は、胃の中心が原点、x = 左(+)、y = 頭側(+)、z = 腹側(+)、単位は (実寸 cm) / BODY_SCALE。
ライセンス：BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
"""
import sys, io, json, base64, zipfile
import numpy as np, trimesh, fast_simplification
from scipy.spatial import cKDTree

SRC, OUT = sys.argv[1], sys.argv[2]
BODY_SCALE = 1.2                                   # js/scene.js の BODY_SCALE と同じ
PARTS = {                                          # 使う部品（FMA の概念 ID）
    'stomach': ['FMA7148'],
    'skin': ['FMA7163'],
    'esophagus': ['FMA7131'],
    'bones': ['FMA7480', 'FMA9140', 'FMA16203'],    # 胸郭（肋骨・肋軟骨・胸骨）、胸椎、腰椎
}
SKIP = {'FMA16033', 'FMA16034', 'FMA16035', 'FMA16036', 'FMA16037'}   # 腰椎の椎間板は骨ではないので除く
FACES = {'skin': 16000, 'bones': 24000}             # 軽くしたあとの三角形の数

rows = [l.rstrip('\n').split('\t') for l in open(f'{SRC}/partof_element_parts.txt', encoding='utf-8')][1:]
def elements(fmas):
    skip = {r[2] for r in rows if r[0] in SKIP}
    return sorted({r[2] for r in rows if r[0] in fmas} - skip)
zf = zipfile.ZipFile(f'{SRC}/partof_BP3D_4.0_obj_99.zip')
def load(key): return load_ids(PARTS[key])
def load_ids(fmas):
    ms = []
    for e in elements(fmas):
        data = zf.read(f'partof_BP3D_4.0_obj_99/{e}.obj')
        ms.append(trimesh.load(io.BytesIO(data), file_type='obj', process=False, force='mesh'))
    m = trimesh.util.concatenate(ms); m.merge_vertices(); return m

stom, skin, bones, eso = load('stomach'), load('skin'), load('bones'), load('esophagus')
c = (stom.bounds[0] + stom.bounds[1]) / 2          # 胃の外接箱の中心（mm）
def to_body(v):
    d = (v - c) / 10.0 / BODY_SCALE
    return np.stack([d[:, 0], d[:, 2], -d[:, 1]], 1)
def simplify(m, faces):
    if len(m.faces) <= faces: return m.vertices, m.faces
    return fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int32), 1 - faces / len(m.faces))
def pack(v, f):   # 位置は 16 bit に量子化し、base64 にする
    v = to_body(np.asarray(v, np.float64)); lo = v.min(0); s = (v.max(0) - lo) / 65535.0
    q = np.round((v - lo) / s).astype(np.uint16)
    idx = np.asarray(f, np.uint16 if len(v) < 65536 else np.uint32)
    return {'n': int(len(v)), 'lo': lo.round(5).tolist(), 's': s.round(8).tolist(),
            'pos': base64.b64encode(q.tobytes()).decode(), 'idx': base64.b64encode(idx.tobytes()).decode(),
            'i32': bool(idx.dtype == np.uint32)}

sk = skin.vertices
headv = sk[sk[:, 2] > sk[:, 2].max() - 250]
meta = {                                            # 実寸 cm（胃の中心から）。透視台の位置合わせに使う
    'back': round(float((sk[:, 1].max() - c[1]) / 10), 2),     # 背中まで
    'sole': round(float((c[2] - sk[:, 2].min()) / 10), 2),     # 足の裏まで
    'head': round(float((sk[:, 2].max() - c[2]) / 10), 2),     # 頭頂まで
    'nose': to_body(headv[headv[:, 1].argmin()][None])[0].round(3).tolist(),   # 鼻先（bodyGroup の座標）
    'dia': round(float((stom.bounds[1][2] + 15 - c[2]) / 10 / BODY_SCALE), 3), # 胃底部の上 1.5 cm を横隔膜とみなす（同上）
    # 噴門（胃と食道の境目）：胃の頂点のうち食道の頂点から 6 mm 以内のものの重心（bodyGroup の座標）。
    # 胃の型を体に合わせるときの基準点（噴門は横隔膜の食道裂孔のところで位置が決まっているため）
    'cardia': to_body(stom.vertices[cKDTree(eso.vertices).query(stom.vertices)[0] < 6.0].mean(0)[None])[0].round(3).tolist(),
    'stomachMm': c.round(1).tolist(),
}
# 椎体（胸椎・腰椎の前の部分）の左右の縁。教科書の斜位の目安（「噴門部が椎体右縁に重なる」など）から角度を求めるのに使う。
# 高さ y（bodyGroup の座標、0.5 刻み）ごとに、前後 0.5 の範囲の骨の頂点のうち、いちばん腹側から実寸 3 cm までを椎体とみなし
# （横突起・棘突起などの後ろの部分を除く）、その [y, x の最小, x の最大, z の最小, z の最大] を並べる
sp = to_body(load_ids(['FMA9140', 'FMA16203']).vertices)
spine = []
for y in np.arange(np.floor(sp[:, 1].min()), np.ceil(sp[:, 1].max()), 0.5):
    s_ = sp[(sp[:, 1] >= y - 0.5) & (sp[:, 1] < y + 0.5)]
    if len(s_) < 20: continue
    b = s_[s_[:, 2] >= s_[:, 2].max() - 3.0 / BODY_SCALE]
    spine.append([round(float(y), 2), round(float(b[:, 0].min()), 3), round(float(b[:, 0].max()), 3),
                  round(float(b[:, 2].min()), 3), round(float(b[:, 2].max()), 3)])
meta['spine'] = spine
data = {'meta': meta, 'skin': pack(*simplify(skin, FACES['skin'])), 'bones': pack(*simplify(bones, FACES['bones']))}
with open(OUT, 'w', encoding='utf-8') as fo:
    fo.write('"use strict";\n/* BodyParts3D から作った患者の体表と骨（tools/build_anatomy.py で生成。手で直さない）\n'
             '   BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International */\n')
    fo.write('const BP3D = ' + json.dumps(data, separators=(',', ':')) + ';\n')
print({k: v for k, v in meta.items() if k != 'spine'}, len(meta['spine']), 'spine rows')
