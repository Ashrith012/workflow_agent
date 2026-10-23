import { Loader2, Minus, Plus, SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { Renderer } from './Renderer';
import { EVENTS, type UiResponse } from './types';
import { triggerEvent } from './useEvent';

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  ui?: UiResponse | null;
}

const SESSION_KEY = 'manzil-chat-session';

function readSession(): string | undefined {
  try {
    return localStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSession(id: string | undefined) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable (private window): the session just won't survive a reload.
  }
}

/**
 * Floating AI assistant. A launcher icon sits at the bottom-right; clicking it opens a
 * compact chat window that can be minimized (collapsed to its title bar) or closed (back to
 * the launcher). Each message fires the chat workflow; the server keeps the session's history.
 */
export function AssistantWidget({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [greeting, setGreeting] = useState(false);
  const [sessionId, setSessionId] = useState(readSession);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the session's history the first time the window is opened.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    if (!sessionId) return;
    api<{ role: 'user' | 'assistant'; content: string; ui: UiResponse | null }[]>(`/api/app/chat/${sessionId}`)
      .then((rows) => setMessages(rows.map((r) => ({ role: r.role, content: r.content, ui: r.ui }))))
      .catch(() => setMessages([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !minimized) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy, open, minimized]);

  useEffect(() => {
    if (open && !minimized) inputRef.current?.focus();
  }, [open, minimized]);

  // Greet the user shortly after load, only while the window is still closed.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setGreeting(true), 1200);
    return () => clearTimeout(t);
  }, [open]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const result = await triggerEvent(EVENTS.chat, { message, projectId }, sessionId);
      if (result.sessionId) {
        setSessionId(result.sessionId);
        writeSession(result.sessionId);
      }
      setMessages((m) => [...m, { role: 'assistant', content: '', ui: result.ui }]);
    } catch (err) {
      const text = err instanceof ApiError && err.runId ? `${err.message} (Reference: ${err.runId})` : (err as Error).message;
      setMessages((m) => [...m, { role: 'error', content: text }]);
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    writeSession(undefined);
    setSessionId(undefined);
    setMessages([]);
  };

  const launch = () => {
    setOpen(true);
    setMinimized(false);
    setGreeting(false);
  };

  // Launcher icon + greeting bubble (shown when the window is closed).
  if (!open) {
    return (
      <div className="fixed bottom-5 right-5 z-50 flex items-end gap-2.5">
        {greeting && (
          <div className="animate-pop-in relative mb-1 max-w-[16rem] rounded-2xl rounded-br-sm border border-line bg-panel px-3.5 py-2.5 text-sm text-fg shadow-lg shadow-black/10">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGreeting(false);
              }}
              aria-label="Dismiss"
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel text-subtle shadow hover:text-fg"
            >
              <X size={11} />
            </button>
            <button type="button" onClick={launch} className="text-left">
              <span className="font-medium">Hey! 👋</span> How can I help you?
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={launch}
          aria-label="Open AI assistant"
          title="AI assistant"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white shadow-lg shadow-indigo-500/30 ring-1 ring-black/5 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:bg-slate-800 dark:ring-white/10"
        >
          <img src="/ai-assistant.png" alt="" className="h-11 w-11" />
        </button>
      </div>
    );
  }

  const header = (
    <div className="flex items-center gap-2.5 border-b border-line bg-panel px-3 py-2.5">
      <img src="/ai-assistant.png" alt="" className="h-7 w-7" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-semibold text-fg">AI Assistant</p>
        <p className="truncate text-[11px] text-subtle">
          {projectId ? `Scoped to project ${projectId}` : 'All projects'}
        </p>
      </div>
      {!minimized && (
        <button
          type="button"
          onClick={newChat}
          aria-label="New chat"
          title="New chat"
          className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
        >
          <Plus size={15} />
        </button>
      )}
      <button
        type="button"
        onClick={() => setMinimized((v) => !v)}
        aria-label={minimized ? 'Expand chat' : 'Minimize chat'}
        title={minimized ? 'Expand' : 'Minimize'}
        className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Close chat"
        title="Close"
        className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-fg"
      >
        <X size={15} />
      </button>
    </div>
  );

  // Minimized: show only the title bar, docked at the bottom-right.
  if (minimized) {
    return (
      <div className="fixed bottom-5 right-5 z-50 w-72 max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/20">
        <button type="button" onClick={() => setMinimized(false)} className="w-full text-left" aria-label="Expand chat">
          {header}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] max-h-[calc(100vh-2.5rem)] w-96 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-line bg-page shadow-2xl shadow-black/20">
      {header}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !busy && (
          <p className="px-2 pt-10 text-center text-sm text-muted">
            Ask about material status, sign-offs, call letters, inspections, execution progress or work completion. Add “executive dashboard” for a visual summary.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-sky-600 px-3.5 py-2 text-sm text-white">
              {m.content}
            </div>
          ) : m.role === 'error' ? (
            <p key={i} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200">
              {m.content}
            </p>
          ) : (
            <div key={i} className="rounded-xl border border-line bg-panel p-3">
              {m.ui ? <Renderer ui={m.ui} /> : <p className="whitespace-pre-wrap text-sm">{m.content}</p>}
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 size={15} className="animate-spin" /> Validating against the knowledge source…
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex gap-2 border-t border-line p-2.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask the assistant…"
          aria-label="Message"
          className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label="Send"
          className="flex items-center justify-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <SendHorizontal size={15} />
        </button>
      </form>
    </div>
  );
}
