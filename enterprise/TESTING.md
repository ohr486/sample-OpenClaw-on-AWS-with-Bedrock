# Enterprise Platform — Comprehensive Test Plan

> **Environment:** Test (us-east-2, dev-openclaw.awspsa.com)
> **EC2:** i-054cb53703d2ba33c (c7g.large)
> **DynamoDB:** openclaw-enterprise (us-east-1)
> **S3:** openclaw-tenants-576186206185
> **AgentCore Runtime:** openclaw_enterprise_runtime-LNEdF69ybp
> **Date:** 2026-04-16
> **Tester:** JiaDe Wu

---

## Test Data — Personas

All tests use these real personas (seeded in DynamoDB):

| Persona | Employee ID | Role | Position | Department | Purpose |
|---------|-------------|------|----------|------------|---------|
| IT Admin | emp-admin | admin | IT Admin | IT | Full admin operations |
| Carol | emp-carol | employee | Sales Rep | Sales | Standard employee flow |
| Bob | emp-bob | manager | Engineering Lead | Engineering | Manager-scoped views |
| Diana | emp-diana | employee | Executive Assistant | Executive | Executive tier always-on |
| Eve | emp-eve | employee | New Hire | Engineering | Fresh employee, no agent |

**Default password:** `OpenClaw2026!` (first login forces change)

---

## Part 1: Functional Testing — Admin Console

### 1.1 Authentication & Authorization

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| A-01 | Admin login | POST `/auth/login` with emp-admin credentials | JWT token returned, role=admin | — |
| A-02 | Employee login | POST `/auth/login` with emp-carol credentials | JWT token, redirected to `/portal` | — |
| A-03 | Manager login | POST `/auth/login` with emp-bob credentials | JWT token, sees admin console (scoped) | — |
| A-04 | Wrong password | POST `/auth/login` with bad password | 401 Unauthorized | — |
| A-05 | First login password change | Login as emp-eve (mustChangePassword=true) | Redirected to `/change-password` | EMP#emp-eve updated |
| A-06 | Token expiry | Use expired JWT token on any API | 401, redirect to login | — |
| A-07 | Employee cannot access admin | Login as emp-carol, navigate to `/dashboard` | Redirected to `/portal` | — |
| A-08 | Admin password change | Settings > Account > Change Password | Success, new password works | EMP#emp-admin passwordHash updated |

### 1.2 Dashboard

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| D-01 | Dashboard loads | Navigate to `/dashboard` | 6 stat cards render without NaN | — |
| D-02 | Setup checklist | Fresh deploy state | Checklist shows incomplete items | — |
| D-03 | Conversation trend | Dashboard chart renders | 7-day bar chart, no blank days | USAGE# records queried |
| D-04 | Agent distribution | Dashboard donut chart | Shows agent count by status | AGENT# records queried |
| D-05 | Recent activity feed | Dashboard activity section | Shows latest audit events | AUDIT# records queried |
| D-06 | Quick actions | Click "Add Employee" | Navigate to `/org/employees` with create modal | — |
| D-07 | Needs attention | Generate a guardrail block | Alert appears in dashboard | AUDIT# with eventType=guardrail_block |

### 1.3 Organization Management

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| O-01 | Create department | Org > Departments > Create "QA Team" under Engineering | Department appears in tree | DEPT#dept-qa + AUDIT# |
| O-02 | Create position | Org > Positions > Create "QA Engineer" in QA Team | Position created with default SOUL | POS#pos-qa-engineer + AUDIT# |
| O-03 | Create employee | Org > Employees > Create "Frank" as QA Engineer | Employee + agent auto-provisioned | EMP#emp-frank + AGENT# + BIND# + AUDIT# (TransactWrite) |
| O-04 | Employee auto-provision | Verify Frank's agent | Agent exists, bound, S3 workspace seeded | S3: _shared/SOUL.md, position/SOUL.md |
| O-05 | Update employee position | Move Carol from Sales Rep to QA Engineer | Position updated, config version bumped | EMP#emp-carol positionId changed + AUDIT# |
| O-06 | Delete employee (cascade) | Delete Frank (force=true) | Agent + bindings + S3 workspace cleaned | EMP#/AGENT#/BIND# deleted + AUDIT# |
| O-07 | Department delete guard | Delete Engineering (has employees) | Error: "department has employees" | — |
| O-08 | Position SOUL edit | Positions > QA Engineer > SOUL tab > Edit | SOUL saved, config version bumped | S3 position SOUL + CONFIG#global-version + AUDIT# |
| O-09 | Bulk provision | Positions > Sales Rep > Bulk Provision | All unbound Sales employees get agents | Multiple EMP#+AGENT#+BIND# TransactWrites |
| O-10 | Employee activity | Employees > Carol > Activity tab | Shows recent session history | SESSION# + CONV# records queried |

