/**
 * ============================================================
 * VIRTUAL FASHION ADVISOR — RECOMMENDATION ENGINE v2.0
 * ============================================================
 *
 * SCORING ARCHITECTURE (total: 100 points per outfit)
 * ─────────────────────────────────────────────────────────────
 *  50pts  →  SWIPE BEHAVIOR     (what the user has liked/disliked)
 *  30pts  →  BODY SUITABILITY   (quiz: body type, occasion, fit)
 *  20pts  →  TREND SCORE        (community engagement + recency)
 *
 * PENALTY SYSTEM (subtractive, applied after scoring)
 * ─────────────────────────────────────────────────────────────
 *  -25pts  →  Disliked category   (user has consistently disliked this)
 *  -15pts  →  Disliked color      (dominant color in disliked outfits)
 *  -10pts  →  Wrong season        (outfit season ≠ current season)
 *   -5pts  →  Overexposed item    (user has seen similar outfits >10x)
 *
 * OUTPUT: scored + penalized → sorted DESC → top N returned
 * ============================================================
 */

const db = require('../config/db');

// ─────────────────────────────────────────────────────────────
// CONSTANTS & CONFIG
// ─────────────────────────────────────────────────────────────

const WEIGHTS = {
  SWIPE_BEHAVIOR   : 0.50,
  BODY_SUITABILITY : 0.30,
  TREND_SCORE      : 0.20,
};

const MAX_POINTS = {
  SWIPE : 50,
  BODY  : 30,
  TREND : 20,
};

const PENALTIES = {
  DISLIKED_CATEGORY : -25,
  DISLIKED_COLOR    : -15,
  WRONG_SEASON      : -10,
  OVEREXPOSED       : -5,
};

// Minimum dislikes before a category/color penalty triggers
const DISLIKE_THRESHOLD = 3;

// Contribution of each matching tag to similarity score
const TAG_SIMILARITY_WEIGHT = 0.15; // per shared tag, max sum = 1.0

// Body type → sub_category/article_type affinity [0–1]
const BODY_STYLE_AFFINITY = {
  hourglass         : { Dress: 1.0, Jumpsuit: 0.9, Tops: 0.8, Jeans: 0.8, Skirts: 0.9 },
  rectangle         : { Streetwear: 1.0, Layering: 0.9, Tops: 0.8, 'Wide-leg': 0.8 },
  pear              : { 'A-Line': 1.0, Flared: 0.9, Blouse: 0.9, Skirts: 0.8 },
  apple             : { 'Empire Waist': 1.0, Tunic: 0.9, Wrap: 0.9, Dress: 0.7 },
  inverted_triangle : { 'Wide-leg': 1.0, Flared: 0.9, Bootcut: 0.8, Skirts: 0.9 },
};

// Quiz primary_context → outfit occasion scoring
const OCCASION_FIT = {
  office  : { Formal: 1.0, 'Smart Casual': 0.8, Casual: 0.3 },
  casual  : { Casual: 1.0, 'Smart Casual': 0.8, Sports: 0.6, Formal: 0.2 },
  party   : { Party: 1.0, Formal: 0.8, 'Smart Casual': 0.5 },
  sports  : { Sports: 1.0, Casual: 0.7 },
  date    : { Party: 0.9, 'Smart Casual': 1.0, Formal: 0.7 },
  travel  : { Casual: 1.0, Sports: 0.8 },
};

// Current season detection (Northern Hemisphere)
const getCurrentSeason = () => {
  const month = new Date().getMonth() + 1;
  if (month >= 3  && month <= 5)  return 'spring';
  if (month >= 6  && month <= 8)  return 'summer';
  if (month >= 9  && month <= 11) return 'fall';
  return 'winter';
};

// ─────────────────────────────────────────────────────────────
// SECTION A: SWIPE BEHAVIOR SCORING  (50 points)
// ─────────────────────────────────────────────────────────────

