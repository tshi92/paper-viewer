<h1 align="center">Paper Viewer</h1>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <strong>自部署的论文工作台，以「一个组」而不是「一个人」为单位。</strong><br/>
  一个文库、每篇 PDF 只有一份大家共同标注的副本、每篇一份 AI 导读、每天一次推送——工作区里所有人看到的是同一份。
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/PostgreSQL-Prisma%206-336791?style=flat-square" alt="PostgreSQL + Prisma" />
  <img src="https://img.shields.io/badge/deploy-Vercel%20%2B%20Neon-000?style=flat-square" alt="Vercel + Neon" />
</p>

<p align="center">
  <a href="#解决什么问题">解决什么问题</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#为一个组设计而不是为一个人">为一个组设计</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#核心功能">功能</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="DEPLOYMENT.zh-CN.md">部署</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;<a href="#本地开发">本地开发</a>
</p>

---

<p align="center">
  <img src="assets/screenshots/library2.png" alt="在阅读页打开一篇论文：左侧 PDF，右侧结构化导读和目录" width="900" />
</p>

---

## 解决什么问题

一个组读论文，通常要用三套互不相通的工具：用 arXiv 订阅或邮件列表找论文，用群聊分享论文，再各自用自己的 PDF 阅读器做标注。

这三样没有一样是真正共享的。订阅是一个人订一份；群消息一天之内就被刷走；标注留在做标注的那台电脑上，于是读得最细的那个人，也是唯一能看到自己读出了什么的人。一个组一起读，却什么都没有一起留下来。

Paper Viewer 是反过来做的：按计划挑选论文，为每篇生成结构化导读，把当天的清单发到群里，并保存小组决定留下的东西——PDF、所有人都看得见的高亮、高亮下面的讨论串，以及一个拿到全文的 AI 对话。

完全自部署，Vercel 与 Neon 的免费额度即可运行，所有数据存在你自己的数据库里。

---

## 为一个组设计，而不是为一个人

大多数阅读工具是按「一个读者」建模的，共享是后来补上去的功能。这里反过来：工作区是默认单位，个人是例外。

| 整个工作区共享 | 只属于你自己 |
|---|---|
| 文库，以及每篇是谁存进来的 | 阅读状态——未读、在读、已讨论、已跳过 |
| 锚定在 PDF 上的文字高亮和划区标注 | 你和某篇论文的 AI 对话记录 |
| 每条高亮下、每篇论文下的讨论串 | 界面语言（存在你自己的浏览器里） |
| AI 导读——只生成一次，所有人读同一份 | |
| 标签、研究方向、用哪个模型、用什么语言写 | |
| 每日推送，以及发进群里的那一张卡片 | |

有四处机制在多人同时读的时候撑住了这件事：

- **PDF 在第一次打开时被固定下来。** 高亮坐标指向的是已存下的字节，所以 arXiv 出了 v2 也不会把所有人的高亮挪位。
- **导读按工作区只生成一次。** 两个人同时打开同一篇新论文，不会产生两份分析，也不会产生两笔账单——第二个请求拿到的是第一个的结果。
- **每日卡片先认领再发送。** cron、每小时心跳、有人手点「发现论文」都可能同时抢同一天，群里收到的仍然只有一张卡片。
- **同一篇论文从三个入口进来仍然是一条记录。** 每条入库路径都会核对 DOI、arXiv id 和归一化标题，存一篇同事已经存过的论文，会指向他那一条，而不是造一条孪生记录。

而对被拉进来的人来说，加入这件事本身不需要任何成本，同时门是关着的：

- **不用装任何东西。** 一个链接、一个浏览器。不需要插件、不需要桌面客户端、不需要同步账号，也不需要每人一把 API key——模型是按工作区配一次的。部署的人把配置这件事替所有人做完了。
- **只能被邀请进来。** 没有公开注册页。owner 账号在 `/bootstrap` 建一次，其余人都通过一次性、会过期的邀请链接进来；库里只存链接的哈希，不存链接本身。工作区的私密程度，等于你把数据库放在哪里——而那是你自己的。

---

## 核心功能

### 📬 每日 arXiv 推送

每个工作区配置自己的研究方向和关键词。每个工作日，推送任务会检索 arXiv，按这些兴趣对新论文排序，生成当天的清单。

- **结构化 AI 导读** —— 每篇论文分字段给出研究动机、要解决的问题、方法、关键结论、为什么重要，而不是把摘要复述一遍。从顶会目录存进来的、自己上传的论文，拿到的是同样的导读。
- **当日总览** —— 针对当天这一批论文给一段简短总结，显示在列表上方。
- **推送到飞书群** —— 配好 webhook 和推送时间后，推送卡片会在该时间点发进群里，每天最多一次。
- **没有东西会自己进文库** —— 推送里的论文以只读预览打开：PDF 和导读都能读，但标注、评论、阅读状态要等有人点「存入文库」之后才开始。否则每天十篇新论文会把小组真正挑出来的那些淹掉。

<img src="assets/screenshots/today.png" alt="每日页面：左侧是当天综述，右侧是选出的论文清单" width="900" />