### 1.4 Agent Factory

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| AG-01 | Agent list loads | Navigate to `/agents` | Serverless tab shows agents, no errors | — |
| AG-02 | Always-on tab | Click "Always-On" tab | Shows always-on agents (if any) | — |
| AG-03 | Create agent manually | Agents > Create > Select employee, position | Agent created + bound | AGENT# + BIND# + AUDIT# |
| AG-04 | Agent detail - serverless | Click agent > Serverless tab | Shows S3 workspace link, config, sessions | — |
| AG-05 | Agent detail - always-on | Click agent > Always-On tab (if enabled) | Shows Fargate status, tier, model, cost | — |
| AG-06 | Agent detail - usage chart | Agent detail > Activity Summary | 7-day bar chart renders | USAGE# records |
| AG-07 | Agent detail - token chart | Agent detail > Token Usage | Area chart with input/output tokens | USAGE# records |
| AG-08 | Model override per position | Configuration tab > Position model override | Override saved, agents use new model | CONFIG#model positionOverrides + AUDIT# |
| AG-09 | Model override per employee | Configuration tab > Employee model override | Override saved for specific employee | CONFIG#model employeeOverrides + AUDIT# |
| AG-10 | Delete agent | Agent detail > Delete > Confirm | Agent + bindings removed, S3 cleaned | AGENT#/BIND# deleted + AUDIT# |
| AG-11 | Refresh agent | Agent detail > Refresh | Session terminated, next msg re-assembles | Session cleared in AgentCore |
| AG-12 | Position change warning | Move emp to new position, check agent detail | Yellow banner: "Position Changed" | EMP# positionId mismatch with AGENT# |

### 1.5 SOUL Editor

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| S-01 | View 3-layer SOUL | Agent > Edit SOUL | Global (locked) + Position + Personal layers | S3 reads |
| S-02 | Edit personal SOUL | Edit personal layer > Save | Version incremented, content saved | S3 personal/SOUL.md + AGENT# soulVersions |
| S-03 | Edit position SOUL | Edit position layer > Save | Config version bumped, all position agents refreshed | S3 position/SOUL.md + CONFIG#global-version |
| S-04 | Global SOUL locked | Try to edit global layer | Read-only, no edit button | — |

### 1.6 Workspace

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| W-01 | File tree loads | Workspace > Select agent | 3-layer tree renders (Global/Position/Personal) | S3 tree listing |
| W-02 | Read file | Click any file | Content renders in viewer | S3 GetObject |
| W-03 | Edit personal file | Edit USER.md > Save | File saved to S3 | S3 PutObject |
| W-04 | SOUL save warning | Edit SOUL.md > Save | Red warning: "affects live agent" | — |
| W-05 | Unsaved changes guard | Edit file > Switch file | "Discard unsaved changes?" dialog | — |
| W-06 | S3 vs EFS badge | Switch between serverless/always-on agents | Badge shows "S3" or "EFS" correctly | — |
| W-07 | agent_type passed | Inspect network > file read/write calls | `agent_type=serverless` or `always-on` in query | — |

