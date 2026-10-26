# 独立同步 Worker

页面部署在 Cloudflare Pages 时，默认使用同域的 `/api/sync`（`_worker.js`），不需要这个 Worker。

只有在下面情况才需要单独部署：

- 页面部署在 GitHub Pages / 其他静态托管，跨域调用同步接口；
- 想用 `https://dividend-sync.<你的子域>.workers.dev` 作为固定同步地址。

```bash
cd worker
npx wrangler deploy
npx wrangler secret put SYNC_KEY
```

`wrangler.toml` 里已经绑定 KV `dividend-workbench`。`SYNC_KEY` 必须和页面「设置 → 数据同步」里填的密钥一致。
