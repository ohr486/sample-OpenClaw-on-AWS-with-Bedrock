# OpenClaw 企业 Skill 平台设计

日期: 2026-03-20
状态: 设计稿

---

## 1. 企业场景定位

### 个人用户 vs 企业用户的 Skill 使用差异

| 维度 | 个人用户 | 企业用户 |
|------|---------|---------|
| 安装方式 | `clawhub install xxx` 手动装 | IT 统一部署，员工即用 |
| API Key | 自己申请，存 `.env` | 企业统一采购，按角色授权 |
| 可用范围 | 自己一个人用 | 全员/部门/团队分级可用 |
| 安全审计 | 无 | 每次调用记录 tenant_id + skill_name |
| 版本管理 | 随时 update，可能 break | IT 测试后统一升级 |
| 依赖管理 | 自己解决 npm/pip 冲突 | 预构建，零运行时安装 |
| 凭证安全 | 明文 `.env`，无审计 | SSM 加密，CloudTrail 审计，可撤销 |

### 企业版核心价值主张

不是"限制员工能装什么"，而是"让员工不用装就能用"。

- IT 装一次 Jira skill + 企业 Jira API key → 500 人直接用
- 财务装一次 SAP skill + SAP 连接凭证 → 财务部 50 人直接用
- 新员工入职 → 自动获得角色对应的 skill 集合，无需任何配置
- 员工离职 → 权限立即撤销，API key 不泄露（因为员工从未见过 key）

---

## 2. 三层 Skill 架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Skill Marketplace (预构建 + 按需加载)         │
│  ├── ClawHub 社区 skills (需要 npm 依赖)               │
│  ├── 企业自研 skills (内部工具集成)                     │
│  └── 预构建为 tar.gz，S3 存储，秒级加载                │
│                                                         │
│  Layer 2: S3 Hot-Load Skills (脚本级，无依赖)           │
│  ├── 纯 JS/Python 脚本 skills                          │
│  ├── S3 存储，entrypoint.sh 拉取                       │
│  └── API Key 通过 SSM → 环境变量注入                   │
│                                                         │
│  Layer 1: Image Built-in Skills (镜像内置)              │
│  ├── Docker build 时 clawhub install                    │
│  ├── 全员共享，零冷启动开销                             │
│  └── IT 测试后 rebuild 镜像升级                         │
└─────────────────────────────────────────────────────────┘
```

### Layer 1: 镜像内置 Skills

**定位**: 企业标配能力，所有员工默认可用。

**特点**:
- Docker build 时通过 `clawhub install` 安装
- npm 依赖在 build 时解决，运行时零安装开销
- 所有 microVM 共享同一镜像，一致性保证
- 升级 = rebuild 镜像 + push ECR，下次 microVM 启动自动生效

**适用场景**:
- 通用能力: web_search, jina-reader, deep-research
- 企业基础设施: S3 文件共享, 内部文档搜索
- 安全审计工具: 日志查询, 合规检查

**管理流程**:
```
IT 评估 skill → 安全审查 → 加入 Dockerfile SKILLS_PREINSTALL 列表
→ rebuild 镜像 → push ECR → 全员自动生效
```

**配置方式** (Dockerfile):
```dockerfile
# 企业内置 skills (IT 管理)
ARG SKILLS_PREINSTALL="jina-reader deep-research-pro"
RUN for skill in $SKILLS_PREINSTALL; do \
      clawhub install "$skill" --no-input --force || true; \
    done
```

**零侵入验证**: `clawhub install` 是 OpenClaw 官方 CLI，装完后 skill 在标准目录。

---

### Layer 2: S3 Hot-Load Skills

**定位**: 部门/团队级自定义能力，灵活部署，无需 rebuild 镜像。

**特点**:
- 纯脚本 skills (JS/Python)，无 npm 依赖
- 存储在 S3，microVM 启动时 entrypoint.sh 拉取
- API Key 通过 SSM Parameter Store 注入环境变量
- 支持三级作用域: 全局 / 部门 / 个人

**S3 目录结构**:
```
s3://openclaw-tenants-{account}/
  _shared/
    skills/
      jira-query/           ← 全员可用
        skill.json          ← manifest (名称、描述、权限声明)
        tool.js             ← skill 脚本
      sap-finance/          ← 财务部可用 (权限控制)
        skill.json
        tool.js
  {tenant_id}/
    skills/
      my-custom-tool/       ← 个人 skill
        skill.json
        tool.js
