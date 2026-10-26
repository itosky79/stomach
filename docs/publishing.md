# 公開範囲の設定と保管

学会発表の準備中は、**URL を知っている人（指導教員など）は開けるが、検索や GitHub からは見つからない**状態にする。

## 1. 検索エンジンから外す（済）

`index.html` に次を入れてある。

```html
<meta name="robots" content="noindex, nofollow, noarchive">
```

- 検索エンジンはこのページを検索結果に載せなくなる。URL を直接開けば今までどおり使える
- すでに検索結果に載っていた場合は、検索エンジンが次に巡回したときに消える（数日〜数週間）
- 急いで消したいときは Google Search Console の「削除」を使う（サイトの所有確認が必要）

## 2. GitHub から隠す（リポジトリを非公開にする）

GitHub 上でコードを見えなくするには、リポジトリを private にする。

**ただし、無料プラン（GitHub Free）では、private のリポジトリから GitHub Pages を公開できない。** 無料プランのまま private にすると、その時点でサイトが止まり URL が開けなくなる。

GitHub Pro なら private のリポジトリからも Pages を公開でき、**サイトは URL を知っている人なら誰でも開ける**（閲覧者を絞れるのは GitHub Enterprise Cloud の組織だけ）。つまり Pro にすれば「コードは非公開・URL は有効・検索には出ない」がそろう。

| | リポジトリ public のまま | Pro にして private |
|---|---|---|
| URL で開ける | ○ | ○ |
| 検索エンジンに出ない | ○（noindex） | ○（noindex） |
| GitHub 上でコードが見えない | × | ○ |

### 手順（順番を守ること）

1. GitHub Pro にする。学生は GitHub Education に申請できる（学生証など在学を示すものが必要）。特典に Pro が含まれるかは、承認後に GitHub Education のポータルで確認する
2. **Pro が有効になったことを確認してから**、Settings → General → 一番下の Danger Zone → Change repository visibility → Make private
3. URL を開いて、まだ表示されることを確かめる
4. 指導教員にコードも見てもらう場合は、Settings → Collaborators から招待する

Pro にしない場合は、リポジトリは public のまま、検索エンジン除外だけで運用する（GitHub 上で探されれば見つかる）。

### 注意

- サイトの中身（アプリ・収録問題・図）は `index.html` に全部入っている。URL を知っている人は誰でも全部見られるので、URL の渡し方に注意する
- リポジトリの About 欄の Website や README に URL を書くと、そこから辿れてしまう。現在の README には書いていない
- GitHub Pages はリポジトリ内のファイルをすべて配信するので、`docs/` や `data/` も URL の後ろにパスを付ければ開ける。アプリからはリンクしていないので普通は見つからないが、アプリ本体以外は配信したくない場合は、Pages の配信元を GitHub Actions に切り替えて `index.html` と `three.min.js` だけを置く方法がある

## 3. 研究室の NAS に保管する

### 履歴ごと 1 ファイルにする（おすすめ）

```sh
git clone https://github.com/<アカウント>/stomach.git
cd stomach
git bundle create ../stomach_YYYYMMDD.bundle --all
```

`stomach_YYYYMMDD.bundle` を NAS に置く。変更履歴をすべて含んだ 1 ファイルで、あとから `git clone stomach_YYYYMMDD.bundle` で元に戻せる。

### フォルダごと置く

`git clone` したフォルダをそのまま NAS にコピーしてもよい。GitHub の Code → Download ZIP でも取れる（ZIP には変更履歴が入らない）。

private にしたあとは、clone に GitHub へのログインが必要になる。

### NAS 上で使う

- `index.html` と `three.min.js` が同じフォルダにあれば、`start.bat`（Windows）か `start.command`（Mac）をダブルクリックするだけで動く。`index.html` を直接開いてもよい。インターネット接続は不要（フォントだけは代わりのものになる）
- 収録問題の正答を確かめ直す:  `pip install pdfminer.six` のあと `python3 tools/verify_answers.py`（厚生労働省のサイトに接続する）
- 収録問題を書き換えたら:  `python3 tools/extract_questions.py` で `data/` と `docs/questions.md` を作り直す