### 1.7 Skills & Knowledge

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| SK-01 | Skill catalog loads | Navigate to `/skills` | Lists all S3 skills with manifests | S3 _shared/skills/ listing |
| SK-02 | Assign skill to position | Skills > browser-use > Assign to Sales Rep | Skill added, config bumped, agents refreshed | CONFIG#global-version + AUDIT# |
| SK-03 | API key configuration | Skills > Keys tab > Set API key | Key saved to SSM SecureString | SSM /openclaw/{stack}/skills/{key} |
| SK-04 | Pending skill review | Employee submits skill > Admin reviews | Approve moves to _shared/, reject deletes | S3 _pending/ -> _shared/ + APPROVAL# |
| SK-05 | Knowledge base list | Navigate to `/knowledge` | Shows KBs with doc counts | S3 _shared/knowledge/ listing |
| SK-06 | Upload knowledge doc | Knowledge > Upload > Select KB, paste content | Doc appears in KB | S3 _shared/knowledge/{kb}/{file} |

### 1.8 Security Center

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| SC-01 | Global SOUL editor | Security > SOUL tab | Read/edit global SOUL | S3 _shared/SOUL.md |
| SC-02 | Position runtime mapping | Security > Runtimes > Assign to position | Runtime mapped | CONFIG#routing + AUDIT# |
| SC-03 | Fargate runtime create | Security > Runtimes > New Template | Runtime created with tier config | Runtime stored (SSM or DDB) |
| SC-04 | Tool allowlist edit | Security > Position > Tools tab | Allowlist saved, config bumped | POS# toolAllowlist + CONFIG#global-version |
| SC-05 | IM platform restriction | Security > Position > IM Platforms | Platforms restricted | POS# allowedIMPlatforms |
| SC-06 | Guardrail events | Security > Guardrails tab | Shows recent guardrail blocks | AUDIT# with guardrail_block |
| SC-07 | Infrastructure audit | Security > Infrastructure tab | Shows IAM roles, VPC, ECR images | AWS API calls |
| SC-08 | Fargate cards (if enabled) | Security > Fargate tab | Running/stopped count, cost bar, bulk ops | ECS API calls |

### 1.9 Monitoring & Audit

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| M-01 | Active sessions | Monitor > Sessions tab | Live sessions with auto-refresh (10s) | SESSION# records |
| M-02 | Session detail | Click session row | Conversation turns, token counts | CONV# records |
| M-03 | Agent health | Monitor > Health tab | Per-agent status cards | AGENT# + USAGE# records |
| M-04 | System status | Monitor > System tab | All services green/yellow/red | Health check APIs |
| M-05 | Runtime events | Monitor > Events tab | Area chart, 24h bucketed | AUDIT# records |
| M-06 | Audit timeline | Audit page > Default view | Chronological event list | AUDIT# records (ScanIndexForward=False) |
| M-07 | Audit filter | Filter by eventType=config_change | Only config_change events shown | AUDIT# filtered query |
| M-08 | Audit scan | Click "Run Scan" | Pattern analysis (zero-turn, SOUL drift) | AUDIT# batch analysis |
| M-09 | Mode column | Monitor sessions table | Shows "Serverless" or "Fargate" badge | SESSION# agentType field |

### 1.10 Usage & Billing

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| U-01 | Usage summary | Navigate to `/usage` | Total tokens, cost, requests, no NaN | USAGE# aggregation |
| U-02 | By department | Usage > Department tab | Breakdown with budget bars | USAGE# + CONFIG#budgets |
| U-03 | By agent | Usage > Agent tab | Per-agent with mode column | USAGE# per agent |
| U-04 | Cost trend | Usage chart | 7-day line chart | USAGE# + COST_TREND# |
| U-05 | Budget edit | Usage > Edit Budget | Budget saved | CONFIG#budgets |
| U-06 | Fargate cost card | Usage stat cards | Shows ~$X/mo for running containers | Calculated from AGENT# deployMode |

### 1.11 Settings

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| ST-01 | Model config | Settings > Model tab | Default + fallback models shown | CONFIG#model |
| ST-02 | Set default model | Change to Claude Sonnet | All agents use new default | CONFIG#model + AUDIT# |
| ST-03 | Service status | Settings > System tab | CPU/Memory/Disk meters, port status | OS stats API |
| ST-04 | Platform logs | Settings > Platform Logs > Fetch | journalctl output rendered | Shell exec on EC2 |
| ST-05 | Restart service | Settings > Restart tenant-router | Service restarted, status refreshes | systemctl restart |
| ST-06 | Fargate config tab | Settings > Fargate | ECS cluster, running tasks, tier defaults | ECS API / service status |
| ST-07 | Admin assistant | Settings > Admin Assistant > Set model | Model saved, assistant uses it | CONFIG#admin-assistant |

