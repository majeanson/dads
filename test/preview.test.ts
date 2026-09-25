import { describe, expect, it } from 'vitest';
import { escape, previewTags } from '../src/worker/routes/preview';

const url = new URL('https://dads.test/i/abc');
const room = {
  name: 'Throwback daddies',
  dad_night_weekday: 4,
  dad_night_time: '21:00',
  dad_night_date: null,
  dad_night_tz: 'America/Montreal',
};

describe('the preview an invite link unfurls to', () => {
  it('names the room and its night, in both languages', () => {
    const { title, html } = previewTags(url, room);
    expect(title).toBe('Throwback daddies — dads');
    expect(html).toContain('<meta property="og:title" content="Throwback daddies" />');
    expect(html).toContain('Thursdays at 21:00');
    expect(html).toContain('jeudis');
    expect(html).toContain('<meta property="og:image" content="https://dads.test/og.png" />');
  });

  it('says nothing about a night that has been and gone', () => {
    const { html } = previewTags(url, { ...room, dad_night_date: '2020-01-02' });
    expect(html).not.toContain('Dad night:');
    expect(html).toContain('You’re invited.');
  });

  it('is the plain one for a link that opens nothing', () => {
    const { title, html } = previewTags(url, null);
    expect(title).toBe('dads');
    expect(html).toContain('<meta property="og:title" content="dads" />');
    expect(html).not.toContain('invited');
  });

  it('escapes a name that tries to be markup', () => {
    // A room's name is whatever its opener typed, and it lands in an
    // attribute of a page this origin serves.
    const { html } = previewTags(url, { ...room, name: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(escape(`a&b<c>"d'e`)).toBe('a&amp;b&lt;c&gt;&quot;d&#39;e');
  });
});
