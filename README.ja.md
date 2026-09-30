# Dusklight Item Tracker

[Dusklight](https://github.com/TwilitRealm/dusklight) Randomizer 用の、自動アイテム/チェック トラッカーです。

トラッカーは Dusklight の Mod です。起動中のゲームから所持品や進行状況を読み取り、
`http://127.0.0.1:38100/` にトラッカー画面を出します。この画面をブラウザで開くか、OBS の
ブラウザソースに追加して使います。別のアプリを入れる必要はありません。

English: [README.md](README.md)

## 機能

- **Items**:Twilight Princess 風のグリッドが、プレイに合わせて自動で更新されます。表示するもの:
  - タネ・オイル・ルピーの数
  - 爆弾袋と瓶の中身
  - 矢立て・ボム袋の拡張
  - 天空文字、奥義、ゴーストの魂、金色の虫、影の結晶石、陰りの鏡の欠片
- **Dungeons**:ダンジョンごとの小さなカギ(使用済みを含む)、ボス部屋のカギまたはカギのかけら、
  マップ、コンパス、ボス、ダンジョン専用アイテム。
- **Locations**:Randomizer の全チェックを地域別に並べ、「取得済み・取れる・まだ取れない」を表示します。
  - 取れるかどうかは、Randomizer 本体のロジックと設定で判定します。
  - チェックごとに、自分で必要条件を設定できます。
  - シードにロジックが合わない場合(入口ランダムなど)は **Logic OFF** にすると、
    「取得済み/未取得」だけを表示します。
- **ゲームから作るアイコン**:Mod がプレイ中に、各自のゲームデータからアイテムアイコンを作ります。
  Mod にゲームの画像は入っていません。
- **名前の自動調整**:Items タブで長いアイテム名は、枠に収まるよう文字が自動で小さくなります。
- **カスタマイズ**:並び替え、テーマ、背景画像、アイコンを変更できます。設定は Mod に保存され、
  ブラウザと OBS で共有されます。

## 導入

1. `dusklight_item_tracker.dusk` を Dusklight の mods フォルダに入れます。
   - Windows:`%APPDATA%\TwilitRealm\Dusklight\mods`
   - Linux:`~/.local/share/TwilitRealm/Dusklight/mods`
   - macOS:`~/Library/Application Support/TwilitRealm/Dusklight/mods`
2. ゲーム内の Mod 管理画面で **Dusklight Item Tracker** を有効にします。パネルに表示されるもの:
   - トラッカーの URL(ポートの入力欄とコピーボタン付き)
   - 接続中のページ数
   - ロジックデータの状態
3. その URL をブラウザか OBS のブラウザソースで開きます。

初回起動時に、Randomizer のチェック一覧とロジックを公開リポジトリ
[dusklight-randomizer](https://github.com/TwilitRealm/dusklight-randomizer) からダウンロードし、
ローカルに保存します。これが必要なのは Locations タブだけで、それ以外はオフラインでも動きます。

## 使い方

| 場所 | 操作 | 動作 |
|---|---|---|
| Items / Dungeons | アイコンを右クリック | アイコン編集を開く(下記) |
| Items | **Golden Bugs** をクリック | 黄金の虫をすべて表示(ゲームの虫の画面と同じ並び、オス・メス別)。Agitha に渡した虫には蝶のマーク。虫や蝶を右クリックでアイコン編集 |
| Items | **Edit** | 並び替え。2 つの枠をクリック、またはドラッグで入れ替え、行の追加・削除、最後に **Confirm** |
| 全タブ | **Theme** | Twilight / Midna / Hyrule / Shadow、または背景画像を選ぶ |
| Locations | 地域をクリック | その地域のチェック一覧を表示。幅が狭いときは一覧に切り替わり、**‹ Back** で戻る |
| Locations | チェックをクリック | 必要条件を表示(and は横、or は縦に並び、満たしている項目は緑の枠) |
| Locations | **Customize** / **Edit** | そのチェックの判定を、自分のルートに置き換える(下記) |
| Locations | 必要条件の **Map** 項目をクリック | その地域の「到達可能」を ON/OFF(全チェック共通) |
| Locations | チェックを選んで **Ctrl+C**、別のチェックを選んで **Ctrl+V** | 自分で設定した条件を別のチェックにコピー。貼り付ける内容を確認するポップアップが出る(OK にフォーカスがあるので **Enter** で貼り付け、**Esc** で取り消し) |
| Locations | 右クリック | チェックや地域を強調する |
| Locations | **Logic ON/OFF** | 到達判定の ON/OFF |
| Locations | **Rules ▾** | 自分で設定した条件を JSON で書き出し・読み込み、シードの選択 |
| Locations | **Show found items** | 初期値は OFF。見つけたチェックの中身を表示(下記)。それ以外のシードの中身は表示しない |

### アイコン編集

どのアイコンも、初期状態は下の表のとおりです。1 つの枠が複数のアイコンを表示する場合(剣の段階、瓶の中身、
爆弾の種類、矢筒のマークなど)は、ドロップダウンで編集するアイコンを選びます。同じアイコンを使う枠
(すべての瓶、すべての爆弾袋)には、変更がまとめて反映されます。アイコンごとに次から選べます。

- **Default**:下の表の初期アイコン
- **From a game texture**:ゲームの **Item icons** または **Dungeon map** アーカイブのテクスチャ(プレビュー付きの一覧から選ぶ)
- **From image file**:アップロードした画像(Mod がアイコン名で保存します)

初期アイコン:

| アイコン | 初期状態 |
|---|---|
| ほとんどのアイテム | 各自のゲームのアイテムアイコンから作成 |
| Shadow Crystal、Fused Shadow、Mirror Shard | この Mod のために作ったオリジナルのアート(ゲームに 2D のアイコンがないため) |
| フィールドのカギ(Faron、Coro、Gate、Bulblin Camp) | ゲームのカギのアイコン+オリジナルの抽象的な背景 |
| ボス | フィールドマップのボスマーク。アイコン編集でボスごとに設定できます |

## クレジット

`res/web/art/` にある Shadow Crystal、影の結晶石、陰りの鏡の欠片 のアイコン、フィールドのカギの背景、昼・夜のアイコン、Agitha の蝶のマークは、
作者がこの Mod のために作ったオリジナルのアートです。ゲームの画像は含みません。

`res/web/art/ui/` のメニュー装飾(金の角飾り、見出しの巻物、テクスチャ)も、Twilight Princess のメニューを参考に
この Mod のために作ったオリジナルのアートです。

ページのフォントは [Nunito](https://github.com/googlefonts/nunito)(Vernon Adams ほか、SIL Open Font License 1.1、
`res/web/fonts/Nunito-OFL.txt`)です。

### 自分で設定する条件

**Customize** を押すと、条件の編集画面が別ウィンドウで開きます(ウィンドウを開けない OBS ではパネル内)。
**Save** を押すとウィンドウは自動で閉じます。

- 上の枠:保存後と同じ見た目で、ルートごとに 1 行ずつ表示します。1 つのルートの項目はすべて必要で、
  どれか 1 つのルートを満たせば到達可能です。ルートをクリックすると、そのルートに追加します。
- 項目はドラッグで移動できます(同じルート内の並べ替えや、別のルート・Option への移動)。ルートや Option は
  「Route 1」などの見出しをドラッグして並べ替えます。
- **+ Or group**:「いずれか 1 つを満たせばよい」部品をルートに追加します。`A and (B or C)` や
  `(A or B) and (C or D)` が設定できます。Option の中にさらに Or group も入れられます。Option をクリックすると
  そこに追加します(追加先は下の枠の見出しに表示)。
- 下の枠:6 つのタブから条件を選びます。各タブは 2 列のチェックボックス一覧で、チェックが入った項目が
  選択中のルートに入っています。クリックで追加・削除します。複数あるアイテムは行の右に個数欄(`1 / 4`)があり、
  そのアイテムの総数までしか入力できません。Items は Items タブのグループと順番・アイコンに従い、
  Map は地方ごとにまとめています。検索欄に入力すると絞り込まれ、**Enter** で一番近い候補を追加します。

| タブ | 条件 | 満たす条件 |
|---|---|---|
| Items | Randomizer のアイテム(個数付き) | 持っている |
| Dungeon | ダンジョンのカギ、ボス、入口(Goron Mines Entrance Opened、ダンジョンの条件の設定、Door to the Past Opened、Mirror of Twilight Repaired、Hyrule Barrier Dispelled)。それぞれ通常のクリア順 | カギを持っている/ボスを倒した/設定が ON、またはシードの解放条件を今のアイテムで満たしている(ゲーム内で開いている場合も) |
| Portals | Gerudo Desert、Mirror Chamber、Snowpeak、Sacred Grove、Bridge of Eldin、Upper Zoras River のポータル | ゲーム内でポータルが開いている |
| Time | Day、Night | ゲーム内の時計がその時間帯(夜は 19:00〜6:00) |
| Rand Settings | Faron Twilight Cleared、Open Door of Time などの ON/OFF 設定 | 設定が ON。3 つの Twilight はセーブデータからも読むので、プレイでクリアした場合も満たす |
| Map Reachable | Randomizer のロジックの地域(Faron Woods、North Eldin など) | 「到達可能」になっている。ゲームでその地域に入ると自動で ON になり、チェックの必要条件にある Map 項目のクリックでも切り替えられる。新しいシードでは **Unmark all** で全部解除 |

### 見つけたチェックの中身

**Show found items** を ON にすると、見つけたチェックの中身を表示します。

| 見つけ方 | タイミング |
|---|---|
| 取得 | チェックを取得した |
| ヒント | 「They say that the reward for … is …」のヒントを読んだ |
| 目視 | 置かれているアイテム(ボスのハートの器を含む)にリンクが近づいた |
| ショップ | そのショップに入った |

中身はシードフォルダのスポイラーログから読むため、スポイラーログのあるシードが必要です。見つけた情報は
ゲームのセーブデータと一緒に保存されます(ゲームでセーブしたときに保存され、ロードするとその時点の情報に
戻ります。クイックセーブには非対応)。セーブデータはシードも覚えます。新しいセーブでは最新のシード、
または **Rules ▾** で選んだシードを使います。

### OBS

トラッカーの URL をブラウザソースに追加します。次の URL オプションは組み合わせて使えます。

| オプション | 効果 |
|---|---|
| `?view=items`、`?view=dungeons`、`?view=locations` | 1 つのタブだけを表示 |
| `?header=0` | タブのバーを隠す |
| `?transparent=1` | 背景を透明にする |
| `?size=<px>` | 枠の大きさ(初期値 64) |

## ビルド

```sh
cmake -B build
cmake --build build
```

結果は `build/mods/dusklight_item_tracker.dusk` で、自分のプラットフォームでのみ動きます。
初回の configure で Dusklight のソースをダウンロードします。

### GitHub Actions

| トリガー | ビルド内容 |
|---|---|
| Pull request | Linux x86_64(ホストテスト付き)と Windows x64。Windows 用の `.dusk` を実行結果に添付 |
| タグ(例:`v0.1.0`) | 全 8 プラットフォームをまとめた `.dusk` を作り、GitHub のリリースに添付 |
| 手動(Actions → Build → Run workflow) | `full`(全プラットフォームとまとめた `.dusk`)または `quick`(PR と同じチェック) |

### Mod 管理画面用の画像

Mod 管理画面と Mod サイトには `res/icon.png`(正方形)と `res/banner.png`(約 3.5:1)が表示されます。
ゲームのアイコンを使って作る手順:

1. セーブデータを読み込んだ状態でゲームを起動し、`http://127.0.0.1:38100/promo.html` を開きます。
2. ブラウザの開発者ツールで `#icon` と `#banner` の要素を選び、「Capture node screenshot」で保存します。

## テスト

```sh
tests/run.sh
```

Dusklight のサービスをメモリ上の偽物に置き換えて、ホスト側のテストをビルド・実行します。

| テスト | 対象 |
|---|---|
| `tests/web_server_test.cpp` | HTTP サーバー |
| `tests/rando_data_test.cpp` | ロジックデータのダウンロード |
| `tests/gx_texture_test.cpp` | テクスチャの読み込みと PNG 出力 |

先に一度 `cmake -B build` を実行してください。fmt が `build/_deps` に取得されていない場合は `FMT_INCLUDE` を設定します。

```sh
node tests/logic_check.mjs <dusklight-randomizer>/generator/data [rules.json]
```

JavaScript に移植したロジックを、Randomizer のデータで検証します。「Export rules」で保存したファイルを
渡すと、その中の自分で設定した条件も検証します。

## ゲームなしでの画面開発

```sh
node tools/mock_server.mjs
```

`res/web/` を同じポートで配信し、台本どおりの模擬プレイを流します。Dusklight を起動しなくても
画面の開発ができます。使える環境変数:

| 変数 | 用途 |
|---|---|
| `RANDO_DATA` | Locations タブ用。Randomizer のリポジトリの `generator/data` フォルダ |
| `ICON_DIR` | ゲームのアイコン用アーカイブの代わりに使う PNG のフォルダ |
| `GAME_ICON_DIR` | ゲームから作るアイコンの代わりに使う `<アイテム番号>.png` のフォルダ |

状態データとイベントの形式は [docs/protocol.md](docs/protocol.md) にあります。
