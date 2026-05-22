/**
 * Quiz Scoring Engine
 *
 * Maps raw quiz answers → style_scores distribution → computed_archetype.
 * Each question answer contributes weighted points to style dimensions.
 *
 * Question IDs match the frontend quiz payload keys.
 */

const STYLE_ARCHETYPES = [
  'casual', 'formal', 'bohemian', 'sporty', 'minimalist',
  'streetwear', 'preppy', 'romantic', 'edgy', 'classic',
];

// Maps answer values to style score deltas
// Format: { [questionId]: { [answerValue]: { [style]: delta } } }
const SCORING_MAP = {
  // "What's your go-to weekend outfit?"
  weekend_outfit: {
    jeans_tee        : { casual: 3, streetwear: 2 },
    dress_sandals    : { romantic: 3, casual: 1 },
    tracksuit        : { sporty: 4 },
    tailored_trousers: { classic: 3, formal: 2 },
    flowy_skirt      : { bohemian: 4 },
    monochrome       : { minimalist: 4, classic: 1 },
  },
  // "Which color palette appeals most?"
  color_palette: {
    neutrals        : { minimalist: 3, classic: 2 },
    bold_bright     : { streetwear: 3, edgy: 2 },
    earth_tones     : { bohemian: 4 },
    pastels         : { romantic: 4, preppy: 1 },
    dark_moody      : { edgy: 4 },
    classic_bw      : { classic: 3, formal: 2 },
  },
  // "Where do you wear most of your outfits?"
  primary_context: {
    office          : { formal: 4, classic: 2 },
    outdoor_active  : { sporty: 4, casual: 1 },
    social_events   : { romantic: 2, formal: 2, preppy: 1 },
    everyday_errands: { casual: 4 },
    creative_spaces : { bohemian: 3, edgy: 2, streetwear: 1 },
    date_nights     : { romantic: 3, formal: 2 },
  },
  // "Which word describes your ideal style?"
  style_word: {
    effortless  : { casual: 3, minimalist: 2 },
    polished    : { formal: 3, classic: 3 },
    free_spirited: { bohemian: 4 },
    powerful    : { edgy: 3, formal: 2 },
    cool        : { streetwear: 4 },
    elegant     : { classic: 3, romantic: 2 },
    cozy        : { casual: 4, sporty: 1 },
    minimal     : { minimalist: 5 },
  },
  // "What's your relationship with trends?"
  trends: {
    always_first   : { streetwear: 3, edgy: 2 },
    selective      : { preppy: 2, classic: 2, minimalist: 1 },
    ignore_them    : { classic: 3, minimalist: 2, bohemian: 1 },
    vintage_revival: { bohemian: 3, romantic: 2, edgy: 1 },
  },
  // "Which accessory do you reach for?"
  accessories: {
    sneakers     : { streetwear: 3, sporty: 2, casual: 1 },
    heels        : { formal: 3, romantic: 2 },
    boots        : { edgy: 3, bohemian: 2 },
    loafers      : { preppy: 3, classic: 2 },
    sandals      : { bohemian: 3, casual: 2 },
    statement_bag: { streetwear: 2, edgy: 2, formal: 1 },
    minimal_watch: { minimalist: 4 },
  },
};

/**
 * Compute style scores from raw quiz answers.
 * @param {Object} answers - { questionId: answerValue }
 * @returns {{ styleScores: Object, computedArchetype: string }}
 */
const computeStyleProfile = (answers) => {
  // Initialize all archetypes at 0
  const raw = Object.fromEntries(STYLE_ARCHETYPES.map((s) => [s, 0]));

  for (const [questionId, answerValue] of Object.entries(answers)) {
    const questionMap = SCORING_MAP[questionId];
    if (!questionMap) continue; // unknown question — skip gracefully

    const deltas = questionMap[answerValue];
    if (!deltas) continue; // unknown answer value — skip

    for (const [style, delta] of Object.entries(deltas)) {
      if (raw[style] !== undefined) raw[style] += delta;
    }
  }

  // Normalize to [0, 1] distribution
  const total = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  const styleScores = {};
  for (const [style, score] of Object.entries(raw)) {
    styleScores[style] = Math.round((score / total) * 1000) / 1000;
  }

  // Pick the top archetype
  const computedArchetype = Object.entries(styleScores)
    .sort(([, a], [, b]) => b - a)[0][0];

  return { styleScores, computedArchetype };
};

/**
 * Derive preference vector seeds from quiz (before any swipe data exists).
 * Returns an array of { dimension, score } to upsert into user_preference_vectors.
 */
const deriveInitialVectors = (styleScores) => {
  return Object.entries(styleScores)
    .filter(([, score]) => score > 0.05)
    .map(([style, score]) => ({
      dimension: `style:${style}`,
      score    : parseFloat((score * 2 - 1).toFixed(4)), // map [0,1] to [-1,1]
    }));
};

module.exports = { computeStyleProfile, deriveInitialVectors, STYLE_ARCHETYPES };
