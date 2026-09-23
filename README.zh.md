# dsh-llm-codebuddy

[English](README.md) | **中文**

一个面向 **腾讯 CodeBuddy** 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）插件。

通过浏览器登录 — **无需 API Key** — 即可使用 CodeBuddy 自带的模型列表。

## 功能

- **浏览器 OAuth 登录** — 在普通浏览器标签页中完成授权，全程无需 API Key。
- **完整模型目录** — CodeBuddy 自带的模型，含上下文窗口、输出上限与积分倍率，服务端新增或下架模型会自动同步。
- **流式对话** — 回复实时流式输出。
- **工具调用** — 支持函数调用，模型不支持时会给出明确提示。
- **推理力度** — 支持思考的模型可自选思考档位。
- **图片输入** — 支持视觉的模型可发送图片（不支持视觉的模型可能会被服务器路由到其他模型）。
- **用量指示器** — 在 Web UI 侧边栏展示个人版与企业版的配额进度条，支持自定义上限与告警阈值。

## 兼容版本

| 要求 | 版本 |
| --- | --- |
| DeepSeek Harness（`dsh`） | `>= 0.1.5-rc.1` |

设置页、模型选择器、用量指示器等 Web UI 功能需要 `web` profile。

## 安装

将插件添加到某个 dsh profile — `web` profile 即 Web UI 后端：

```bash
dsh plugin --profile web add @shatyuka/dsh-llm-codebuddy
```

## 登录

在 Web UI 中打开 **设置 → CodeBuddy** 并点击 **登录**。浏览器登录页会在新标签页打开，harness 自动写入凭据，无需使用终端。

也可以从终端登录：

```bash
# CLI 备用方式，推荐使用上方的 Web UI 登录。

# 登录
dsh plugin --profile web exec dsh-codebuddy-login

# 查看登录账号与模型列表
dsh plugin --profile web exec dsh-codebuddy-login --status

# 删除已保存的凭据
dsh plugin --profile web exec dsh-codebuddy-login --logout
```

登录后，CodeBuddy 的模型会出现在模型选择器中。

## 构建

在源码目录中：

```bash
pnpm install
pnpm run build
```

该命令使用 `tsc` 编译宿主端，使用 `esbuild` 打包 Web 客户端，两者均输出到 `lib/`。

## 许可证

MIT
