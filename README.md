# NEO BLACKJACK

ブラックジャック × モンスター育成。友達と最大4人でオンライン対戦(空き席はBOT)。

## ファイル
- index.html : ゲーム本体(1ファイル)
- server.js : 配信 + ランキングAPI + 友達部屋(WebSocket)。外部ライブラリ不要
- package.json / render.yaml / .gitignore : デプロイ用

## ローカルで動かす
    node server.js
    → http://localhost:3000 を開く(Node 18以上)

## GitHub + Render で公開
1. GitHubで新しいリポジトリを作り、全ファイルをリポジトリ直下にアップロード
2. Render → New + → Web Service → そのリポジトリを接続
3. Build Command: echo ok / Start Command: node server.js / Plan: Free
4. 出てきた https://〜.onrender.com を友達に送る
5. 「ONLINE」→ 部屋を作る → 4桁の番号を伝える

## 注意
- 無料プランは15分無操作でスリープ(再開に30秒〜1分)。ランキングは再デプロイで消えることがある
- index.html を直接開くと、1人用は動くがオンライン機能は動かない
