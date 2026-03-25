import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Loader2, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../api/client';
import ClawForgeLogo from '../../components/ClawForgeLogo';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  source?: string;
  model?: string;
}

const STORAGE_KEY = 'openclaw_portal_chat';

function loadMessages(userId: string): Message[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${userId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMessages(userId: string, messages: Message[]) {
  localStorage.setItem(`${STORAGE_KEY}_${userId}`, JSON.stringify(messages));
}

export default function PortalChat() {
  const { user } = useAuth();
  const userId = user?.id || 'unknown';
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = loadMessages(userId);
    if (saved.length > 0) return saved;
    return [{ id: 0, role: 'assistant', content: `Hello ${user?.name || 'there'}! I'm your **${user?.positionName || 'AI'} Agent** at ACME Corp.\n\nI can help you with tasks related to your ${user?.positionName || ''} role in the ${user?.departmentName || ''} department. Just type your question or request below.`, timestamp: new Date().toISOString() }];
  });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Persist messages to localStorage
  useEffect(() => { saveMessages(userId, messages); }, [messages, userId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = useCallback(() => {
    const initial: Message[] = [{ id: Date.now(), role: 'assistant', content: `Chat cleared. How can I help you?`, timestamp: new Date().toISOString() }];
    setMessages(initial);
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || sending) return;
    const userMsg: Message = { id: Date.now(), role: 'user', content: input.trim(), timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const resp = await api.post<{ response: string; agentName?: string; source?: string; model?: string }>('/portal/chat', { message: userMsg.content });
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant', content: resp.response,
        timestamp: new Date().toISOString(), source: resp.source, model: resp.model,
      }]);
    } catch (e: any) {
      // Auto-retry once — AgentCore cold start takes ~25s, first request often fails
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant',
        content: '⏳ Agent is warming up (first request). Retrying...',
        timestamp: new Date().toISOString(), source: 'warmup',
      }]);
      try {
        await new Promise(r => setTimeout(r, 3000));
        const retry = await api.post<{ response: string; agentName?: string; source?: string; model?: string }>('/portal/chat', { message: userMsg.content });
        setMessages(prev => [...prev, {
          id: Date.now() + 2, role: 'assistant', content: retry.response,
          timestamp: new Date().toISOString(), source: retry.source, model: retry.model,
        }]);
      } catch {
        setMessages(prev => [...prev, {
          id: Date.now() + 2, role: 'assistant',
          content: 'Agent is still starting up. Please try again in ~30 seconds.',
          timestamp: new Date().toISOString(), source: 'error',
        }]);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-dark-border px-6 py-3">
        <div className="flex items-center gap-3">
          <ClawForgeLogo size={36} animate={sending ? 'working' : 'idle'} />
          <div>
            <h1 className="text-sm font-semibold text-text-primary">{user?.positionName} Agent</h1>
            <p className="text-xs text-text-muted">{user?.name} · {user?.departmentName}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-green-400">Online</span>
          </div>
          <button onClick={clearChat} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Clear chat history">
            <Trash2 size={14} /> Clear
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary mt-1">
                <Bot size={16} />
              </div>
            )}
            <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-primary text-white'
                : 'bg-dark-card border border-dark-border text-text-primary'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="text-sm prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mt-2 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:bg-dark-bg [&_code]:px-1 [&_code]:rounded [&_pre]:bg-dark-bg [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:my-2 [&_table]:text-xs [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_strong]:text-text-primary [&_a]:text-primary-light">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}
              <p className={`text-[10px] mt-1.5 ${msg.role === 'user' ? 'text-white/60' : 'text-text-muted'}`}>
                {new Date(msg.timestamp).toLocaleTimeString()}
                {msg.source === 'agentcore' && ' · AgentCore'}
                {msg.source === 'fallback' && ' · offline'}
                {msg.model && ` · ${msg.model.split('/').pop()?.split(':')[0] || ''}`}
              </p>
            </div>
            {msg.role === 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 mt-1">
                <User size={16} />
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex gap-3">
            <div className="shrink-0 mt-1">
              <ClawForgeLogo size={28} animate="working" />
            </div>
            <div className="rounded-xl bg-dark-card border border-dark-border px-4 py-3 flex items-center gap-2">
              <span className="text-xs text-text-muted">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-dark-border px-6 py-4">
        <div className="flex gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type your message..."
            disabled={sending}
            className="flex-1 rounded-xl border border-dark-border bg-dark-bg px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Send size={18} />
          </button>
        </div>
        <p className="text-[10px] text-text-muted mt-2 text-center">
          Messages are stored locally. Your agent runs on AWS Bedrock via AgentCore.
        </p>
      </div>
    </div>
  );
}
