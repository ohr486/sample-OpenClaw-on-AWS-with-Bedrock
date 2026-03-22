# ClawForge — Enterprise AI Workforce Platform

## One-Liner

Turn OpenClaw from a personal AI assistant into a governed digital workforce — every employee gets a role-specific AI agent with unique identity, permissions, and memory, running in isolated Firecracker microVMs on AWS Bedrock AgentCore. Zero modifications to OpenClaw source code.

## The Market Opportunity

The AI agent market hit $7.84B in 2025 and is projected to reach $50B+ by 2030 (41% CAGR). Gartner forecasts 40% of enterprise applications will embed AI agents by end of 2026. 62% of Fortune 500 companies already use at least one AI agent framework in production.

But there's a gap: open-source AI agents like OpenClaw (200k+ GitHub stars) are designed for personal use. Enterprises need multi-tenant isolation, RBAC, audit trails, and cost governance — none of which exist in the base product. The choice today is between powerful-but-ungoverned open-source agents and expensive-but-locked-in enterprise platforms.

ClawForge fills this gap.

## What ClawForge Does

ClawForge is a management layer that wraps OpenClaw with enterprise controls. It doesn't fork or modify OpenClaw — it controls agent behavior entirely through OpenClaw's native workspace file system (SOUL.md, TOOLS.md, USER.md).

When Carol in Finance asks her agent "Who are you?", it responds "I'm your ACME Corp Finance Analyst." When Wang Wu in Engineering asks the same question to his agent, it responds "I'm your ACME Corp Software Engineer." Same LLM, same infrastructure, completely different identities and permissions.

## Six Design Advantages

### 1. Zero Invasion Architecture

We don't fork OpenClaw. We don't patch it. We don't even know it's running in an enterprise context.

The `workspace_assembler` merges three layers of configuration (Global → Position → Personal) into workspace files that OpenClaw reads natively. This means:
- Upgrade OpenClaw independently — community updates work immediately
- No maintenance burden from maintaining a fork
- All 50+ OpenClaw community plugins work out of the box
- Enterprise logic is fully decoupled and portable to other agent platforms

No other enterprise AI agent platform achieves this level of non-invasiveness. Competitors like GoClaw rebuild the entire agent in Go. Microsoft Copilot is a closed system. We wrap the existing open-source agent without touching it.

### 2. Serverless-First on Firecracker

Each agent runs in an isolated Firecracker microVM via AWS Bedrock AgentCore. There are no long-running containers per tenant.

- 20 agents = $0 idle cost (microVMs only exist during active conversations)
- Cold start: ~5s user-perceived (fast-path), ~25s real microVM (background)
- Hardware-level isolation: each agent has its own filesystem, network namespace, and memory space
- Auto-scaling: 1 user or 1,000 users, same infrastructure

Traditional approach: 20 containers always running = $400+/month.
ClawForge approach: 20 potential microVMs, pay per invocation = ~$65/month.

### 3. Three-Layer SOUL Architecture

Agent identity is composed from three layers, each managed by a different stakeholder:

```
Layer 1: GLOBAL (IT locked — CISO + CTO approval)
  → Company policies, security red lines, data handling rules
  → "Never share customer PII. Never execute rm -rf."

Layer 2: POSITION (Department admin managed)
  → Role expertise, tool permissions, knowledge scope
  → "You are a Finance Analyst. Use excel-gen, not shell."

Layer 3: PERSONAL (Employee self-service)
  → Communication preferences, custom instructions
  → "I prefer concise answers. Always use TypeScript."
```

The merge order ensures Global rules always take precedence. An employee cannot override "Never share customer PII" through personal preferences. This is the core innovation — centralized governance with individual customization.

### 4. Permission Enforcement (Plan A + Plan E)

Two-layer permission system:

- Plan A (Pre-Execution): Permission constraints are injected at the top of SOUL.md before OpenClaw processes any message. The LLM sees "You MUST NOT use: shell, code_execution" as the first instruction.
- Plan E (Post-Execution): Every response is scanned for blocked tool patterns. If a Finance agent somehow executes a shell command, it's logged, flagged, and the security team is notified.

Plus skill-level filtering: each of the 26 skills has `allowedRoles`/`blockedRoles` in its manifest. Finance gets excel-gen but not shell. SDE gets github-pr but not email-send. IT controls the catalog.

### 5. Full-Stack Admin Console (24 Pages)

Not a dashboard bolted onto an API. A complete management platform:

