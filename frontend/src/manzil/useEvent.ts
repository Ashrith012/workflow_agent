import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { EventResult } from './types';

export type EventState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; result: EventResult }
  | { phase: 'error'; message: string; status: number; runId?: string };

export function triggerEvent(eventKey: string, payload: object = {}, sessionId?: string): Promise<EventResult> {
  return api<EventResult>(`/api/app/events/${encodeURIComponent(eventKey)}`, { body: { payload, sessionId } });
}

/** Fires an app event; only the latest call's result is kept. */
export function useEvent() {
  const [state, setState] = useState<EventState>({ phase: 'idle' });
  const latest = useRef(0);

  const fire = useCallback(async (eventKey: string, payload: object = {}) => {
    const seq = ++latest.current;
    setState({ phase: 'running' });
    try {
      const result = await triggerEvent(eventKey, payload);
      if (seq === latest.current) setState({ phase: 'done', result });
    } catch (err) {
      if (seq !== latest.current) return;
      const e = err instanceof ApiError ? err : new ApiError((err as Error).message, 0);
      setState({ phase: 'error', message: e.message, status: e.status, runId: e.runId });
    }
  }, []);

  return { state, fire };
}