/**
 * buildSwipeProfile
 * ─────────────────
 * Converts raw swipe history rows into structured frequency maps.
 *
 * Each swipe row must have: action, category, color_family, style, tags[]
 *
 * Outputs:
 *  likedCategories    { category → like_count }
 *  dislikedCategories { category → dislike_count }
 *  likedColors        { color_family → like_count }
 *  dislikedColors     { color_family → dislike_count }
 *  likedStyles        { style → like_count }
 *  likedTags          { tag_name → like_count }
 *  seenCategories     { category → total_seen }  — for overexposure check
 *
 * @param {Array} swipeHistory
 * @returns {Object} swipeProfile
 */
const buildSwipeProfile = (swipeHistory) => {
  const profile = {
    likedCategories   : {},
    dislikedCategories: {},
    likedColors       : {},
    dislikedColors    : {},
    likedStyles       : {},
    dislikedStyles    : {},
    likedTags         : {},
    dislikedTags      : {},
    seenCategories    : {},
    totalLikes        : 0,
    totalDislikes     : 0,
  };

  for (const swipe of swipeHistory) {
    const { action, category, color_family, style, tags = [] } = swipe;
    const isLike    = action === 'like';
    const isDislike = action === 'dislike';

    // Track every seen category regardless of action (for overexposure)
    profile.seenCategories[category] = (profile.seenCategories[category] || 0) + 1;

    if (isLike) {
      profile.totalLikes++;
      profile.likedCategories[category] = (profile.likedCategories[category] || 0) + 1;
      profile.likedColors[color_family] = (profile.likedColors[color_family] || 0) + 1;
      profile.likedStyles[style]        = (profile.likedStyles[style]         || 0) + 1;
      for (const tag of tags) {
        profile.likedTags[tag] = (profile.likedTags[tag] || 0) + 1;
      }
    } else if (isDislike) {
      profile.totalDislikes++;
      profile.dislikedCategories[category] = (profile.dislikedCategories[category] || 0) + 1;
      profile.dislikedColors[color_family] = (profile.dislikedColors[color_family] || 0) + 1;
      profile.dislikedStyles[style]        = (profile.dislikedStyles[style]         || 0) + 1;
      for (const tag of tags) {
        profile.dislikedTags[tag] = (profile.dislikedTags[tag] || 0) + 1;
      }
    }
  }

  return profile;
};

/**
 * scoreSwipeBehavior
 * ──────────────────
 * Scores an outfit against user's learned preferences. (max 50pts)
 *
 * Sub-components:
 *   18pts — Category affinity
 *           Ratio of how often user liked THIS category vs their most-liked one.
 *           Ex: if user liked "Dress" 8x and liked "Tops" 4x, max = 8.
 *           Dress → 18pts, Tops → 9pts.
 *
 *   14pts — Color affinity
 *           Same ratio logic applied to color_family.
 *
 *   12pts — Tag similarity (Jaccard-inspired)
 *           Counts how many of the outfit's tags appear in liked tags.
 *           Each hit adds TAG_SIMILARITY_WEIGHT (0.15), capped at 1.0.
 *           Normalized by total liked-tag signal to avoid tag-spam bias.
 *
 *    6pts — Style affinity
 *           Ratio of liked-style match.
 *
 * @param {Object} outfit
 * @param {Object} swipeProfile
 * @returns {number} [0, 50]
 */