- 19 admin pages: Dashboard, Org Tree, Positions, Employees, Agent Factory, SOUL Editor, Workspace Manager, Skill Platform, Knowledge Base, Bindings & Routing, Monitor Center, Session Detail, Audit Center, Usage & Cost, Approvals, Playground, Settings
- 5 employee portal pages: Chat, Profile, My Usage, My Skills, My Requests
- 3-role RBAC: Admin (full access), Manager (department-scoped via BFS rollup), Employee (portal only)
- 35+ FastAPI endpoints backed by DynamoDB single-table design + S3
- Zero hardcoded data — everything from DynamoDB/S3

### 6. 85% Cost Reduction

| | ChatGPT Team | Microsoft Copilot | ClawForge |
|-|-------------|-------------------|-----------|
| 20 users | $500/mo | $600/mo | ~$65/mo |
| Per-user identity | ❌ Same for all | ❌ Same for all | ✅ Unique per role |
| Tool permissions | ❌ | ❌ | ✅ Per-position |
| Self-hosted | ❌ | ❌ | ✅ Your VPC |
| Open source | ❌ | ❌ | ✅ |
| Memory persistence | ❌ Session only | ❌ | ✅ Cross-session |
| Audit trail | ❌ | Partial | ✅ Comprehensive |

## How It Works (Technical Flow)

```
Employee sends "Run git status" via Telegram
  → OpenClaw Gateway receives message
  → H2 Proxy intercepts Bedrock SDK call
  → Tenant Router derives tenant_id: tg__emp-carol__a1b2c3d4
  → AgentCore creates Firecracker microVM
  → server.py extracts base ID: emp-carol
  → SSM lookup: emp-carol → pos-fa (Finance Analyst)
  → workspace_assembler.py merges 3 SOUL layers from S3
  → Plan A injects: "You MUST NOT use: shell, code_execution"
  → OpenClaw reads merged SOUL.md
  → Agent responds: "I don't have permission to run shell commands.
     My Finance Analyst role only has access to: web_search, excel-gen..."
  → Plan E scans response: ✅ PASS
  → Usage written to DynamoDB (fire-and-forget)
  → Memory synced to S3 every 60s
```

## What's Built (v1.0 — Production Ready)

| Component | Details |
|-----------|---------|
| Admin Console | 24 pages, React 19 + Tailwind CSS v4, dark theme |
| Backend | FastAPI, 35+ endpoints, DynamoDB + S3 |
| Agent Runtime | Docker on AgentCore, workspace assembly, skill loading |
| SOUL Templates | 10 position-specific (SA, SDE, DevOps, QA, AE, PM, FA, HR, CSM, Legal) |
| Skills | 26 with role-based filtering (6 global + 20 department-scoped) |
| Knowledge Base | 12 Markdown documents in S3, scope-controlled |
| Sample Org | ACME Corp: 20 employees, 20 agents, 13 departments |
| Seed Scripts | 10 scripts to populate DynamoDB + S3 + SSM |
| Infrastructure | CloudFormation, ECR, systemd, CloudFront + Route 53 |

## Target Customers

1. Mid-size companies (50-500 employees) adopting AI agents for the first time
   - Need governance but can't afford enterprise AI platforms ($50k+/year)
   - Already using OpenClaw personally, want to scale to the team

2. AWS-native organizations
   - Already on Bedrock, want to add agent management
   - Value VPC isolation and IAM integration

3. Regulated industries (finance, healthcare, legal)
   - Need audit trails, PII detection, data sovereignty
   - Can't use ChatGPT/Copilot due to data residency requirements

4. System integrators and MSPs
   - Deploy ClawForge for multiple clients (v2.0 multi-tenancy)
   - White-label the Admin Console

## Roadmap

| Version | Timeline | Key Features |
|---------|----------|-------------|
| v1.0 | Now | Full Admin Console, SOUL injection, RBAC, Portal, Usage tracking |
| v1.1 | Q2 2026 | Org sync (Feishu/DingTalk), SSO, SOUL change approval workflow |
| v1.2 | Q3 2026 | Real-time CloudWatch integration, quality scoring, skill marketplace |
| v2.0 | Q4 2026 | Multi-tenancy (MSP mode), mobile, advanced monitoring |

## Live Demo

**https://openclaw.awspsa.com**

A real running instance with 7 departments, 10 positions, 20 employees, 20 AI agents, 26 skills, and 12 knowledge documents. Every button works, every chart reads from real DynamoDB data, every agent runs on Bedrock AgentCore in isolated Firecracker microVMs.

## Open Source

Apache 2.0 licensed. Part of [aws-samples](https://github.com/aws-samples).

GitHub: https://github.com/aws-samples/sample-OpenClaw-on-AWS-with-Bedrock/tree/main/enterprise

---

Built by [wjiad@aws](mailto:wjiad@amazon.com) · Contributions welcome
