/* ═══════════════════════════════════════════════════════════════
   FLAIR — SWIPE UI ENGINE
   ═══════════════════════════════════════════════════════════════ */

// Stats
const stats = { likes: 0, dislikes: 0, seen: 0, sessionId: Date.now() };

// Deck queue: pre-fetched outfits
let deck    = [];
let loading = false;
let currentOutfit = null;
let selectedOccasion = null;
let allOutfits = [];
let userProfile = null;

/* ── DOM refs ───────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const cardStack    = $('cardStack');
const emptyState   = $('emptyState');
const actionBtns   = $('actionButtons');
const footer       = $('pageFooter');
const swipeHint    = $('swipeHint');
const progressFill = $('progressFill');


// Start the app immediately
initApp();

function getCurrentSeason() {
  const m = new Date().getMonth() + 1;
  if (m>=3&&m<=5) return 'Spring Collection';
  if (m>=6&&m<=8) return 'Summer Collection';
  if (m>=9&&m<=11) return 'Autumn Collection';
  return 'Winter Collection';
}

function getBodyTypes(item) {
  if (!item || !item.body_type) return [];
  if (Array.isArray(item.body_type)) {
    return item.body_type.map(b => (b || '').toString().toLowerCase().trim()).filter(Boolean);
  }
  return item.body_type.toString().split(',').map(b => (b || '').toString().toLowerCase().trim()).filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════
   APP INIT
   ═══════════════════════════════════════════════════════════════ */