```

**Skill Manifest (skill.json)**:
```json
{
  "name": "jira-query",
  "version": "1.0.0",
  "description": "Query Jira issues and create tickets",
  "author": "IT Team",
  "scope": "global",
  "requires": {
    "env": ["JIRA_API_TOKEN", "JIRA_BASE_URL"],
    "tools": ["web_fetch"]
  },
  "permissions": {
    "allowedRoles": ["*"],
    "blockedRoles": ["intern"]
  }
}
```

**API Key 注入流程**:
```
microVM 启动
  → entrypoint.sh 读取 skill manifest
  → 从 SSM 拉取 skill 需要的 key:
      /openclaw/{stack}/skills/jira-query/JIRA_API_TOKEN
      /openclaw/{stack}/skills/jira-query/JIRA_BASE_URL
  → export 为环境变量
  → OpenClaw skill 通过 process.env 读取
```

**权限控制**:
```
entrypoint.sh 拉取 skills 时:
  1. 拉取 _shared/skills/ (全局)
  2. 读取租户权限 profile (SSM)
  3. 过滤: 只保留 allowedRoles 匹配的 skills
  4. 拉取 {tenant_id}/skills/ (个人)
  5. 合并到 workspace/skills/
```

**零侵入验证**: OpenClaw 只看到 workspace 里的 skill 文件，不知道来源是 S3。

---

### Layer 3: Skill Marketplace (预构建)

**定位**: 需要 npm 依赖的复杂 skills，企业级 skill 生态。

**问题**: ClawHub 的 skill 可能带 `package.json`，需要 `npm install`。
在临时 microVM 里每次 `npm install` 不现实 (30s-2min)。

**解法: 预构建 Skill Bundle**

```
管理员在 Admin Console 选择 skill
  → 触发 Lambda/CodeBuild
  → clawhub install {skill} + npm install
  → 打包为 skill-{name}-{version}.tar.gz
  → 上传到 S3: _shared/skill-bundles/
  → microVM 启动时: 下载 tar.gz → 解压到 skills/ (秒级)
```

**Skill Bundle 格式**:
```
skill-jira-query-1.0.0.tar.gz
  └── jira-query/
      ├── skill.json          ← manifest
      ├── tool.js             ← 入口脚本
      ├── node_modules/       ← 预安装的依赖
      └── package.json        ← 依赖声明
```

**构建流水线**:
```
Admin Console "Install Skill" 按钮
  → API Gateway → Lambda (skill-builder)
  → Lambda 启动 CodeBuild (ARM64):
      1. clawhub install {skill} --no-input --force
      2. cd skill-dir && npm install --omit=dev
      3. tar czf skill-{name}-{version}.tar.gz .
      4. aws s3 cp → _shared/skill-bundles/
  → 更新 SSM: /openclaw/{stack}/skill-catalog/{name} = {version}
  → Admin Console 显示 "Installed"
```

**microVM 加载流程**:
```
entrypoint.sh:
  # 读取 skill catalog
  CATALOG=$(aws ssm get-parameters-by-path \
    --path "/openclaw/${STACK_NAME}/skill-catalog" \
    --query 'Parameters[*].[Name,Value]' --output text)
  
  # 下载并解压每个 skill bundle
  for skill in $CATALOG; do
    aws s3 cp "s3://${S3_BUCKET}/_shared/skill-bundles/${skill}.tar.gz" - \
      | tar xzf - -C "$WORKSPACE/skills/"
  done
```

**零侵入验证**: 解压后的目录结构和 `clawhub install` 的结果完全一样。
OpenClaw 不知道 skill 是预构建的还是现场安装的。

---

## 3. 用户体验设计

### 3.1 员工视角 (Skill 消费者)

员工不需要知道 skill 的存在。他们只需要对 AI 说话：

```
员工: "帮我查一下 JIRA-1234 的状态"
AI:   (自动调用 jira-query skill)
      "JIRA-1234: 'Fix login timeout'
       状态: In Progress
       负责人: Alice
       优先级: High
       预计完成: 3月25日"

员工: "帮我在 SAP 里查一下上个月的差旅报销总额"
AI:   (自动调用 sap-finance skill)
      "2026年2月差旅报销总额: ¥45,230
       已审批: ¥38,500
       待审批: ¥6,730"
