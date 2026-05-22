import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { req } from '../api';
import { useToast } from '../hooks/useToast';
import { useStore } from '../store';
import type { Agent } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  _clean?: string;
  _actions?: ChatAction[];
  _parsed?: boolean;
}

interface ChatAction {
  type: 'create-agent' | 'open-agents' | 'open-settings';
  label: string;
  data?: { name?: string; description?: string; system?: string; tools?: string[]; model?: string };
}

type FlatAgent = Agent & { level?: string };

// ── Constants ──────────────────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: 'Optimizar agente', icon: 'ti-robot',     text: 'Tengo el siguiente system prompt de un agente. Analízalo y propón mejoras para hacerlo más preciso y efectivo:\n\n' },
  { label: 'Crear CLAUDE.md',  icon: 'ti-file-text', text: 'Ayúdame a crear un archivo CLAUDE.md para un proyecto de tipo: ' },
  { label: 'Revisar prompt',   icon: 'ti-eye',        text: 'Revisa este system prompt e indica si hay instrucciones contradictorias, vagas o que puedan mejorarse:\n\n' },
  { label: 'Nuevo agente',     icon: 'ti-plus',       text: 'Quiero crear un agente para: ' },
];

const LEVEL_LABEL: Record<string, string> = {
  global: 'global', section: 'sección', tech: 'tech', project: 'proyecto',
};

const ACTION_ICON: Record<string, string> = {
  'create-agent': 'ti-plus', 'open-agents': 'ti-robot', 'open-settings': 'ti-settings',
};

// ── Markdown helper ────────────────────────────────────────────────────────────

function renderMarkdown(text: string): string {
  if (!text) return '';
  let s = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  s = s.replace(/```([^`]*?)```/gs, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![*_])([*_])(?![*_])(.+?)(?<![*_])\1(?![*_])/g, '<em>$2</em>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ── Parse AI action comments ───────────────────────────────────────────────────

function parseActions(content: string): { clean: string; actions: ChatAction[] } {
  const m = content.match(/<!--ACTIONS:([\s\S]*?)-->/);
  if (!m) return { clean: content, actions: [] };
  try {
    const actions = JSON.parse(m[1]) as ChatAction[];
    return { clean: content.replace(/<!--ACTIONS:[\s\S]*?-->/, '').trim(), actions };
  } catch {
    return { clean: content, actions: [] };
  }
}

// ── System prompt builder ──────────────────────────────────────────────────────

function buildSystem(activeAgents: FlatAgent[]): string {
  let sys = 'Eres un asistente de IA dentro de Agent Hub, una aplicación para gestionar agentes de Claude Code y proyectos de desarrollo. Ayuda a mejorar system prompts, crear nuevos agentes, revisar configuraciones y responder preguntas sobre desarrollo de software.';

  if (activeAgents.length > 0) {
    sys += '\n\nAgentes activos como contexto:\n\n';
    sys += activeAgents.map((a) =>
      `### @${a.name}\nDescripción: ${a.description || 'Sin descripción'}\n\nSystem prompt:\n${a.system || '(vacío)'}`
    ).join('\n\n---\n\n');
    sys += '\n\nUsa estos agentes como referencia al responder. Puedes sugerir mejoras, detectar problemas o proponer agentes complementarios.';
  }

  sys += `\n\nCuando quieras sugerir una acción concreta en la app, añade al final de tu respuesta en una sola línea:
<!--ACTIONS:[{"type":"create-agent","label":"Crear agente X","data":{"name":"...","description":"...","system":"...","tools":["Read","Write"],"model":"sonnet"}},{"type":"open-agents","label":"Ver agentes"}]-->
Tipos válidos: "create-agent" (con data: {name,description,system,tools,model}), "open-agents", "open-settings". Solo inclúyelo si hay acciones genuinamente útiles.`;

  return sys;
}

// ── Chat page ──────────────────────────────────────────────────────────────────

