// OpenClaw Enterprise — Core Types (DynamoDB Single-Table Design)

// === Organization Layer (Layer 1) ===

export interface Department {
  id: string;
  name: string;
  parentId: string | null;
  headCount: number;
  createdAt: string;
}

export interface Position {
  id: string;
  name: string;
  departmentId: string;
  departmentName: string;
  soulTemplate: string;       // Position-level SOUL.md template
  defaultSkills: string[];
  defaultKnowledge: string[];
  toolAllowlist: string[];
  defaultChannel?: ChannelType; // Default messaging channel for auto-provision
  allowedIMPlatforms?: string[];
  memberCount: number;
  createdAt: string;
}

export interface Employee {
  id: string;
  name: string;
  employeeNo: string;
  positionId: string;
  positionName: string;
  departmentId: string;
  departmentName: string;
  channels: ChannelType[];
  agentId: string | null;
  agentStatus: 'active' | 'idle' | 'archived';
  personalPrefs: string;      // USER.md summary
  role?: 'admin' | 'manager' | 'employee';
  email?: string;
  createdAt: string;
}

// === Agent Layer (Layer 2) ===

export interface Agent {
  id: string;
  name: string;
  employeeId: string | null;
  employeeName: string;
  positionId: string;
  positionName: string;
  status: 'active' | 'idle' | 'error' | 'archived';
  soulVersions: { global: number; position: number; personal: number };
  skills: string[];
  channels: ChannelType[];
  qualityScore: number | null;
  createdAt: string;
  updatedAt: string;
  // Always-on agent fields (ECS Fargate)
  deployMode?: DeployMode;
  containerPort?: number;
  containerStatus?: ContainerStatus;
  ecsServiceName?: string;
  ecsTaskArn?: string;
}

export interface SoulLayer {
  layer: 'global' | 'position' | 'personal';
  content: string;
  locked: boolean;
  version: number;
  updatedAt: string;
}

// === Collaboration + Connection Layer (Layer 3+4) ===

export interface Binding {
  id: string;
  employeeId: string;
  employeeName: string;
  agentId: string;
  agentName: string;
  mode: '1:1' | 'N:1' | '1:N';
  channel: ChannelType;
  status: 'bound' | 'pending' | 'expired' | 'revoked' | 'active' | 'inactive';
  createdAt: string;
}

// === Operations Layer (Layer 7) ===

export interface LiveSession {
  id: string;
  agentId: string;
  agentName: string;
  employeeId: string;
  employeeName: string;
  channel: ChannelType;
  startedAt: string;
  turns: number;
  lastMessage: string;
  status: 'active' | 'idle';
  toolCalls?: number;
  tokensUsed?: number;
}

// === Governance Layer (Layer 6) ===

export interface AuditEntry {
  id: string;
  timestamp: string;
  eventType: 'agent_invocation' | 'tool_execution' | 'config_change' | 'permission_denied' | 'approval_decision' | 'session_start' | 'session_end' | 'guardrail_block';
  actorId: string;
  actorName: string | null;
  targetType: 'agent' | 'employee' | 'position' | 'department' | 'skill' | 'binding' | 'system' | 'guardrail';
  targetId: string;
  detail: string | null;
  status: 'success' | 'blocked' | 'warning' | 'info';
}

// === Fargate / Always-On Types ===

export type DeployMode = 'serverless' | 'always-on-ecs' | 'personal' | 'always-on';

export type ContainerStatus = 'starting' | 'running' | 'stopped' | 'error' | 'reloading';

export type Tier = 'standard' | 'restricted' | 'engineering' | 'executive';

export interface AlwaysOnStatus {
  enabled: boolean;
  running: boolean;
  tier?: Tier;
  ecsStatus?: string;
  serviceName?: string;
  endpoint?: string;
  taskArn?: string;
  containerPort?: number;
}

export interface AlwaysOnChannel {
  channel: string;
  connectedAt?: string;
  status?: string;
}

export interface RuntimeConfig {
  id: string;
  name: string;
  model?: string;
  roleArn?: string;
  guardrailId?: string;
  tier?: Tier;
}

// === Shared ===

export type ChannelType = 'telegram' | 'whatsapp' | 'slack' | 'discord' | 'feishu' | 'dingtalk' | 'portal' | 'web';

/** Normalize legacy deploy mode values to canonical form. */
export function normalizeDeployMode(mode?: string): 'serverless' | 'always-on-ecs' {
  if (mode === 'always-on' || mode === 'always-on-ecs') return 'always-on-ecs';
  return 'serverless'; // 'personal', 'serverless', undefined all map here
}

export function isAlwaysOn(mode?: string): boolean {
  return mode === 'always-on' || mode === 'always-on-ecs';
}

export const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  slack: 'Slack',
  discord: 'Discord',
  feishu: 'Feishu',
  dingtalk: 'DingTalk',
  portal: 'Web Portal',
  web: 'Web Portal',
};