```

**员工能做的**:
- 使用 IT 授权的所有 skills (无需安装)
- 查看可用 skill 列表: "你有什么能力？"
- 请求新 skill: "我需要查询 Confluence 的能力" → 触发审批流

**员工不能做的**:
- 自行安装 ClawHub skills (安全风险)
- 看到或修改 API key
- 使用未授权的 skills

### 3.2 IT 管理员视角 (Skill 管理者)

通过 Admin Console 或 CLI 管理 skill 生命周期：

```
Admin Console:
┌─────────────────────────────────────────────┐
│  Skill Catalog                              │
│                                             │
│  Built-in (Layer 1)          5 skills       │
│  ├── web_search              ✅ All users   │
│  ├── jina-reader             ✅ All users   │
│  ├── deep-research-pro       ✅ All users   │
│  ├── s3-files                ✅ All users   │
│  └── transcript              ✅ All users   │
│                                             │
│  Department Skills (Layer 2)  3 skills      │
│  ├── jira-query              ✅ Engineering │
│  ├── sap-finance             ✅ Finance     │
│  └── workday-hr              ✅ HR          │
│                                             │
│  Marketplace (Layer 3)        2 skills      │
│  ├── github-pr-review        ✅ Engineering │
│  └── slack-summarizer        ✅ All users   │
│                                             │
│  [+ Add Skill]  [Manage Keys]  [Audit Log] │
└─────────────────────────────────────────────┘
```

**管理员操作流程**:

安装新 skill:
```
1. Admin Console → Add Skill
2. 选择来源: ClawHub / 自定义上传 / GitHub URL
3. 安全审查: 自动扫描 skill 代码 (敏感 API 调用、文件系统访问)
4. 配置 API Key: 输入企业凭证 → 存入 SSM
5. 设置权限: 选择可用角色/部门
6. 部署: Layer 2 (脚本) 直接上传 S3 / Layer 3 (复杂) 触发构建
7. 生效: 下次 microVM 启动自动加载
```

管理 API Key:
```
Admin Console → Manage Keys
  ├── JIRA_API_TOKEN      ✅ Active   Used by: jira-query
  ├── SAP_CLIENT_SECRET   ✅ Active   Used by: sap-finance
  ├── SLACK_BOT_TOKEN     ✅ Active   Used by: slack-summarizer
  └── [+ Add Key]  [Rotate]  [Revoke]

Key 操作:
  - Add: 输入 key name + value → SSM put-parameter (SecureString)
  - Rotate: 输入新 value → SSM update → 下次 microVM 启动生效
  - Revoke: SSM delete → skill 调用时报错 "credential not available"
```

### 3.3 Skill 开发者视角

企业内部开发者可以为团队创建自定义 skill:

```
skill 目录结构 (Layer 2 脚本级):
  my-internal-api/
    skill.json        ← manifest
    tool.js           ← 入口: 接收参数，调用内部 API，返回结果

skill.json:
{
  "name": "my-internal-api",
  "version": "1.0.0",
  "description": "Query internal inventory system",
  "requires": {
    "env": ["INVENTORY_API_KEY", "INVENTORY_BASE_URL"]
  },
  "tools": [{
    "name": "query_inventory",
    "description": "Search inventory by product name or SKU",
    "parameters": {
      "query": { "type": "string", "description": "Product name or SKU" }
    }
  }]
}

发布流程:
  1. 开发者写好 skill → git push 到内部 repo
  2. IT 审查代码 → approve
  3. 上传到 S3: aws s3 sync ./my-internal-api/ s3://bucket/_shared/skills/my-internal-api/
  4. 配置 API Key: aws ssm put-parameter --name "/openclaw/.../INVENTORY_API_KEY" --value "xxx"
  5. 设置权限: aws ssm put-parameter --name "/openclaw/.../skills/my-internal-api/roles" --value "engineering,ops"
  6. 生效
```

---

## 4. 技术实现路线

### Phase 1: Layer 1 镜像内置 (Week 1, 1-2 天)

**改动文件**: `agent-container/Dockerfile`

```dockerfile
# 在 builder stage 末尾加:
ARG SKILLS_PREINSTALL="jina-reader deep-research-pro transcript"
RUN for skill in $SKILLS_PREINSTALL; do \
      clawhub install "$skill" --no-input --force 2>&1 | tail -3 || true; \
    done

# 在 runtime stage 加:
COPY --from=builder /root/.openclaw/skills /root/.openclaw/skills
```

**验证**: rebuild 镜像 → push ECR → 新 microVM 启动 → `openclaw agent --message "search web for AWS news"` 验证 skill 可用。

**风险**: 低。clawhub install 是官方 CLI。

---

### Phase 2: Layer 2 S3 热加载 + SSM Key 注入 (Week 1-2, 3-5 天)

**改动文件**: `agent-container/entrypoint.sh`, 新增 `agent-container/skill_loader.py`

**skill_loader.py** (新文件):
```python
"""
Load skills from S3 based on tenant permissions.
Inject API keys from SSM as environment variables.
"""

