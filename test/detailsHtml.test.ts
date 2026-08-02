import { describe, expect, it } from 'vitest';
import { buildDetailsHtml } from '../src/details/detailsHtml';
import { extractServiceRecord } from '../src/state/serviceDetails';
import type { ServiceDetails, ServiceRecord } from '../src/state/serviceDetails';

const details: ServiceDetails = {
  name: 'BugSink',
  workspace: 'Acme',
  project: 'production',
  region: 'Frankfurt (DE)',
  pod: 'Small',
  deployType: 'webservice',
  runtime: 'registry',
};

const emptyRecord: ServiceRecord = {
  id: undefined,
  internalUrl: undefined,
  externalUrl: undefined,
  customUrl: undefined,
};

describe('extractServiceRecord', () => {
  it('reads the live service record and ignores fields it does not surface', () => {
    const record = extractServiceRecord({
      service: {
        id: 'svc-1',
        deploy_tag: '73166',
        external_sd_url: 'https://example.partitur.cloud',
        name: 'BugSink',
      },
    });
    expect(record.id).toBe('svc-1');
    expect(record.externalUrl).toBe('https://example.partitur.cloud');
    expect(record.internalUrl).toBeUndefined();
    expect(record.customUrl).toBeUndefined();
  });

  it('picks up internal and custom URLs if the API ever returns them', () => {
    const record = extractServiceRecord({
      service: { internal_url: 'http://svc.internal', custom_url: 'https://app.acme.com' },
    });
    expect(record.internalUrl).toBe('http://svc.internal');
    expect(record.customUrl).toBe('https://app.acme.com');
  });

  it('treats blank strings as absent and never throws on junk', () => {
    expect(extractServiceRecord({ service: { id: '   ' } }).id).toBeUndefined();
    expect(extractServiceRecord(undefined).id).toBeUndefined();
    expect(extractServiceRecord('nope').externalUrl).toBeUndefined();
  });
});

describe('buildDetailsHtml', () => {
  it('shows a select-a-service state with no selection', () => {
    const html = buildDetailsHtml(undefined, undefined, undefined, false);
    expect(html).toContain('Select a service');
    expect(html).not.toContain('command:partiri.deploy');
  });

  it('offers Deploy only when the service has no id yet', () => {
    const html = buildDetailsHtml('web', undefined, emptyRecord, false);
    expect(html).toContain('command:partiri.deploy');
    expect(html).not.toContain('command:partiri.pause');
    expect(html).not.toContain('command:partiri.unpause');
  });

  it('offers all three actions once the service has an id', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect(html).toContain('command:partiri.deploy');
    expect(html).toContain('command:partiri.pause');
    expect(html).toContain('command:partiri.unpause');
  });

  it('omits every unpopulated row rather than rendering it blank', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect(html).toContain('Region');
    expect(html).toContain('Frankfurt (DE)');
    expect(html).not.toContain('>ID<');
    expect(html).not.toContain('Internal');
    expect(html).not.toContain('External');
    expect(html).not.toContain('Custom');
  });

  it('renders id and URLs when they are populated, linking the URLs', () => {
    const html = buildDetailsHtml(
      'BugSink',
      details,
      {
        id: 'svc-1',
        internalUrl: 'http://svc.internal',
        externalUrl: 'https://example.partitur.cloud',
        customUrl: 'https://app.acme.com',
      },
      true,
    );
    expect(html).toContain('svc-1');
    expect(html).toContain('Internal');
    expect(html).toContain('External');
    expect(html).toContain('Custom');
    expect(html).toContain('<a href="https://example.partitur.cloud"');
  });

  it('never emits a script tag and escapes hostile values', () => {
    const html = buildDetailsHtml(
      '<script>alert(1)</script>',
      undefined,
      { ...emptyRecord, id: '<img src=x onerror=alert(1)>' },
      false,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('action button affordance', () => {
  it('gives each button an icon, a role, and a consequence tooltip', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect((html.match(/role="button"/g) ?? []).length).toBe(3);
    expect(html).toContain('consumes balance');
    expect(html).toContain('until unpaused');
    // Icons are inline SVG, since the panel loads no external resources.
    expect(html).toContain('<svg');
    expect(html).not.toContain('codicon');
  });

  it('tells the user that actions are confirmed before running', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect(html).toContain('asks you to confirm');
  });

  it('marks pause as a caution and deploy as primary', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect(html).toContain('action--primary');
    expect(html).toContain('action--caution');
  });

  it('still emits no script tag with icons present', () => {
    const html = buildDetailsHtml('BugSink', details, emptyRecord, true);
    expect(html).not.toContain('<script');
  });
});
