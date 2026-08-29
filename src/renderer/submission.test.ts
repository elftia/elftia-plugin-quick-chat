import type { HostLocalChannelMessage } from '@elftia/plugin-types';
import { describe, expect, it, vi } from 'vitest';

import { MAX_DRAFT_UTF8_BYTES } from '../shared/constants';
import { isNormalizedSubmitIntent, LogicalSubmission } from './submission';

const hostMessage: HostLocalChannelMessage = {
  id: 'host-1',
  role: 'user',
  content: 'hello',
  createdAt: '2026-01-01',
  revision: 1,
  clientMessageId: 'id-1',
};

describe('LogicalSubmission', () => {
  it('rejects blank and over-32-KiB input without allocating an id', async () => {
    const idFactory = vi.fn(() => 'id-1');
    const send = vi.fn();
    const submission = new LogicalSubmission({ send }, vi.fn(), idFactory);
    await expect(submission.submit('  ')).resolves.toMatchObject({ state: 'invalid' });
    await expect(submission.submit('界'.repeat(MAX_DRAFT_UTF8_BYTES))).resolves.toMatchObject({
      state: 'invalid',
    });
    expect(idFactory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    { accepted: true, duplicate: false, state: 'accepted' },
    { accepted: false, duplicate: true, state: 'duplicate' },
  ] as const)('reconciles $state as success', async ({ accepted, duplicate, state }) => {
    const onAccepted = vi.fn();
    const send = vi.fn().mockResolvedValue({ accepted, duplicate, message: hostMessage });
    const submission = new LogicalSubmission({ send }, onAccepted, () => 'id-1');
    await expect(submission.submit('hello')).resolves.toMatchObject({ state });
    expect(send).toHaveBeenCalledWith({ text: 'hello', clientMessageId: 'id-1' });
    expect(onAccepted).toHaveBeenCalledOnce();
  });

  it('excludes concurrent duplicate submit and allocates once', async () => {
    let resolveSend!: (value: unknown) => void;
    const send = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        })
    );
    const idFactory = vi.fn(() => 'id-1');
    const submission = new LogicalSubmission({ send } as never, vi.fn(), idFactory);
    const first = submission.submit('hello');
    await expect(submission.submit('hello')).resolves.toEqual({ state: 'pending' });
    resolveSend({ accepted: true, duplicate: false, message: hostMessage });
    await first;
    expect(send).toHaveBeenCalledOnce();
    expect(idFactory).toHaveBeenCalledOnce();
  });

  it('reuses the same logical id after an uncertain result', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('reply lost'))
      .mockResolvedValueOnce({ accepted: false, duplicate: true, message: hostMessage });
    const idFactory = vi.fn(() => 'id-1');
    const submission = new LogicalSubmission({ send }, vi.fn(), idFactory);
    await expect(submission.submit('hello')).resolves.toMatchObject({ state: 'uncertain' });
    expect(submission.canRetry('hello')).toBe(true);
    await expect(submission.submit('hello')).resolves.toMatchObject({ state: 'duplicate' });
    expect(send).toHaveBeenNthCalledWith(1, { text: 'hello', clientMessageId: 'id-1' });
    expect(send).toHaveBeenNthCalledWith(2, { text: 'hello', clientMessageId: 'id-1' });
    expect(idFactory).toHaveBeenCalledOnce();
  });
});

describe('normalized opaque submit intent', () => {
  it('accepts only an unmodified non-composing Enter intent', () => {
    expect(isNormalizedSubmitIntent({ key: 'Enter' })).toBe(true);
    expect(isNormalizedSubmitIntent({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isNormalizedSubmitIntent({ key: 'Enter', ctrlKey: true })).toBe(false);
    expect(isNormalizedSubmitIntent({ key: 'Enter', isComposing: true })).toBe(false);
    expect(isNormalizedSubmitIntent({ key: 'a' })).toBe(false);
    expect(isNormalizedSubmitIntent({ type: 'keydown', target: { value: 'hello' } })).toBe(false);
  });
});
