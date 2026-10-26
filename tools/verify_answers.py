#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""収録問題の正答を、厚生労働省が公表している正答値表 PDF と照合する。

index.html の収録問題それぞれについて、該当回の正答値表 PDF をダウンロードし、
表の座標から正答を読み取って、アプリ側の正答と一致するかを確かめる。

正答値表は 4 列組の表なので、行だけで読むと隣の列の数字を拾ってしまう。
そのため「問番号のセルと同じ行で、次の問番号の列より左にある数字」だけを
その問の正答として読む。

必要なもの:  pip install pdfminer.six
使い方:      python3 tools/verify_answers.py
             （ダウンロードした PDF は tools/.cache/ に残し、2 回目からは再利用する）
"""
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
import warnings

warnings.filterwarnings('ignore')
try:
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LAParams, LTChar, LTTextContainer
except ImportError:
    sys.exit('pdfminer.six が必要です:  pip install pdfminer.six')

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / '.cache'
BASE = 'https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/'
# 回 → 厚生労働省「診療放射線技師国家試験の問題および正答について」のページ
PAGES = {
    78: 'tp260424-06', 77: 'tp250428-06', 76: 'tp240424-06', 75: 'tp230524-06',
    74: 'tp220421-06', 73: 'tp210416-06', 72: 'tp200414-06', 71: 'tp190415-06',
    70: 'tp180511-06', 69: 'tp170425-06', 68: 'tp160411-04', 67: 'tp150511-04',
    66: 'tp140512-04', 65: 'tp130422-04',
}


def fetch(url, dest):
    if dest.exists() and dest.stat().st_size > 1000:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        dest.write_bytes(r.read())
    return dest


def answer_pdf(kai):
    """その回のページから正答値表 PDF を見つけて取ってくる。
    ファイル名は回によって違う（…seitou.pdf の回も …e.pdf の回もある）ので、
    リンクの文字が「正答」のものを選ぶ。"""
    url = BASE + PAGES[kai] + '.html'
    html = fetch(url, CACHE / ('%d.html' % kai)).read_bytes().decode('cp932', errors='replace')
    for href, label in re.findall(r'<a[^>]+href="([^"]+\.pdf)"[^>]*>(.*?)</a>', html, re.S):
        if '正答' in re.sub(r'<[^>]+>', '', label) or 'seito' in href:
            return fetch(urllib.parse.urljoin(url, href), CACHE / ('%d_seitou.pdf' % kai))
    sys.exit('第%d回のページに正答値表が見つかりません' % kai)


def cells(path):
    """PDF の文字を、間が空いたところで区切った「セル」(x, y, 文字列) にする"""
    out = []
    for page in extract_pages(str(path), laparams=LAParams(line_margin=0.1, char_margin=1.2)):
        for el in page:
            if not isinstance(el, LTTextContainer):
                continue
            for line in el:
                if not hasattr(line, '__iter__'):
                    continue
                chs = sorted((c for c in line if isinstance(c, LTChar) and c.get_text().strip()),
                             key=lambda c: c.x0)
                if not chs:
                    continue
                cur = [chs[0]]
                for c in chs[1:]:
                    if c.x0 - cur[-1].x1 > 2.2:
                        out.append(cur)
                        cur = [c]
                    else:
                        cur.append(c)
                out.append(cur)
    res = []
    for g in out:
        t = ''.join(c.get_text() for c in g).strip()
        if t:
            res.append((g[0].x0, sum(c.y0 for c in g) / len(g), t))
    return res


def parse_id(t):
    """問番号セルを (午前/午後, 番号) にする。第65〜75回は A001 形式、第76回以降は AM1 形式"""
    m = re.fullmatch(r'(AM|PM|A|B)0*(\d{1,3})', t)
    if not m:
        return None
    return ('午前' if m.group(1) in ('A', 'AM') else '午後'), int(m.group(2))


def read_answer(cs, half, n):
    """問番号セルと同じ行・同じ列ブロックにある数字を正答として読む"""
    ids = [(c, parse_id(c[2])) for c in cs]
    ids = [(c, p) for c, p in ids if p]
    want = [c for c, p in ids if p == (half, n)]
    if not want:
        return None
    x0, y0, _ = want[0]
    cols = sorted({round(c[0]) for c, _ in ids})
    nxt = min([x for x in cols if x > x0 + 5], default=10 ** 6)
    row = sorted((c for c in cs if abs(c[1] - y0) < 3 and x0 < c[0] < nxt - 5), key=lambda c: c[0])
    ans = []
    for _, _, t in row:
        if re.fullmatch(r'[1-5]+', t):      # 隣り合った正答は「12」のようにひとつのセルになる
            ans += [int(d) for d in t]
    return sorted(set(ans)) or None


def main():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    qs = json.loads(re.search(r'const EXAM_DEFAULT = (\[.*?\]);\n', html, re.S).group(1))
    table, bad = {}, 0
    print('%-20s %-10s %-10s %s' % ('出典', 'アプリ', '正答値表', '結果'))
    def key(q):
        m = re.match(r'第(\d+)回 (午前|午後) 第(\d+)問', q['src'])
        return int(m.group(1)), m.group(2) == '午後', int(m.group(3))
    for q in sorted(qs, key=key):
        m = re.match(r'第(\d+)回 (午前|午後) 第(\d+)問', q['src'])
        kai, half, n = int(m.group(1)), m.group(2), int(m.group(3))
        if kai not in table:
            table[kai] = cells(answer_pdf(kai))
        official = read_answer(table[kai], half, n)
        ok = official == sorted(q['a'])
        bad += not ok
        print('%-20s %-10s %-10s %s' % (q['src'], q['a'], official, '一致' if ok else '★不一致'))
    print('\n%d 問中 %d 問一致' % (len(qs), len(qs) - bad))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