---

## Part 2: Functional Testing — Employee Portal

### 2.1 Portal Chat

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| P-01 | Portal chat — serverless | Login as Carol > Send "Hello" | Agent responds via AgentCore, source=agentcore | SESSION# + CONV# + USAGE# |
| P-02 | Cold start indicator | First message after idle | WarmupIndicator shows ~25s countdown | — |
| P-03 | Chat history persistence | Send messages > Refresh page | Messages restored from localStorage | — |
| P-04 | Clear chat | Click trash icon | Chat cleared, fresh welcome message | — |
| P-05 | Agent mode badge | Check header | Shows "Serverless" or "Always-On" badge | — |
| P-06 | Agent switcher | Sidebar agent buttons (if dual) | Switching changes chat mode | Context state change |
| P-07 | Portal chat — always-on | Login as Diana (if AO enabled) > Switch to Always-On > Send "Hi" | Agent responds via Fargate, source=fargate | SESSION# + CONV# (different session pattern) |
| P-08 | Cron notification | After scheduled task fires | Bell notification appears in chat | NOTIFICATION# record |

### 2.2 Portal Profile

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| PP-01 | Profile loads | Portal > Profile | Name, position, department, agent, mode shown | EMP# + AGENT# |
| PP-02 | USER.md edit | Write preferences > Save | Saved to S3 personal workspace | S3 personal/USER.md |
| PP-03 | Use template | Click "Use template" | Template fills textarea | — |
| PP-04 | Memory preview | Expand "What My Agent Remembers" | Shows MEMORY.md size + preview | S3 personal/MEMORY.md |
| PP-05 | Digital twin toggle | Enable digital twin | Share URL generated | TWIN# + TWINOWNER# |
| PP-06 | Digital twin public chat | Open twin URL in incognito | Can chat without login | CONV# via public endpoint |
| PP-07 | Deploy mode display | Check Mode field | Shows "Always-on" or "On-demand" with correct handling of legacy values | Profile API response |

### 2.3 Portal IM Binding

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| IM-01 | Channel status | Portal > Connect IM | Shows available channels with admin config status | CONFIG#im-bot-info |
| IM-02 | Start pairing | Select Telegram > Start Pairing | 8-char pairing code displayed | PAIR# with 15min TTL |
| IM-03 | Complete pairing | Send code to Telegram bot | Pairing completes, channel shows as connected | MAPPING#telegram__{userId} + BIND# |
| IM-04 | Self-service disconnect | Connected channel > Disconnect | Channel removed | MAPPING# deleted + AUDIT# |
| IM-05 | Always-on credential input | Switch to Always-On mode > Connect Feishu | Shows app-id/secret form + webhook URL | EMP# imCredentials + AUDIT# |
| IM-06 | agent_type context | Switch agent mode in sidebar | BindIM shows correct mode (pairing vs credentials) | Context state |

### 2.4 Portal Sub-pages

| # | Test Case | Steps | Expected | DynamoDB Trace |
|---|-----------|-------|----------|----------------|
| PS-01 | My Skills | Portal > My Skills | Shows active + restricted skills | S3 skills listing |
| PS-02 | Request skill access | My Skills > Request "browser-use" | Request submitted, badge shows "Requested" | APPROVAL# created |
| PS-03 | My Usage | Portal > My Usage | Stats + daily chart, no NaN | USAGE# filtered by employee |
| PS-04 | My Requests | Portal > My Requests | Pending + resolved lists | APPROVAL# records |
| PS-05 | New tool request | My Requests > New Request > Select tool | Request submitted | APPROVAL# created |
| PS-06 | My Agents | Portal > My Agents | Serverless card + Always-On card (if enabled) | AGENT# + always-on status |
| PS-07 | agent_type propagation | Switch agent mode > Check network | All portal API calls include `agent_type` param | — |

---

## Part 3: E2E Scenarios (Real Flows)

### E2E-01: New Employee Onboarding (Full Lifecycle)

