# @lemoncat7/dsh-web-search

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的可配置联网搜索插件。插件接管 DSH 原生 `web_search` 工具，模型不需要猜测或切换工具名称；管理员在设置中选择实际搜索来源。

## 搜索来源

| 提供方 | 密钥 | 适用场景 |
| --- | --- | --- |
| SearXNG | 不需要 | 自托管的通用网页搜索 |
| Wikipedia | 不需要 | 稳定的百科资料，默认使用中文站点 |
| Tavily | 需要 | 面向 Agent 的通用搜索 |
| Brave Search | 需要 | 传统网页与新闻检索 |
| Gemini Grounded Search | 需要 | 带 Google Search 引用的生成式检索；查询包含 URL 时同时启用 URL Context |

每次查询只发送给当前选中的提供方，不会暗中并发请求或自动消耗其他 API 额度。

## 安装

```bash
dsh plugin --profile web add @lemoncat7/dsh-web-search
```

开发包：

```bash
npm install
npm run check
dsh plugin --profile web add ./dist/lemoncat7-dsh-web-search-0.1.0-alpha.5.tgz
```

安装后进入 **设置 → 插件 → 插件配置 → 联网搜索**。可以选择提供方、保存密钥、调整超时和安全搜索，并在保存前执行一次真实测试。

默认启用无需密钥的中文 Wikipedia，保证插件安装后即可验证。若需要通用网页搜索，推荐部署 SearXNG 或配置 Tavily / Brave / Gemini。

## 本地 SearXNG

仓库附带只绑定本机回环地址的 SearXNG Compose 配置：

```bash
docker compose -f deploy/searxng/compose.yml up -d
curl -fsS -X POST http://127.0.0.1:8080/search -d 'q=DeepSeek&format=json'
```

不要直接把该实例暴露到公网。公网服务需要额外的认证、限流和访问控制。

设置页可以从当前实例的 `/config` 获取通用搜索引擎，受控并发逐个测速，并按可用性和延迟排序。选择的引擎只保存在当前 DSH 配置中；正式搜索还可设置 0–3 次失败或空结果重试。

## 配置示例

```yaml
- id: lemoncat7-web-search
  config:
    provider: searxng
    requestTimeoutMs: 25000
    searxng:
      baseURL: http://127.0.0.1:8080
      language: zh-CN
      engines: [bing, baidu]
      retryCount: 1
      safeSearch: 1
```

### 代理

插件支持独立的出站代理，不会修改 DSH 或其他插件的全局网络行为：

```bash
export DSH_WEB_SEARCH_PROXY=http://127.0.0.1:7893
export DSH_WEB_SEARCH_NO_PROXY=localhost,searxng
```

回环地址和常见私网 IPv4 默认直连，适合本地 SearXNG；其他自定义直连域名可以放入逗号分隔的 `DSH_WEB_SEARCH_NO_PROXY`。

Brave、Tavily 与 Gemini 的密钥通过 DSH Credential Store 保存，不写入普通插件配置。默认引用分别为：

- `BRAVE_SEARCH_API_KEY`
- `TAVILY_API_KEY`
- `GEMINI_API_KEY`

## 安全边界

- 外部 JSON 响应限制为 2 MiB，并在进入 DSH 前校验结构。
- 拒绝 HTTP 重定向，避免查询或凭据被静默转发。
- API Key 只放在提供方规定的认证 Header 中，不出现在 URL 和结果里。
- 浏览器设置接口执行严格同源检查，写请求必须携带与当前 Host 完全匹配的 Origin；接口限制请求体大小且不会回显密钥。
- 插件只提供搜索，不提供任意 URL 抓取工具。

## 开发验证

```bash
npm run typecheck
npm test
npm run build
npm run check:package
```

## 来源与许可

本项目基于 MIT 许可的 [zmh2000829/dsh-web-search-multi](https://github.com/zmh2000829/dsh-web-search-multi) 进行独立维护和适配，保留原项目许可声明。当前代码同样使用 MIT License。
