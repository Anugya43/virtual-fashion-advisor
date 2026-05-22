/**
 * Tests for the recommendation engine scoring functions.
 * Run: npm test
 */

const {
  buildSwipeProfile,
  scoreSwipeBehavior,
  scoreBodySuitability,
  scoreTrend,
  computePenalties,
  diversifyResults,
  parseQuizProfile,
} = require('../engine/recommender');

// ── Test fixtures ─────────────────────────────────────────────

const mockSwipeHistory = [
  { action: 'like',    category: 'Dress',   color_family: 'Blue',  style: 'casual',   tags: ['floral', 'summer'] },
  { action: 'like',    category: 'Dress',   color_family: 'Blue',  style: 'casual',   tags: ['wrap', 'midi'] },
  { action: 'like',    category: 'Tops',    color_family: 'White', style: 'minimalist', tags: ['linen'] },
  { action: 'dislike', category: 'Sportwear', color_family: 'Black', style: 'sporty', tags: ['polyester'] },
  { action: 'dislike', category: 'Sportwear', color_family: 'Black', style: 'sporty', tags: ['logo'] },
  { action: 'dislike', category: 'Sportwear', color_family: 'Black', style: 'sporty', tags: [] },
  { action: 'skip',    category: 'Jeans',   color_family: 'Blue',  style: 'casual',   tags: [] },
];

const mockOutfitLiked = {
  id: 'abc', category: 'Dress', sub_category: 'Midi Dress', article_type: 'Dress',
  style: 'casual', occasion: 'Casual', season: 'summer',
  color_family: 'Blue', base_color: 'Navy',
  avg_rating: 0.8, swipe_count: 50, like_count: 40, save_count: 20,
  created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days old
  tags: ['floral', 'midi'],
};

const mockOutfitDisliked = {
  id: 'def', category: 'Sportwear', sub_category: 'Tracksuit', article_type: 'Tracksuit',
  style: 'sporty', occasion: 'Sports', season: 'all',
  color_family: 'Black', base_color: 'Black',
  avg_rating: 0.3, swipe_count: 20, like_count: 6, save_count: 1,
  created_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
  tags: ['polyester'],
};

const mockQuizRow = {
  computed_archetype: 'casual',
  style_scores: { casual: 0.6, minimalist: 0.25, romantic: 0.1, sporty: 0.05 },
  answers: { body_type: 'hourglass', primary_context: 'casual', style_word: 'effortless' },
};

// ── Tests ─────────────────────────────────────────────────────

describe('buildSwipeProfile', () => {
  test('counts likes and dislikes correctly', () => {
    const profile = buildSwipeProfile(mockSwipeHistory);
    expect(profile.likedCategories['Dress']).toBe(2);
    expect(profile.dislikedCategories['Sportwear']).toBe(3);
    expect(profile.totalLikes).toBe(3);
    expect(profile.totalDislikes).toBe(3);
  });

  test('tracks liked tags', () => {
    const profile = buildSwipeProfile(mockSwipeHistory);
    expect(profile.likedTags['floral']).toBe(1);
    expect(profile.likedTags['midi']).toBe(1);
    expect(profile.likedTags['linen']).toBe(1);
  });

  test('tracks seen categories for overexposure', () => {
    const profile = buildSwipeProfile(mockSwipeHistory);
    expect(profile.seenCategories['Sportwear']).toBe(3);
    expect(profile.seenCategories['Dress']).toBe(2);
  });

  test('handles empty history', () => {
    const profile = buildSwipeProfile([]);
    expect(profile.totalLikes).toBe(0);
    expect(profile.totalDislikes).toBe(0);
  });
});

describe('scoreSwipeBehavior', () => {
  const profile = buildSwipeProfile(mockSwipeHistory);

  test('liked outfit scores higher than disliked outfit', () => {
    const likedScore    = scoreSwipeBehavior(mockOutfitLiked,    profile);
    const dislikedScore = scoreSwipeBehavior(mockOutfitDisliked, profile);
    expect(likedScore).toBeGreaterThan(dislikedScore);
  });

  test('score stays within [0, 50]', () => {
    const score = scoreSwipeBehavior(mockOutfitLiked, profile);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(50);
  });

  test('returns 0 for totally unknown outfit against empty profile', () => {
    const emptyProfile = buildSwipeProfile([]);
    const score = scoreSwipeBehavior(mockOutfitLiked, emptyProfile);
    // max-of-empty = 1 so all ratios = 0 → 0pts
    expect(score).toBe(0);
  });
});

