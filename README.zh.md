# @lemoncat7/dsh-web-search

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的可配置联网插件。插件提供 DSH 原生 `web_search` 与 `web_fetch`：搜索由管理员选择的后端完成，网页抓取则通过同一套插件级代理和安全边界完成。另有受限的 `web_source`，供 Agent 按明确来源规则核验原始 HTML 标记或脚本内嵌数据；普通网页阅读仍应使用 `web_fetch`。

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

插件的搜索与网页抓取共用独立的出站代理，不会修改 DSH 或其他插件的全局网络行为：

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

- 搜索 JSON 与网页正文均限制为 2 MiB；搜索结果在进入 DSH 前校验结构。
- `web_fetch` 只接受无凭据的 HTTP(S) 公网地址，拒绝回环、私网、链路本地与保留目标。
- `web_fetch` 最多跟随 5 次重定向，并在每一跳重新执行目标校验；只返回 HTML、文本、JSON 与 XML 等文本内容。
- `web_source` 复用相同的安全抓取，只能对一个精确 URL 做分段读取或查找有限个源码标记，单次最多返回 120,000 字符。
- API Key 只放在提供方规定的认证 Header 中，不出现在 URL 和结果里。
- 浏览器设置接口执行严格同源检查，写请求必须携带与当前 Host 完全匹配的 Origin；接口限制请求体大小且不会回显密钥。
- `web_fetch`／`web_source` 是受限的只读公网抓取能力，不提供内网访问、文件协议或任意命令执行。

## 开发验证

```bash
npm run typecheck
npm test
npm run build
npm run check:package
```

## 来源与许可

本项目基于 MIT 许可的 [zmh2000829/dsh-web-search-multi](https://github.com/zmh2000829/dsh-web-search-multi) 进行独立维护和适配，保留原项目许可声明。当前代码同样使用 MIT License。
