import { describe, expect, it } from 'vitest';
import {
  SelectedServiceStore,
  selectedServiceId,
  selectionKey,
  type SelectedService,
} from '../src/state/selectedService';

describe('SelectedServiceStore', () => {
  it('round-trips a remote selection through select()/get()', () => {
    const store = new SelectedServiceStore();
    const selection: SelectedService = { kind: 'remote', serviceId: 'svc-1', name: 'api' };

    store.select(selection);

    expect(store.get()).toEqual(selection);
  });

  it('round-trips a localConfig selection through select()/get()', () => {
    const store = new SelectedServiceStore();
    const selection: SelectedService = {
      kind: 'localConfig',
      folder: '/workspace/api',
      configPath: '/workspace/api/.partiri.jsonc',
      name: 'api',
    };

    store.select(selection);

    expect(store.get()).toEqual(selection);
  });

  it('fires onDidChange with the selected payload', () => {
    const store = new SelectedServiceStore();
    const selection: SelectedService = { kind: 'remote', serviceId: 'svc-1', name: 'api' };
    const received: (SelectedService | undefined)[] = [];
    store.onDidChange((value) => received.push(value));

    store.select(selection);

    expect(received).toEqual([selection]);
  });

  it('clearing to undefined updates get() and fires undefined', () => {
    const store = new SelectedServiceStore();
    const received: (SelectedService | undefined)[] = [];
    store.select({ kind: 'remote', serviceId: 'svc-1', name: 'api' });
    store.onDidChange((value) => received.push(value));

    store.select(undefined);

    expect(store.get()).toBeUndefined();
    expect(received).toEqual([undefined]);
  });

  it('dispose() disposes the underlying emitter without throwing', () => {
    const store = new SelectedServiceStore();
    expect(() => store.dispose()).not.toThrow();
  });
});

describe('selectedServiceId', () => {
  it('returns the id for a remote selection', () => {
    expect(selectedServiceId({ kind: 'remote', serviceId: 'svc-1', name: 'api' })).toBe('svc-1');
  });

  it('returns the id for a localConfig selection that has one', () => {
    expect(
      selectedServiceId({
        kind: 'localConfig',
        folder: '/workspace/api',
        configPath: '/workspace/api/.partiri.jsonc',
        serviceId: 'svc-1',
        name: 'api',
      }),
    ).toBe('svc-1');
  });

  it('returns undefined for a localConfig selection with no id yet', () => {
    expect(
      selectedServiceId({
        kind: 'localConfig',
        folder: '/workspace/api',
        configPath: '/workspace/api/.partiri.jsonc',
        name: 'api',
      }),
    ).toBeUndefined();
  });

  it('returns undefined for no selection', () => {
    expect(selectedServiceId(undefined)).toBeUndefined();
  });
});

describe('selectionKey', () => {
  it('keys a remote selection by service id', () => {
    expect(selectionKey({ kind: 'remote', serviceId: 'svc-1', name: 'api' })).toBe('remote:svc-1');
  });

  it('keys a local config by its path', () => {
    expect(
      selectionKey({
        kind: 'localConfig',
        folder: '/workspace/api',
        configPath: '/workspace/api/.partiri.jsonc',
        serviceId: 'svc-1',
        name: 'api',
      }),
    ).toBe('local:/workspace/api/.partiri.jsonc');
  });

  /**
   * Two files can legitimately carry the same service id, and selecting one
   * then the other is a real change the panels must re-render for.
   */
  it('distinguishes two configs sharing one service id', () => {
    const base = { kind: 'localConfig' as const, folder: '/w', serviceId: 'svc-1', name: 'api' };
    expect(selectionKey({ ...base, configPath: '/w/a.partiri.jsonc' })).not.toBe(
      selectionKey({ ...base, configPath: '/w/b.partiri.jsonc' }),
    );
  });

  it('never collides across kinds', () => {
    expect(selectionKey({ kind: 'remote', serviceId: 'x', name: 'api' })).not.toBe(
      selectionKey({ kind: 'localConfig', folder: '/w', configPath: 'x', name: 'api' }),
    );
  });
});