const scoreSwipeBehavior = (outfit, swipeProfile) => {
  const { category, color_family, style, tags = [] } = outfit;

  // Category affinity ─────────────────────────────────────────
  const maxCategoryLikes = Math.max(...Object.values(swipeProfile.likedCategories), 1);
  const categoryLikes    = swipeProfile.likedCategories[category] || 0;
  const categoryScore    = (categoryLikes / maxCategoryLikes) * 18;

  // Color affinity ────────────────────────────────────────────
  const maxColorLikes = Math.max(...Object.values(swipeProfile.likedColors), 1);
  const colorLikes    = swipeProfile.likedColors[color_family] || 0;
  const colorScore    = (colorLikes / maxColorLikes) * 14;

  // Tag similarity ────────────────────────────────────────────
  const totalLikedTagSignal = Object.values(swipeProfile.likedTags)
    .reduce((a, b) => a + b, 0) || 1;

  let tagRatio = 0;
  for (const tag of tags) {
    const tagLikes = swipeProfile.likedTags[tag] || 0;
    tagRatio += (tagLikes / totalLikedTagSignal) * TAG_SIMILARITY_WEIGHT;
  }
  const tagScore = Math.min(tagRatio, 1.0) * 12;

  // Style affinity ────────────────────────────────────────────
  const maxStyleLikes = Math.max(...Object.values(swipeProfile.likedStyles), 1);
  const styleLikes    = swipeProfile.likedStyles[style] || 0;
  const styleScore    = (styleLikes / maxStyleLikes) * 6;

  return Math.min(
    Math.round((categoryScore + colorScore + tagScore + styleScore) * 100) / 100,
    MAX_POINTS.SWIPE
  );
};

// ─────────────────────────────────────────────────────────────
// SECTION B: BODY SUITABILITY SCORING  (30 points)
// ─────────────────────────────────────────────────────────────

/**
 * parseQuizProfile
 * ────────────────
 * Normalizes a quiz_responses row into a clean profile object.
 * Returns null if no quiz has been taken.
 *
 * @param {Object|null} quizRow
 * @returns {Object|null}
 */
const parseQuizProfile = (quizRow) => {
  if (!quizRow) return null;
  const answers = quizRow.answers || {};
  return {
    bodyType        : answers.body_type || null,
    primaryOccasion : answers.primary_context || null,
    styleArchetype  : quizRow.computed_archetype || null,
    styleScores     : quizRow.style_scores || {},
  };
};

/**
 * scoreBodySuitability
 * ─────────────────────
 * Scores how well an outfit suits the user's body type and lifestyle. (max 30pts)
 *
 * If no quiz data → returns 15pts (neutral) so swipe signal dominates.
 *
 * Sub-components:
 *   12pts — Body type fit
 *           Looks up BODY_STYLE_AFFINITY[bodyType][sub_category].
 *           Affinity is [0,1]; multiplied by 12.
 *           Falls back to partial string match, then neutral 6pts.
 *
 *   10pts — Occasion alignment
 *           Maps quiz primary_context to outfit occasion via OCCASION_FIT.
 *           Fit value [0,1] × 10pts.
 *
 *    8pts — Style archetype match
 *           Blends direct archetype match (60%) with style_scores distribution
 *           score (40%). Rewards adjacent styles for well-rounded users.
 *
 * @param {Object}      outfit
 * @param {Object|null} quizProfile
 * @returns {number} [0, 30]
 */
const scoreBodySuitability = (outfit, quizProfile) => {
  if (!quizProfile) return 15; // cold start: neutral half-score

  const { bodyType, primaryOccasion, styleArchetype, styleScores } = quizProfile;

  // Body type → article fit ───────────────────────────────────
  let bodyScore = 6; // neutral
  if (bodyType && BODY_STYLE_AFFINITY[bodyType]) {
    const affinityMap = BODY_STYLE_AFFINITY[bodyType];
    const subCat      = outfit.sub_category || outfit.category || '';
    const articleType = outfit.article_type || '';

    // Direct match first
    const directAffinity = affinityMap[subCat] ?? affinityMap[articleType];
    if (directAffinity !== undefined) {
      bodyScore = directAffinity * 12;
    } else {
      // Partial: find any affinity key that is a substring of article/sub_cat
      const partialKey = Object.keys(affinityMap).find(
        (k) =>
          articleType.toLowerCase().includes(k.toLowerCase()) ||
          subCat.toLowerCase().includes(k.toLowerCase())
      );
      bodyScore = partialKey ? affinityMap[partialKey] * 12 : 6;
    }
  }

  // Occasion alignment ────────────────────────────────────────
  let occasionScore = 5;
  if (primaryOccasion && OCCASION_FIT[primaryOccasion]) {
    const fitMap = OCCASION_FIT[primaryOccasion];
    occasionScore = (fitMap[outfit.occasion] || 0.2) * 10;
  }

  // Style archetype match ─────────────────────────────────────
  let styleScore = 4;
  if (styleArchetype && outfit.style) {
    const isDirectMatch     = outfit.style === styleArchetype;
    const distributionMatch = styleScores[outfit.style] || 0;
    // 60% weight on direct match, 40% on distribution to reward adjacent styles
    styleScore = isDirectMatch
      ? (0.6 + distributionMatch * 0.4) * 8
      : distributionMatch * 8 * 0.4;
  }

  return Math.min(
    Math.round((bodyScore + occasionScore + styleScore) * 100) / 100,
    MAX_POINTS.BODY
  );
};

