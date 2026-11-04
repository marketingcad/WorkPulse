import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field, Input, Select, Textarea } from '../src';

// Audit QA-02 (30 Oct 2026): a Field's error or hint describes its control, and the control says
// when it is invalid or required, so a screen reader reads the problem with the field.
const render = (props: Parameters<typeof Field>[0]) => renderToStaticMarkup(h(Field, props));
/** The ARIA attributes on the element with this id (class names may contain "aria-" too). */
const ariaOf = (html: string, id: string) => (html.match(new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`))?.[0] ?? '').match(/ aria-[a-z]+="[^"]*"/g) ?? [];

describe('Field ARIA', () => {
  it('ties the error to the control and marks it invalid and required', () => {
    const html = render({ label: 'Email', htmlFor: 'email', required: true, error: 'Enter a valid email address', children: h(Input, { id: 'email' }) });
    expect(html).toContain('id="email-message" role="alert"');
    expect(html).toMatch(/<input[^>]*id="email"[^>]*aria-describedby="email-message"[^>]*aria-invalid="true"[^>]*aria-required="true"/);
  });

  it('uses the hint as the description when there is no error, and is not invalid', () => {
    const html = render({ label: 'Notes', htmlFor: 'notes', hint: 'Shown on the invoice', children: h(Textarea, { id: 'notes' }) });
    expect(html).toContain('<p id="notes-message"');
    expect(html).toMatch(/<textarea[^>]*aria-describedby="notes-message"/);
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-required');
  });

  it('keeps a description the caller set and adds the field message', () => {
    const html = render({ label: 'Role', htmlFor: 'role', error: 'Choose a role', children: h(Select, { id: 'role', 'aria-describedby': 'role-help' }) });
    expect(html).toMatch(/<select[^>]*aria-describedby="role-help role-message"[^>]*aria-invalid="true"/);
  });

  it('leaves other controls in the same Field alone', () => {
    const html = render({ label: 'Hours', htmlFor: 'from', error: 'End after start', children: [h(Input, { id: 'from', key: 'a' }), h(Input, { id: 'to', key: 'b' })] });
    expect(ariaOf(html, 'from')).toEqual([' aria-describedby="from-message"', ' aria-invalid="true"']);
    expect(ariaOf(html, 'to')).toEqual([]);
  });

  it('adds nothing outside a Field', () => {
    expect(ariaOf(renderToStaticMarkup(h(Input, { id: 'free' })), 'free')).toEqual([]);
  });
});
