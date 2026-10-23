import { useEffect, useState } from 'react';
import { EventStatus } from './EventTab';
import { Renderer } from './Renderer';
import { EVENTS, type FormState } from './types';
import { useEvent } from './useEvent';

interface Props {
  projectId: string;
  onProjectChange: (projectId: string) => void;
}

/**
 * The home view comes from the dashboard.load workflow (project picker, domain
 * buttons, ...). A button fires its own event with its payload plus the form
 * values, and the result renders below.
 */
export function DashboardTab({ projectId, onProjectChange }: Props) {
  const { state: homeState, fire: fireHome } = useEvent();
  const action = useEvent();
  const [form, setForm] = useState<FormState>({ projectId });
  const [actionLabel, setActionLabel] = useState('');

  useEffect(() => {
    void fireHome(EVENTS.dashboard);
  }, [fireHome]);

  const onFormChange = (name: string, value: string | boolean) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (name === 'projectId' && typeof value === 'string') onProjectChange(value);
  };

  const onAction = (eventKey: string, payload: Record<string, unknown>, label: string) => {
    setActionLabel(label);
    void action.fire(eventKey, { ...payload, ...form });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <EventStatus state={homeState} busyText="Loading dashboard…" />
      {homeState.phase === 'done' && (
        <Renderer ui={homeState.result.ui} form={form} onFormChange={onFormChange} onAction={onAction} busy={action.state.phase === 'running'} />
      )}
      {action.state.phase !== 'idle' && (
        <section className="space-y-4 border-t border-line pt-6">
          <EventStatus state={action.state} busyText={`Analyzing ${actionLabel} from the knowledge source…`} />
          {action.state.phase === 'done' && <Renderer ui={action.state.result.ui} onAction={onAction} />}
        </section>
      )}
    </div>
  );
}
