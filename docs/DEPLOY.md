# 部署与运维说明

## 线上地址

| 用途 | 地址 |
| --- | --- |
| 主站（Cloudflare Pages） | <https://dividend-app-cym.pages.dev> |
| 备用站（Cloudflare Pages） | <https://dividend-45f.pages.dev> |
| GitHub 仓库 | <https://github.com/xiaohaichong09/dividend-workbench> |
| GitHub Pages（启用后） | <https://xiaohaichong09.github.io/dividend-workbench/> |

Cloudflare 账号：`420775251@qq.com`

KV 命名空间：`dividend-workbench`（`b3cc120068144f2bad955f594feda484`）

## 一、准备

1. 安装 Python 3.10+ 与依赖：

   ```powershell
   py -m pip install blake3
   ```

2. 准备 Cloudflare API Token（需要权限：Cloudflare Pages:Edit、Workers Scripts:Edit、Workers KV Storage:Edit）。脚本按以下顺序读取：

   - 环境变量 `CLOUDFLARE_API_TOKEN`
   - `scripts/cf_token.txt`
   - `../Index 2/tools/cf_token.txt`

3. 同步密钥：

   - 环境变量 `SYNC_KEY`，或
   - 项目根目录 `同步密钥.txt` 的第一行非注释内容，或
   - 都没有时脚本自动生成并写入 `同步密钥.txt`

   `同步密钥.txt` 已被 `.gitignore` 排除，不要提交或发给别人。

## 二、一键部署

```powershell
py scripts\deploy_cloudflare.py
```

脚本执行内容：

1. 查询账号 ID。
2. 找到 / 创建 KV 命名空间 `dividend-workbench`。
3. 对每个 Pages 项目（默认 `dividend-app,dividend`）：
   - 找到 / 创建项目；
   - 绑定 `KV`（KV namespace）和 `SYNC_KEY`（Secret）；
   - 用 Direct Upload 上传静态文件；
   - 上传 `_worker.js` 并创建部署；
   - 检查 `uses_functions=true`；
   - 访问首页、`/api/health`、`/api/sync` 做验证。
4. 上传独立 Worker `dividend-sync`（可选备用）。

只部署页面：

```powershell
py scripts\deploy_cloudflare.py --pages-only
```

只部署 Worker：

```powershell
py scripts\deploy_cloudflare.py --worker-only
```

覆盖项目列表：

```powershell
$env:CF_PAGES_PROJECTS = "dividend-app"
py scripts\deploy_cloudflare.py
```

## 三、Cloudflare 端配置要点

### Pages 绑定

通过 API PATCH 项目时，必须使用下面的结构（不是旧版的 `bindings`）：

```json
{
  "deployment_configs": {
    "production": {
      "kv_namespaces": {
        "KV": { "namespace_id": "<KV_ID>" }
      },
      "env_vars": {
        "SYNC_KEY": { "type": "secret_text", "value": "<同步密钥>" }
      }
    }
  }
}
```

修改绑定后需要**重新部署**才会生效。

### `_worker.js`

- 文件位于仓库根目录，使用 ES Module 语法 `export default { fetch }`。
- Direct Upload 时必须作为 **独立的 multipart 文件字段** 上传（filename 为 `_worker.js`），只写进 manifest 不会执行。
- 部署结果里的 `uses_functions` 必须为 `true`。

### 路由

| 路径 | 方法 | 说明 |
| --- | --- | --- |
| `/api/health` | GET | `{ok, kv, auth}`，用于检查绑定 |
| `/api/sync` | GET / HEAD | 读取云端状态 |
| `/api/sync` | PUT | 覆盖云端状态 |
| `/api/sync` | OPTIONS | CORS 预检 |
| 其他 | GET | 静态资源 |

鉴权：请求头 `X-Auth-Key`，与 `SYNC_KEY` 做定长比较。

### 独立 Worker（可选）

```powershell
cd worker
npx wrangler deploy
npx wrangler secret put SYNC_KEY
```

`worker/wrangler.toml` 已写好 KV 绑定。若使用 API 部署，当前 Token 可能无权限启用 `workers.dev` 子域；这不影响主站，因为主站使用同域 `/api/sync`。需要备用地址时，到 Cloudflare 控制台 **Workers & Pages → dividend-sync → Settings → Domains & Routes** 启用 `workers.dev`。

## 四、GitHub Pages

1. 推送 `main` 分支。
2. 仓库 **Settings → Pages → Build and deployment**：
   - Source：`Deploy from a branch`
   - Branch：`main` / `(root)`
3. 等待几分钟，访问 `https://xiaohaichong09.github.io/dividend-workbench/`。

仓库根目录有 `.nojekyll`，避免 Jekyll 忽略以下划线开头的文件。

GitHub Pages 场景下前端会自动把同步地址回退到：

```text
https://dividend-app-cym.pages.dev/api/sync
```

## 五、本地开发

```powershell
py -m http.server 8765 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8765/>。本地静态服务器没有 `/api/sync`，同步会报错，属正常现象。

修改图标 / 启动图：

```powershell
py scripts\make_icons.py
```

## 六、验证清单

- [ ] 首页 200，标题「攒股收息 · 退休计划」
- [ ] `/api/health` 返回 `{"ok":true,"kv":true,"auth":true}`
- [ ] 用正确密钥 GET `/api/sync` 返回 200 或 404
- [ ] 错误密钥返回 401
- [ ] `manifest.webmanifest` 可访问，Chrome 显示「安装」入口
- [ ] `sw.js` 注册成功，断网后仍能打开已缓存页面
- [ ] 手机添加到主屏幕后为 standalone 模式
- [ ] 两台设备填同一密钥后数据互通
- [ ] 云端数据中 `settings.syncKey` 为空

## 七、常见问题

| 现象 | 排查 |
| --- | --- |
| 部署成功但文件数 0 | manifest 路径必须以 `/` 开头，哈希算法为 `blake3(base64(bytes)+ext)[:32]` |
| `uses_functions=false` | `_worker.js` 没作为独立文件上传，或部署 part 名称不对 |
| `/api/health` 503 | KV / SYNC_KEY 未绑定，或绑定后没有重新部署 |
| `/api/health` 401/403 | 请求被 Cloudflare 拦截，用浏览器访问；脚本已带浏览器 UA |
| 同步 401 | 密钥不一致，检查两端 `同步密钥.txt` |
| 同步 404 | 云端还没有数据，首次同步会自动上传 |
| 同步 413 | 数据超过 1MB，删减历史收息记录或拆分 |
| 手机装不了 | 必须用 HTTPS；微信内置浏览器请转到系统浏览器 |
| 页面仍是旧版 | 更新 SW 版本号 `sw.js` 里的 `VERSION`，或在设置里刷新 |
| `workers.dev` 打不开 | 控制台手动启用子域；主站同域同步不受影响 |
