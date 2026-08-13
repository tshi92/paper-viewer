<h1 align="center">Paper Viewer</h1>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <strong>面向研究小组的自部署论文工作台。</strong><br/>
  每日 arXiv 推送与 AI 导读、顶会论文目录、共享文库、PDF 标注，以及基于全文的 AI 对话。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/PostgreSQL-Prisma%206-336791?style=flat-square" alt="PostgreSQL + Prisma" />
  <img src="https://img.shields.io/badge/deploy-Vercel%20%2B%20Neon-000?style=flat-square" alt="Vercel + Neon" />
</p>

<p align="center">
  <a href="#解决什么问题">解决什么问题</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#核心功能">功能</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="DEPLOYMENT.zh-CN.md">部署</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#本地开发">本地开发</a>
</p>

---

## 解决什么问题

一个组读论文，通常要用三套互不相通的工具：用 arXiv 订阅或邮件列表找论文，用群聊分享论文，再各自用自己的 PDF 阅读器做标注。三者之间没有衔接——群消息会被刷走，标注只留在一个人的电脑上。

Paper Viewer 把这三件事放在同一个应用里：按计划挑选论文，为每篇生成结构化导读，把当天的清单发到群里，并保存小组决定留下的论文——连同 PDF、高亮、讨论串，以及一个拿到全文的 AI 对话。

完全自部署，Vercel 与 Neon 的免费额度即可运行，所有数据存在你自己的数据库里。

---

## 核心功能

### 📬 每日 arXiv 推送

每个工作区配置自己的研究方向和关键词。每个工作日，推送任务会检索 arXiv，按这些兴趣对新论文排序，生成当天的清单。

- **结构化 AI 导读** —— 每篇论文分字段给出研究动机、要解决的问题、方法、关键结论、为什么重要，而不是把摘要复述一遍；中英文由工作区选定。
- **当日总览** —— 针对当天这一批论文给一段简短总结，显示在列表上方。
- **推送到飞书群** —— 配好 webhook 和推送时间后，推送卡片会在该时间点发进群里，每天最多一次。
- **推送里的论文不等于文库论文** —— 它们以只读预览打开，除非有人明确「存入文库」，因此每日清单不会自行改变共享文库的内容。
- **支持任意 OpenAI 兼容模型** —— Kimi/Moonshot、DeepSeek、OpenAI 或自建网关，在设置中按工作区配置。

### 🏛️ 顶会论文目录

系统与数据库方向主要会议的录用列表——目前包含 **SOSP、OSDI、ATC、NSDI、EuroSys、ASPLOS、SIGMOD、VLDB**——数据来自 [csconf-papers](https://github.com/RealZST/csconf-papers)。

- **浏览与搜索** —— 按会议和年份筛选，或跨所有目录一次性搜索。
- **尽可能站内直接读全文** —— 约三分之二的论文可以在站内打开，其余给出出版方链接。用 arXiv 预印本渲染的论文会标注出来，读的是不是正式版一目了然。
- **存入文库** —— 目录论文入库时，走的是与其他来源完全相同的查重逻辑。

### 📚 共享文库

- **所有来源共用一个入口** —— 每日推送、顶会目录、上传的 PDF，或粘贴的 arXiv / DOI 链接。
- **跨来源查重** —— DOI、arXiv id、标准化标题三重比对，同一篇论文从三个来源进来仍然只有一条记录。
- **筛选与搜索** —— 按时间窗口、标签、阅读状态筛选，按标题和作者搜索，常用主题以标签形式直接列出。
- **共享标签** —— 在设置中定义一次的彩色标签，论文和高亮共用同一套。

### 🖍️ PDF 标注

- **PDF 快照固化** —— 首次打开时把文件存下来，arXiv 发布新版本时已有高亮的锚点仍然有效。
- **文本高亮与区域框选** —— 选中一段文字，或在图表上拖出一个框，两者都作为带锚点的标注保存。
- **每条高亮一条讨论串** —— 回复挂在具体那条高亮上，而不是整篇论文上。
- **目录导航** —— 把 PDF 自带的书签渲染成可点击的大纲。
- **按人记录的阅读状态** —— 未读 / 在读 / 已讨论，每个成员分别记录。
- **键盘操作** —— `j`/`k` 按文库顺序前后移动，`1`–`4` 切换右侧面板。

### 💬 讨论区与 AI 对话

- **论文级评论与回复** —— 回复在被回复的评论下缩进一层，并带 `@成员名` 标记。
- **按角色管理** —— 作者管理自己的评论；owner 和 admin 可以编辑或删除任何人的评论。
- **基于全文的对话** —— 回答来自论文抽取出的正文，而不是摘要。
- **Markdown 渲染** —— 评论、对话和导读中的标题、列表、表格、代码块都会正常渲染，可一键复制原始文本。

### 👥 团队、角色与语言

- **邀请制成员管理** —— 邮件邀请或复制链接邀请，owner / admin / member 三种角色。
- **仅管理员可执行的操作** —— LLM 密钥、研究偏好、飞书 webhook、目录同步、成员邀请，以及把论文移出共享文库。
- **中英双语** —— 界面语言每人各自设置；AI 撰写导读和每日总结用哪种语言，则是工作区级的另一个设置。

---

## 部署

Paper Viewer 可以完全跑在免费额度上：Vercel Hobby 承载应用和定时任务，Neon 提供 Postgres，Vercel Blob 存放 PDF。部署大约需要 15 分钟。

**→ [部署指南](DEPLOYMENT.zh-CN.md)** —— Neon 与 Vercel 配置、环境变量、`/bootstrap` owner 账号、站内配置、让每日推送准点、不用 Vercel 的自部署方式，以及常见问题排查。

---

## 本地开发

**前置条件：** Node 22+、pnpm 10（通过 corepack）、Docker（或自备 PostgreSQL 16 + MinIO）。

```bash
# 1. 起服务：PostgreSQL + MinIO
docker compose up -d
docker compose run --rm minio-client     # 创建 paper-pdfs bucket

# 2. 配置
cp .env.example .env                     # 本地默认值已经填好

# 3. 安装与迁移
pnpm install
pnpm db:generate
pnpm db:migrate

# 4. 启动
pnpm dev                                 # http://localhost:3000
```

然后访问 `/bootstrap` 创建 owner 账号。

> 本地建议设置 `NEXT_PUBLIC_AUTO_GENERATE_INTRO=off`，避免打开测试数据时触发真实的 LLM 调用。

### 测试

```bash
pnpm lint          # 全部包跑 tsc
pnpm test          # 单元测试（vitest）
pnpm test:e2e      # Playwright，需要开发环境已启动且 .env 已导出
```

### 目录结构

```
apps/web            Next.js 15 App Router 应用——页面、API 路由、组件
packages/core       纯领域逻辑（权限、标签、LLM 配置、上传校验）
packages/db         Prisma schema、client、迁移
packages/storage    S3 / 对象存储封装
```

**技术栈：** Next.js 15（App Router）· React 19 · Prisma 6 + PostgreSQL · Vercel Blob / S3 · next-intl · react-pdf-highlighter · pnpm workspaces · vitest + Playwright。

---

## 许可证

[AGPL-3.0](LICENSE)。如果你把修改后的版本作为网络服务运行，需要向其用户提供修改后的源码。