// ─────────────────────────────────────────────────────────────
// SECTION C: TREND SCORE  (20 points)
// ─────────────────────────────────────────────────────────────

/**
 * scoreTrend
 * ──────────
 * Rewards outfits with strong community engagement and freshness. (max 20pts)
 *
 * Sub-components:
 *   10pts — Community like rate
 *           Global like_count / swipe_count, normalized against p90 like rate.
 *           Items with < 5 swipes get neutral 5pts (avoid cold-start bias).
 *
 *    6pts — Recency decay
 *           Linear decay from 6pts (< 3 days old) to 0pts (> 90 days old).
 *           Ensures fresh catalog items surface.
 *
 *    4pts — Save momentum
 *           log10(saves + 1) / log10(100) × 4.
 *           Logarithmic scale prevents viral items from dominating.
 *
 * trendBaselines is pre-computed from the outfits table aggregate:
 *   { avgLikeRate, p90LikeRate }
 *
 * @param {Object} outfit
 * @param {Object} trendBaselines
 * @returns {number} [0, 20]
 */
const scoreTrend = (outfit, trendBaselines) => {
  const { p90LikeRate = 0.75 } = trendBaselines;

  const swipeCount = parseInt(outfit.swipe_count) || 0;
  const likeCount  = parseInt(outfit.like_count)  || 0;
  const saveCount  = parseInt(outfit.save_count)  || 0;

  // Community like rate ───────────────────────────────────────
  let communityScore;
  if (swipeCount < 5) {
    communityScore = 5; // not enough signal → neutral
  } else {
    const likeRate   = likeCount / swipeCount;
    const normalized = Math.min(likeRate / p90LikeRate, 1.0);
    communityScore   = normalized * 10;
  }

  // Recency decay ─────────────────────────────────────────────
  const ageDays = (Date.now() - new Date(outfit.created_at).getTime())
    / (1000 * 60 * 60 * 24);
  let recencyScore;
  if      (ageDays <= 3)  recencyScore = 6;
  else if (ageDays <= 7)  recencyScore = 5;
  else if (ageDays <= 14) recencyScore = 4;
  else if (ageDays <= 30) recencyScore = 3;
  else if (ageDays <= 60) recencyScore = 1.5;
  else if (ageDays <= 90) recencyScore = 0.5;
  else                    recencyScore = 0;

  // Save momentum (log scale) ─────────────────────────────────
  const saveMomentum = Math.min(
    (Math.log10(saveCount + 1) / Math.log10(100)) * 4,
    4
  );

  return Math.min(
    Math.round((communityScore + recencyScore + saveMomentum) * 100) / 100,
    MAX_POINTS.TREND
  );
};

// ─────────────────────────────────────────────────────────────
// SECTION D: PENALTY COMPUTATION
// ─────────────────────────────────────────────────────────────

