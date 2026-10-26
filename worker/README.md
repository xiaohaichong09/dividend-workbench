# 独立同步 Worker

页面部署在 Cloudflare Pages 时，默认使用同域的 `/api/sync`（`_worker.js`），不需要这个 Worker。

只有在想用独立地址时才需要部署：

- 想用 `https://dividend-sync.<你的子域>.workers.dev` 作为固定同步地址；
- 页面部署在其他静态托管，且不想回退到 Pages 的 `/api/sync`。

> 当前账号的 `workers.dev` 子域未启用，主站和 GitHub Pages 都使用
> `https://dividend-app-cym.pages.dev/api/sync`，不依赖这个 Worker。

```bash
cd worker
npx wrangler deploy
npx wrangler secret put SYNC_KEY
```

`wrangler.toml` 里已经绑定 KV `dividend-workbench`。`SYNC_KEY` 必须和页面「设置 → 数据同步」里填的密钥一致。
