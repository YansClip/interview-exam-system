# 面试答题系统

面试答题系统是一个轻量在线候选人测评工具，支持候选人登录、后台白名单、在线作答、倒计时、交卷、自动判分、防作弊留痕、代码题人工复核与 PDF 导出。

当前版本不依赖数据库，使用本地 JSON 保存白名单与提交记录，适合本地演示、内部测试与小规模部署。

> **公开版说明**：本仓库仅包含示例试卷与空白运行数据，不包含真实候选人、真实手机号或真实答卷。本地运行后生成的 `data/candidates.json`、`data/submissions.json` 请勿提交回公开仓库。生产环境请使用独立部署与强密码，勿将 `.env` 提交到 Git。

## 快速开始

```bash
npm install
npm start
```

启动后访问：

| 页面 | 地址 |
| --- | --- |
| 登录页 | http://127.0.0.1:8787/login.html |
| 答题页 | http://127.0.0.1:8787/index.html（需先登录） |
| 提交成功页 | http://127.0.0.1:8787/success.html |
| 后台管理 | http://127.0.0.1:8787/admin.html |
| PDF 排版预览 | http://127.0.0.1:8787/admin-pdf-preview.html（需后台登录） |

**注意**

- 不要用 `file://` 直接打开 HTML；登录、答题、后台都必须通过 `npm start` 启动的服务访问。
- 仓库内已附带示例 `data/exams.json`；白名单与提交记录在首次运行时会自动创建为空文件。

本地调试代码题运行/自动评测时：

```bash
ENABLE_CODE_RUNNER=1 npm start
```

本地使用测试号 `123` 时（开发环境默认允许，生产环境禁止）：

```bash
ALLOW_TEST_PHONE=1 npm start
```

## 角色与权限

从登录页「后台管理」进入，系统根据密码识别角色（不暴露具体角色名）。

| 能力 | HR（`ADMIN_HR_PASSWORD`） | 技术主管（`ADMIN_TECH_PASSWORD`） |
| --- | --- | --- |
| 录入/删除候选人白名单 | 是 | 是 |
| 查看试卷提交记录 | 否 | 是 |
| 查看答卷详情、客观题得分 | 否 | 是 |
| 导出答卷 PDF | 否 | 是 |
| 查看防作弊记录 | 否 | 是 |
| 删除提交记录 | 否 | 是 |
| 代码题人工复核 / 自动重评 | 否 | 是 |
| 试卷导入、发布、题干编辑 | 否 | 是 |
| 导出考生卷 PDF（无标答） | 否 | 是 |

开发环境默认密码：HR `yunqi`，技术主管 `yunqis`。生产环境请为两个角色分别设置强密码。

## 候选人流程

1. 在登录页填写姓名、手机号并选择应聘岗位。
2. 系统校验「手机号 + 岗位」是否已在后台录入（测试号 `123` 除外）。
3. 校验通过后进入答题页（HttpOnly Cookie 维持会话）。
4. 答题页顶部显示倒计时（时长来自当前岗位生效试卷，默认 40 分钟）；刷新页面不会重置计时。
5. 作答过程自动保存在浏览器本地草稿中。
6. 点击「提交试卷」先出现确认弹窗，并展示答题摘要。
7. 如有漏答，会提示题号，可选择继续检查或仍要提交。
8. 后端自动判分并保存记录；防作弊记录以**服务端会话**为准。
9. 提交成功后跳转至 `success.html`。

### 登录规则

- **姓名**：登录页预填默认值，答题页可继续修改；以交卷时填写的姓名为准。
- **手机号**：与后台白名单匹配；须为 11 位有效号码（测试号 `123` 除外）。
- **岗位**：须与后台录入一致。
- 同一「手机号 + 岗位」只能提交一次（测试号可重复交卷）。

### 测试号 `123`

- 姓名可任意填写；岗位默认「大模型工程师」，也可手动修改。
- 不需要后台录入，可重复登录与交卷。

### 可选岗位

- 大模型工程师
- 游戏策划师
- 全栈工程师

## 答题页功能

- 顶部岗位名称、倒计时、中英文切换、明暗主题。
- 左侧题型进度、考生信息、题号导航。
- 客观题单选/多选/填空；代码题支持 Python、C++、Java。
- 多道代码题时，**每道题独立保存代码**，切换题号不会互相覆盖。

### 防作弊

| 行为 | 处理 |
| --- | --- |
| 切 Tab / 切到其他软件 | 离开超过 **10 秒** 记一次违规 |
| 页面内思考、长时间无操作 | **不**记违规 |
| 从代码编辑器内复制再粘贴 | 允许 |
| 从题干/题目区域复制再贴入代码区 | 拦截粘贴，**不**记违规 |
| 从外部粘贴 | 拦截并记违规 |
| 累计违规达阈值 | 警告 → 临时锁定输入 → 自动交卷 |

