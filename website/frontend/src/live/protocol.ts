/**
 * @implemented-ui Assembles one WebSocket subscription's frames into complete events.
 *
 * Enforces the delivered observation contract: a `subscribed` control message
 * first, one process identity, `part/parts` fragment reassembly, the bracketed
 * book snapshot, per-channel sequences advancing by exactly one, and heartbeat
 * baselines equal to the last applied sequence. Anything else raises
 * StreamBroken; the caller discards this subscription and resynchronizes rather
 * than guessing at missing state.
 */
import { baselines, integer, object, text, WireError } from './wire.ts';

export class StreamBroken extends Error {}
/** The exchange process changed: every previous observation is invalid. */
export class ProcessChanged extends StreamBroken {
  readonly processId: string;
  constructor(processId: string) {
    super('Exchange process changed');
    this.processId = processId;
  }
}

export type StreamEvent =
  | {
      kind: 'subscribed';
      processId: string;
      commitId: number;
      baselines: Record<string, number>;
    }
  | { kind: 'snapshot'; channel: string; commitId: number; payload: unknown }
  | {
      kind: 'update';
      channel: string;
      sequence: number;
      commitId: number;
      payload: unknown;
    }
  | { kind: 'heartbeat'; commitId: number };

type Envelope = {
  processId: string;
  channel: string;
  sequence: number;
  commitId: number;
  type: string;
  part: number;
  parts: number;
  payload?: unknown;
  fragment?: string;
};

function envelope(frame: string): Envelope {
  let raw: Record<string, unknown>;
  try {
    raw = object(JSON.parse(frame), 'envelope');
  } catch {
    throw new StreamBroken('Malformed frame');
  }
  try {
    const result: Envelope = {
      processId: text(raw.process_id),
      channel: text(raw.channel),
      sequence: integer(raw.sequence),
      commitId: integer(raw.commit_id),
      type: text(raw.type),
      part: integer(raw.part),
      parts: integer(raw.parts),
    };
    if ('payload' in raw) result.payload = raw.payload;
    else result.fragment = text(raw.payload_fragment);
    if (result.part < 1 || result.part > result.parts)
      throw new WireError('Bad part');
    return result;
  } catch (error) {
    throw new StreamBroken(
      error instanceof Error ? error.message : 'Bad envelope',
    );
  }
}

export class Assembler {
  private processId: string | null;
  private subscribed = false;
  private readonly sequences = new Map<string, number>();
  /** Book snapshot progress: absent until start, then 'open', then done. */
  private snapshot: 'pending' | 'open' | 'done';
  private pending: { head: Envelope; chunks: string[] } | null = null;
  private snapshotPayload: unknown;

  private readonly channels: readonly string[];

  constructor(
    channels: readonly string[],
    /** The process this client already knows, if any. */
    knownProcess: string | null = null,
  ) {
    this.channels = channels;
    this.processId = knownProcess;
    this.snapshot = channels.includes('book') ? 'pending' : 'done';
  }

  /** Feed one text frame; returns the complete events it finishes (zero or one). */
  feed(frame: string): StreamEvent[] {
    const message = envelope(frame);
    if (this.processId !== null && message.processId !== this.processId)
      throw new ProcessChanged(message.processId);
    this.processId = message.processId;
    const whole = this.reassemble(message);
    const event = whole && this.interpret(whole.head, whole.payload);
    return event ? [event] : [];
  }

  private reassemble(
    message: Envelope,
  ): { head: Envelope; payload: unknown } | null {
    if (this.pending) {
      const { head, chunks } = this.pending;
      if (
        message.channel !== head.channel ||
        message.sequence !== head.sequence ||
        message.type !== head.type ||
        message.parts !== head.parts ||
        message.part !== chunks.length + 1 ||
        message.fragment === undefined
      )
        throw new StreamBroken('Interrupted fragmented bundle');
      chunks.push(message.fragment);
      if (chunks.length < head.parts) return null;
      this.pending = null;
      try {
        return { head, payload: JSON.parse(chunks.join('')) };
      } catch {
        throw new StreamBroken('Malformed fragmented bundle');
      }
    }
    if (message.parts === 1) {
      if (message.fragment !== undefined)
        throw new StreamBroken('Unexpected fragment');
      return { head: message, payload: message.payload };
    }
    if (message.part !== 1 || message.fragment === undefined)
      throw new StreamBroken('Fragment out of order');
    this.pending = { head: message, chunks: [message.fragment] };
    return null;
  }

  /** Returns null for frames that complete no event (snapshot brackets). */
  private interpret(head: Envelope, payload: unknown): StreamEvent | null {
    if (!this.subscribed) {
      if (head.channel !== 'control' || head.type !== 'subscribed')
        throw new StreamBroken('Expected subscription confirmation');
      const initial = this.baselines(payload);
      for (const channel of this.channels) {
        const sequence = initial[channel];
        if (sequence === undefined)
          throw new StreamBroken(`Missing baseline for ${channel}`);
        this.sequences.set(channel, sequence);
      }
      this.subscribed = true;
      return {
        kind: 'subscribed',
        processId: head.processId,
        commitId: head.commitId,
        baselines: initial,
      };
    }
    if (head.channel === 'control') {
      if (head.type !== 'heartbeat')
        throw new StreamBroken(`Unexpected control ${head.type}`);
      const current = this.baselines(payload);
      for (const channel of this.channels)
        if (current[channel] !== this.sequences.get(channel))
          throw new StreamBroken(`Heartbeat shows a gap on ${channel}`);
      return { kind: 'heartbeat', commitId: head.commitId };
    }
    const last = this.sequences.get(head.channel);
    if (last === undefined)
      throw new StreamBroken(`Unsubscribed channel ${head.channel}`);
    if (head.channel === 'book' && this.snapshot !== 'done') {
      if (head.sequence !== last)
        throw new StreamBroken('Snapshot sequence mismatch');
      if (head.type === 'snapshot_start' && this.snapshot === 'pending') {
        this.snapshot = 'open';
        return null;
      }
      if (
        head.type === 'snapshot' &&
        this.snapshot === 'open' &&
        this.snapshotPayload === undefined
      ) {
        this.snapshotPayload = payload;
        return null;
      }
      if (head.type === 'snapshot_end' && this.snapshotPayload !== undefined) {
        this.snapshot = 'done';
        const result: StreamEvent = {
          kind: 'snapshot',
          channel: 'book',
          commitId: head.commitId,
          payload: this.snapshotPayload,
        };
        this.snapshotPayload = undefined;
        return result;
      }
      throw new StreamBroken('Book snapshot out of order');
    }
    if (head.type !== 'update')
      throw new StreamBroken(`Unexpected ${head.type} on ${head.channel}`);
    if (head.sequence !== last + 1)
      throw new StreamBroken(`Sequence gap on ${head.channel}`);
    this.sequences.set(head.channel, head.sequence);
    return {
      kind: 'update',
      channel: head.channel,
      sequence: head.sequence,
      commitId: head.commitId,
      payload,
    };
  }

  private baselines(payload: unknown): Record<string, number> {
    try {
      return baselines(object(payload, 'control payload').channels);
    } catch (error) {
      throw new StreamBroken(
        error instanceof Error ? error.message : 'Bad baselines',
      );
    }
  }
}
