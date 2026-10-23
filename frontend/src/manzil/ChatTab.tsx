import { Loader2, Plus, SendHorizontal } from 'lucide-react';
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

/** Chat with AI: each message fires the chat workflow; the server keeps the session's history. */
export function ChatTab({ projectId }: { projectId: string }) {
  const [sessionId, setSessionId] = useState(readSession);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    api<{ role: 'user' | 'assistant'; content: string; ui: UiResponse | null }[]>(`/api/app/chat/${sessionId}`)
      .then((rows) => setMessages(rows.map((r) => ({ role: r.role, content: r.content, ui: r.ui }))))
      .catch(() => setMessages([]));
    // Only on mount: later turns are appended locally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

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

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col px-6">
      <div className="flex items-center justify-between py-3 text-xs text-muted">
        <span>{projectId ? `Scoped to project ${projectId}` : 'All projects (choose one on the Dashboard to scope answers)'}</span>
        <button type="button" onClick={newChat} className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-fg-soft hover:bg-hover">
          <Plus size={13} /> New chat
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && !busy && (
          <p className="pt-16 text-center text-sm text-muted">
            Ask about material status, sign-offs, call letters, inspections, execution progress or work completion. Add “executive dashboard” for a visual summary.
          </p>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[75%] rounded-2xl rounded-br-sm bg-sky-600 px-4 py-2 text-sm text-white">
              {m.content}
            </div>
          ) : m.role === 'error' ? (
            <p key={i} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950 dark:text-red-200">
              {m.content}
            </p>
          ) : (
            <div key={i} className="rounded-xl border border-line bg-panel p-4">
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
      <form onSubmit={send} className="flex gap-2 border-t border-line py-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. What is the inspection status of the replacement PCs?"
          aria-label="Message"
          className="flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-line-strong focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          className="flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          <SendHorizontal size={15} /> Send
        </button>
      </form>
    </div>
  );
}