答题期间会尝试启用 **Screen Wake Lock** 减少息屏导致的误报。

## 后台管理

**HR 管理**：候选人白名单录入与维护（不可查看试卷提交记录）。

**技术主管**：试卷提交记录（查看、详情、PDF、防作弊摘要、删除）、试卷摘要、题干编辑、Word/PDF 导入发布、考生卷 PDF 导出、代码题复核。

试卷导入格式见 [`docs/exam-import-template.md`](docs/exam-import-template.md)。

## 判分规则

- 单选、多选、综合题由后端自动判分。
- 代码题支持本机运行与自动评测（需 `ENABLE_CODE_RUNNER=1`）及人工复核。
- 当前默认试卷（大模型工程师）满分 **100 分**：客观题 71 分 + 代码题 29 分。

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 监听端口，默认 `8787` |
| `NODE_ENV` | 设为 `production` 时启用生产安全策略（**公开部署必填**） |
| `ADMIN_TECH_PASSWORD` | 技术主管密码；兼容旧变量 `ADMIN_PASSWORD`；生产环境必填 |
| `ADMIN_HR_PASSWORD` | HR 密码；生产环境必填 |
| `ANTICHEAT_FORCE_SUBMIT_THRESHOLD` | 自动交卷违规阈值，默认 `5` |
| `ANTICHEAT_WARN_THRESHOLD` | 开始警告的违规次数，默认 `1` |
| `ANTICHEAT_LOCK_THRESHOLD` | 临时锁定输入的违规次数，默认 `3` |
| `ANTICHEAT_LEAVE_GRACE_MS` | 离开页面多少毫秒后计违规，默认 `10000` |
| `ALLOW_TEST_PHONE` | 测试号 `123`；开发环境默认开启，生产环境禁止设为 `1` |
| `ENABLE_CODE_RUNNER` | 设为 `1` 时启用本机代码运行；**默认关闭** |
| `EXAM_PARSE_API_KEY` | 试卷智能解析 API Key（OpenAI 兼容） |
| `EXAM_PARSE_API_BASE` | 智能解析 API 地址 |
| `EXAM_PARSE_MODEL` | 智能解析模型名 |
| `FORCE_SECURE_COOKIES` | 强制 Cookie `Secure`（HTTPS 反代） |
| `NOTIFY_ON_SUBMIT` | 设为 `0` 关闭 macOS 交卷系统通知 |

复制 `.env.example` 为 `.env` 后按需修改。`.env` 已被 `.gitignore` 忽略。

## 安全部署清单

公开或局域网对外提供服务前，请至少完成：

1. `NODE_ENV=production`
2. 设置强密码：`ADMIN_HR_PASSWORD`、`ADMIN_TECH_PASSWORD`
3. 确认 `ALLOW_TEST_PHONE` 未开启
4. 不要将 `ENABLE_CODE_RUNNER=1` 直接暴露在公网；须使用容器/沙箱判题
5. 前置 HTTPS 反向代理，并视情况设置 `FORCE_SECURE_COOKIES=1`
6. 不要将真实 `data/candidates.json`、`data/submissions.json` 提交到公开 Git

## 数据存储

```text
data/exams.json          # 各岗位生效试卷（含 answerKey，不可静态访问）
data/exam-drafts/        # 导入解析草稿（本地生成，默认不提交）
data/candidates.json     # 候选人白名单（本地生成，默认不提交）
data/submissions.json    # 交卷记录（本地生成，默认不提交）
```

`data/` 目录不可通过静态 URL 访问。

## 主要文件

| 文件 | 说明 |
| --- | --- |
| `server.js` | 后端服务、API、会话、判分、权限 |
| `exam-store.js` | 试卷存储 |
| `anti-cheat.js` | 答题页防作弊 |
| `app.js` / `index.html` | 答题页 |
| `admin.js` / `admin.html` | 后台管理 |
| `login.js` / `login.html` | 登录页 |
| `code-editor.js` | Monaco 代码编辑器 |
| `i18n.js` / `theme.js` | 多语言与主题 |

## 项目信息

- **项目名**：面试答题系统
- **npm 包名**：`interview-exam-system`
- **默认端口**：8787
- **Node 版本**：>= 18

## 后续可扩展

- 数据库持久化
- 隔离沙箱判题服务
- 导出 Excel / CSV
- HTTPS 正式部署与多环境配置
