import { describe, expect, it } from 'vitest';
import { bundleOf, isNewer } from '../src/web/fresh';

const BUILT = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/index-B58FEbGc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-D8ZoV25s.css">
</head><body><div id="root"></div></body></html>`;

const DEV = `<!doctype html><html><head></head><body>
<script type="module" src="/src/web/main.tsx"></script></body></html>`;

describe('bundleOf', () => {
  it('names the built bundle', () => {
    expect(bundleOf(BUILT)).toBe('/assets/index-B58FEbGc.js');
  });

  it('finds nothing on the dev server, so the check stays inert there', () => {
    expect(bundleOf(DEV)).toBeNull();
  });

  it('is not fooled by the stylesheet', () => {
    expect(bundleOf(BUILT)).not.toContain('.css');
  });
});

describe('isNewer', () => {
  it('is a different bundle on both sides', () => {
    expect(isNewer('/assets/index-aaa.js', '/assets/index-bbb.js')).toBe(true);
    expect(isNewer('/assets/index-aaa.js', '/assets/index-aaa.js')).toBe(false);
  });

  it('never reloads on a page it cannot read', () => {
    // A door served with no bundle — an outage page, a captive portal — is
    // not a newer version of anything.
    expect(isNewer('/assets/index-aaa.js', null)).toBe(false);
    expect(isNewer(null, '/assets/index-bbb.js')).toBe(false);
  });
});
