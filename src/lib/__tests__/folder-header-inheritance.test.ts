import { describe, expect, it } from 'vitest';
import { buildInheritedHeaderRows } from '../folder-header-inheritance';

const h = (key: string, value: string, enabled = true) => ({ key, value, enabled });

describe('buildInheritedHeaderRows', () => {
  it('lists collection headers first, then each folder outermost first', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('X-Team', 'a')] }],
      [],
    );
    expect(rows.map((r) => [r.key, r.source])).toEqual([
      ['Accept', 'shop'],
      ['X-Team', 'users'],
    ]);
  });

  it('lets a nearer level replace a header with the same name', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('Accept', 'xml')] }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'Accept', value: 'xml', source: 'users' });
  });

  it('drops disabled headers and never lets them shadow', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [{ label: 'users', headers: [h('Accept', 'xml', false)] }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 'json', source: 'shop' });
  });

  it('marks a row overridden only on an exact, case-sensitive name match', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json'), h('X-Id', '1')] },
      [],
      [h('Accept', 'xml'), h('x-id', '2')],
    );
    expect(rows.find((r) => r.key === 'Accept')?.overridden).toBe(true);
    expect(rows.find((r) => r.key === 'X-Id')?.overridden).toBe(false);
  });

  it('ignores disabled own headers when marking overrides', () => {
    const rows = buildInheritedHeaderRows(
      { label: 'shop', headers: [h('Accept', 'json')] },
      [],
      [h('Accept', 'xml', false)],
    );
    expect(rows[0]?.overridden).toBe(false);
  });
});