async function initApp() {
  // Load user profile from quiz
  userProfile = JSON.parse(localStorage.getItem('userProfile') || '{"bodyType": "apple", "undertone": "neutral"}');
  userProfile.bodyType = (userProfile.bodyType || '').toLowerCase().trim();
  userProfile.undertone = (userProfile.undertone || '').toLowerCase().trim();
  
  // Load fashion dataset from same directory as swipe page
  const datasetUrl = 'fashion_dataset_processed.json';
  try {
    const response = await fetch(datasetUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    allOutfits = await response.json();
    if (!Array.isArray(allOutfits)) throw new Error('Dataset is not an array');
    console.log(`Loaded ${allOutfits.length} dataset items from ${datasetUrl}`);
  } catch (e) {
    console.error('Failed to load dataset:', e);
    allOutfits = [];
    showToast('Unable to load swipe dataset. Please refresh or check the server.');
  }

  hideSwipeControls();
  await showOccasionSelection();
}

/* ═══════════════════════════════════════════════════════════════
   OCCASION SELECTION
   ═══════════════════════════════════════════════════════════════ */
async function showOccasionSelection() {
  try {
    const occasions = [...new Set(allOutfits.map(item => item.occasion_clean).filter(Boolean))];

    const selectionDiv = document.createElement('div');
    selectionDiv.className = 'occasion-selection';
    selectionDiv.innerHTML = `
      <h2>Select Occasion</h2>
      <div class="occasion-buttons">
        ${occasions.map(occ => `<button class="occasion-btn" data-occ="${occ}">${occ}</button>`).join('')}
      </div>
    `;
    document.body.appendChild(selectionDiv);

    return new Promise((resolve) => {
      selectionDiv.addEventListener('click', e => {
        if (e.target.classList.contains('occasion-btn')) {
          selectedOccasion = e.target.dataset.occ.toString().trim();
          document.body.removeChild(selectionDiv);
          showSwipeControls();
          // Filter by occasion AND user's body type and undertone
          deck = allOutfits.filter(item => {
            const outfitOccasion = (item.occasion_clean || '').toString().trim();
            if (outfitOccasion !== selectedOccasion) return false;
            // Check body type match
            const bodyTypes = getBodyTypes(item);
            if (bodyTypes.length && !bodyTypes.includes(userProfile.bodyType)) return false;
            // Check undertone match
            const outfitTone = (item.undertone || '').toString().toLowerCase().trim();
            if (outfitTone && outfitTone !== userProfile.undertone) {
              if (outfitTone !== 'neutral' && userProfile.undertone !== 'neutral') {
                return false;
              }
            }
            return true;
          });

          if (deck.length === 0) {
            deck = allOutfits.filter(item => item.occasion_clean === selectedOccasion);
            if (deck.length > 0) {
              showToast('No exact profile match found. Showing occasion-based outfits.');
            }
          }

          renderNextCard();
          resolve();
        }
      });
    });
  } catch (e) {
    console.error(e);
  }
}

/* ═══════════════════════════════════════════════════════════════
   FILTER OUTFIT DECK
   ═══════════════════════════════════════════════════════════════ */
async function fetchDeck() {
  if (deck.length > 0 || loading) return;
  loading = true;

  try {
    // Deck is already filtered in showOccasionSelection
    // but if we need to refetch, filter again
    if (selectedOccasion && allOutfits.length > 0) {
      deck = allOutfits.filter(item => {
        const outfitOccasion = (item.occasion_clean || '').toString().trim();
        if (outfitOccasion !== selectedOccasion) return false;
        const bodyTypes = getBodyTypes(item);
        if (bodyTypes.length && !bodyTypes.includes(userProfile.bodyType)) return false;
        const outfitTone = (item.undertone || '').toString().toLowerCase().trim();
        if (outfitTone && outfitTone !== userProfile.undertone) {
          if (outfitTone !== 'neutral' && userProfile.undertone !== 'neutral') {
            return false;
          }
        }
        return true;
      });
      if (deck.length === 0) {
        deck = allOutfits.filter(item => item.occasion_clean === selectedOccasion);
        if (deck.length > 0) {
          showToast('No exact profile match found. Showing occasion-based outfits.');
        }
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    loading = false;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CARD RENDERING
   ═══════════════════════════════════════════════════════════════ */
function renderNextCard() {
  // Remove previous active card
  const prev = cardStack.querySelector('.outfit-card');
  if (prev) prev.remove();

  if (deck.length === 0) {
    fetchDeck().then(() => {
      if (deck.length > 0) renderNextCard();
      else showEmpty();
    });
    return;
  }

  // Pre-fetch when deck gets low
  if (deck.length <= 3) fetchDeck();

  currentOutfit = deck.shift();
  const card    = buildCard(currentOutfit);
  cardStack.appendChild(card);

  // Animate in
  card.style.animation = 'cardIn .4s var(--ease-out) both';

  stats.seen++;
  updateStats();
  updateProgress();

  // Dismiss hint after first card
  if (stats.seen === 1) {
    setTimeout(() => { swipeHint.style.opacity = '0'; swipeHint.style.transition = 'opacity .6s'; }, 2500);
  }

  attachDragEvents(card);
}

function buildCard(outfit) {
  const card = document.createElement('div');
  card.className = 'outfit-card';
  card.dataset.id = outfit.p_id || outfit.id || '';

  // Color map for dots
  const colorMap = {
    Pink:'#e8b4b8', Blue:'#7ba7d4', Green:'#8fa98f', Brown:'#a0785a',
    Grey:'#9a9a9a', Black:'#2a2a2a', Orange:'#d4845a', Neutral:'#c8b99a',
    Purple:'#9b7eb8', Red:'#c46060', White:'#e8e4dc', Yellow:'#d4c060',
  };
  const tags = [];
  if (outfit.occasion_clean) tags.push(outfit.occasion_clean);
  if (outfit.colour) tags.push(outfit.colour);

  card.innerHTML = `
    <!-- Vote indicators (shown while dragging) -->
    <div class="vote-indicator vote-like"  id="indLike">LOVE</div>
    <div class="vote-indicator vote-dislike" id="indPass">PASS</div>

    <!-- Image or emoji placeholder -->
    ${outfit.img
      ? `<img class="card-img" src="${buildImageUrl(outfit.img)}"
             alt="${outfit.name || outfit.clean_description || ''}"
             onerror="this.outerHTML=\`<div class='card-img-placeholder'>👗</div>\`">`
      : `<div class="card-img-placeholder">👗</div>`
    }
    <div class="card-img-overlay"></div>

    <div class="card-body">

      <div class="card-tags">
        ${tags.map(t => `<span class="card-tag">${t}</span>`).join('')}
      </div>
    </div>
  `;

  return card;
}

function buildImageUrl(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return '/' + encodeURI(path);
}

/* ═══════════════════════════════════════════════════════════════
   DRAG / SWIPE ENGINE
   ═══════════════════════════════════════════════════════════════ */
function attachDragEvents(card) {
  let startX = 0, startY = 0, curX = 0, curY = 0, isDragging = false;
  const SWIPE_THRESHOLD = 90; // px to trigger swipe

  const onStart = e => {
    isDragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    card.classList.add('is-dragging');
  };

  const onMove = e => {
    if (!isDragging) return;
    e.preventDefault();

    const pt = e.touches ? e.touches[0] : e;
    curX = pt.clientX - startX;
    curY = pt.clientY - startY;

    // Rotation: max ±25deg based on horizontal travel
    const rot = curX * 0.10;
    card.style.transform = `translateX(${curX}px) translateY(${curY * 0.4}px) rotate(${rot}deg)`;

    // Show/hide vote indicators
    const prog  = Math.abs(curX) / SWIPE_THRESHOLD;
    const like  = card.querySelector('.vote-like');
    const pass  = card.querySelector('.vote-dislike');
    if (curX > 20)  { like.style.opacity = Math.min(prog, 1); pass.style.opacity = 0; }
    else if (curX < -20) { pass.style.opacity = Math.min(prog, 1); like.style.opacity = 0; }
    else            { like.style.opacity = 0; pass.style.opacity = 0; }
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    card.classList.remove('is-dragging');

    if (curX > SWIPE_THRESHOLD)       triggerSwipe('like',    card);
    else if (curX < -SWIPE_THRESHOLD) triggerSwipe('dislike', card);
    else {
      // Snap back
      card.classList.add('snap-back');
      card.style.transform = '';
      card.querySelector('.vote-like').style.opacity    = 0;
      card.querySelector('.vote-dislike').style.opacity = 0;
      setTimeout(() => card.classList.remove('snap-back'), 450);
    }

    curX = 0; curY = 0;
  };

  // Mouse events
  card.addEventListener('mousedown',  onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onEnd);

  // Touch events
  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove',  onMove,  { passive: false });
  card.addEventListener('touchend',   onEnd);

  // Cleanup on card removal
  card._cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup',   onEnd);
  };
}

/* ═══════════════════════════════════════════════════════════════
   SWIPE ACTION
   ═══════════════════════════════════════════════════════════════ */
async function triggerSwipe(action, card) {
  if (!card || !currentOutfit) return;

  // Detach events
  if (card._cleanup) card._cleanup();

  // Fly animation
  card.classList.add(action === 'like' ? 'fly-right' : action === 'dislike' ? 'fly-left' : 'fly-right');

  // Button pop
  const popBtn = action === 'like' ? $('btnLike') : action === 'dislike' ? $('btnDislike') : $('btnSkip');
  if (popBtn) { popBtn.style.animation = 'none'; popBtn.offsetHeight; popBtn.style.animation = 'btnPop .4s var(--ease-spring)'; }

  // Update stats
  if      (action === 'like')    { stats.likes++;    showToast('❤ Loved it'); }
  else if (action === 'dislike') { stats.dislikes++;  showToast('Noted — not your style'); }
  else                            { showToast('Skipped'); }
  updateStats();

  // Remove card after animation + load next
  setTimeout(() => {
    if (card.parentNode) card.parentNode.removeChild(card);
    renderNextCard();
  }, 480);

}

/* ═══════════════════════════════════════════════════════════════
   BUTTON EVENTS
   ═══════════════════════════════════════════════════════════════ */
$('btnLike').addEventListener('click', () => {
  const card = cardStack.querySelector('.outfit-card');
  if (card) triggerSwipe('like', card);
});
$('btnDislike').addEventListener('click', () => {
  const card = cardStack.querySelector('.outfit-card');
  if (card) triggerSwipe('dislike', card);
});
$('btnSkip').addEventListener('click', () => {
  const card = cardStack.querySelector('.outfit-card');
  if (card) triggerSwipe('skip', card);
});

// Keyboard support
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') $('btnLike').click();
  else if (e.key === 'ArrowLeft')  $('btnDislike').click();
  else if (e.key === 'ArrowDown')  $('btnSkip').click();
});

$('btnReload').addEventListener('click', async () => {
  emptyState.classList.remove('visible');
  cardStack.style.display = 'block';
  actionBtns.style.display = 'flex';
  deck = [];
  await fetchDeck();
  renderNextCard();
});

/* ═══════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════ */
function hideSwipeControls() {
  actionBtns.style.display = 'none';
  if (footer) footer.style.display = 'none';
}

function showSwipeControls() {
  cardStack.style.display = 'block';
  cardStack.style.opacity = '1';
  cardStack.style.pointerEvents = 'auto';
  emptyState.classList.remove('visible');
  actionBtns.style.display = 'flex';
  actionBtns.style.opacity = '1';
  actionBtns.style.pointerEvents = 'auto';
  if (footer) footer.style.display = 'flex';
}

function updateStats() {
  $('statLikes').textContent    = stats.likes;
  $('statDislikes').textContent = stats.dislikes;
  $('statSeen').textContent     = stats.seen;
}

function updateProgress() {
  const total = Math.max(stats.seen + deck.length, stats.seen);
  const pct   = total > 0 ? Math.min((stats.seen / total) * 100, 95) : 0;
  progressFill.style.width = pct + '%';
}

function showEmpty() {
  cardStack.style.opacity = '0';
  cardStack.style.pointerEvents = 'none';
  actionBtns.style.opacity = '0';
  actionBtns.style.pointerEvents = 'none';
  setTimeout(() => {
    cardStack.style.display = 'none';
    actionBtns.style.display = 'none';
    emptyState.classList.add('visible');
  }, 300);
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toastWrap').appendChild(el);
  requestAnimationFrame(() => { el.classList.add('show'); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 1800);
}