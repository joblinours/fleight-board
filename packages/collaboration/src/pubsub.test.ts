import { describe, expect, it, vi } from 'vitest';
import { InMemoryPubSub } from './pubsub';

describe('InMemoryPubSub', () => {
  it('diffuse un message aux abonnés du canal uniquement', async () => {
    const pubsub = new InMemoryPubSub<string>();
    const boardA = vi.fn();
    const boardB = vi.fn();
    pubsub.subscribe('board:a', boardA);
    pubsub.subscribe('board:b', boardB);

    await pubsub.publish('board:a', 'hello');

    expect(boardA).toHaveBeenCalledWith('hello');
    expect(boardB).not.toHaveBeenCalled();
  });

  it('cesse la diffusion après désabonnement et libère le canal', async () => {
    const pubsub = new InMemoryPubSub<string>();
    const handler = vi.fn();
    const unsubscribe = pubsub.subscribe('board:a', handler);

    unsubscribe();
    await pubsub.publish('board:a', 'hello');

    expect(handler).not.toHaveBeenCalled();
    expect(pubsub.channelCount).toBe(0);
  });

  it('tolère un désabonnement pendant la diffusion', async () => {
    const pubsub = new InMemoryPubSub<string>();
    const second = vi.fn();
    const unsubscribeFirst = pubsub.subscribe('board:a', () => unsubscribeFirst());
    pubsub.subscribe('board:a', second);

    await pubsub.publish('board:a', 'hello');

    expect(second).toHaveBeenCalledOnce();
  });
});