/**
 * computePenalties
 * ─────────────────
 * Applies contextual deductions after the base score is computed.
 *
 * Penalty triggers:
 *
 *  1. Disliked category: user has disliked this category ≥ DISLIKE_THRESHOLD times.
 *     Penalty scales up with more dislikes (capped at -25pts).
 *
 *  2. Disliked color: same scaling logic for color_family.
 *
 *  3. Season mismatch: outfit is seasonally wrong for the current calendar month.
 *     Outfits tagged 'all' are never penalized.
 *
 *  4. Overexposure: user has seen this category many times but rarely liked it.
 *     Threshold: seen > 10 AND like_rate < 20%.
 *
 * Returns { penalty: number ≤ 0, reasons: string[] }
 *
 * @param {Object} outfit
 * @param {Object} swipeProfile
 * @param {string} currentSeason
 * @returns {{ penalty: number, reasons: string[] }}
 */
const computePenalties = (outfit, swipeProfile, currentSeason) => {
  let penalty = 0;
  const reasons = [];

  // Disliked category ─────────────────────────────────────────
  const catDislikes = swipeProfile.dislikedCategories[outfit.category] || 0;
  if (catDislikes >= DISLIKE_THRESHOLD) {
    const scaled = Math.min(
      (catDislikes / (DISLIKE_THRESHOLD * 2)) * PENALTIES.DISLIKED_CATEGORY,
      PENALTIES.DISLIKED_CATEGORY
    );
    penalty += scaled;
    reasons.push(`disliked_category:${outfit.category}(${catDislikes}x)`);
  }

  // Disliked color ────────────────────────────────────────────
  const colorDislikes = swipeProfile.dislikedColors[outfit.color_family] || 0;
  if (colorDislikes >= DISLIKE_THRESHOLD) {
    const scaled = Math.min(
      (colorDislikes / (DISLIKE_THRESHOLD * 2)) * PENALTIES.DISLIKED_COLOR,
      PENALTIES.DISLIKED_COLOR
    );
    penalty += scaled;
    reasons.push(`disliked_color:${outfit.color_family}(${colorDislikes}x)`);
  }

  // Season mismatch ───────────────────────────────────────────
  if (outfit.season !== 'all' && outfit.season !== currentSeason) {
    penalty += PENALTIES.WRONG_SEASON;
    reasons.push(`wrong_season:${outfit.season}≠${currentSeason}`);
  }

  // Overexposure ──────────────────────────────────────────────
  const timesSeen  = swipeProfile.seenCategories[outfit.category] || 0;
  const timesLiked = swipeProfile.likedCategories[outfit.category] || 0;
  if (timesSeen > 10 && timesLiked / timesSeen < 0.2) {
    penalty += PENALTIES.OVEREXPOSED;
    reasons.push(`overexposed:${outfit.category}(${timesLiked}liked/${timesSeen}seen)`);
  }

  return { penalty: Math.round(penalty * 100) / 100, reasons };
};

// ─────────────────────────────────────────────────────────────
// SECTION E: DATABASE LOADERS
// ─────────────────────────────────────────────────────────────

