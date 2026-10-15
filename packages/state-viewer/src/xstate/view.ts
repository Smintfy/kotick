// What an observer of a proxied actor sees: the proxy's snapshot, and the real actor's ending.

import type { Observer } from 'xstate';

/** What a view reads from the actor's binding. */
export interface ViewSource {
  /** What the proxy shows: the forced snapshot during a preview, otherwise the real one. */
  getSnapshot(): unknown;
  /** The real actor's snapshot, whatever the proxy shows. */
  getLiveSnapshot(): unknown;
  isPreviewing(): boolean;
  /** Calls `fn` with the proxy showing the real snapshot. */
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
   * Subscribed to the real actor. It has an error callback only when the target has one: XState reports an error as
   * unhandled when an observer has none, and an extra one here would swallow it.
   */
  readonly observer: Observer<unknown>;
  /** Shows the target what the proxy shows now; called when a preview changes it. */
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
  /** Ends the view, as unsubscribing does: the target hears nothing more. */
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
 * What the target is still owed about an actor the memory has moved on from: how it ended, if a preview held that
 * back, and otherwise the real snapshot a preview hid from it, which an observer @xstate/react doesn't move to the
 * new actor hears from nobody else. With what the target last saw of the actor, and where.
 */
interface Owed {
  source: ViewSource;
  last: unknown;
  ending?: Ending;
}

/** How a hook's observer stands with @xstate/react, which subscribes it to an actor in an effect of its own. */
export interface Attachment {
  /**
   * False from the commit that passes a new observer until @xstate/react subscribes it and starts the actor, which
   * sends the real snapshot. It's shown previews meanwhile, from the layout phase where a deep link applies one.
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
   * True when @xstate/react subscribed the observer to an actor that had already ended and stopped: XState completes
   * or fails it inside subscribe() and tells it nothing more. It followed none of the actor's previews.
   */
  late(): boolean;
}

/**
 * What one observer has been told about one actor. A hook's observer often gets a new identity on every render, and
 * each identity gets a view, so the hook shares one memory between them: an observer that heard the actor finish
 * doesn't hear it again, isn't sent a snapshot twice, and hears an ending the view of an earlier identity held back.
 */
export interface ViewMemory {
  /** The real actor the memory is about. A new one (Fast Refresh) has told the observer nothing yet. */
  actor?: unknown;
  /** Tells the actor apart even while nothing previews it (`debug.disabled`); the source otherwise. */
  identify?: () => unknown;
  /** The source the target last saw the actor through. */
  source?: ViewSource;
  /** What the target saw last, so a real update during a preview, which doesn't change what's shown, isn't repeated. */
  last: unknown;
  /** Whether the target has heard how the actor ended. */
  told: boolean;
  /**
   * How the real actor ended, held back while a preview hides the real snapshot. The target hears it once the
   * preview ends, after the real snapshot, as XState sends the done snapshot before complete.
   */
  ending?: Ending;
  /**
   * What's owed about actors @xstate/react replaced (a new config: Fast Refresh, a machine built from props), which
   * the target hears once the hook's actor is no longer previewed, before anything about the new actor.
   */
  owed: Owed[];
}

const UNSET = Symbol('unset');
const noop = (): void => {};

export function createViewMemory(identify?: () => unknown): ViewMemory {
  return { identify, last: UNSET, told: false, owed: [] };
}

/**
 * `getSource` is what previews the actor: for a hook, its actor's binding, unless `debug.disabled`. The view shows the
 * target that source only while the `attachment`, when there is one, says the target follows the actor.
 */
export function createView(
  target: Observer<unknown>,
  getSource: () => ViewSource | undefined,
  lifetime: ViewLifetime,
  onClose: () => void = noop,
  shared?: ViewMemory,
  attachment?: Attachment,
): View {
  const memory = shared ?? createViewMemory();
  // The source the target sees the actor through.
  const current = (): ViewSource | undefined => (attachment?.replaced() ? undefined : getSource());
  const remember = (): ViewMemory => {
    const source = current();
    const actor = memory.identify ? memory.identify() : source;
    if (actor !== undefined && memory.actor !== actor) {
      const { source: seen, last, ending } = memory;
      if (seen && (ending || (last !== UNSET && last !== seen.getLiveSnapshot()))) {
        memory.owed.push({ source: seen, last, ending });
      }
      memory.actor = actor;
      memory.source = undefined;
      memory.last = UNSET;
      memory.told = false;
      memory.ending = undefined;
    }
    if (source) memory.source = source;
    return memory;
  };
  let closed = false;
  // Dropped by the hook while it held back how the actor ended: it closes once it has delivered that.
  let dropped = false;

  const deliver = (snapshot: unknown): void => {
    const current = remember();
    current.last = snapshot;
    // Shown the current actor, the target has left whatever it saw of an earlier one.
    if (current.owed.some((owed) => !owed.ending)) current.owed = current.owed.filter((owed) => owed.ending);
    isolate(() => target.next?.(snapshot));
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    onClose();
  };

  // True while a preview shows something other than the real snapshot.
  const hides = (source: ViewSource | undefined): boolean =>
    !!source && source.isPreviewing() && source.getSnapshot() !== source.getLiveSnapshot();
  const hidden = (): boolean => hides(current());

  // Once told how the actor ended, a hook's observer only hears what XState sends it.
  const heardEnding = (): boolean => lifetime === 'ended' && remember().told;

  const end = ({ failed, cause }: Ending, source = current()): void => {
    const current = remember();
    current.ending = undefined;
    current.told = true;
    // The proxy shows the real snapshot meanwhile: toPromise reads the output from it.
    const tell = (): void => isolate(() => (failed ? target.error?.(cause) : target.complete?.()));
    if (source) source.showingLive(tell);
    else tell();
    const stopped = statusOf(source?.getLiveSnapshot()) === 'stopped';
    if (dropped || stopped || (lifetime === 'notified' && (failed || target.complete))) close();
  };

  // Held back only from a target that's shown previews and hasn't heard it before; toPromise's, without next, hears at
  // once, and so does an observer told already, which XState completes again when it's subscribed again, and one
  // subscribed after the actor ended, unless the hook still holds back the ending an earlier observer was owed.
  const endOrHold = (failed: boolean, cause?: unknown): void => {
    const current = remember();
    const late = !!attachment?.late() && current.ending === undefined;
    if (target.next && !current.told && !late && hidden()) current.ending = { failed, cause };
    else end({ failed, cause });
  };

  // Whether show() hands a hook's observer a snapshot of an actor that hasn't ended for it.
  const shows = (source: ViewSource, isHidden: boolean, last: unknown, status: unknown): boolean => {
    if (!attachment) return true;
    // XState's start of an actor restored from an error snapshot sends it only the error.
    if (status === 'error' && !attachment.subscribed()) return false;
    // An observer shown nothing of the actor yet gets its real snapshot from XState: at start, which comes here through
    // next only while a preview the actor can't show is on, or at its next update. A release owes it nothing.
    return isHidden || last !== UNSET || (attachment.subscribed() && source.isPreviewing());
  };

  // What the target sees of `source`, with or without a preview hiding the real snapshot.
  const show = (source: ViewSource, isHidden: boolean): void => {
    if (closed || heardEnding()) return;
    const { last, ending } = remember();
    const shown = isHidden ? source.getSnapshot() : source.getLiveSnapshot();
    const status = statusOf(source.getLiveSnapshot());
    // A consumer that only re-renders (useSelector, the hooks' store) needs waking to leave a preview of an actor
    // that stopped, which XState no longer tells it about.
    const wakes = status === 'stopped' && lifetime !== 'ended' && !target.complete;
    if (ending === undefined) {
      // Ended without the target being told: subscribed after the actor stopped, or failed without an error callback.
      // The consumer may have rendered the preview it subscribed under, so it isn't let go before the preview ends.
      if (status === 'stopped' || (lifetime === 'ended' && status === 'error' && !target.error)) {
        if (wakes && isHidden) return;
        if (wakes && shown !== last) deliver(shown);
        memory.told = true;
        if (status === 'stopped') close();
      } else if (shown !== last && shows(source, isHidden, last, status)) deliver(shown);
      return;
    }
    if (isHidden) {
      if (shown !== last) deliver(shown);
      return;
    }
    // The preview that hid the ending is gone. XState sends a done snapshot through next.
    if (shown !== last && (status === 'done' || wakes)) deliver(shown);
    if (!closed && memory.ending) end(memory.ending, source);
  };

  // What's owed about replaced actors, once the hook's actor is no longer previewed, or at once when `force`d. It's the
  // hook's, so the target hears it even when the view has closed on a new actor that was restored stopped. An actor
  // registered under another id isn't previewed by what previews the new one.
  const settleOwed = (force: boolean): void => {
    for (const owed of [...remember().owed]) {
      const index = memory.owed.indexOf(owed);
      // Settled already, from inside a callback this loop made.
      if (index < 0 || (!force && hides(getSource()))) continue;
      memory.owed.splice(index, 1);
      const { source, last, ending } = owed;
      // A target that follows the new actor is shown its real snapshot by it, debug.disabled or not.
      if (!ending && !attachment?.replaced()) continue;
      const live = source.getLiveSnapshot();
      const status = statusOf(live);
      const wakes = status === 'stopped' && lifetime !== 'ended' && !target.complete;
      // What a release shows: show() with the preview gone.
      const shows = ending
        ? status === 'done' || wakes
        : status === 'stopped'
          ? wakes
          : !(lifetime === 'ended' && status === 'error');
      if (live !== last && shows) isolate(() => target.next?.(live));
      if (!ending) continue;
      const { failed, cause } = ending;
      source.showingLive(() => isolate(() => (failed ? target.error?.(cause) : target.complete?.())));
    }
  };

  const showCurrent = (): void => {
    settleOwed(false);
    const source = current();
    if (source) show(source, hidden());
  };

  // Only the source the target saw the actor through: one remembered from an actor Fast Refresh replaced has nothing
  // left to show.
  const detach = (source: ViewSource): void => {
    if (getSource()) return;
    // What's owed about replaced actors first, as on a release.
    settleOwed(true);
    if (remember().source === source) show(source, false);
  };

  const settle = (): void => {
    if (getSource()) return;
    settleOwed(true);
    const { source, ending } = remember();
    if (source && ending) show(source, false);
  };

  const drop = (): void => {
    if (memory.ending === undefined) close();
    else dropped = true;
  };

  // What an actor the hook replaced still sends the target, until @xstate/react moves the observer, leaves what the
  // target was told about the new actor as it is. A preview of the hook's actor holds it back, as owed.
  const fromReplaced = (source: ViewSource | undefined, sent: { snapshot: unknown } | { ending: Ending }): void => {
    // The memory moves to the new actor first, owing what the target last saw of this one.
    remember();
    const owed = source && memory.owed.find((entry) => entry.source === source);
    if (source && target.next && hides(getSource())) {
      const ending = 'ending' in sent ? sent.ending : undefined;
      if (!owed) memory.owed.push({ source, last: UNSET, ending });
      else if (ending) owed.ending = ending;
      return;
    }
    // XState tells the target the actor's real state itself: it's owed no restore of it.
    if (owed && !owed.ending) memory.owed.splice(memory.owed.indexOf(owed), 1);
    if ('snapshot' in sent) {
      isolate(() => target.next?.(sent.snapshot));
      return;
    }
    const { failed, cause } = sent.ending;
    const tell = (): void => isolate(() => (failed ? target.error?.(cause) : target.complete?.()));
    if (source) source.showingLive(tell);
    else tell();
  };

  const observer: Observer<unknown> = {
    next(snapshot) {
      if (closed) return;
      const replaced = attachment?.replaced();
      if (replaced) fromReplaced(replaced.source, { snapshot });
      // Without a preview, real updates pass through as XState sends them, repeats included.
      else if (current()?.isPreviewing() && !heardEnding()) showCurrent();
      else deliver(snapshot);
    },
    complete() {
      if (closed) return;
      const replaced = attachment?.replaced();
      if (replaced) fromReplaced(replaced.source, { ending: { failed: false } });
      else endOrHold(false);
    },
  };
  if (target.error) {
    observer.error = (cause) => {
      if (closed) return;
      const replaced = attachment?.replaced();
      if (replaced) fromReplaced(replaced.source, { ending: { failed: true, cause } });
      else endOrHold(true, cause);
    };
  }

  return {
    observer,
    showCurrent,
    detach,
    settle,
    owes: () => remember().ending !== undefined || memory.owed.length > 0,
    close,
    drop,
    isClosed: () => closed,
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

function statusOf(snapshot: unknown): unknown {
  return (snapshot as { status?: unknown } | null | undefined)?.status;
}
