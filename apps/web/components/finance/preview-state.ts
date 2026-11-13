/**
 * Whether the invoice preview shows exactly what “Create” will send (QA audit 13 Nov 2026, BUG-20).
 * The preview follows the form 350 ms after the last change, plus the request; until then it shows
 * the previous version, and the Review step showed a total of $12.99 while “Create” saved $67.99.
 */
export function previewIsCurrent(p: { formKey: string; sentKey: string; fetching: boolean; placeholder: boolean; hasData: boolean }): boolean {
  return p.hasData && p.formKey === p.sentKey && !p.fetching && !p.placeholder;
}
