/**
 * English stopwords plus legal-boilerplate words.
 *
 * The legal set matters: "section", "act", "shall" and "provided" appear in
 * essentially every chunk of the corpus, so their IDF is near zero and they
 * are useless as distinguishing keyword-search terms. Removing them up front
 * keeps `idf.js` from having to learn that on a 60-chunk corpus.
 */
export const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'by', 'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'me', 'more',
  'most', 'my', 'nor', 'of', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
  'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours',
  // legal boilerplate — present in nearly every chunk, therefore uninformative
  'section', 'sections', 'sub', 'subsection', 'clause', 'act', 'shall', 'may', 'said',
  'provided', 'hereby', 'thereof', 'therein', 'thereto', 'whoever', 'person', 'persons',
  'india', 'indian', 'state', 'law', 'court', 'case', 'means', 'includes', 'respect',
]);

/**
 * Words whose presence or absence changes a legal proposition. These are
 * never treated as stopwords and are counted by the citation negation guard.
 */
export const NEGATION_WORDS = [
  'not', 'no', 'nor', 'never', 'unless', 'except', 'save', 'without', 'neither',
];

/** Qualifier markers used by the Misleading Context deterministic door. */
export const QUALIFIER_RE =
  /\b(unless|except|provided that|save as|save that|subject to|shall not apply|other than|only if|notwithstanding|no obligation|does not (?:apply|extend)|nothing in this)\b/i;
