const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const swipeModel  = require('../models/swipe.model');
const outfitModel = require('../models/outfit.model');
const db          = require('../config/db');

/**
 * POST /api/swipe
 * Body: { outfit_id, action, duration_ms?, session_id?, source? }
 *
 * Flow:
 *  1. Validate outfit exists
 *  2. Insert/update swipe record
 *  3. Update user preference vectors (in same transaction)
 *  4. Return confirmation + updated vector deltas
 */
const recordSwipe = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const {
    outfit_id,
    action,
    duration_ms = null,
    session_id  = 0,
    source      = 'swipe_deck',
  } = req.body;

  // 1. Ensure outfit exists
  const outfit = await outfitModel.findById(outfit_id);
  if (!outfit) {
    throw new ApiError(404, `Outfit ${outfit_id} not found.`);
  }

  // 2 + 3. Swipe + vector update in one transaction
  const swipe = await db.withTransaction(async (client) => {
    const swipeRecord = await swipeModel.create({
      userId,
      outfitId: outfit_id,
      action,
      sessionId: session_id,
      durationMs: duration_ms,
      source,
    });

    // Only update preference vectors for meaningful actions
    if (action !== 'skip' || duration_ms > 3000) {
      await swipeModel.updatePreferenceVectors(client, userId, outfit, action);
    }

    return swipeRecord;
  });

  // 4. Return
  return res.status(201).json({
    success: true,
    data: {
      swipe_id  : swipe.id,
      outfit_id,
      action,
      swiped_at : swipe.swiped_at,
      outfit_meta: {
        category    : outfit.category,
        style       : outfit.style,
        color_family: outfit.color_family,
      },
    },
  });
});

/**
 * GET /api/swipe/deck
 * Returns next batch of unseen outfits for the swipe deck.
 * Query: ?limit=10
 */
const getSwipeDeck = asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const limit  = Math.min(parseInt(req.query.limit) || 10, 30);

  const { rows: [user] } = await db.query(
    `SELECT gender FROM users WHERE id = $1`,
    [userId]
  );
  if (!user) throw new ApiError(404, 'User not found.');

  const outfits = await outfitModel.findUnseen(userId, user.gender, limit);

  return res.json({
    success: true,
    data   : outfits,
    meta   : { count: outfits.length },
  });
});

module.exports = { recordSwipe, getSwipeDeck };
