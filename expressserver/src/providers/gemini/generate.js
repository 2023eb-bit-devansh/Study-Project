/**
 * The three shapes of Gemini generation this project uses.
 *
 * Deliberately NOT offered: structured output combined with the googleSearch
 * tool. On the 2.5 family that returns `400 INVALID_ARGUMENT`; on 3.x it is
 * accepted but `groundingChunks` comes back empty, which for a system whose
 * entire product is citations is worse than an error. Grounded calls return
 * prose plus grounding metadata; anything needing structure is a separate,
 * tool-free call.
 */
import { getGenAI, withRetry } from './client.js';
import { modelFor } from '../../config/models.js';
import { config } from '../../config/index.js';
import { timer } from '../../util/time.js';
import { upstream } from '../../util/errors.js';

/** @typedef {{ text: string, usage: object, ms: number, model: string }} GenResult */

function usageOf(response) {
  const u = response?.usageMetadata ?? {};
  return {
    prompt: u.promptTokenCount ?? 0,
    output: u.candidatesTokenCount ?? 0,
    thoughts: u.thoughtsTokenCount ?? 0,
    total: u.totalTokenCount ?? 0,
  };
}

/**
 * Structured JSON generation. Returns the PARSED object.
 * @param {object} o
 * @param {string} o.role         model role: extraction | verdict | retrieval | vision
 * @param {any}    o.contents     string, or a Content[] for multimodal
 * @param {object} o.schema       responseSchema built with the SDK `Type` enum
 * @param {string} [o.system]     system instruction
 * @param {number} [o.temperature]
 */
export async function generateStructured({
  role, contents, schema, system, temperature, maxOutputTokens, label = role,
}) {
  const model = modelFor(role);
  const t = timer();
  const response = await withRetry(() => getGenAI().models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: temperature ?? config.gemini.tempExtraction,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(system ? { systemInstruction: system } : {}),
      abortSignal: AbortSignal.timeout(config.gemini.timeoutMs),
    },
  }), { label });

  const raw = response.text ?? '';
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // A finishReason of MAX_TOKENS truncates the JSON mid-object. Say so —
    // "unexpected end of JSON input" alone sends you hunting the wrong bug.
    const finish = response?.candidates?.[0]?.finishReason;
    if (finish === 'MAX_TOKENS') {
      throw upstream(
        `The ${label} response was cut off at the output-token limit `
        + `(${maxOutputTokens ?? 'default'}), so its JSON is incomplete. `
        + 'Raise GEMINI_MAX_OUTPUT_TOKENS_VERDICT, or shorten the evidence packet.',
        raw.slice(0, 500),
      );
    }
    throw upstream(
      `Gemini returned unparseable JSON for "${label}"`
      + (finish && finish !== 'STOP' ? ` (finishReason=${finish})` : ''),
      raw.slice(0, 500),
    );
  }
  return { data: parsed, raw, usage: usageOf(response), ms: t.ms(), model, finishReason: response?.candidates?.[0]?.finishReason };
}

/** Plain text generation (no tools, no schema). */
export async function generateText({ role, contents, system, temperature, maxOutputTokens, label = role }) {
  const model = modelFor(role);
  const t = timer();
  const response = await withRetry(() => getGenAI().models.generateContent({
    model,
    contents,
    config: {
      temperature: temperature ?? 0,
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      ...(system ? { systemInstruction: system } : {}),
      abortSignal: AbortSignal.timeout(config.gemini.timeoutMs),
    },
  }), { label });
  return { text: response.text ?? '', usage: usageOf(response), ms: t.ms(), model };
}

/**
 * Grounded generation via the googleSearch tool.
 *
 * Returns prose plus the citations Google actually used. Note that a
 * grounding chunk carries a URI and a title but NOT the page text — you
 * cannot verify a quote against a URL, so `retrieval/tools/webSearch.js`
 * fetches each URI into the Source Text Store before the evidence is
 * allowed anywhere near the verdict stage.
 */
export async function generateGrounded({ query, system, label = 'grounding' }) {
  const model = modelFor('grounding');
  const t = timer();
  const response = await withRetry(() => getGenAI().models.generateContent({
    model,
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0,
      ...(system ? { systemInstruction: system } : {}),
      abortSignal: AbortSignal.timeout(config.gemini.timeoutMs),
    },
  }), { label });

  const gm = response?.candidates?.[0]?.groundingMetadata ?? {};
  const sources = (gm.groundingChunks ?? [])
    .map((c, i) => (c.web ? { index: i, uri: c.web.uri, title: c.web.title ?? '', domain: c.web.domain ?? '' } : null))
    .filter(Boolean);

  return {
    text: response.text ?? '',
    sources,
    supports: gm.groundingSupports ?? [],
    searchQueries: gm.webSearchQueries ?? [],
    // Google's terms require displaying this chip alongside grounded results.
    searchEntryPoint: gm.searchEntryPoint?.renderedContent ?? null,
    usage: usageOf(response),
    ms: t.ms(),
    model,
  };
}

/** Build a multimodal user Content from text + a bare base64 image. */
export function imageContents(text, { mimeType, base64 }) {
  return [{ role: 'user', parts: [{ text }, { inlineData: { mimeType, data: base64 } }] }];
}