<table>
  <tr>
    <td width="33%"><img src="assets/screenshots/settings1.png" alt="设置 → 研究偏好：研究方向、关键词、arXiv 分类、每天几篇" /></td>
    <td width="33%"><img src="assets/screenshots/settings2.png" alt="设置 → LLM：工作区使用的接口地址、模型、API key，以及 AI 生成语言" /></td>
    <td width="33%"><img src="assets/screenshots/settings3.png" alt="设置 → 通知：飞书 webhook 和推送时间" /></td>
  </tr>
</table>

<sub>每日推送依赖的三块配置，每块都按工作区设一次：拿什么排序、用哪个模型和哪种语言写、卡片发到哪里。</sub>

### 🏛️ 顶会论文目录

系统与数据库方向主要会议的录用列表——目前包含 **SOSP、OSDI、ATC、NSDI、EuroSys、ASPLOS、SIGMOD、VLDB**——数据来自 [csconf-papers](https://github.com/RealZST/csconf-papers)。

- **浏览与搜索** —— 按会议和年份筛选，或跨所有目录一次性搜索。
- **尽可能站内直接读全文** —— 约三分之二的论文可以在站内打开，其余给出出版方链接。用 arXiv 预印本渲染的论文会标注出来，读的是不是正式版一目了然。
- **存入文库** —— 目录论文入库时，走的是与其他来源完全相同的查重逻辑。

<img src="assets/screenshots/conferences.png" alt="顶会目录筛选到 OSDI 2026，每行提供 PDF、出版方页面和 Scholar 查找" width="900" />

### 📚 共享文库

- **所有来源共用一个入口** —— 每日推送、顶会目录、上传的 PDF，或粘贴的 arXiv / DOI 链接。
- **跨来源查重** —— DOI、arXiv id、标准化标题三重比对，同一篇论文从三个来源进来仍然只有一条记录。
- **筛选与搜索** —— 按时间窗口、标签、阅读状态筛选，按标题和作者搜索，常用主题以标签形式直接列出。
- **共享标签** —— 在设置中定义一次的彩色标签，论文和高亮共用同一套。

<img src="assets/screenshots/library1.png" alt="文库列表，每行显示论文来源、存入者、主题和标签" width="900" />

### 📖 阅读

- **论文在站内打开** —— PDF 和导读、讨论串、AI 对话并排显示，读一篇论文不需要先把它下载下来。
- **目录导航** —— 把 PDF 自带的书签渲染成可点击的大纲。
- **按人记录的阅读状态** —— 未读 / 在读 / 已讨论 / 已跳过，每个成员分别记录，也可以在文库里按它筛选。
- **键盘操作** —— `j`/`k` 按文库顺序前后移动，`1`–`4` 切换右侧面板。

### 🖍️ 共享 PDF 标注

- **所有人画在同一份上** —— 一条高亮整个工作区都看得见，按它的标签着色；悬停可以看到是谁画的、下面说了什么。
- **PDF 快照固化** —— 首次打开时把文件存下来，arXiv 发布新版本时已有高亮的锚点仍然有效。
- **文本高亮与区域框选** —— 选中一段文字，或在图表上拖出一个框，两者都作为带锚点的标注保存。

<img src="assets/screenshots/library4.png" alt="PDF 旁边的标注面板，文字高亮和划区标注按页分组" width="900" />

### 💬 讨论

每条评论都写在被讨论的东西旁边，而且所有成员都看得见。

- **两个位置可以说话** —— 挂在论文下，或挂在某一条高亮下，针对某一句话的疑问就留在那句话上。
- **回复带着它在回应谁** —— 缩进一层挂在被回应的评论下，并带 `@名字` 标记。
- **按角色管理** —— 作者管自己的评论，owner 和 admin 可以编辑或删除任何人的。

<img src="assets/screenshots/library5.png" alt="论文下的评论串，回复缩进在它所回应的评论下方" width="900" />

### 🤖 与论文对话

- **答案来自全文** —— PDF 的文字在第一次使用时被提取并缓存，所以回答依据的是论文本身，不是摘要。
- **对话记录是你自己的** —— 按成员分开保存，所以问一个「很基础」的问题不需要有心理负担。
- **可以把答案存成评论** —— 一次点击，把一条值得留下的回答变成整个工作区都看得见的论文评论；私有的东西是被主动放到台面上的，而不是默认就在台面上。

<img src="assets/screenshots/library3.png" alt="向论文提问，答案来自全文而不是摘要" width="900" />

### 👥 团队与角色

- **邀请制成员管理** —— 邮件邀请或复制链接邀请，owner / admin / member 三种角色。
- **仅管理员可执行的操作** —— LLM 密钥、研究偏好、飞书 webhook、目录同步、成员邀请。存入文库和移出文库则是每个成员都能做的：这份阅读清单由读它的人自己维护。

### ⚙️ 全局

三件不属于单个功能、但到处都生效的事：

- **支持任意 OpenAI 兼容模型** —— Kimi/Moonshot、DeepSeek、OpenAI 或自建网关。按工作区配一次，导读、当日总览和 AI 对话用的都是它。
- **两套互不相干的语言设置** —— 界面语言每人各自选，存在自己的浏览器里；AI 用什么语言写是工作区级的另一个设置，因此全组读到的导读是同一种语言。
- **到处都能写 Markdown** —— 评论、AI 回答和导读都会渲染标题、列表、表格和代码块，原始文本一键可复制。

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
