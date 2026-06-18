/* ═══════════════════════════════════════════════════════════════
   FLAIR — SWIPE UI ENGINE  (fixed)
   ═══════════════════════════════════════════════════════════════ */

/* ── Stats ─────────────────────────────────────────────────── */
const stats = { likes: 0, dislikes: 0, seen: 0 };

/* ── State ──────────────────────────────────────────────────── */
let deck             = [];
let loading          = false;
let currentOutfit    = null;
let selectedOccasion = null;
let allOutfits       = [];
let userProfile      = null;
const currentUser    = JSON.parse(localStorage.getItem('vf_user') || 'null');

/* ── DOM refs ───────────────────────────────────────────────── */
const $            = id => document.getElementById(id);
const cardStack    = $('cardStack');
const emptyState   = $('emptyState');
const actionBtns   = $('actionButtons');
const footer       = $('pageFooter');
const swipeHint    = $('swipeHint');
const progressFill = $('progressFill');

/* ── Boot ───────────────────────────────────────────────────── */
initApp();

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */
function getBodyTypes(item) {
  if (!item?.body_type) return [];
  const raw = Array.isArray(item.body_type) ? item.body_type : String(item.body_type).split(',');
  return raw.map(b => String(b).toLowerCase().trim()).filter(Boolean);
}

function buildImageUrl(path) {
  if (!path) return '';
  // Force https — Myntra assets are served over http which browsers block as mixed content
  return path.replace(/^http:\/\//, 'https://');
}

async function sendSwipeEvent(action, outfit, durationMs = 0) {
  if (!currentUser || !currentUser.id || !outfit) return;
  const outfitId = outfit.p_id || outfit.id;
  if (!outfitId) return;

  try {
    await fetch('/api/swipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id,
        outfit_id: outfitId,
        action,
        duration_ms: durationMs || undefined,
        source: 'flair_ui'
      })
    });
  } catch (err) {
    console.warn('Swipe event failed to save:', err);
  }
}

/* ═══════════════════════════════════════════════════════════════
   APP INIT  — load dataset FIRST, then show occasion picker
   ═══════════════════════════════════════════════════════════════ */
