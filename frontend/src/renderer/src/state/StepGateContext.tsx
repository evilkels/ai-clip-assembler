import {
  createContext,
  // Codebase-wide convention is useContext; the prefer-use migration is owned
  // by the react-doctor-triage plan, not done piecemeal here.
  // react-doctor-disable-next-line react-doctor/no-react19-deprecated-apis
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { GateUnblockId } from '../lib/stepGate';

/**
 * A blocked step names the action that would unblock it, but those actions live
 * on the route (Import owns the folder picker, the analyze run and the clip
 * rules), while the action bar lives in the shell. Routes publish their
 * handlers here and the shell renders whichever one the derived gate asks for.
 */
export interface GateAction {
  /** Verbatim button label, e.g. `Analyze 10 videos`. */
  label: string;
  run: () => void;
  /**
   * The action is the right one to offer but cannot do anything yet — nothing
   * is selected to analyze. Shown disabled rather than hidden, so the bar still
   * says what unblocks the step.
   */
  inert?: boolean;
}

export type GateActions = Partial<Record<GateUnblockId, GateAction>>;

interface StepGateValue {
  actions: GateActions;
  publish: (actions: GateActions) => void;
}

const EMPTY: GateActions = {};

const Ctx = createContext<StepGateValue | null>(null);

export function StepGateProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<GateActions>(EMPTY);
  const value = useMemo(() => ({ actions, publish: setActions }), [actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The unblock actions the current route is offering. */
export function useGateActions(): GateActions {
  return useContext(Ctx)?.actions ?? EMPTY;
}

/**
 * Publish this route's unblock actions, and withdraw them on unmount so a
 * stale handler can never outlive the screen that owns it. Pass a memoized
 * object: it is the effect's dependency.
 */
export function usePublishGateActions(actions: GateActions): void {
  const publish = useContext(Ctx)?.publish;
  useEffect(() => {
    if (!publish) return;
    publish(actions);
    return () => publish(EMPTY);
  }, [publish, actions]);
}