```
1. Admin: Create department "Customer Success"
2. Admin: Create position "CS Specialist" with custom SOUL
3. Admin: Assign skills (browser-use, crm-query) to position
4. Admin: Create employee "Grace" (emp-grace) in CS Specialist
   -> Verify: auto-provisioned agent + binding + S3 workspace
5. Grace: Login (first login, forced password change)
6. Grace: Edit USER.md with preferences
7. Grace: Send first chat message "What can you do?"
   -> Verify: cold start ~25s, agent responds with SOUL-informed answer
8. Grace: Send "Search our knowledge base for refund policy"
   -> Verify: agent uses assigned skills, response references KB
9. Grace: Connect Telegram (self-service pairing)
   -> Verify: pairing code, bot message, MAPPING# created
10. Admin: Check Grace in Monitor > Active Sessions
    -> Verify: session visible, turn count matches
11. Admin: Check Grace in Audit Log
    -> Verify: agent_invocation events with correct actorId
12. Admin: Check Usage > By Agent
    -> Verify: Grace's agent shows token/cost data
```

**DynamoDB traces to verify:**
- `DEPT#dept-cs`, `POS#pos-cs-specialist`, `EMP#emp-grace`, `AGENT#agent-grace-*`, `BIND#bind-*`
- `SESSION#personal__emp-grace`, `CONV#personal__emp-grace#*` (multiple turns)
- `USAGE#agent-grace-*#2026-04-16`
- `MAPPING#telegram__*` (Grace's Telegram mapping)
- `AUDIT#*` (at least 5 entries: create_dept, create_pos, create_emp, agent_invocation x2)
- S3: `emp-grace/SOUL.md`, `emp-grace/USER.md`, `emp-grace/memory/2026-04-16.md`

### E2E-02: Always-On Agent with IM (Fargate Flow)

```
1. Admin: Security Center > Create Fargate runtime "Engineering Tier"
2. Admin: Security Center > Assign Engineering Tier to Engineering position
3. Admin: Enable Always-On for emp-bob
   -> Verify: ECS RunTask, container starts, SSM endpoint registered
4. Bob: Portal > Switch to Always-On mode
5. Bob: Send message "List my upcoming tasks"
   -> Verify: routed to Fargate container (source=fargate), <3s response
6. Bob: Connect Feishu (credential form, not pairing)
   -> Verify: app-id/secret saved to EMP#, webhook URL displayed
7. Admin: Agent Detail > Bob > Always-On tab
   -> Verify: Running badge, tier, model, cost, IM channels listed
8. Admin: Agent Detail > Disconnect Feishu (with reason "test disconnect")
   -> Verify: channel removed, audit entry with reason
9. Admin: Agent Detail > Stop Always-On
   -> Verify: ECS task stopped, status changes to Stopped
```

**DynamoDB traces to verify:**
- `EMP#emp-bob` alwaysOnEnabled=true, alwaysOnTier=engineering
- `SESSION#cron__emp-bob` or `SESSION#always-on__emp-bob`
- `AUDIT#*` entries for always_on_enabled, im_channel_connected, im_channel_disconnected (with reason)
- SSM: `/openclaw/{stack}/always-on/emp-bob/endpoint`

### E2E-03: Model Override & Budget Enforcement

```
1. Admin: Settings > Set default model to Nova 2 Lite
2. Admin: Agents > Configuration > Override Sales Rep position model to Claude Sonnet
3. Carol (Sales): Send message
   -> Verify: response uses Claude Sonnet (check USAGE# model field)
4. Admin: Agents > Configuration > Override emp-carol to Claude Opus
5. Carol: Send message
   -> Verify: response uses Claude Opus (employee override > position override)
6. Admin: Usage > Edit Budget > Set emp-carol budget to $0.01
7. Carol: Send expensive message
   -> Verify: budget warning or enforcement (check AUDIT# for budget_exceeded)
8. Admin: Remove employee override, remove position override
   -> Verify: Carol falls back to Nova 2 Lite
```

**DynamoDB traces to verify:**
- `CONFIG#model` with positionOverrides and employeeOverrides
- `USAGE#agent-carol-*#2026-04-16` with model=claude-sonnet, then claude-opus, then nova-2-lite
- `CONFIG#budgets` with employee-level budget
- `AUDIT#*` for config_change events

### E2E-04: Cascade Delete — Complete Cleanup

```
1. Setup: Ensure emp-frank exists with:
   - Active agent with sessions
   - IM binding (Telegram mapping)
   - S3 workspace with files
   - Usage records
   - Always-On enabled (if possible)
2. Admin: Employees > Delete emp-frank (force=true)
3. Verify cleanup:
   - EMP#emp-frank: DELETED
   - AGENT#agent-frank-*: DELETED
   - BIND#bind-frank-*: DELETED
   - MAPPING#telegram__frank-*: DELETED
   - S3 workspace: emp-frank/ prefix EMPTY
   - SESSION# records: REMAIN (audit trail)
   - USAGE# records: REMAIN (billing trail)
   - CONV# records: REMAIN (conversation trail)
   - AUDIT#: new entry "employee_deleted" with cascade details
   - If Always-On: ECS task stopped, EFS access point deleted, SSM params deleted
```

### E2E-05: Security — SOUL Governance Chain

```
1. Admin: Security Center > Edit Global SOUL
   - Add: "Never discuss competitor products"
2. Admin: Security Center > Edit Sales Rep Position SOUL
   - Add: "Always mention our pricing advantage"
3. Carol: Edit personal USER.md
   - Add: "I prefer concise answers in bullet points"
4. Carol: Send "Compare us with CompetitorX"
   -> Verify: Agent refuses (global SOUL rule)
5. Carol: Send "What's our pricing advantage?"
   -> Verify: Response includes pricing info (position SOUL)
6. Carol: Send "Summarize our product"
   -> Verify: Response in bullet points (personal preference)
7. Admin: Audit > Verify SOUL version chain
   -> Verify: soulVersions.global, .position, .personal all incremented
```

### E2E-06: Skill Lifecycle — Request, Review, Deploy

```
1. Carol: Portal > My Skills > Request "aws-cli" access
   -> Verify: APPROVAL# created with type=tool
2. Admin: Approvals page > See Carol's request
3. Admin: Approve "aws-cli" for Carol
   -> Verify: APPROVAL# status=approved, skill added to Carol's personalSkills
4. Carol: Portal > My Skills > "aws-cli" now in Active Skills
5. Carol: Chat > "List my S3 buckets"
   -> Verify: Agent uses aws-cli skill (check session for tool_call)
6. Admin: Revoke aws-cli from Carol (remove from personalSkills)
7. Carol: Chat > "List my S3 buckets"
   -> Verify: Agent says it doesn't have access to that tool
```

### E2E-07: Digital Twin — Public Sharing

```
1. Carol: Portal > Profile > Enable Digital Twin
   -> Verify: TWIN# + TWINOWNER# created, URL generated
2. Open twin URL in incognito browser (no auth)
   -> Verify: Shows Carol's agent name, can chat
3. Send message as anonymous visitor
   -> Verify: Response reflects Carol's SOUL + preferences
4. Carol: Check twin stats (views, chats)
5. Carol: Disable Digital Twin
   -> Verify: TWIN#/TWINOWNER# deleted, URL returns 404
```

---

## Part 4: Non-Functional Testing

### 4.1 Performance

| # | Test Case | Method | Target | Pass Criteria |
|---|-----------|--------|--------|---------------|
| NF-01 | Dashboard load time | Browser DevTools Network | `/dashboard` GET | < 2s total, no waterfall > 500ms |
| NF-02 | Agent list load (50+ agents) | Network timing | `/agents` GET | < 1s response |
| NF-03 | Workspace tree load | Network timing | `/workspace/tree` GET | < 3s for large workspace |
| NF-04 | Chat cold start (serverless) | Stopwatch from send to first token | Portal chat | < 30s (AgentCore microVM boot) |
| NF-05 | Chat warm response | Stopwatch on subsequent messages | Portal chat | < 5s |
| NF-06 | Chat cold start (always-on) | Stopwatch from send to first token | Portal chat (AO mode) | < 5s (container already running) |
| NF-07 | Concurrent sessions | 5 browser tabs, different employees | Simultaneous chat | All respond, no cross-tenant leak |
| NF-08 | DynamoDB query latency | CloudWatch metrics | Table scans/queries | p99 < 100ms |
| NF-09 | S3 workspace read | Network timing | `/workspace/file` GET | < 500ms per file |
| NF-10 | Auto-refresh polling | Monitor page open 5 min | Sessions/Health refresh | No memory leak, no duplicate requests |

### 4.2 Reliability & Error Handling

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| NF-11 | API error display | Kill tenant-router, send chat | Friendly error message, not stack trace |
| NF-12 | DynamoDB throttle | Rapid-fire 20 requests | Graceful retry or backoff message |
| NF-13 | S3 permission denied | Try to read another employee's file | 403, not file content |
| NF-14 | Invalid agent ID | Navigate to `/agents/nonexistent` | "Agent Not Found" page |
| NF-15 | Network offline | Disable network mid-chat | Error toast, retry on reconnect |
| NF-16 | JWT token tamper | Modify JWT payload | 401 on all API calls |
| NF-17 | Large file upload | Upload 2MB knowledge doc | Rejected with size error (max 1MB) |
| NF-18 | Concurrent SOUL edit | Two admins edit same SOUL | Last-write-wins, no corruption |

### 4.3 Security

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| NF-19 | XSS in chat | Send `<script>alert(1)</script>` in chat | Rendered as text, not executed |
| NF-20 | XSS in employee name | Create employee with `<img onerror=...>` name | Escaped in all views |
| NF-21 | SQL/NoSQL injection | Employee name: `"; DROP TABLE` | DynamoDB ignores, name stored literally |
| NF-22 | Path traversal workspace | GET `/workspace/file?key=../../etc/passwd` | Rejected by key validation |
| NF-23 | IDOR — cross-employee data | Carol tries to read Bob's workspace files | 403 Forbidden |
| NF-24 | IDOR — employee escalation | Carol calls admin-only API | 403 or filtered response |
| NF-25 | Rate limiting | Send 100 chat messages in 10s | Rate limited after threshold |
| NF-26 | SSM parameter security | Check gateway tokens in SSM | Stored as SecureString, not plaintext |
| NF-27 | CORS enforcement | Cross-origin request from evil.com | Rejected by CORS policy |
| NF-28 | Guardrail enforcement | Send PII/toxic content | Bedrock Guardrail blocks, AUDIT# logged |

### 4.4 Data Integrity

| # | Test Case | Method | Expected |
|---|-----------|-------|----------|
| NF-29 | Atomic provisioning | Create employee during DDB hiccup | All 4 records created or none (TransactWrite) |
| NF-30 | Config version consistency | Edit SOUL, immediately chat | Agent uses new SOUL (config version check) |
| NF-31 | Usage aggregation accuracy | Sum USAGE# records manually | Matches Usage page totals |
| NF-32 | Audit completeness | Perform 10 actions, check audit | All 10 appear in AUDIT# |
| NF-33 | Session turn count | Send 5 messages, check SESSION# | turns=5, tokensUsed > 0 |
| NF-34 | Conversation ordering | Check CONV# records for a session | seq values monotonically increasing |

### 4.5 UI/UX

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| NF-35 | Responsive layout | Resize browser to 768px width | Sidebar collapses, cards stack |
| NF-36 | Dark theme consistency | All pages | No white flashes, consistent color palette |
| NF-37 | Loading states | Slow network (DevTools throttle) | Skeleton/spinner on every data fetch |
| NF-38 | Empty states | New deploy with no data | Helpful empty state messages, not blank |
| NF-39 | Error toasts | Trigger API errors | Toast appears with actionable message |
| NF-40 | Keyboard navigation | Tab through forms | Focus rings visible, Enter submits |

---

## Part 5: Data Verification Queries

After running all tests, verify data traces in DynamoDB:

```bash
# Connect to EC2
aws ssm start-session --target i-054cb53703d2ba33c --region us-east-1

# Count records by type
aws dynamodb scan --table-name openclaw-enterprise --region us-east-1 \
  --select COUNT \
  --filter-expression "begins_with(SK, :sk)" \
  --expression-attribute-values '{":sk":{"S":"AUDIT#"}}' \
  --query 'Count'

# Verify specific employee trace
aws dynamodb query --table-name openclaw-enterprise --region us-east-1 \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"ORG#acme"},":sk":{"S":"EMP#emp-grace"}}' \
  --query 'Items[0]'

# Check conversation history
aws dynamodb query --table-name openclaw-enterprise --region us-east-1 \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"ORG#acme"},":sk":{"S":"CONV#personal__emp-carol"}}' \
  --query 'Count'

# Check usage records for today
aws dynamodb query --table-name openclaw-enterprise --region us-east-1 \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"ORG#acme"},":sk":{"S":"USAGE#"}}' \
  --filter-expression "contains(SK, :date)" \
  --expression-attribute-values '{":pk":{"S":"ORG#acme"},":sk":{"S":"USAGE#"},":date":{"S":"2026-04-16"}}' \
  --query 'Count'

# Check audit entries from today
aws dynamodb query --table-name openclaw-enterprise --region us-east-1 \
  --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
  --expression-attribute-values '{":pk":{"S":"ORG#acme"},":sk":{"S":"AUDIT#"}}' \
  --scan-index-forward false --limit 20 \
  --query 'Items[].{event: eventType.S, actor: actorId.S, time: timestamp.S}'

# Verify S3 workspace for new employee
aws s3 ls s3://openclaw-tenants-576186206185/emp-grace/ --recursive

# Check SSM parameters
aws ssm get-parameters-by-path --path /openclaw/openclaw-enterprise/ \
  --recursive --region us-east-1 --query 'Parameters[].Name'
```

---

## Part 6: Test Execution Checklist

### Phase 1: Admin Foundation (Day 1 Morning)
- [ ] A-01 to A-08 — Auth & authorization
- [ ] D-01 to D-07 — Dashboard
- [ ] O-01 to O-10 — Organization CRUD
- [ ] AG-01 to AG-12 — Agent factory

### Phase 2: Admin Features (Day 1 Afternoon)
- [ ] S-01 to S-04 — SOUL editor
- [ ] W-01 to W-07 — Workspace
- [ ] SK-01 to SK-06 — Skills & knowledge
- [ ] SC-01 to SC-08 — Security center
- [ ] ST-01 to ST-07 — Settings

### Phase 3: Portal (Day 2 Morning)
- [ ] P-01 to P-08 — Portal chat
- [ ] PP-01 to PP-07 — Profile
- [ ] IM-01 to IM-06 — IM binding
- [ ] PS-01 to PS-07 — Portal sub-pages

### Phase 4: E2E Scenarios (Day 2 Afternoon)
- [ ] E2E-01 — New employee onboarding
- [ ] E2E-02 — Always-on Fargate flow
- [ ] E2E-03 — Model override & budget
- [ ] E2E-04 — Cascade delete
- [ ] E2E-05 — SOUL governance chain
- [ ] E2E-06 — Skill lifecycle
- [ ] E2E-07 — Digital twin

### Phase 5: Non-Functional (Day 3)
- [ ] NF-01 to NF-10 — Performance
- [ ] NF-11 to NF-18 — Reliability
- [ ] NF-19 to NF-28 — Security
- [ ] NF-29 to NF-34 — Data integrity
- [ ] NF-35 to NF-40 — UI/UX

### Phase 6: Data Verification (Day 3 End)
- [ ] Run all DynamoDB verification queries
- [ ] Verify S3 workspace artifacts
- [ ] Verify SSM parameter store entries
- [ ] Screenshot all data traces for evidence
- [ ] DO NOT clean up test data — preserve for demo

---

## Test Exit Criteria

| Category | Pass | Fail |
|----------|------|------|
| Functional (Part 1-2) | 90%+ test cases pass | Any P0 blocker (auth, chat, CRUD) |
| E2E Scenarios (Part 3) | All 7 scenarios complete | Any scenario cannot finish end-to-end |
| Non-Functional (Part 4) | No critical security issues, all performance targets met | XSS, IDOR, or data leak found |
| Data Traces (Part 5) | All expected DynamoDB/S3/SSM records present | Missing audit trail or orphaned records |