async function initApp() {
  /* 1 ▸ Read user profile from quiz results (set by main app) */
  userProfile = JSON.parse(
    localStorage.getItem('userProfile') ||
    '{"bodyType":"apple","undertone":"neutral"}'
  );
  userProfile.bodyType  = (userProfile.bodyType  || '').toLowerCase().trim();
  userProfile.undertone = (userProfile.undertone || '').toLowerCase().trim();

  /* 2 ▸ Hide swipe UI until occasion is chosen */
  hideSwipeControls();

  /* 3 ▸ Fetch dataset — MUST run over HTTP (python3 -m http.server) */
  showToast('Loading outfits…');
  try {
    const res = await fetch('fashion_dataset_processed.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json();
    if (!Array.isArray(parsed)) throw new Error('Dataset is not an array');
    allOutfits = parsed;
    console.log(`✓ Loaded ${allOutfits.length} outfits`);
  } catch (err) {
    console.error('Dataset fetch failed:', err);
    /*
     * ── COMMON CAUSES ──────────────────────────────────────────
     *  • Opened as file:// — run: python3 -m http.server 8080
     *  • Wrong filename / path — check it matches exactly
     *  • JSON syntax error — validate at jsonlint.com
     * ───────────────────────────────────────────────────────────
     */
    showToast('⚠ Could not load dataset. See console for help.');
    allOutfits = [];   // graceful fallback — occasion picker will show "no occasions"
  }

  /* 4 ▸ Show occasion picker (uses allOutfits, even if empty) */
  await showOccasionSelection();
}

/* ═══════════════════════════════════════════════════════════════
   OCCASION SELECTION
   ═══════════════════════════════════════════════════════════════ */
function showOccasionSelection() {
  return new Promise(resolve => {
    /* Deduplicate + sort occasions from dataset */
    const occasions = [...new Set(
      allOutfits.map(item => (item.occasion_clean || '').trim()).filter(Boolean)
    )].sort();

    /* Use the .occasion-selection class already defined in swipe.css */
    const overlay = document.createElement('div');
    overlay.className = 'occasion-selection';
    overlay.innerHTML = `
      <h2>What's the occasion?</h2>
      <div class="occasion-buttons">
        ${
          occasions.length
            ? occasions.map(occ =>
                `<button class="occasion-btn" data-occ="${occ}">${occ}</button>`
              ).join('')
            : `<p style="opacity:.5;font-size:.8rem;letter-spacing:.1em;">No occasions found in dataset.</p>`
        }
      </div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
      const btn = e.target.closest('.occasion-btn');
      if (!btn) return;

      selectedOccasion = btn.dataset.occ.trim();

      /* Fade out using your existing paper background */
      overlay.style.transition = 'opacity .3s';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);

      buildDeck();
      showSwipeControls();
      renderNextCard();
      resolve();
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   BUILD DECK  — filter by occasion + profile
   ═══════════════════════════════════════════════════════════════ */
function buildDeck() {
  /* Primary filter: occasion + body type + undertone */
  let filtered = allOutfits.filter(item => {
    /* Occasion must match */
    if ((item.occasion_clean || '').trim() !== selectedOccasion) return false;

    /* Body type: only filter if the item specifies body types */
    const bodyTypes = getBodyTypes(item);
    if (bodyTypes.length && !bodyTypes.includes(userProfile.bodyType)) return false;

    /* Undertone: skip if item has a different non-neutral undertone */
    const tone = (item.undertone || '').toLowerCase().trim();
    if (tone && tone !== 'neutral' && userProfile.undertone !== 'neutral' && tone !== userProfile.undertone) {
      return false;
    }

    return true;
  });

  /* Fallback: if profile filtering returns nothing, use occasion-only */
  if (!filtered.length) {
    filtered = allOutfits.filter(item =>
      (item.occasion_clean || '').trim() === selectedOccasion
    );
    if (filtered.length) showToast('Showing all occasion styles — refine your quiz for better matches');
  }

  /* Shuffle so order varies each session */
  deck = shuffle(filtered);
  console.log(`Deck ready: ${deck.length} cards for "${selectedOccasion}"`);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ═══════════════════════════════════════════════════════════════
   CARD RENDERING
   ═══════════════════════════════════════════════════════════════ */
function renderNextCard() {
  /* Remove previous card */
  cardStack.querySelector('.outfit-card')?.remove();

  if (!deck.length) {
    showEmpty();
    return;
  }

  currentOutfit = deck.shift();
  const card    = buildCard(currentOutfit);
  card.dataset.swipeStart = String(Date.now());
  cardStack.appendChild(card);
  card.style.animation = 'cardIn .4s var(--ease-out, ease-out) both';

  stats.seen++;
  updateStats();
  updateProgress();

  /* Fade hint after first card */
  if (stats.seen === 1) {
    setTimeout(() => {
      swipeHint.style.transition = 'opacity .6s';
      swipeHint.style.opacity    = '0';
    }, 2500);
  }

  attachDragEvents(card);
}

function buildCard(outfit) {
  const card    = document.createElement('div');
  card.className = 'outfit-card';
  card.dataset.id = outfit.p_id || outfit.id || '';

  const tags = [outfit.occasion_clean, outfit.colour].filter(Boolean);

  // Debug: log the image URL being used so you can check it in DevTools console
  const imgUrl = buildImageUrl(outfit.img);
  if (outfit.img) console.log('[FLAIR] card img →', imgUrl, '| raw:', outfit.img);

  card.innerHTML = `
    <div class="vote-indicator vote-like">LOVE ❤</div>
    <div class="vote-indicator vote-dislike">PASS ✕</div>

    ${outfit.img
      ? `<img class="card-img"
              src="${imgUrl}"
              alt="${outfit.name || ''}"
              onerror="console.warn('[FLAIR] Image failed to load:', this.src); this.style.display='none'; this.nextElementSibling.style.display='flex';">`
      : ''
    }
    <div class="card-img-placeholder" style="${outfit.img ? 'display:none' : ''}">👗</div>
    <div class="card-img-overlay"></div>

    <div class="card-body">
      <div class="card-tags">
        ${tags.map(t => `<span class="card-tag">${t}</span>`).join('')}
      </div>
    </div>`;

  return card;
}

/* ═══════════════════════════════════════════════════════════════
   DRAG / SWIPE ENGINE
   ═══════════════════════════════════════════════════════════════ */
function attachDragEvents(card) {
  let startX = 0, startY = 0, curX = 0, curY = 0, dragging = false;
  const THRESHOLD = 90; // px

  const likeInd = card.querySelector('.vote-like');
  const passInd = card.querySelector('.vote-dislike');

  function onStart(e) {
    dragging = true;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    card.classList.add('is-dragging');
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    curX = pt.clientX - startX;
    curY = pt.clientY - startY;

    const rot  = curX * 0.10;
    card.style.transform = `translateX(${curX}px) translateY(${curY * 0.4}px) rotate(${rot}deg)`;

    const prog = Math.min(Math.abs(curX) / THRESHOLD, 1);
    if (curX > 20)       { likeInd.style.opacity = prog; passInd.style.opacity = 0; }
    else if (curX < -20) { passInd.style.opacity = prog; likeInd.style.opacity = 0; }
    else                 { likeInd.style.opacity = 0;    passInd.style.opacity = 0; }
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    card.classList.remove('is-dragging');

    if      (curX >  THRESHOLD) triggerSwipe('like',    card);
    else if (curX < -THRESHOLD) triggerSwipe('dislike', card);
    else {
      /* Snap back */
      card.style.transition = 'transform .4s cubic-bezier(.175,.885,.32,1.275)';
      card.style.transform  = '';
      likeInd.style.opacity = 0;
      passInd.style.opacity = 0;
      setTimeout(() => { card.style.transition = ''; }, 450);
    }
    curX = 0; curY = 0;
  }

  /* Mouse */
  card.addEventListener('mousedown',   onStart);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onEnd);

  /* Touch */
  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchmove',  onMove,  { passive: false });
  card.addEventListener('touchend',   onEnd);

  /* Cleanup so old listeners don't pile up */
  card._cleanup = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup',   onEnd);
  };
}

/* ═══════════════════════════════════════════════════════════════
   SWIPE ACTION
   ═══════════════════════════════════════════════════════════════ */
function triggerSwipe(action, card) {
  if (!card || !currentOutfit) return;
  card._cleanup?.();

  /* Fly off screen */
  card.classList.add(action === 'like' ? 'fly-right' : 'fly-left');

  /* Button pop feedback */
  const popId = action === 'like' ? 'btnLike' : action === 'dislike' ? 'btnDislike' : 'btnSkip';
  const popBtn = $(popId);
  if (popBtn) {
    popBtn.style.animation = 'none';
    void popBtn.offsetHeight;                      // force reflow
    popBtn.style.animation = 'btnPop .4s ease';
  }

  /* Stats */
  if      (action === 'like')    { stats.likes++;    showToast('❤ Loved it!'); }
  else if (action === 'dislike') { stats.dislikes++;  showToast('Noted — not your style'); }
  else                            { showToast('Skipped'); }
  updateStats();

  const durationMs = card && card.dataset.swipeStart ? Date.now() - Number(card.dataset.swipeStart) : 0;
  sendSwipeEvent(action, currentOutfit, durationMs);

  /* Save liked outfit to localStorage */
  if (action === 'like' && currentOutfit) {
    const saved = JSON.parse(localStorage.getItem('flair_liked') || '[]');
    saved.push(currentOutfit);
    localStorage.setItem('flair_liked', JSON.stringify(saved));
  }

  setTimeout(() => {
    card.remove();
    renderNextCard();
  }, 420);
}

/* ═══════════════════════════════════════════════════════════════
   BUTTON WIRING
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

/* Keyboard shortcuts */
document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') $('btnLike').click();
  if (e.key === 'ArrowLeft')  $('btnDislike').click();
  if (e.key === 'ArrowDown')  $('btnSkip').click();
});

/* Reload button */
$('btnReload').addEventListener('click', () => {
  emptyState.classList.remove('visible');
  buildDeck();          // re-filter and re-shuffle
  showSwipeControls();
  renderNextCard();
});

/* ═══════════════════════════════════════════════════════════════
   UI HELPERS
   ═══════════════════════════════════════════════════════════════ */
function hideSwipeControls() {
  cardStack.style.visibility  = 'hidden';
  actionBtns.style.display    = 'none';
  if (footer) footer.style.display = 'none';
}

function showSwipeControls() {
  cardStack.style.visibility  = 'visible';
  actionBtns.style.display    = 'flex';
  if (footer) footer.style.display = 'flex';
}

function updateStats() {
  $('statLikes').textContent    = stats.likes;
  $('statDislikes').textContent = stats.dislikes;
  $('statSeen').textContent     = stats.seen;
}

function updateProgress() {
  const total = stats.seen + deck.length;
  const pct   = total > 0 ? Math.min((stats.seen / total) * 100, 95) : 0;
  progressFill.style.width = pct + '%';
}

function showEmpty() {
  cardStack.style.opacity      = '0';
  actionBtns.style.opacity     = '0';
  cardStack.style.pointerEvents  = 'none';
  actionBtns.style.pointerEvents = 'none';
  setTimeout(() => {
    cardStack.style.display  = 'none';
    actionBtns.style.display = 'none';
    emptyState.classList.add('visible');
  }, 300);
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className   = 'toast';
  el.textContent = msg;
  $('toastWrap').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 1800);
}