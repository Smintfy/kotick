import type { AnyActorRef, Observer, Snapshot, SnapshotStatus } from 'xstate';

export interface ViewSource {
  getSnapshot(): Snapshot<unknown>;
  getLiveSnapshot(): Snapshot<unknown>;
  isPreviewing(): boolean;
  showingLive(fn: () => void): void;
}

/**
 * When an observer stops hearing previews, once it has been told how the actor ended. XState drops its observers then,
 * but a preview can still change what the proxy shows:
 * - `'stopped'`: once the actor is stopped, so a finished or failed machine can still be previewed (the hooks' store).
 * - `'notified'`: once its own complete or error has been called, or the actor is stopped. useSelector's observer has
 *   no complete, so it keeps receiving previews of a finished machine (proxy.subscribe()).
 * - `'ended'`: once the actor is done, fails or stops, as with XState (the observer given to useActorRef). It still
 *   hears what XState sends it afterwards, which is the ending again when @xstate/react restarts a finished actor.
 */
export type ViewLifetime = 'stopped' | 'notified' | 'ended';

export interface View {
  /**
   * It has an error callback only when the target has one.
   * XState reports an error as unhandled when an observer has none, and an extra one here would swallow it.
   */
  readonly observer: Observer<Snapshot<unknown>>;
  showCurrent(): void;
  /**
   * Shows the target the real snapshot of `source`, and how the actor ended if that was held back, as a release would.
   * For a hook that stops previewing its actor while the view stays (`debug.disabled`).
   */
  detach(source: ViewSource): void;
  /**
   * Delivers what the view holds back, as a release would, once nothing previews the actor for it. For a hook that
   * stopped previewing its actor while it wasn't listening (`debug.disabled` while an Activity hides it).
   */
  settle(): void;
  /**
   * True while the view holds back how the actor ended, or owes the target something about an actor the hook ran
   * before, so a hook that starts listening again checks whether the preview that held it back is still on.
   */
  owes(): boolean;
  close(): void;
  /** Ends the view as close() does, or, while it holds back how the actor ended, right after it delivers that. */
  drop(): void;
  isClosed(): boolean;
}

interface Ending {
  failed: boolean;
  cause?: unknown;
}

/**
 * What the target has heard of how the actor ended.
 * A preview that hides the real snapshot holds the ending back until the preview ends.
 * The target then hears the real snapshot first, as XState sends the done snapshot before complete.
 */
type Heard = { kind: 'nothing' } | { kind: 'held'; ending: Ending } | { kind: 'told' };

type Sent = { snapshot: Snapshot<unknown> } | { ending: Ending };

const NOTHING_SHOWN = Symbol('nothing shown');

type LastShown = Snapshot<unknown> | typeof NOTHING_SHOWN;

/**
 * What the target is still owed about an actor the memory moved on from.
 * It is how the actor ended, if a preview held that back, or else the real snapshot that a preview hid.
 * An observer that @xstate/react does not move to the new actor hears that snapshot from nobody else.
 */
interface Owed {
  source: ViewSource;
  last: LastShown;
  ending?: Ending;
}

interface Attachment {
  /**
   * False from the commit that passes a new observer until @xstate/react subscribes it and starts the actor, which
   * sends the real snapshot. It's shown previews meanwhile, from the layout phase where the actor registers.
   */
  subscribed(): boolean;
  /**
   * While @xstate/react still has the observer subscribed to an actor the hook replaced (a new config), that actor's
   * binding, if it had one. It moves an inline observer in the passive effects of the commit that replaced the actor,
   * and a stable one only when its effects run again (StrictMode, an Activity revealed): the new actor's previews skip
   * it meanwhile, and what the replaced actor sends it until it's stopped isn't about the new one.
   */
  replaced(): { source?: ViewSource } | undefined;
  /**
   * True when @xstate/react subscribed the observer to an actor that had already stopped.
   * XState completes or fails such an observer inside subscribe(), and then tells it nothing more.
   */
  subscribedAfterStop(): boolean;
}

/**
 * What one observer has been told about one actor. A hook's observer often gets a new identity on every render, and
 * each identity gets a view, so the hook shares one memory between them: an observer that heard the actor finish
 * doesn't hear it again, isn't sent a snapshot twice, and hears an ending the view of an earlier identity held back.
 */
export interface ViewMemory {
  /** The real actor the memory is about. A new one (Fast Refresh) has told the observer nothing yet. */
  actor?: AnyActorRef | ViewSource;
  /** Tells the actor apart even while nothing previews it (`debug.disabled`); the source otherwise. */
  identify?: () => AnyActorRef | undefined;
  source?: ViewSource;
  /**
   * A real update during a preview does not change what the target sees.
   * The view compares with this value, so it does not send the same snapshot again.
   */
  last: LastShown;
  heard: Heard;
  /**
   * What's owed about actors @xstate/react replaced (a new config: Fast Refresh, a machine built from props), which
   * the target hears once the hook's actor is no longer previewed, before anything about the new actor.
   */
  owed: Owed[];
}

