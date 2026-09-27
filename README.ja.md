# ShadowQ Item Tracker

[Dusklight](https://github.com/TwilitRealm/dusklight) Randomizer 用の、自動アイテム/チェック トラッカーです。

トラッカーは Dusklight の Mod です。起動中のゲームから所持品や進行状況を読み取り、
`http://127.0.0.1:38100/` にトラッカー画面を出します。この画面をブラウザで開くか、OBS の
ブラウザソースに追加して使います。別のアプリを入れる必要はありません。

English: [README.md](README.md)

## 機能

- **Items**:Twilight Princess 風のグリッドが、プレイに合わせて自動で更新されます。表示するもの:
  - 弾・オイル・ルピーの数
  - 爆弾袋と瓶の中身
  - 矢筒・爆弾袋の拡張
  - 天空文字、奥義、ポウの魂、黄金の虫、Fused Shadow、Mirror Shard
- **Dungeons**:ダンジョンごとの小さなカギ(使用済みを含む)、ボスカギまたはカギのかけら、
  マップ、コンパス、ボス、ダンジョン専用アイテム。
- **Locations**:Randomizer の全チェックを地域別に並べ、「取得済み・取れる・まだ取れない」を表示します。
  - 取れるかどうかは、Randomizer 本体のロジックと設定で判定します。
  - チェックごとに、自分で必要条件を設定できます。
  - シードにロジックが合わない場合(入口ランダムなど)は **Logic OFF** にすると、
    「取得済み/未取得」だけを表示します。
- **ゲームから作るアイコン**:Mod がプレイ中に、各自のゲームデータからアイテムアイコンを作ります。
  Mod にゲームの画像は入っていません。
- **カスタマイズ**:並び替え、テーマ、背景画像、アイコンを変更できます。設定は Mod に保存され、
  ブラウザと OBS で共有されます。

## 導入

1. `shadowq_tracker.dusk` を Dusklight の mods フォルダに入れます。
   - Windows:`%APPDATA%\TwilitRealm\Dusklight\mods`
   - Linux:`~/.local/share/TwilitRealm/Dusklight/mods`
   - macOS:`~/Library/Application Support/TwilitRealm/Dusklight/mods`
2. ゲーム内の Mod 管理画面で **ShadowQ Item Tracker** を有効にします。パネルに表示されるもの:
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
| Items | **Edit** | 並び替え。2 つの枠をクリック、またはドラッグで入れ替え、行の追加・削除、最後に **Confirm** |
| 全タブ | **Theme** | Twilight / Midna / Hyrule / Shadow、または背景画像を選ぶ |
| Locations | 地域をクリック | その地域のチェック一覧を表示。幅が狭いときは一覧に切り替わり、**‹ Back** で戻る |
| Locations | チェックをクリック | 必要条件を表示(and は横、or は縦に並び、満たしている項目は緑の枠) |
| Locations | **Customize** / **Edit** | そのチェックの判定を、自分のルート(アイテムやロジック式)に置き換える |
| Locations | 右クリック | チェックや地域を強調する |
| Locations | **Logic ON/OFF** | 到達判定の ON/OFF |
| Locations | **Rules ▾** | 自分で設定した条件を JSON で書き出し・読み込み |

### アイコン編集

どのアイコンも、初期状態はゲームのアイコンです。アイコンごとに次から選べます。

- **From the game**:初期状態のアイコン
- **From a game texture**:ゲームの 2D アーカイブにある任意のテクスチャ(プレビュー付きの一覧から選ぶ)
- **From image file**:アップロードした画像(Mod がアイコン名で保存します)

アイコンの**背景**にゲームのテクスチャを敷くこともできます(例:フィールドのカギの後ろにフィールドの画像)。

Shadow Crystal、Fused Shadow、Mirror Shard、ボスには、ゲームに 2D のアイコンがありません。
アイコンを設定するまでは文字で表示されます。

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

結果は `build/mods/shadowq_tracker.dusk` で、自分のプラットフォームでのみ動きます。
初回の configure で Dusklight のソースをダウンロードします。

### GitHub Actions

| きっかけ | ビルド内容 |
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
