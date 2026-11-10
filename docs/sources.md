# 出典

## 国家試験の問題・正答

厚生労働省「診療放射線技師国家試験の問題および正答について」。ウェブで公開されているのは第65回（平成25年）以降で、第65〜78回を対象にしました。

| 回 | ページ |
|---|---|
| 第78回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp260424-06.html |
| 第77回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp250428-06.html |
| 第76回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp240424-06.html |
| 第75回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp230524-06.html |
| 第74回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp220421-06.html |
| 第73回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp210416-06.html |
| 第72回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp200414-06.html |
| 第71回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp190415-06.html |
| 第70回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp180511-06.html |
| 第69回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp170425-06.html |
| 第68回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp160411-04.html |
| 第67回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp150511-04.html |
| 第66回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp140512-04.html |
| 第65回 | https://www.mhlw.go.jp/seisakunitsuite/bunya/kenkou_iryou/iryou/topics/tp130422-04.html |

### 選んだ問題・外した問題

- 設問に胃・幽門・噴門・十二指腸・食道が出る問題、上部消化管造影の撮影技術の問題を収録
- 注腸造影（下部消化管）と、診療放射線技師の業務範囲（法規）の問題は外した
- 第71回 午前 第60問「胃液中に含まれるのはどれか」は、設問に「2つ選べ」が無いのに正答値表の正答が 2 つあるため外した
- 正答はすべて正答値表と照合（`tools/verify_answers.py`、22 問中 22 問一致）

## 撮影体位と撮影手順

- 日本消化器がん検診学会『胃がん検診のための胃X線検査マニュアル 2025改訂第3版』（2025年6月15日）表 1-Ⅱ-1「基準撮影法Ⅰ・Ⅱの撮影体位」
  https://www.jsgcs.or.jp/files/uploads/igankenshin_Xsen_manual2025.pdf
- 河内 幸夫「胃がん検診における基準撮影法（NPO 日本消化器がん検診精度管理評価機構）と新認定制度について」（2010年）
  https://plaza.umin.ac.jp/~GifuART/sibu/seino/2010_seino_HP/pdf/22kawachi.pdf
- 公益財団法人 福島県保健衛生協会『胃透視検査 その1・その2』（2015年8月、「新・胃X線撮影法ガイドライン」より）— 第1斜位・第2斜位の向きの根拠
  https://www.fhk.or.jp/wp/wp-content/themes/fhk/img/cancer_health/itousikensa.pdf

## 体位ごとの描出部位

- 日本人間ドック・予防医療学会『上部消化管エックス線健診判定マニュアル』「撮影体位、枚数」（2011年 新・胃X線撮影法ガイドライン改訂版の基準撮影法〔任意型〕に準拠）
  https://www.ningen-dock.jp/ningendock/pdf/UpperGastrointestinal.pdf
- 上部消化管造影検査｜Radiological Site（体位と描出部位の対応の参考）
  https://radiological.site/archives/%E4%B8%8A%E9%83%A8%E6%B6%88%E5%8C%96%E7%AE%A1%E9%80%A0%E5%BD%B1%E6%A4%9C%E6%9F%BB.html

## 同梱物とライセンス

- `three.min.js` — [three.js](https://threejs.org/) r128。MIT License, Copyright 2010-2021 Three.js Authors。ファイル先頭のライセンス表示はそのまま残している
- 収録している問題文・選択肢・正答は、厚生労働省が公表している診療放射線技師国家試験の問題および正答。各問に出典を表示している
- 同梱している上部消化管造影写真 5 枚（`data/figures/`）は、同試験の「別冊」PDF から取り込んだもの。**学会発表のスライドや論文に載せる場合、また一般に配布する場合は、これらの画像の扱いを確認すること**
- 図に重ねている解剖の名札は、このリポジトリで付けた注釈で、試験問題には含まれない。読み取りに確信が持てない構造には付けていない

## 人体の 3D モデル（v2）

v2 の患者の体表と骨（胸郭・胸骨・胸椎・腰椎）は BodyParts3D から作った。

- 出典：BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
- 入手先：https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html（`partof_BP3D_4.0_obj_99.zip`、`partof_element_parts.txt`）
- ライセンス：CC BY 4.0（データベースのライセンスのページ、2025-02-27 更新）。出典を表示すれば、改変・再配布・派生物の公開ができる。継承（SA）の条件はない
  - 配布されている OBJ ファイルの先頭には、以前のライセンス（CC 表示-継承 2.1 日本）の文言が残っている。データベースとしては 2025 年に CC BY 4.0 に変わっているので、v2 では CC BY 4.0 として扱い、出典の文言も新しいものにした
- 加工：`tools/build_anatomy.py` で、部品を選び、三角形を減らし（体表 16,000、骨 24,000）、v2 の座標（胃の中心が原点、cm）に変換して `js/anatomy-data.js` に書き出した
- 加工（胃）：`tools/fit_stomach.py` で、BodyParts3D の胃と十二指腸を輪切りにして中心の線と太さを求め、胃の型「解剖モデル」（`js/data.js` の `TYPES.bp3d`）にした。さらに次のように改変している（BodyParts3D の胃の形そのままではない）
  - 太さ：検査中の胃の中身（バリウム 150 mL ＋ 発泡剤のガス 250 mL）に容積が合うよう変え、胃角より口側ほどよく膨らむ割合は MRI の実測（Min ほか, PLoS ONE 2015）に合わせた（`js/model.js` の DISTEND）
  - 穹窿部：太くし、背中側へ深くした（2026-11-04、2026-11-10。`js/model.js` の FUNDUS）
  - J 字の形：噴門より下を縦に 2 倍に伸ばし、胃角より先を持ち上げた（2026-11-10。`js/model.js` の JSHAPE）。教科書（虎の巻 pp.91-96）の X 線像と、教科書の記載との一致で選んだ値
  - 胃体部を腹側へ出し、穹窿部をさらに深くした（2026-11-10。`js/model.js` の JSHAPE.body・FUNDUS.d）。背臥位で穹窿部のバリウムが胃体部へ広がりすぎないようにするため。値は見た目と教科書の 10 項目で選んだ
  - 胃角部から十二指腸：胃角より先を持ち上げて横に寄せ、前庭部〜幽門前部を太くし、十二指腸球部を上へ向けて太くした（2026-11-10。`js/model.js` の JSHAPE）。虎の巻 pp.91-96 の X 線像に合わせた見た目の値
  - 圧迫フトン：腹臥位の頭低位で胃体部の前の壁を押す（2026-11-10。`js/model.js` の FUTON）。強さは見た目と教科書の 10 項目で選んだ値
  - 体位による向き：体位ごとに、噴門のまわりのねじれと振れを加える（`js/data.js` の `TYPES.bp3d.twist`）
- 表示：アプリの最初の案内に出典を 1 行出している