const noop = (): void => {};

export function createViewMemory(identify?: () => AnyActorRef | undefined): ViewMemory {
  return { identify, last: NOTHING_SHOWN, heard: { kind: 'nothing' }, owed: [] };
}

export function createView(
  target: Observer<Snapshot<unknown>>,
  getSource: () => ViewSource | undefined,
  lifetime: ViewLifetime,
  onClose: () => void = noop,
  shared?: ViewMemory,
  attachment?: Attachment,
): View {
  const memory = shared ?? createViewMemory();
  const current = (): ViewSource | undefined => (attachment?.replaced() ? undefined : getSource());
  // A consumer that only re-renders (useSelector, the hooks' store) needs waking to leave a preview of an actor that
  // stopped, which XState no longer tells it about.
  const wakesOnStop = lifetime !== 'ended' && !target.complete;
  let state: 'open' | 'dropped' | 'closed' = 'open';

  const currentMemory = (): ViewMemory => {
    const source = current();
    const actor = memory.identify ? memory.identify() : source;

    if (actor !== undefined && memory.actor !== actor) {
      const { source: seen, last, heard } = memory;
      const held = heard.kind === 'held' ? heard.ending : undefined;

      if (seen && (held || (last !== NOTHING_SHOWN && last !== seen.getLiveSnapshot()))) {
        memory.owed.push({ source: seen, last, ending: held });
      }

      memory.actor = actor;
      memory.source = undefined;
      memory.last = NOTHING_SHOWN;
      memory.heard = { kind: 'nothing' };
    }

    if (source) memory.source = source;

    return memory;
  };

  const deliver = (snapshot: Snapshot<unknown>): void => {
    currentMemory().last = snapshot;

    // Shown the current actor, the target has left whatever it saw of an earlier one.
    if (memory.owed.some((owed) => !owed.ending)) memory.owed = memory.owed.filter((owed) => owed.ending);
    isolate(() => target.next?.(snapshot));
  };

  // The proxy shows the real snapshot meanwhile: toPromise reads the output from it.
  const sendEnding = ({ failed, cause }: Ending, source: ViewSource | undefined): void => {
    const send = (): void => isolate(() => (failed ? target.error?.(cause) : target.complete?.()));

    if (source) source.showingLive(send);
    else send();
  };

  const close = (): void => {
    if (state === 'closed') return;
    state = 'closed';
    onClose();
  };

  const hides = (source: ViewSource | undefined): boolean =>
    !!source && source.isPreviewing() && source.getSnapshot() !== source.getLiveSnapshot();

  const hidden = (): boolean => hides(current());

  const hearsOnlyXState = (): boolean => lifetime === 'ended' && currentMemory().heard.kind === 'told';

  const tell = (ending: Ending, source = current()): void => {
    currentMemory().heard = { kind: 'told' };
    sendEnding(ending, source);
    const stopped = source?.getLiveSnapshot().status === 'stopped';

    if (state === 'dropped' || stopped || (lifetime === 'notified' && (ending.failed || target.complete))) close();
  };

  // Held back only from a target that's shown previews and hasn't heard it before; toPromise's, without next, hears at
  // once, and so does an observer told already, which XState completes again when it's subscribed again, and one
  // subscribed after the actor ended, unless the hook still holds back the ending an earlier observer was owed.
  const tellOrHold = (ending: Ending): void => {
    const { heard } = currentMemory();
    const afterStop = !!attachment?.subscribedAfterStop() && heard.kind !== 'held';

    if (target.next && heard.kind !== 'told' && !afterStop && hidden()) memory.heard = { kind: 'held', ending };
    else tell(ending);
  };

  const shows = (source: ViewSource, isHidden: boolean, last: LastShown, status: SnapshotStatus): boolean => {
    if (!attachment) return true;

    // XState's start of an actor restored from an error snapshot sends it only the error.
    if (status === 'error' && !attachment.subscribed()) return false;

    // An observer shown nothing of the actor yet gets its real snapshot from XState: at start, which comes here through
    // next only while a preview the actor can't show is on, or at its next update. A release owes it nothing.
    return isHidden || last !== NOTHING_SHOWN || (attachment.subscribed() && source.isPreviewing());
  };

  const releaseShows = (status: SnapshotStatus, holdsEnding: boolean): boolean => {
    if (status === 'stopped') return wakesOnStop;

    // XState sends a done snapshot through next.
    return holdsEnding ? status === 'done' : !(lifetime === 'ended' && status === 'error');
  };

  const release = (source: ViewSource): void => {
    const live = source.getLiveSnapshot();

    if (live !== currentMemory().last && releaseShows(live.status, true)) deliver(live);
    const { heard } = memory;

    if (state !== 'closed' && heard.kind === 'held') tell(heard.ending, source);
  };

  const show = (source: ViewSource, isHidden: boolean): void => {
    if (state === 'closed' || hearsOnlyXState()) return;
    const { last, heard } = currentMemory();
    const shown = isHidden ? source.getSnapshot() : source.getLiveSnapshot();
    const status = source.getLiveSnapshot().status;
    const wakes = status === 'stopped' && wakesOnStop;

    if (heard.kind === 'held') {
      if (!isHidden) release(source);
      else if (shown !== last) deliver(shown);
    } else if (status === 'stopped' || (lifetime === 'ended' && status === 'error' && !target.error)) {
      // Ended without the target being told: subscribed after the actor stopped, or failed without an error callback.
      // The consumer may have rendered the preview it subscribed under, so it isn't let go before the preview ends.
      if (wakes && isHidden) return;

      if (wakes && shown !== last) deliver(shown);
      memory.heard = { kind: 'told' };

      if (status === 'stopped') close();
    } else if (shown !== last && shows(source, isHidden, last, status)) deliver(shown);
  };

  // The target hears what it is owed about replaced actors when no preview hides the hook's actor.
  // The memory is the hook's, so the target hears it also when the view closed on a new actor restored stopped.
  // A preview of the new actor does not preview an actor that is registered under another id.
  const settleOwed = (): void => {
    for (const owed of Array.from(currentMemory().owed)) {
      const index = memory.owed.indexOf(owed);

      // Settled already, from inside a callback this loop made.
      if (index < 0 || hides(getSource())) continue;
      memory.owed.splice(index, 1);
      const { source, last, ending } = owed;

      // A target that follows the new actor is shown its real snapshot by it, debug.disabled or not.
      if (!ending && !attachment?.replaced()) continue;
      const live = source.getLiveSnapshot();

      if (live !== last && releaseShows(live.status, !!ending)) isolate(() => target.next?.(live));

      if (ending) sendEnding(ending, source);
    }
  };

  const showCurrent = (): void => {
    settleOwed();
    const source = current();

    if (source) show(source, hidden());
  };

  // Only the source the target saw the actor through: one remembered from an actor Fast Refresh replaced has nothing
  // left to show.
  const detach = (source: ViewSource): void => {
    if (getSource()) return;
    // What the target is owed about replaced actors comes first, as on a release.
    settleOwed();

    if (currentMemory().source === source) show(source, false);
  };

  const settle = (): void => {
    if (getSource()) return;
    settleOwed();
    const { source, heard } = currentMemory();

    if (source && heard.kind === 'held') show(source, false);
  };

  const drop = (): void => {
    if (memory.heard.kind !== 'held') close();
    else if (state === 'open') state = 'dropped';
  };

  // What an actor the hook replaced still sends the target, until @xstate/react moves the observer, leaves what the
  // target was told about the new actor as it is. A preview of the hook's actor holds it back, as owed.
  const fromReplaced = (source: ViewSource | undefined, sent: Sent): void => {
    const owed = source && currentMemory().owed.find((entry) => entry.source === source);

    if (source && target.next && hides(getSource())) {
      const ending = 'ending' in sent ? sent.ending : undefined;

      if (!owed) memory.owed.push({ source, last: NOTHING_SHOWN, ending });
      else if (ending) owed.ending = ending;

      return;
    }

    // XState tells the target the actor's real state itself: it's owed no restore of it.
    if (owed && !owed.ending) memory.owed.splice(memory.owed.indexOf(owed), 1);

    if ('snapshot' in sent) isolate(() => target.next?.(sent.snapshot));
    else sendEnding(sent.ending, source);
  };

  const receive = (sent: Sent): void => {
    if (state === 'closed') return;
    const replaced = attachment?.replaced();

    if (replaced) fromReplaced(replaced.source, sent);
    else if ('ending' in sent) tellOrHold(sent.ending);
    // Without a preview, real updates pass through as XState sends them, repeats included.
    else if (current()?.isPreviewing() && !hearsOnlyXState()) showCurrent();
    else deliver(sent.snapshot);
  };

  const observer: Observer<Snapshot<unknown>> = {
    next: (snapshot) => receive({ snapshot }),
    complete: () => receive({ ending: { failed: false } }),
  };

  if (target.error) observer.error = (cause) => receive({ ending: { failed: true, cause } });

  return {
    observer,
    showCurrent,
    detach,
    settle,
    owes: () => currentMemory().heard.kind === 'held' || memory.owed.length > 0,
    close,
    drop,
    isClosed: () => state === 'closed',
  };
}

/**
 * Calls into the target as XState does: what it throws is reported from a timer, and the view carries on, so a held
 * ending still follows a throwing next, and a throwing complete still closes the view.
 */
function isolate(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    setTimeout(() => {
      throw error;
    });
  }
}