def load_skills(tenant_id, workspace, s3_bucket, stack_name, region):
    # 1. 拉取全局 skills
    # 2. 读取租户权限 profile
    # 3. 过滤 skills (权限匹配)
    # 4. 拉取租户个人 skills
    # 5. 读取每个 skill 的 manifest
    # 6. 从 SSM 拉取 required env vars
    # 7. 写入 /tmp/skill_env.sh (export KEY=VALUE)
    pass
```

**entrypoint.sh 改动**:
```bash
# Step 2.5: Load skills and inject API keys (after S3 workspace sync)
python /app/skill_loader.py \
  --tenant "$TENANT_ID" \
  --workspace "$WORKSPACE" \
  --bucket "$S3_BUCKET" \
  --stack "$STACK_NAME" \
  --region "$AWS_REGION"

# Source skill environment variables
if [ -f /tmp/skill_env.sh ]; then
    . /tmp/skill_env.sh
fi
```

**SSM 参数结构**:
```
/openclaw/{stack}/skill-keys/jira-query/JIRA_API_TOKEN     = "xxx" (SecureString)
/openclaw/{stack}/skill-keys/jira-query/JIRA_BASE_URL      = "https://company.atlassian.net"
/openclaw/{stack}/skill-roles/jira-query                    = "engineering,product,*"
/openclaw/{stack}/skill-roles/sap-finance                   = "finance,executive"
```

**验证**:
1. 上传一个测试 skill 到 S3
2. 配置 SSM key
3. 触发 microVM → 验证 skill 加载 + key 注入
4. 不同角色的租户验证权限过滤

**风险**: 低。只改 entrypoint.sh 和新增 Python 脚本。

---

### Phase 3: Layer 3 预构建 Skill Bundle (Week 3-4, 5-7 天)

**新增组件**:
- `skill-builder/` Lambda 函数 (触发 CodeBuild)
- `skill-builder/buildspec.yml` (CodeBuild 构建规范)
- Admin Console 新增 "Skill Marketplace" 页面

**构建流程**:
```
Admin Console → "Install from ClawHub"
  → API Gateway POST /skills/install {name: "github-pr-review"}
  → Lambda: skill-builder
    → 启动 CodeBuild (ARM64):
        1. clawhub install github-pr-review --no-input --force
        2. cd ~/.openclaw/skills/github-pr-review
        3. npm install --omit=dev (如果有 package.json)
        4. tar czf /tmp/skill-github-pr-review-1.0.0.tar.gz .
        5. aws s3 cp → s3://bucket/_shared/skill-bundles/
        6. aws ssm put-parameter --name "/openclaw/{stack}/skill-catalog/github-pr-review" --value "1.0.0"
    → 返回 {status: "installed", version: "1.0.0"}
  → Admin Console 刷新 catalog
```

**entrypoint.sh 改动** (在 skill_loader.py 中):
```python
# 加载 Layer 3 skill bundles
catalog = ssm.get_parameters_by_path("/openclaw/{stack}/skill-catalog/")
for skill_name, version in catalog:
    bundle_key = f"_shared/skill-bundles/skill-{skill_name}-{version}.tar.gz"
    s3.download_file(bucket, bundle_key, f"/tmp/{skill_name}.tar.gz")
    subprocess.run(["tar", "xzf", f"/tmp/{skill_name}.tar.gz",
                    "-C", f"{workspace}/skills/"])
