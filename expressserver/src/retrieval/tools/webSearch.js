/**
 * Live search fallback (FR10), via Gemini's googleSearch grounding tool.
 *
 * Two constraints shape this file.
 *
 * 1. **No structured output here.** Combining `responseMimeType:
 *    'application/json'` with `tools: [{googleSearch:{}}]` returns 400 on
 *    the 2.5 family, and on 3.x is accepted but returns EMPTY
 *    `groundingChunks` — which, for a system whose entire product is
 *    citations, is worse than an error. Retrieval returns evidence rather
 *    than structure, so we read the grounding metadata directly and skip the
 *    schema call entirely.
 *
 * 2. **A grounding chunk is a URI and a title, NOT page text.** You cannot
 *    verify a quote against a URL. So every grounded URI is fetched into the
 *    Source Text Store before it is allowed to become evidence, and
 *    WEB_ALLOW_UNFETCHABLE_AS_EVIDENCE=false means a page we could not fetch
 *    is dropped from the evidence set entirely — it can never contribute to
 *    Supported or Contradicted. That is stricter than most production
 *    systems and it is the honest answer to the "retrieved web evidence is
 *    unreliable" risk.
 */
import { request } from 'undici';
import { generateGrounded } from '../../providers/gemini/generate.js';
import { writeWebSource, webSourceId } from '../../corpus/sourceStore.js';
import { config } from '../../config/index.js';
import { logger } from '../../util/logger.js';
import { squash, truncate } from '../../util/text.js';

const log = logger('websearch');

const GROUNDING_SYSTEM =
  'You are a legal research assistant. Search for authoritative primary sources — the text of the ' +
  'statute, the judgment, or an official government page — that bear on the statement given. ' +
  'Report what the sources say. Do NOT state whether the claim is true or false, and do not use ' +
  'words such as "correct", "incorrect", "true" or "false" about it.';

/** Strip a fetched HTML document down to readable text. */
export function htmlToText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Fetch a page into the Source Text Store. Never throws. */
export async function fetchSourceText(uri, title) {
  try {
    const res = await request(uri, {
      method: 'GET',
      maxRedirections: 3,
      headersTimeout: config.web.fetchTimeoutMs,
      bodyTimeout: config.web.fetchTimeoutMs,
      headers: {
        // Identify honestly rather than impersonating a browser.
        'user-agent': 'AI-Fact-Checker-PoC/0.1 (university study project; evidence verification)',
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
    });
    if (res.statusCode >= 400) return { ok: false, reason: `http_${res.statusCode}` };

    const ctype = String(res.headers['content-type'] ?? '');
    if (!/text\/html|text\/plain|application\/xhtml/.test(ctype)) {
      return { ok: false, reason: `unsupported_content_type:${ctype.split(';')[0]}` };
    }

    // Bounded read — a 200MB page must not be able to exhaust memory.
    let bytes = 0;
    const parts = [];
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > config.web.fetchMaxBytes) break;
      parts.push(chunk);
    }
    const text = htmlToText(Buffer.concat(parts).toString('utf8'));
    if (text.length < 200) return { ok: false, reason: 'too_little_text' };

    writeWebSource({ uri, title, text });
    return { ok: true, chars: text.length, text };
  } catch (err) {
    return { ok: false, reason: err?.code ?? err?.name ?? 'fetch_failed', detail: err?.message };
  }
}

/**
 * @param {{ query: string }} args
 * @returns {Promise<{tool:string, hits:Array, sources:Array, dropped:Array}>}
 */
export async function webSearch({ query }) {
  if (!config.web.enabled) {
    return { tool: 'web_search', hits: [], sources: [], dropped: [], skipped: 'live_search_disabled' };
  }

  const grounded = await generateGrounded({ query, system: GROUNDING_SYSTEM, label: 'web_search' });

  const hits = [];
  const dropped = [];

  for (const src of grounded.sources) {
    const fetched = await fetchSourceText(src.uri, src.title);
    const sourceId = webSourceId(src.uri);

    if (!fetched.ok) {
      // Recorded so the trace can show it was found and why it was excluded,
      // but never admitted as evidence.
      dropped.push({ uri: src.uri, title: src.title, reason: fetched.reason });
      log.debug(`dropped ${src.uri}: ${fetched.reason}`);
      if (!config.web.allowUnfetchable) continue;
    }

    const text = fetched.ok
      ? truncate(squash(fetched.text), 4000)
      : squash(grounded.text).slice(0, 1000);

    hits.push({
      chunk_id: sourceId,
      text,
      meta: {
        doc_id: sourceId,
        doc_title: src.title || src.uri,
        doc_type: 'web',
        source_url: src.uri,
        ref_key: '',
        ref_key_alt: '',
        status: 'in_force',
        heading: src.title ?? '',
        seq: 0,
        char_start: 0,
        char_end: text.length,
        verification_status: 'unverified',
      },
      // Web evidence enters with a modest dense similarity and a penalty, so
      // a curated corpus passage of equal relevance always outranks it.
      denseSim: 0.5,
      refHit: false,
      exactHit: false,
      isWeb: true,
      isNeighbour: false,
      sourceType: fetched.ok ? 'web' : 'web_unverifiable',
      routes: ['web'],
    });
  }

  return {
    tool: 'web_search',
    query,
    hits,
    dropped,
    sources: grounded.sources,
    searchQueries: grounded.searchQueries,
    // Google's terms require this chip to be displayed alongside grounded results.
    searchEntryPoint: grounded.searchEntryPoint,
    usage: grounded.usage,
    ms: grounded.ms,
    model: grounded.model,
  };
}
