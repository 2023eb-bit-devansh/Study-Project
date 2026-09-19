/**
 * Declarative environment specification.
 *
 * Every tunable in the system is declared here exactly once: its type, its
 * default, and its valid range. `config/index.js` reads this, validates
 * process.env against it, and freezes the result. Nothing else in `src/`
 * may touch process.env — `test/unit/config.test.js` enforces that.
 *
 * This is the mechanism behind NFR 4.4 ("model names, endpoints, token
 * limits, source weights and thresholds should be kept in configuration
 * rather than spread through application code").
 */

/** @typedef {'string'|'int'|'float'|'bool'|'csv'|'enum'} EnvType */

export const SCHEMA = {
  // ── server ───────────────────────────────────────────────────────────
  PORT:                  { group: 'server', type: 'int',    def: 3000, min: 1, max: 65535 },
  NODE_ENV:              { group: 'server', type: 'enum',   def: 'development', values: ['development', 'production', 'test'] },
  LOG_LEVEL:             { group: 'server', type: 'enum',   def: 'info', values: ['debug', 'info', 'warn', 'error', 'silent'] },
  CORS_ALLOWED_ORIGINS:  { group: 'server', type: 'csv',    def: 'http://localhost:5173,http://localhost:5174,http://localhost:3000' },
  REQUEST_MAX_BODY_MB:   { group: 'server', type: 'int',    def: 8, min: 1, max: 64 },
  DASHBOARD_ENABLED:     { group: 'server', type: 'bool',   def: true },
  DASHBOARD_TOKEN:       { group: 'server', type: 'string', def: 'change-me', secret: true },
  REQUEST_MONITOR_RING:  { group: 'server', type: 'int',    def: 500, min: 10, max: 10000 },

  // ── gemini ───────────────────────────────────────────────────────────
  GEMINI_API_KEY:                 { group: 'gemini', type: 'string', def: '', secret: true },
  GEMINI_MODEL_EXTRACTION:        { group: 'gemini', type: 'string', def: '' },
  GEMINI_MODEL_VISION:            { group: 'gemini', type: 'string', def: '' },
  GEMINI_MODEL_RETRIEVAL:         { group: 'gemini', type: 'string', def: '' },
  GEMINI_MODEL_VERDICT:           { group: 'gemini', type: 'string', def: '' },
  GEMINI_MODEL_GROUNDING:         { group: 'gemini', type: 'string', def: '' },
  GEMINI_EMBED_MODEL:             { group: 'gemini', type: 'string', def: 'gemini-embedding-001' },
  GEMINI_MODEL_VALIDATE_AT_BOOT:  { group: 'gemini', type: 'bool',   def: true },
  GEMINI_EMBED_DIM:               { group: 'gemini', type: 'int',    def: 768, min: 128, max: 3072 },
  GEMINI_EMBED_BATCH:             { group: 'gemini', type: 'int',    def: 100, min: 1, max: 100 },
  GEMINI_EMBED_NORMALIZE:         { group: 'gemini', type: 'bool',   def: true },
  GEMINI_EMBED_TASKTYPE_DOC:      { group: 'gemini', type: 'string', def: 'RETRIEVAL_DOCUMENT' },
  GEMINI_EMBED_TASKTYPE_QUERY:    { group: 'gemini', type: 'string', def: 'RETRIEVAL_QUERY' },
  GEMINI_TEMPERATURE_EXTRACTION:  { group: 'gemini', type: 'float',  def: 0, min: 0, max: 2 },
  GEMINI_TEMPERATURE_VERDICT:     { group: 'gemini', type: 'float',  def: 0, min: 0, max: 2 },
  GEMINI_TEMPERATURE_REFINER:     { group: 'gemini', type: 'float',  def: 0.2, min: 0, max: 2 },
  GEMINI_MAX_OUTPUT_TOKENS_VERDICT: { group: 'gemini', type: 'int',  def: 16384, min: 256, max: 65536 },
  GEMINI_TIMEOUT_MS:              { group: 'gemini', type: 'int',    def: 60000, min: 1000, max: 300000 },
  GEMINI_MAX_RETRIES:             { group: 'gemini', type: 'int',    def: 3, min: 0, max: 10 },
  GEMINI_RETRY_BASE_MS:           { group: 'gemini', type: 'int',    def: 800, min: 50, max: 10000 },

  // ── chroma ───────────────────────────────────────────────────────────
  CHROMA_HOST:           { group: 'chroma', type: 'string', def: 'localhost' },
  CHROMA_PORT:           { group: 'chroma', type: 'int',    def: 8000, min: 1, max: 65535 },
  CHROMA_SSL:            { group: 'chroma', type: 'bool',   def: false },
  CHROMA_TENANT:         { group: 'chroma', type: 'string', def: 'default_tenant' },
  CHROMA_DATABASE:       { group: 'chroma', type: 'string', def: 'default_database' },
  CHROMA_COLLECTION:     { group: 'chroma', type: 'string', def: 'indian_law_v1' },
  CHROMA_HNSW_SPACE:     { group: 'chroma', type: 'enum',   def: 'cosine', values: ['cosine', 'l2', 'ip'] },
  CHROMA_ADD_BATCH:      { group: 'chroma', type: 'int',    def: 500, min: 1, max: 5461 },
  CHROMA_REGEX_SELFTEST: { group: 'chroma', type: 'bool',   def: true },

  // ── corpus / ingest ──────────────────────────────────────────────────
  CORPUS_SEED_DIR:             { group: 'corpus', type: 'string', def: './src/corpus/seed/documents' },
  SOURCE_TEXT_DIR:             { group: 'corpus', type: 'string', def: './data/sources' },
  CHUNK_MAX_CHARS:             { group: 'corpus', type: 'int', def: 1200, min: 200, max: 8000 },
  CHUNK_MIN_CHARS:             { group: 'corpus', type: 'int', def: 120, min: 0, max: 2000 },
  CHUNK_OVERLAP_CHARS_STATUTE: { group: 'corpus', type: 'int', def: 0, min: 0, max: 1000 },
  CHUNK_OVERLAP_CHARS_JUDGMENT:{ group: 'corpus', type: 'int', def: 150, min: 0, max: 1000 },

  // ── retrieval ────────────────────────────────────────────────────────
  RETRIEVAL_MODE:                { group: 'retrieval', type: 'enum', def: 'heuristic', values: ['heuristic'] },
  RETRIEVAL_MAX_TURNS:           { group: 'retrieval', type: 'int', def: 6, min: 1, max: 20 },
  RETRIEVAL_MAX_TOOL_CALLS:      { group: 'retrieval', type: 'int', def: 10, min: 1, max: 60 },
  RETRIEVAL_MAX_LLM_CALLS:       { group: 'retrieval', type: 'int', def: 2, min: 0, max: 10 },
  RETRIEVAL_MAX_EVIDENCE_CHARS:  { group: 'retrieval', type: 'int', def: 24000, min: 1000, max: 200000 },
  RETRIEVAL_DEADLINE_MS:         { group: 'retrieval', type: 'int', def: 45000, min: 1000, max: 300000 },
  RETRIEVAL_TOP_K:               { group: 'retrieval', type: 'int', def: 8, min: 1, max: 50 },
  RETRIEVAL_CANDIDATE_POOL:      { group: 'retrieval', type: 'int', def: 40, min: 1, max: 500 },
  RETRIEVAL_FINAL_K:             { group: 'retrieval', type: 'int', def: 6, min: 1, max: 30 },
  RETRIEVAL_NEIGHBOUR_WINDOW:    { group: 'retrieval', type: 'int', def: 1, min: 0, max: 3 },
  TOOL_SNIPPET_CHARS:            { group: 'retrieval', type: 'int', def: 320, min: 80, max: 2000 },
  READ_PASSAGE_MAX_CHARS:        { group: 'retrieval', type: 'int', def: 3000, min: 200, max: 20000 },

  // ── ranking / fusion ─────────────────────────────────────────────────
  RANK_W_DENSE:           { group: 'ranking', type: 'float', def: 0.5, min: 0, max: 1 },
  RANK_W_REF:             { group: 'ranking', type: 'float', def: 0.3, min: 0, max: 1 },
  RANK_W_EXACT:           { group: 'ranking', type: 'float', def: 0.2, min: 0, max: 1 },
  RANK_PENALTY_WEB:       { group: 'ranking', type: 'float', def: 0.10, min: 0, max: 1 },
  RANK_PENALTY_NEIGHBOUR: { group: 'ranking', type: 'float', def: 0.05, min: 0, max: 1 },
  RANK_NEAR_DUP_JACCARD:  { group: 'ranking', type: 'float', def: 0.90, min: 0, max: 1 },

  // ── retrieval sufficiency ────────────────────────────────────────────
  SUFFICIENCY_MIN_TERM_COVERAGE: { group: 'sufficiency', type: 'float', def: 0.60, min: 0, max: 1 },
  SUFFICIENCY_MIN_TOP_SCORE:     { group: 'sufficiency', type: 'float', def: 0.55, min: 0, max: 1 },
  SUFFICIENCY_MIN_CHUNK_SCORE:   { group: 'sufficiency', type: 'float', def: 0.40, min: 0, max: 1 },
  SUFFICIENCY_MIN_CHUNKS:        { group: 'sufficiency', type: 'int',   def: 2, min: 1, max: 20 },
  SUFFICIENCY_MIN_TURNS:         { group: 'sufficiency', type: 'int',   def: 2, min: 1, max: 6 },

  // ── live search ──────────────────────────────────────────────────────
  LIVE_SEARCH_ENABLED:              { group: 'web', type: 'bool',  def: true },
  WEB_MIN_CORPUS_TURNS:             { group: 'web', type: 'int',   def: 2, min: 1, max: 10 },
  WEB_ESCALATE_MAX_TOP_SCORE:       { group: 'web', type: 'float', def: 0.45, min: 0, max: 1 },
  WEB_MAX_CALLS:                    { group: 'web', type: 'int',   def: 1, min: 0, max: 5 },
  WEB_FETCH_TIMEOUT_MS:             { group: 'web', type: 'int',   def: 10000, min: 500, max: 60000 },
  WEB_FETCH_MAX_BYTES:              { group: 'web', type: 'int',   def: 1500000, min: 10000, max: 20000000 },
  WEB_ALLOW_UNFETCHABLE_AS_EVIDENCE:{ group: 'web', type: 'bool',  def: false },

  // ── claims ───────────────────────────────────────────────────────────
  MAX_SUBCLAIMS:          { group: 'claims', type: 'int',  def: 2, min: 1, max: 10 },
  IMAGE_CONFIRM_REQUIRED: { group: 'claims', type: 'bool', def: true },
  IMAGE_MAX_BYTES:        { group: 'claims', type: 'int',  def: 6000000, min: 10000, max: 20000000 },
  FILE_MAX_BYTES:         { group: 'claims', type: 'int',  def: 8000000, min: 10000, max: 40000000 },
  FILE_ALLOWED_MIME:      { group: 'claims', type: 'csv',  def: 'text/plain,text/markdown,application/json,image/png,image/jpeg,image/webp' },

  // ── citation verification ────────────────────────────────────────────
  CITATION_FUZZY_VERIFY:     { group: 'citation', type: 'float', def: 0.95, min: 0, max: 1 },
  CITATION_FUZZY_PARTIAL:    { group: 'citation', type: 'float', def: 0.75, min: 0, max: 1 },
  CITATION_JACCARD_PREFILTER:{ group: 'citation', type: 'float', def: 0.50, min: 0, max: 1 },
  CITATION_MIN_QUOTE_CHARS:  { group: 'citation', type: 'int',   def: 40, min: 0, max: 500 },
  CITATION_MAX_QUOTE_CHARS:  { group: 'citation', type: 'int',   def: 600, min: 50, max: 5000 },
  CITATION_WINDOW_SLACK:     { group: 'citation', type: 'float', def: 0.20, min: 0, max: 1 },
  CITATION_MAX_RETRIES:      { group: 'citation', type: 'int',   def: 1, min: 0, max: 1, clampMax: 1 },
  CITATION_NUMBER_GUARD:     { group: 'citation', type: 'bool',  def: true },
  CITATION_NEGATION_GUARD:   { group: 'citation', type: 'bool',  def: true },

  // ── verdict ──────────────────────────────────────────────────────────
  VERDICT_WEIGHT_VERIFIED:  { group: 'verdict', type: 'float', def: 1.0, min: 0, max: 1 },
  VERDICT_WEIGHT_PARTIAL:   { group: 'verdict', type: 'float', def: 0.5, min: 0, max: 1 },
  VERDICT_MIN_EVIDENCE:     { group: 'verdict', type: 'float', def: 1.0, min: 0, max: 10 },
  VERDICT_COVERAGE_FULL:    { group: 'verdict', type: 'float', def: 0.75, min: 0, max: 1 },
  VERDICT_REQUIRE_MISSING_CONDITION_QUOTE: { group: 'verdict', type: 'bool', def: true },
  AGGREGATION_MODE:         { group: 'verdict', type: 'enum',  def: 'strictest', values: ['strictest'] },

  // ── jobs / trace ─────────────────────────────────────────────────────
  JOB_RING_SIZE:          { group: 'jobs', type: 'int',    def: 200, min: 10, max: 5000 },
  JOB_TTL_MS:             { group: 'jobs', type: 'int',    def: 3600000, min: 60000, max: 86400000 },
  JOB_CONFIRM_TIMEOUT_MS: { group: 'jobs', type: 'int',    def: 600000, min: 10000, max: 3600000 },
  JOB_CONCURRENCY:        { group: 'jobs', type: 'int',    def: 2, min: 1, max: 16 },
  TRACE_MAX_DETAIL_CHARS: { group: 'jobs', type: 'int',    def: 4000, min: 200, max: 100000 },
  TRACE_SSE_ENABLED:      { group: 'jobs', type: 'bool',   def: true },
  TRACE_SSE_HEARTBEAT_MS: { group: 'jobs', type: 'int',    def: 15000, min: 1000, max: 120000 },
  RUN_LOG_ENABLED:        { group: 'jobs', type: 'bool',   def: true },
  RUN_LOG_DIR:            { group: 'jobs', type: 'string', def: './data/runs' },
  REPLAY_ENABLED:         { group: 'jobs', type: 'bool',   def: true },
};

/** Groups in the order the dashboard Config view should render them. */
export const GROUP_ORDER = [
  'server', 'gemini', 'chroma', 'corpus', 'retrieval', 'ranking',
  'sufficiency', 'web', 'claims', 'citation', 'verdict', 'jobs',
];
