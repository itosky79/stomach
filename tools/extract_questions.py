#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index.html に埋め込んだ収録問題を、読める形のファイルに書き出す。

アプリは index.html 1 枚で動くように問題と図を中に埋め込んでいる。
NAS での保管や指導教員の確認用に、それを次の形で取り出す。

  data/questions.json   問題文・選択肢・正答・解説・体位・名札（図は別ファイル）
  data/figures/*.jpg    設問の図（別冊の上部消化管造影写真）
  docs/questions.md     収録問題の一覧表

使い方:  python3 tools/extract_questions.py
index.html の問題を書き換えたら、もう一度実行して作り直すこと。
"""
import base64
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def load_questions():
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    m = re.search(r'const EXAM_DEFAULT = (\[.*?\]);\n', html, re.S)
    if not m:
        sys.exit('index.html に EXAM_DEFAULT が見つかりません')
    return json.loads(m.group(1))


def slug(src):
    """「第76回 午後 第85問」→「76_PM_085」"""
    m = re.match(r'第(\d+)回 (午前|午後) 第(\d+)問', src)
    return '%s_%s_%03d' % (m.group(1), 'AM' if m.group(2) == '午前' else 'PM', int(m.group(3)))


def main():
    qs = load_questions()
    data_dir, fig_dir = ROOT / 'data', ROOT / 'data' / 'figures'
    fig_dir.mkdir(parents=True, exist_ok=True)

    out = []
    for q in qs:
        row = {k: q[k] for k in ('src', 'q', 'c', 'a', 'e') if k in q}
        if q.get('set'):
            row['pose'] = {'tilt': q['set'][0], 'roll': q['set'][1]}
        if q.get('img'):
            name = slug(q['src']) + '.jpg'
            (fig_dir / name).write_bytes(base64.b64decode(q['img'].split(',', 1)[1]))
            row['figure'] = 'figures/' + name
        if q.get('ann'):
            row['labels'] = [{'x_pct': a[0], 'y_pct': a[1], 'name': a[2]} for a in q['ann']]
        out.append(row)

    out.sort(key=lambda r: slug(r['src']))
    (data_dir / 'questions.json').write_text(
        json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    lines = [
        '# 収録問題の一覧',
        '',
        '`index.html` に収録している診療放射線技師国家試験の過去問です。',
        '正答はすべて厚生労働省の正答値表と照合済みです（`tools/verify_answers.py`）。',
        '',
        'このファイルは `tools/extract_questions.py` が `index.html` から作っています。手で編集しないでください。',
        '',
        '| # | 出典 | 設問 | 正答 | 図 |',
        '|---|---|---|---|---|',
    ]
    for i, r in enumerate(out, 1):
        ans = '・'.join('%d %s' % (a, r['c'][a - 1]) for a in r['a'])
        fig = '[図](../data/%s)' % r['figure'] if 'figure' in r else ''
        lines.append('| %d | %s | %s | %s | %s |' % (i, r['src'], r['q'].replace('|', '｜'), ans, fig))
    lines += ['', '## 解説', '']
    for i, r in enumerate(out, 1):
        lines.append('**%d. %s** — %s' % (i, r['src'], r.get('e', '')))
        lines.append('')
    (ROOT / 'docs').mkdir(exist_ok=True)
    (ROOT / 'docs' / 'questions.md').write_text('\n'.join(lines), encoding='utf-8')

    figs = sorted(p.name for p in fig_dir.glob('*.jpg'))
    print('%d 問 → data/questions.json' % len(out))
    print('図 %d 枚 → data/figures/ (%s)' % (len(figs), ', '.join(figs)))
    print('一覧 → docs/questions.md')


if __name__ == '__main__':
    main()
