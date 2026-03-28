import { useState, useEffect, useCallback } from 'react';
import { User, Bot, Save, Brain, Eye, EyeOff, ChevronDown, ChevronRight, Share2, Copy, Check, Power, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../api/client';
import { Badge, Button, Card, StatusDot } from '../../components/ui';

const USER_MD_TEMPLATE = `## My working style
I prefer concise, direct answers. Skip long preambles.

## Response format
- Use markdown: tables for comparisons, code blocks for commands
- For multi-step tasks: show numbered steps, confirm before executing

## My timezone
UTC+8 (Beijing / Singapore)

## My current focus
<!-- Tell your agent what you're working on this week -->

## My preferences
<!-- Add personal preferences that should always apply -->
`;


export default function PortalProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [userMd, setUserMd] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [twin, setTwin] = useState<{ active: boolean; url?: string; chatCount?: number; viewCount?: number } | null>(null);
  const [twinLoading, setTwinLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [alwaysOn, setAlwaysOn] = useState<{ running: boolean; ecsStatus?: string } | null>(null);
  const [alwaysOnLoading, setAlwaysOnLoading] = useState(false);

  useEffect(() => {
    api.get<any>('/portal/profile').then(data => {
      setProfile(data);
      setUserMd(data.userMd || '');
    }).catch(() => {});
    api.get<any>('/portal/twin').then(setTwin).catch(() => {});
    api.get<any>('/portal/always-on').then(setAlwaysOn).catch(() => {});
  }, []);

  const handleTwinToggle = useCallback(async () => {
    setTwinLoading(true);
    try {
      if (twin?.active) {
        await api.del('/portal/twin');
        setTwin({ active: false });
      } else {
        const data = await api.post<any>('/portal/twin', {});
        setTwin(data);
      }
    } catch {}
    setTwinLoading(false);
  }, [twin]);

  const handleAlwaysOnToggle = useCallback(async () => {
    setAlwaysOnLoading(true);
    try {
      if (alwaysOn?.running) {
        await api.del('/portal/always-on');
        setAlwaysOn({ running: false, ecsStatus: 'STOPPED' });
      } else {
        const data = await api.post<any>('/portal/always-on', {});
        setAlwaysOn({ running: false, ecsStatus: 'STARTING', ...data });
        // Poll until RUNNING (up to 60s)
        for (let i = 0; i < 12; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const status = await api.get<any>('/portal/always-on').catch(() => null);
          if (status) { setAlwaysOn(status); if (status.running) break; }
        }
      }
    } catch {}
    setAlwaysOnLoading(false);
  }, [alwaysOn]);

  const handleCopy = useCallback(() => {
    if (twin?.url) {
      navigator.clipboard?.writeText(twin.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [twin?.url]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/portal/profile', { userMd });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {}
    setSaving(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-bold text-text-primary">My Profile</h1>

      {/* Basic Info */}
      <Card>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/20 text-primary text-xl font-bold">
            {user?.name?.[0] || 'U'}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">{user?.name}</h2>
            <p className="text-sm text-text-muted">{user?.positionName} · {user?.departmentName}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><p className="text-xs text-text-muted">Employee ID</p><p className="text-sm font-medium">{user?.id}</p></div>
          <div><p className="text-xs text-text-muted">Position</p><p className="text-sm font-medium">{user?.positionName}</p></div>
          <div><p className="text-xs text-text-muted">Department</p><p className="text-sm font-medium">{user?.departmentName}</p></div>
          <div>
            <p className="text-xs text-text-muted">Agent</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Bot size={14} className="text-green-400" />
              <span className="text-sm font-medium">{profile?.agent?.name || 'Not assigned'}</span>
              {profile?.agent && <StatusDot status={profile.agent.status} />}
            </div>
          </div>
        </div>
      </Card>

      {/* Preferences */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Tell Your Agent About Yourself (USER.md)</h3>
            <p className="text-xs text-text-muted">Your agent reads this every session — the more detail you add, the better it adapts to you</p>
          </div>
          <div className="flex gap-2">
            {!userMd && (
              <Button variant="default" size="sm" onClick={() => setUserMd(USER_MD_TEMPLATE)}>
                Use template
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              <Save size={14} /> {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save'}
            </Button>
          </div>
        </div>
        {!userMd && (
          <div className="mb-3 rounded-xl bg-info/5 border border-info/20 px-3 py-2.5 text-xs text-info">
            This file is empty. Click <strong>Use template</strong> to get started with suggestions,
            or write freely — tell your agent your working style, timezone, preferred formats, and current focus.
          </div>
        )}
        <textarea
          value={userMd}
          onChange={e => setUserMd(e.target.value)}
          rows={12}
          placeholder={USER_MD_TEMPLATE}
          className="w-full rounded-xl border border-dark-border/60 bg-dark-bg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted/40 focus:border-primary/60 focus:outline-none font-mono resize-y"
        />
      </Card>

      {/* Memory */}
      <Card>
        <button className="w-full flex items-center justify-between" onClick={() => setShowMemory(s => !s)}>
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-primary-light" />
            <h3 className="text-sm font-semibold text-text-primary">What My Agent Remembers</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">
              {profile?.memoryMdSize ? `${(profile.memoryMdSize / 1024).toFixed(1)} KB` : 'Empty'}
            </span>
            {showMemory ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
          </div>
        </button>
        {showMemory && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-info/5 border border-info/20 px-3 py-2 text-xs text-info">
              This is your agent's persistent memory — it's automatically updated as you work together.
              It helps your agent maintain context across sessions. You can't edit this directly.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-surface-dim px-4 py-3">
                <p className="text-xs text-text-muted mb-1">MEMORY.md size</p>
                <p className="text-sm font-semibold text-text-primary">{profile?.memoryMdSize ? `${(profile.memoryMdSize / 1024).toFixed(1)} KB` : '—'}</p>
              </div>
              <div className="rounded-xl bg-surface-dim px-4 py-3">
                <p className="text-xs text-text-muted mb-1">Daily memory files</p>
                <p className="text-sm font-semibold text-text-primary">{profile?.dailyMemoryCount || 0}</p>
              </div>
            </div>
            {profile?.memoryPreview && (
              <pre className="rounded-xl bg-dark-bg border border-dark-border/40 px-4 py-3 text-xs text-text-secondary whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                {profile.memoryPreview}
              </pre>
            )}
          </div>
        )}
      </Card>

      {/* Digital Twin */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Share2 size={16} className={twin?.active ? 'text-success' : 'text-text-muted'} />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Digital Twin</h3>
              <p className="text-xs text-text-muted">Share a link so anyone can chat with your AI agent while you're away</p>
            </div>
          </div>
          <button
            onClick={handleTwinToggle}
            disabled={twinLoading}
            className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${twin?.active ? 'bg-success' : 'bg-dark-border'} disabled:opacity-50`}
          >
            <span className={`absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${twin?.active ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {twin?.active && twin?.url && (
          <div className="space-y-3">
            <div className="rounded-xl bg-success/5 border border-success/20 px-3 py-2.5 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
              <p className="text-xs text-success font-medium">Your digital twin is live</p>
              {twin.viewCount !== undefined && (
                <span className="text-[10px] text-text-muted ml-auto">{twin.viewCount} views · {twin.chatCount} chats</span>
              )}
            </div>

            <div className="rounded-xl bg-dark-bg border border-dark-border/40 px-3 py-2.5 flex items-center gap-2">
              <p className="flex-1 text-xs font-mono text-text-secondary truncate">{twin.url}</p>
              <button onClick={handleCopy} className="shrink-0 text-text-muted hover:text-primary transition-colors">
                {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
              </button>
              <a href={twin.url} target="_blank" rel="noreferrer" className="shrink-0 text-text-muted hover:text-primary transition-colors">
                <ExternalLink size={14} />
              </a>
            </div>

            <p className="text-[10px] text-text-muted">
              Anyone with this link can chat with your AI agent. Your agent will respond based on your SOUL profile and memory.
              Turn off to revoke access immediately.
            </p>
          </div>
        )}

        {!twin?.active && (
          <div className="rounded-xl bg-surface-dim px-3 py-3 text-xs text-text-muted">
            When enabled, you get a shareable link. Visitors can ask your AI questions and get responses based on your expertise and memory — useful when you're unavailable.
          </div>
        )}
      </Card>

      {/* Persistent Mode */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Power size={16} className={alwaysOn?.running ? 'text-primary' : 'text-text-muted'} />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Persistent Mode</h3>
              <p className="text-xs text-text-muted">Your agent runs continuously — enables scheduled reminders and instant responses</p>
            </div>
          </div>
          <button
            onClick={handleAlwaysOnToggle}
            disabled={alwaysOnLoading}
            className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${alwaysOn?.running ? 'bg-primary' : 'bg-dark-border'} disabled:opacity-50`}
          >
            <span className={`absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${alwaysOn?.running ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {alwaysOn?.running ? (
          <div className="space-y-2">
            <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-2.5 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
              <p className="text-xs text-primary font-medium">Persistent mode active</p>
              <span className="text-[10px] text-text-muted ml-auto">Scheduled tasks enabled</span>
            </div>
            <p className="text-[10px] text-text-muted">
              Your agent is always running. Reminders will fire on time. Turn off to stop the container and return to on-demand mode.
            </p>
          </div>
        ) : alwaysOnLoading ? (
          <div className="rounded-xl bg-primary/5 border border-primary/10 px-3 py-2.5 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary/60 animate-pulse shrink-0" />
            <p className="text-xs text-text-muted">
              {alwaysOn?.ecsStatus === 'STARTING' ? 'Container starting (~30s)...' : 'Processing...'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-surface-dim px-3 py-3 text-xs text-text-muted space-y-1">
            <p>Enable for reliable scheduled reminders, recurring tasks, and 0ms response time.</p>
            <p className="text-[10px] opacity-70">Note: incurs additional compute cost (~$15/mo).</p>
          </div>
        )}
      </Card>
    </div>
  );
}
