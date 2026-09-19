/**
 * Tool registry.
 *
 * The tools are plain JS functions. The `functionDeclarations` below exist
 * so that an LLM-driven retrieval driver could be added later (deferred to
 * Phase 3 as the comparison arm in the evaluation) over an IDENTICAL tool
 * layer — which is what would make that comparison meaningful.
 *
 * Note what a tool result envelope does NOT contain: source URLs. A model
 * that never sees a URL cannot cite one it did not read.
 */
import { Type } from '@google/genai';
import { searchCorpus } from './searchCorpus.js';
import { lookupLegalReference } from './lookupLegalReference.js';
import { keywordSearch } from './keywordSearch.js';
import { readPassage } from './readPassage.js';
import { webSearch } from './webSearch.js';
import { ACT_CODES } from '../../corpus/refKey.js';
import { config } from '../../config/index.js';
import { truncate } from '../../util/text.js';

export const TOOLS = {
  search_corpus: searchCorpus,
  lookup_legal_reference: lookupLegalReference,
  keyword_search: keywordSearch,
  read_passage: readPassage,
  web_search: webSearch,
};

const ACT_ENUM = ['ANY', ...ACT_CODES];

export const functionDeclarations = [
  {
    name: 'search_corpus',
    description:
      'Semantic search over the curated Indian law corpus. Use for conceptual queries. '
      + 'Returns ranked snippets, never full documents.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Natural-language query, 3-20 words.' },
        act_code: { type: Type.STRING, enum: ACT_ENUM },
        doc_type: { type: Type.STRING, enum: ['ANY', 'act', 'constitution', 'judgment'] },
        n_results: { type: Type.INTEGER, description: '1-20, default 8.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_legal_reference',
    description:
      'Exact lookup of a provision by its reference. ALWAYS prefer this when the claim names a '
      + 'Section or Article. Automatically follows IPC→BNS, CrPC→BNSS and Evidence Act→BSA equivalences.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        act_code: { type: Type.STRING, enum: ACT_CODES },
        section: { type: Type.STRING, description: 'As printed: "302", "304A", "8". Omit for Articles.' },
        subsection: { type: Type.STRING },
        article: { type: Type.STRING, description: 'Constitutional Article: "21", "19".' },
        clause: { type: Type.STRING },
        include_equivalents: { type: Type.BOOLEAN },
      },
      required: ['act_code'],
    },
  },
  {
    name: 'keyword_search',
    description:
      'Literal or pattern search over passage text. Use for exact phrases, distinctive wording, '
      + 'or case citations such as "(2015) 5 SCC 1". Case-insensitive.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        phrase: { type: Type.STRING },
        regex: { type: Type.STRING, description: 'Optional; used instead of phrase when supplied.' },
        act_code: { type: Type.STRING, enum: ACT_ENUM },
        n_results: { type: Type.INTEGER },
      },
      required: [],
    },
  },
  {
    name: 'read_passage',
    description:
      'Read a chunk in full together with its neighbouring chunks from the same document. '
      + 'Use when a search hit looks promising but is truncated.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        chunk_id: { type: Type.STRING },
        window: { type: Type.INTEGER, description: 'Neighbours each side, 0-3.' },
      },
      required: ['chunk_id'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the live web. Available ONLY after the curated corpus has been searched and found '
      + 'insufficient. At most one call per claim.',
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING } },
      required: ['query'],
    },
  },
];

/**
 * The compact envelope a model would see. Snippets only, no URLs, no scores
 * that could steer it, and an explicit count of what was withheld as
 * already-seen so a model cannot mistake dedup for absence.
 */
export function toolResultEnvelope({ tool, turn, budget, hits, skippedSeen = 0, note, error }) {
  return {
    tool,
    turn,
    budget_left: {
      turns: budget.limits.turns - budget.used.turns,
      tool_calls: budget.limits.toolCalls - budget.used.toolCalls,
      llm_calls: budget.limits.llmCalls - budget.used.llmCalls,
    },
    ...(error ? { error } : {}),
    new_results: (hits ?? []).map((h) => ({
      chunk_id: h.chunk_id,
      ref: h.meta?.ref_key || h.meta?.heading || '',
      title: h.meta?.doc_title ?? '',
      status: h.meta?.status ?? '',
      chars: (h.text ?? '').length,
      snippet: truncate(h.text ?? '', config.retrieval.snippetChars),
    })),
    skipped_already_seen: skippedSeen,
    ...(note ? { note } : {}),
  };
}