const loadUserProfile = async (userId) => {
  const { rows } = await db.query(
    `SELECT id, gender, body_type, style_archetype FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
};

const loadUserSwipeHistory = async (userId) => {
  const { rows } = await db.query(`
    SELECT
      s.action, s.duration_ms, s.swiped_at,
      o.id AS outfit_id,
      o.category, o.sub_category, o.article_type,
      o.style, o.occasion, o.color_family, o.season,
      COALESCE(array_agg(t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
    FROM swipes s
    JOIN outfits o    ON o.id = s.outfit_id
    LEFT JOIN outfit_tags ot ON ot.outfit_id = o.id
    LEFT JOIN tags t  ON t.id = ot.tag_id
    WHERE s.user_id = $1
    GROUP BY s.action, s.duration_ms, s.swiped_at,
             o.id, o.category, o.sub_category, o.article_type,
             o.style, o.occasion, o.color_family, o.season
    ORDER BY s.swiped_at DESC
    LIMIT 500
  `, [userId]);
  return rows;
};

const loadLatestQuiz = async (userId) => {
  const { rows } = await db.query(`
    SELECT answers, computed_archetype, style_scores
    FROM quiz_responses
    WHERE user_id = $1
    ORDER BY taken_at DESC LIMIT 1
  `, [userId]);
  return rows[0] || null;
};

const loadCandidateOutfits = async (userId, { gender, occasion, limit = 300 }) => {
  const params      = [gender, userId];
  const extraFilter = [];

  if (occasion) {
    params.push(occasion);
    extraFilter.push(`AND LOWER(o.occasion) = LOWER($${params.length})`);
  }

  const { rows } = await db.query(`
    SELECT
      o.id, o.source_id, o.image_path, o.image_url,
      o.category, o.sub_category, o.article_type,
      o.style, o.occasion, o.season, o.gender_target,
      o.base_color, o.color_family, o.colors,
      o.avg_rating, o.swipe_count, o.like_count, o.save_count,
      o.created_at,
      COALESCE(array_agg(t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
    FROM outfits o
    LEFT JOIN outfit_tags ot ON ot.outfit_id = o.id
    LEFT JOIN tags t          ON t.id = ot.tag_id
    WHERE o.gender_target IN ($1, 'unisex')
      AND o.id NOT IN (SELECT outfit_id FROM swipes WHERE user_id = $2)
      ${extraFilter.join(' ')}
    GROUP BY o.id
    ORDER BY o.avg_rating DESC, RANDOM()
    LIMIT ${limit}
  `, params);
  return rows;
};

const loadTrendBaselines = async () => {
  const { rows } = await db.query(`
    SELECT
      AVG(like_count::float / NULLIF(swipe_count,0))     AS avg_like_rate,
      PERCENTILE_CONT(0.90) WITHIN GROUP (
        ORDER BY like_count::float / NULLIF(swipe_count,0)
      )                                                   AS p90_like_rate
    FROM outfits WHERE swipe_count >= 5
  `);
  return {
    avgLikeRate : parseFloat(rows[0]?.avg_like_rate) || 0.5,
    p90LikeRate : parseFloat(rows[0]?.p90_like_rate) || 0.75,
  };
};

// ─────────────────────────────────────────────────────────────
// SECTION F: DIVERSITY FILTER
// ─────────────────────────────────────────────────────────────

/**
 * diversifyResults
 * ─────────────────
 * Prevents the top-N list from being dominated by one category.
 *
 * Strategy: sliding window capping.
 * Walk the sorted list. Once a category has appeared maxPerCategory
 * times, push subsequent matches to overflow. Fill from overflow
 * once the primary list is exhausted (or at the end).
 *
 * This ensures users see a variety of categories even if their
 * strongest signal is for a single one (e.g. all Dresses).
 *
 * @param {Array}  scored
 * @param {number} maxPerCategory
 * @param {number} limit
 * @returns {Array}
 */
const diversifyResults = (scored, maxPerCategory = 4, limit = 20) => {
  const categoryCounts = {};
  const primary  = [];
  const overflow = [];

  for (const item of scored) {
    const count = categoryCounts[item.category] || 0;
    if (count < maxPerCategory) {
      primary.push(item);
      categoryCounts[item.category] = count + 1;
    } else {
      overflow.push(item);
    }
    if (primary.length >= limit) break;
  }

  // If primary fell short of limit, fill from overflow (still sorted)
  return [...primary, ...overflow].slice(0, limit);
};

// ─────────────────────────────────────────────────────────────
// SECTION G: MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────

/**
 * getRecommendations
 * ───────────────────
 * Full pipeline:
 *  Load data → Build profiles → Score candidates →
 *  Apply penalties → Sort → Diversify → Return
 *
 * @param {string} userId
 * @param {object} options
 *   @param {number}  options.limit          - recs to return (default 20)
 *   @param {string}  options.occasion       - optional occasion filter
 *   @param {number}  options.maxPerCategory - diversity cap (default 4)
 *   @param {boolean} options.debug          - include per-outfit score breakdown
 *
 * @returns {object} { success, user, recommendations, meta }
 */
const getRecommendations = async (userId, options = {}) => {
  const {
    limit          = 20,
    occasion       = null,
    maxPerCategory = 4,
    debug          = false,
  } = options;

  const startTime     = Date.now();
  const currentSeason = getCurrentSeason();

  // ── Step 1: Load all data in parallel ─────────────────────
  const [user, swipeHistory, quizRow, trendBaselines] = await Promise.all([
    loadUserProfile(userId),
    loadUserSwipeHistory(userId),
    loadLatestQuiz(userId),
    loadTrendBaselines(),
  ]);

  if (!user) throw new Error(`User ${userId} not found`);

  // ── Step 2: Build profiles ─────────────────────────────────
  const swipeProfile = buildSwipeProfile(swipeHistory);
  const quizProfile  = parseQuizProfile(quizRow);

  // ── Step 3: Load unseen candidate outfits ──────────────────
  const candidates = await loadCandidateOutfits(userId, {
    gender : user.gender || 'unisex',
    occasion,
  });

  // ── Step 4: Score every candidate ─────────────────────────
  const scored = candidates.map((outfit) => {

    // A. Swipe behavior score [0–50]
    //    Cold start (no history) → neutral 25pts
    const swipeScore = swipeHistory.length === 0
      ? MAX_POINTS.SWIPE * 0.5
      : scoreSwipeBehavior(outfit, swipeProfile);

    // B. Body suitability score [0–30]
    //    No quiz → neutral 15pts
    const bodyScore = scoreBodySuitability(outfit, quizProfile);

    // C. Trend score [0–20]
    const trendScore = scoreTrend(outfit, trendBaselines);

    // D. Raw total before penalties
    const rawTotal = swipeScore + bodyScore + trendScore;

    // E. Compute and apply penalties
    const { penalty, reasons: penaltyReasons } = computePenalties(
      outfit,
      swipeProfile,
      currentSeason
    );

    // F. Final score floored at 0 — never go negative
    const finalScore = Math.max(0, rawTotal + penalty);

    return {
      ...outfit,
      _score: Math.round(finalScore * 100) / 100,
      // Scoring breakdown — only in debug mode to keep responses lean
      ...(debug && {
        _breakdown: {
          swipe_score    : Math.round(swipeScore  * 100) / 100,
          body_score     : Math.round(bodyScore   * 100) / 100,
          trend_score    : Math.round(trendScore  * 100) / 100,
          raw_total      : Math.round(rawTotal    * 100) / 100,
          penalty        : Math.round(penalty     * 100) / 100,
          final_score    : Math.round(finalScore  * 100) / 100,
          penalty_reasons: penaltyReasons,
        },
      }),
    };
  });

  // ── Step 5: Sort descending by final score ─────────────────
  scored.sort((a, b) => b._score - a._score);

  // ── Step 6: Diversify — cap per-category in top-N ─────────
  const recommendations = diversifyResults(scored, maxPerCategory, limit);

  // ── Step 7: Return structured response ────────────────────
  return {
    success: true,
    user: {
      id             : userId,
      gender         : user.gender,
      style_archetype: user.style_archetype || quizProfile?.styleArchetype || null,
      has_quiz       : !!quizRow,
      swipes_recorded: swipeHistory.length,
      // Signal quality drives frontend UX messaging
      signal_quality : swipeHistory.length < 5  ? 'cold_start'
                     : swipeHistory.length < 20 ? 'warming'
                     : 'good',
    },
    recommendations,
    meta: {
      candidates_scored : candidates.length,
      returned          : recommendations.length,
      current_season    : currentSeason,
      engine_version    : '2.0.0',
      weights           : WEIGHTS,
      elapsed_ms        : Date.now() - startTime,
    },
  };
};

module.exports = {
  getRecommendations,
  // Named exports for unit testing individual scoring functions
  buildSwipeProfile,
  parseQuizProfile,
  scoreSwipeBehavior,
  scoreBodySuitability,
  scoreTrend,
  computePenalties,
  diversifyResults,
};