export function Chat() {
  const toast    = useToast();
  const projects = useStore((s) => s.projects);
  const setView  = useStore((s) => s.setView);

  const [messages,      setMessages]      = useState<Message[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [projectId,     setProjectId]     = useState<string | null>(null);
  const [activeAgents,  setActiveAgents]  = useState<FlatAgent[]>([]);
  const [allAgents,     setAllAgents]     = useState<FlatAgent[] | null>(null);
  const [inputValue,    setInputValue]    = useState('');
  const [mentionQuery,  setMentionQuery]  = useState<string | null>(null);
  const [mentionIndex,  setMentionIndex]  = useState(0);
  const [mentionStart,  setMentionStart]  = useState(0);

  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const loadedPidRef = useRef<string>('__none__');
  const savingRef   = useRef(false);

  // ── History ──────────────────────────────────────────────────────────────────

  const loadHistory = useCallback(async (pid: string | null) => {
    const id  = pid ?? '';
    const url = id ? `/chat/history?projectId=${encodeURIComponent(id)}` : '/chat/history';
    try {
      const data = await req<{ messages: Message[] }>('GET', url);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch {
      setMessages([]);
    }
    loadedPidRef.current = id;
  }, []);

  const saveHistory = useCallback(async (msgs: Message[], pid: string | null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const id  = pid ?? '';
    const url = id ? `/chat/history?projectId=${encodeURIComponent(id)}` : '/chat/history';
    try { await req('PUT', url, { messages: msgs }); } catch {}
    savingRef.current = false;
  }, []);

  const switchProject = useCallback(async (newPid: string | null) => {
    if (newPid === projectId) return;
    setMessages((prev) => { saveHistory(prev, projectId); return []; });
    setProjectId(newPid);
    loadedPidRef.current = '__none__';
    loadHistory(newPid);
  }, [projectId, saveHistory, loadHistory]);

  // ── Agents (flat list for @mention) ─────────────────────────────────────────

  const loadAllAgents = useCallback(async () => {
    try {
      const data = await req<FlatAgent[]>('GET', '/agents/flat');
      setAllAgents(data);
    } catch {
      setAllAgents([]);
    }
  }, []);

  useEffect(() => {
    loadHistory(null);
    loadAllAgents();
  }, []);

  // ── Scroll to bottom when messages change ────────────────────────────────────

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  // ── @mention helpers ─────────────────────────────────────────────────────────

  const mentionFiltered = useCallback((): FlatAgent[] => {
    const q = (mentionQuery ?? '').toLowerCase();
    return (allAgents ?? [])
      .filter((a) => !activeAgents.find((x) => x.name === a.name) && a.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, allAgents, activeAgents]);

  function mentionApply(agent: FlatAgent) {
    const inp = inputRef.current;
    if (!inp) return;
    const end    = mentionStart + 1 + (mentionQuery ?? '').length;
    const before = inp.value.slice(0, mentionStart);
    const after  = inp.value.slice(end);
    const next   = before + after;
    setInputValue(next);
    inp.value = next;
    inp.setSelectionRange(mentionStart, mentionStart);
    autoResize(inp);
    setMentionQuery(null);
    if (!activeAgents.find((a) => a.name === agent.name)) {
      setActiveAgents((prev) => [...prev, agent]);
    }
    setTimeout(() => inp.focus(), 0);
  }

  // ── Input handlers ───────────────────────────────────────────────────────────

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el  = e.currentTarget;
    const val = el.value;
    setInputValue(val);
    autoResize(el);

    const pos    = el.selectionStart ?? 0;
    const before = val.slice(0, pos);
    const atIdx  = before.lastIndexOf('@');

    if (atIdx === -1 || (atIdx > 0 && !/[\s\n]/.test(before[atIdx - 1]))) {
      setMentionQuery(null); return;
    }
    const query = before.slice(atIdx + 1);
    if (query.includes(' ') || query.includes('\n')) { setMentionQuery(null); return; }

    setMentionStart(atIdx);
    setMentionQuery(query);
    setMentionIndex(0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null) {
      const items = mentionFiltered();
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((i) => Math.min(items.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIndex((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const agent = items[mentionIndex];
        if (agent) mentionApply(agent);
        else setMentionQuery(null);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  // ── Send ─────────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (loading) return;
    const text = inputValue.trim();
    if (!text) return;

    setMentionQuery(null);
    setInputValue('');
    if (inputRef.current) { inputRef.current.value = ''; autoResize(inputRef.current); }

    const userMsg: Message = { role: 'user', content: text };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    setLoading(true);

    try {
      const data = await req<{ reply: string }>('POST', '/chat', {
        messages:     withUser,
        systemPrompt: buildSystem(activeAgents),
      });
      const updated = [...withUser, { role: 'assistant' as const, content: data.reply }];
      setMessages(updated);
      saveHistory(updated, projectId);
    } catch (err: any) {
      setMessages([...withUser, { role: 'assistant', content: `⚠️ Error: ${err.message}` }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  // ── Quick prompts & clear ────────────────────────────────────────────────────

  function insertQuick(text: string) {
    setInputValue(text);
    if (inputRef.current) {
      inputRef.current.value = text;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(text.length, text.length);
      autoResize(inputRef.current);
    }
  }

  function clearChat() {
    setMessages([]);
    setLoading(false);
    const id  = projectId ?? '';
    const url = id ? `/chat/history?projectId=${encodeURIComponent(id)}` : '/chat/history';
    req('DELETE', url).catch(() => {});
    setInputValue('');
    if (inputRef.current) { inputRef.current.value = ''; inputRef.current.focus(); }
  }

  // ── Action execution ─────────────────────────────────────────────────────────

  function execAction(action: ChatAction) {
    if (action.type === 'open-agents' || action.type === 'create-agent') {
      setView('agents');
    } else if (action.type === 'open-settings') {
      setView('settings');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const filtered = mentionFiltered();

  const projSelector = (
    <select
      className="chat-proj-sel"
      value={projectId ?? ''}
      onChange={(e) => switchProject(e.target.value || null)}
      title="Historial de conversación por proyecto"
    >
      <option value="">Global</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );

  const sub = activeAgents.length > 0
    ? `${activeAgents.length} agente${activeAgents.length > 1 ? 's' : ''} activo${activeAgents.length > 1 ? 's' : ''}`
    : undefined;

  return (
    <div className="view active" id="view-chat">
      <Topbar title="Chat IA" sub={sub} actions={projSelector} />

      <div className="chat-view">
        {/* Messages */}
        <div className="chat-messages" ref={messagesRef}>
          {messages.length === 0 && !loading ? (
            <div className="chat-empty">
              <i className="ti ti-message-chatbot" />
              <p>
                Inicia una conversación con la IA configurada.<br />
                Escribe <strong>@nombre-agente</strong> para añadir un agente como contexto.<br />
                Usa los accesos rápidos para empezar.
              </p>
            </div>
          ) : (
            <>
              {messages.map((m, idx) => (
                <MessageBubble key={idx} message={m} onExecAction={execAction} />
              ))}
              {loading && (
                <div className="chat-bubble assistant chat-typing">
                  <span /><span /><span />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="chat-foot">
          {/* Context bar */}
          {activeAgents.length > 0 && (
            <div className="chat-context-bar">
              <span style={{ fontSize: 11, color: 'var(--text2)', flexShrink: 0 }}>Contexto:</span>
              {activeAgents.map((a) => (
                <div key={a.name} className="agent-chip">
                  <i className="ti ti-robot" style={{ fontSize: 11 }} />
                  <span>@{a.name}</span>
                  <span
                    className="chip-remove"
                    onMouseDown={(e) => { e.preventDefault(); setActiveAgents((prev) => prev.filter((x) => x.name !== a.name)); }}
                    title="Quitar"
                  >
                    <i className="ti ti-x" style={{ fontSize: 10 }} />
                  </span>
                </div>
              ))}
              <button
                className="btn ghost sm"
                onMouseDown={(e) => { e.preventDefault(); setActiveAgents([]); }}
                style={{ fontSize: 10, padding: '1px 7px' }}
              >
                Limpiar
              </button>
            </div>
          )}

          {/* Quick prompts */}
          <div className="chat-quick">
            {QUICK_PROMPTS.map((q) => (
              <button key={q.label} className="chat-quick-btn" onClick={() => insertQuick(q.text)}>
                <i className={`ti ${q.icon}`} /> {q.label}
              </button>
            ))}
            <button className="chat-quick-btn chat-quick-clear" onClick={clearChat}>
              <i className="ti ti-trash" /> Nueva
            </button>
          </div>

          {/* Input row */}
          <div className="chat-input-row">
            <div className="chat-input-wrap">
              {/* @mention dropdown */}
              {mentionQuery !== null && filtered.length > 0 && (
                <div className="mention-dropdown">
                  {filtered.map((a, i) => (
                    <div
                      key={a.name}
                      className={`mention-item${i === mentionIndex ? ' sel' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); mentionApply(a); }}
                    >
                      <span className="mi-name">@{a.name}</span>
                      <span className="mi-desc">{a.description ?? ''}</span>
                      <span className="mi-level">{LEVEL_LABEL[a.level ?? ''] ?? a.level ?? ''}</span>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                className="chat-input inp"
                placeholder="Escribe… usa @nombre para añadir agentes como contexto (Enter envía)"
                rows={2}
                value={inputValue}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
              />
            </div>
            <button className="btn primary" onClick={handleSend} disabled={loading}>
              <i className="ti ti-send" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MessageBubble ──────────────────────────────────────────────────────────────

interface BubbleProps {
  message: Message;
  onExecAction: (action: ChatAction) => void;
}

function MessageBubble({ message: m, onExecAction }: BubbleProps) {
  if (m.role === 'user') {
    return (
      <div
        className="chat-bubble user"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
      />
    );
  }

  if (!m._parsed) {
    const { clean, actions } = parseActions(m.content);
    m._clean   = clean;
    m._actions = actions;
    m._parsed  = true;
  }

  return (
    <div className="chat-bubble assistant">
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(m._clean ?? m.content) }} />
      {m._actions && m._actions.length > 0 && (
        <div className="chat-actions">
          {m._actions.map((a, i) => (
            <button key={i} className="chat-action-btn" onClick={() => onExecAction(a)}>
              <i className={`ti ${ACTION_ICON[a.type] ?? 'ti-bolt'}`} /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
