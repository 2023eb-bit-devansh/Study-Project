/**
 * The Phase 2 §7.2 demonstration set.
 *
 * These are the manual validation cases from the spec, plus T0 which
 * exercises the pre-retrieval checkability guard (FR6). Each records not
 * just the expected label but the PATH it should take, because a case that
 * reaches the right label by the wrong route is not evidence that the
 * architecture works.
 */
export const DEMO_CASES = [
  {
    id: 'T0',
    label: 'Not Checkable',
    claim: 'Section 302 IPC is far too harsh and should be abolished.',
    expect: { label: 'Not Checkable', maxTraceEvents: 12, noRetrieval: true, noVerdictCall: true },
    why: 'A value judgement about what the law ought to be, not a statement of what it is. '
       + 'Must short-circuit before any Chroma query and before the verdict model.',
  },
  {
    id: 'T1',
    label: 'Supported',
    claim: 'Under Section 302 of the Indian Penal Code, murder is punishable with death or imprisonment for life.',
    expect: { label: 'Supported', rules: ['R3'], refKeys: ['IPC:S302'], minVerified: 1, exactTier: true },
    why: 'Exact reference lookup on turn 1, then a character-for-character quote match.',
  },
  {
    id: 'T2',
    label: 'Contradicted',
    claim: "Section 66A of the Information Technology Act, 2000 makes sending offensive messages online punishable with up to three years' imprisonment, and it is still in force today.",
    expect: { label: 'Contradicted', rules: ['R2', 'R5'], refKeys: ['IT:S66A'], minVerified: 1 },
    why: 'A verdict model working from memory alone plausibly says Supported. The status metadata '
       + 'on s.66A and the Shreya Singhal holding are what make it say Contradicted.',
  },
  {
    id: 'T3',
    label: 'Misleading Context',
    claim: 'The Right to Information Act gives any citizen the right to obtain information from any public authority.',
    expect: { label: 'Misleading Context', rules: ['R4', 'R5'], minVerified: 2 },
    why: 'True as far as it goes. The counter-evidence turn surfaces the exemptions, so the system '
       + 'reports the omission rather than confirming the claim.',
  },
  {
    id: 'T4',
    label: 'Insufficient Evidence',
    claim: 'In 2023 the Bombay High Court held in Criminal Appeal No. 412 of 2019 that a dying declaration recorded by a police constable is inadmissible.',
    expect: { label: 'Insufficient Evidence', rules: ['R0', 'R1', 'R6', 'R7'] },
    why: 'Checkable in form, so it correctly enters retrieval. The corpus has no Bombay HC judgments, '
       + 'live search confirms nothing, and the system abstains rather than guessing (FR18).',
  },
];
