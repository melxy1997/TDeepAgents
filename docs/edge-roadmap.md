# 端侧特性路线图

> TDeepAgents 的差异化亮点：**在浏览器中运行完整的 Agent 循环**

## 愿景

```
┌────────────────────────────────────────────┐
│              浏览器 / PWA                   │
│                                            │
│  ┌──────────┐   ┌────────────────────────┐ │
│  │ Chrome   │   │    TDeepAgents Core     │ │
│  │ Built-in │◄──│                         │ │
│  │ AI       │   │  ReAct Loop Engine      │ │
│  │(Nano端侧)│──►│                         │ │
│  └──────────┘   └────────┬───────────────┘ │
│                          │                  │
│  ┌──────────┐   ┌────────┴───────────────┐ │
│  │IndexedDB │◄──│  IndexedDBBackend       │ │
│  │WebStorage│   │  (BackendProtocol)      │ │
│  └──────────┘   └────────────────────────┘ │
│                                            │
│  ┌──────────┐   ┌────────────────────────┐ │
│  │ WebMCP   │◄──│  WebMCPMiddleware       │ │
│  │ 工具注册  │──►│  (双向工具桥接)          │ │
│  └──────────┘   └────────────────────────┘ │
│                                            │
│      零网络 · 零延迟 · 数据不出设备          │
└────────────────────────────────────────────┘
```

## Phase 1: 浏览器基础 ✅

| 特性 | 实现方式 | 状态 |
|------|---------|------|
| browser 入口 | `@tdeepagents/backends/browser` 排除 node:fs | ✅ 已完成 |
| 适配器注册表 | `registerAdapter()` 可扩展 | ✅ 已完成 |
| zodToJsonSchema 共享 | 统一转换函数 | ✅ 已完成 |
| Agent Skills 规范兼容 | 完整 frontmatter + resource 发现 | ✅ 已完成 |
| SkillBundle (端侧技能) | JSON 格式打包 SKILL.md + 脚本 | ✅ 已完成 |
| URL 安装技能 | `installSkillFromUrl()` | ✅ 已完成 |
| 子 Agent 技能继承 | GP 继承 / custom 覆盖 | ✅ 已完成 |

## Phase 2: Chrome Built-in AI 适配器

| 特性 | 技术方案 |
|------|---------|
| `ChromeAIAdapter` | 实现 `LLMAdapter` 接口，封装 `ai.languageModel.create()` |
| Prompt-based Tool Calling | 利用 `responseConstraint` (JSON Schema) 约束输出为工具调用结构体 |
| Session 管理 | 每次 chat 调用创建新 session，完成后 `destroy()` 释放 GPU |
| 流式响应 | `promptStreaming()` → `ChatChunk` 转换 |
| 模型能力检测 | `ai.languageModel.availability()` 检测是否可用 |

**关键创新**：通过 `responseConstraint` 将 Zod 定义的工具参数 schema 直接传入 Chrome AI，保证端侧模型输出的格式可靠性。

## Phase 3: IndexedDB Backend

| 特性 | 技术方案 |
|------|---------|
| `IndexedDBBackend` | 实现 `BackendProtocol`，文件存储于 IndexedDB |
| 离线持久化 | 跨 session 保持 Agent 工作产物 |
| 配额管理 | `navigator.storage.estimate()` 监控存储用量 |
| 导入/导出 | 支持与 `FilesystemBackend` 之间的数据迁移 |

## Phase 4: WebMCP 集成

| 特性 | 技术方案 |
|------|---------|
| 工具发现 | 读取 `navigator.modelContext` 注册的工具 |
| 工具消费 | WebMCP Tool → `ToolDefinition` 自动转换 |
| 工具暴露 | Agent 的内置工具注册为 WebMCP 供外部 Agent 调用 |
| 声明式工具 | 支持 `<form>` 元素的声明式 WebMCP |
| HITL 桥接 | `ModelContextClient.requestUserInteraction()` → `HITLMiddleware` |

## 差异化竞争力

| 对比维度 | LangChain DeepAgents | TDeepAgents |
|---------|---------------------|-------------|
| 运行时 | Python / Node.js 服务端 | **浏览器端侧** |
| 模型 | 云端 API | **Chrome Built-in AI (端侧)** |
| 延迟 | 网络往返 | **零延迟** |
| 隐私 | 数据上云 | **数据不出设备** |
| Web 标准 | 无 | **WebMCP W3C 标准** |
| 离线能力 | 无 | **完全离线可用** |
| 技能分发 | 只支持文件系统 | **SkillBundle JSON + URL 安装** |
| 包体积 | 重 (LangGraph 生态) | **轻量 (~60KB total)** |