describe('scoreBodySuitability', () => {
  const quizProfile = parseQuizProfile(mockQuizRow);

  test('returns neutral 15 when no quiz data', () => {
    const score = scoreBodySuitability(mockOutfitLiked, null);
    expect(score).toBe(15);
  });

  test('hourglass + Dress scores high', () => {
    const score = scoreBodySuitability(mockOutfitLiked, quizProfile);
    // Dress has 1.0 affinity for hourglass → 12pts body + occasion + style
    expect(score).toBeGreaterThan(20);
  });

  test('score stays within [0, 30]', () => {
    const score = scoreBodySuitability(mockOutfitLiked, quizProfile);
    expect(score).toBeLessThanOrEqual(30);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('sporty outfit scores lower for casual archetype', () => {
    const sportyScore = scoreBodySuitability(mockOutfitDisliked, quizProfile);
    const dressScore  = scoreBodySuitability(mockOutfitLiked, quizProfile);
    expect(dressScore).toBeGreaterThan(sportyScore);
  });
});

describe('scoreTrend', () => {
  const baselines = { avgLikeRate: 0.5, p90LikeRate: 0.75 };

  test('high like rate outfit scores more than low like rate', () => {
    const highScore = scoreTrend(mockOutfitLiked,    baselines); // 40/50 = 80%
    const lowScore  = scoreTrend(mockOutfitDisliked, baselines); // 6/20 = 30%
    expect(highScore).toBeGreaterThan(lowScore);
  });

  test('score stays within [0, 20]', () => {
    const score = scoreTrend(mockOutfitLiked, baselines);
    expect(score).toBeLessThanOrEqual(20);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  test('recent outfit scores higher recency than old outfit', () => {
    const recentOutfit = { ...mockOutfitLiked, created_at: new Date().toISOString() };
    const recentScore  = scoreTrend(recentOutfit,       baselines);
    const oldScore     = scoreTrend(mockOutfitDisliked, baselines);
    // mockOutfitDisliked is 100 days old (0 recency pts) vs recentOutfit (6 pts)
    expect(recentScore).toBeGreaterThan(oldScore);
  });
});

describe('computePenalties', () => {
  const profile = buildSwipeProfile(mockSwipeHistory);
  const currentSeason = 'summer';

  test('penalizes disliked category', () => {
    const { penalty, reasons } = computePenalties(mockOutfitDisliked, profile, currentSeason);
    expect(penalty).toBeLessThan(0);
    expect(reasons.some(r => r.startsWith('disliked_category'))).toBe(true);
  });

  test('no penalty for liked category', () => {
    const { penalty } = computePenalties(mockOutfitLiked, profile, currentSeason);
    // Dress is liked, no season mismatch (summer), not overexposed
    expect(penalty).toBe(0);
  });

  test('penalizes season mismatch for non-all outfits', () => {
    const winterOutfit = { ...mockOutfitLiked, season: 'winter', category: 'NewCat', color_family: 'Green' };
    const { reasons } = computePenalties(winterOutfit, profile, 'summer');
    expect(reasons.some(r => r.startsWith('wrong_season'))).toBe(true);
  });

  test('no season penalty for season=all', () => {
    const allSeasonOutfit = { ...mockOutfitLiked, season: 'all' };
    const { reasons } = computePenalties(allSeasonOutfit, profile, 'winter');
    expect(reasons.some(r => r.startsWith('wrong_season'))).toBe(false);
  });
});

describe('diversifyResults', () => {
  const makeOutfit = (category, score) => ({ id: Math.random().toString(), category, _score: score });

  test('caps category at maxPerCategory', () => {
    const input = [
      makeOutfit('Dress', 90), makeOutfit('Dress', 88), makeOutfit('Dress', 85),
      makeOutfit('Dress', 82), makeOutfit('Dress', 80),  // 5 Dresses
      makeOutfit('Tops', 79),
    ];
    const result = diversifyResults(input, 4, 6);
    const dressCount = result.filter(o => o.category === 'Dress').length;
    expect(dressCount).toBe(4);
  });

  test('respects output limit', () => {
    const input = Array.from({ length: 50 }, (_, i) => makeOutfit('Cat' + (i % 5), 100 - i));
    const result = diversifyResults(input, 4, 20);
    expect(result.length).toBe(20);
  });
});