```

**验证**:
1. 通过 Admin Console 安装一个 ClawHub skill
2. 验证 CodeBuild 构建成功
3. 新 microVM 启动 → 验证 skill 可用
4. 测量加载时间 (目标: < 5s)

**风险**: 中。需要新增 Lambda + CodeBuild 基础设施。

---

## 5. 数据流总览

```
┌──────────────────────────────────────────────────────────────┐
│  Admin Console / CLI                                         │
│                                                              │
│  管理 Skills:                                                │
│  ├── Layer 1: 编辑 Dockerfile SKILLS_PREINSTALL → rebuild    │
│  ├── Layer 2: aws s3 sync skill/ → S3 _shared/skills/       │
│  └── Layer 3: "Install" → Lambda → CodeBuild → S3 bundles   │
│                                                              │
│  管理 Keys:                                                  │
│  └── aws ssm put-parameter → /openclaw/{stack}/skill-keys/  │
│                                                              │
│  管理权限:                                                    │
│  └── aws ssm put-parameter → /openclaw/{stack}/skill-roles/  │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  microVM 启动 (entrypoint.sh + skill_loader.py)              │
│                                                              │
│  1. Layer 1: 镜像内置 skills 已在 ~/.openclaw/skills/        │
│  2. Layer 2: S3 pull _shared/skills/ → workspace/skills/     │
│     └── 权限过滤: 只拉取 allowedRoles 匹配的 skills          │
│  3. Layer 3: S3 pull skill-bundles/*.tar.gz → 解压           │
│  4. SSM pull skill-keys/* → export 环境变量                  │
│  5. OpenClaw 启动 → 自动扫描 skills 目录 → 全部可用          │
└──────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────┐
│  OpenClaw Runtime (零侵入)                                    │
│                                                              │
│  OpenClaw 看到的:                                             │
│  ~/.openclaw/skills/                                         │
│    ├── jina-reader/        (Layer 1, 镜像内置)               │
│    ├── deep-research-pro/  (Layer 1, 镜像内置)               │
│    ├── jira-query/         (Layer 2, S3 热加载)              │
│    ├── sap-finance/        (Layer 2, S3 热加载)              │
│    └── github-pr-review/   (Layer 3, 预构建 bundle)          │
│                                                              │
│  环境变量:                                                    │
│    JIRA_API_TOKEN=xxx      (SSM 注入)                        │
│    JIRA_BASE_URL=https://  (SSM 注入)                        │
│    SAP_CLIENT_SECRET=xxx   (SSM 注入)                        │
│                                                              │
│  OpenClaw 不知道 skills 从哪来，不知道 key 从哪来。           │
│  它只看到标准的 skill 目录和标准的环境变量。                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 安全设计

### API Key 生命周期

```
创建: Admin Console → SSM put-parameter (SecureString, KMS 加密)
使用: microVM 启动 → SSM get-parameter → export 环境变量 → skill 读取
轮换: Admin Console → SSM update → 下次 microVM 启动自动生效 (无需重启)
撤销: Admin Console → SSM delete → skill 调用报错
审计: CloudTrail 记录每次 SSM get-parameter (谁、什么时候、哪个 key)
```

### Skill 安全审查

Layer 2 (脚本级):
- 代码审查: IT 人工 review skill 代码
- 静态扫描: 检查是否调用 `fs.writeFile`, `child_process.exec`, `eval` 等危险 API
- 网络限制: skill 只能访问声明的 URL (通过 Plan A 约束)

Layer 3 (预构建):
- 依赖扫描: `npm audit` 在 CodeBuild 中运行
- VirusTotal: clawhub 自带的安全检查
- 沙箱测试: CodeBuild 中运行 skill 的 test suite

### 权限隔离

```
租户 A (engineering, senior):
  ├── Layer 1: 全部 ✅
  ├── Layer 2: jira-query ✅, sap-finance ✗ (不是 finance 角色)
  └── Layer 3: github-pr-review ✅

租户 B (finance, analyst):
  ├── Layer 1: 全部 ✅
  ├── Layer 2: jira-query ✗ (blockedRoles: intern), sap-finance ✅
  └── Layer 3: github-pr-review ✗ (不是 engineering 角色)
```

---

## 7. 实施时间线

```
Week 1 (Mar 20-23):
  ├── Layer 1: Dockerfile 加 SKILLS_PREINSTALL
  ├── Layer 2: skill.json manifest 格式定稿
  └── Layer 2: skill_loader.py 基础版 (S3 pull + SSM key inject)

Week 2 (Mar 24-30):
  ├── Layer 2: 权限过滤 (role-based skill access)
  ├── Layer 2: Admin Console skill 管理页面
  └── Layer 2: 端到端测试 (Jira skill + API key)

Week 3 (Mar 31 - Apr 6):
  ├── Layer 3: CodeBuild 构建流水线
  ├── Layer 3: skill bundle 格式 + 加载逻辑
  └── Layer 3: Admin Console "Install from ClawHub" 功能

Week 4 (Apr 7-13):
  ├── 安全审查: skill 代码扫描 + 依赖审计
  ├── 文档: Skill 开发者指南
  └── 测试: 10+ skills 端到端验证
```

---

## 8. 不做的事情

| 方案 | 为什么不做 |
|------|-----------|
| 运行时 npm install | 太慢 (30s-2min)，影响冷启动 |
| 修改 OpenClaw skill 加载逻辑 | 侵入性，版本耦合 |
| 自建 skill registry | 过度工程，ClawHub 已有生态 |
| 允许员工自行安装 ClawHub skills | 安全风险，供应链攻击 |
| Skill 间通信 | 复杂度高，v2.0 考虑 |
| Skill 热更新 (不重启 microVM) | OpenClaw 不支持运行时 reload skills |
