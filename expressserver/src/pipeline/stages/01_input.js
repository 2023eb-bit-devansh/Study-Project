/**
 * Stage 1 — input.
 *
 * Text goes straight through. An image is transcribed and then the job STOPS
 * at `awaiting_confirmation` so the user can correct the OCR before it drives
 * retrieval.
 *
 * IMAGE_CONFIRM_REQUIRED is unconditional and deliberately not auto-skipped
 * on `legibility: "high"` — a model's self-reported confidence is not
 * calibrated, correcting it is one click, and it is a stated usability
 * requirement (§4.3: "If an image is unclear, the system should show the
 * extracted claim before verification so the user can correct it").
 */
import { generateStructured, imageContents } from '../../providers/gemini/generate.js';
import { imageTranscriptionSchema } from '../../providers/gemini/schemas/index.js';
import { IMAGE_TRANSCRIPTION_SYSTEM, IMAGE_TRANSCRIPTION_PROMPT } from '../../prompts/imageTranscription.prompt.js';
import { config } from '../../config/index.js';
import { badRequest } from '../../util/errors.js';

export async function runInputStage({ job, emit }) {
  emit({ stage: 'input', type: 'stage_start', label: job.input.kind === 'image' ? 'Reading the image' : 'Reading the submitted text' });

  if (job.input.kind === 'text') {
    const text = String(job.input.text ?? '').trim();
    if (!text) throw badRequest('No text was submitted.');
    emit({
      stage: 'input', type: 'stage_end',
      label: `Text accepted (${text.length} characters)`,
      detail: { chars: text.length, sourceUrl: job.input.sourceUrl ?? null },
    });
    return { text, needsConfirmation: false };
  }

  const { data, usage, ms, model } = await generateStructured({
    role: 'vision',
    contents: imageContents(IMAGE_TRANSCRIPTION_PROMPT, {
      mimeType: job.input.mimeType,
      base64: job.input.base64,
    }),
    schema: imageTranscriptionSchema,
    system: IMAGE_TRANSCRIPTION_SYSTEM,
    temperature: 0,
    label: 'image_transcription',
  });

  emit({
    stage: 'input', type: 'llm_result',
    label: `Transcribed ${data.transcribed_text?.length ?? 0} characters (legibility: ${data.legibility})`,
    detail: { model, ...data },
    duration_ms: ms,
    tokens: usage,
  });

  if (!data.contains_text || !String(data.transcribed_text ?? '').trim()) {
    throw badRequest('No readable text was found in that image.');
  }

  emit({
    stage: 'input', type: 'stage_end',
    label: config.claims.imageConfirmRequired
      ? 'Waiting for you to confirm the extracted text'
      : 'Transcription accepted',
    detail: { legibility: data.legibility, illegible_spans: data.illegible_spans ?? [] },
  });

  return {
    text: data.transcribed_text,
    transcription: data,
    needsConfirmation: config.claims.imageConfirmRequired,
    usage,
  };
}
