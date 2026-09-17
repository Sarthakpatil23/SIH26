// Indexed-element page snapshot — the SeeAct/browser-use observation pattern.
//
// One Runtime.evaluate per snapshot tags every visible interactive element
// with data-browy-id="N" so subsequent click/type/select tools can refer to
// elements by N and target them deterministically (no brittle CSS selectors,
// no LLM-hallucinated XPaths).
//
// The serialized form fed to the LLM looks like:
//
//   <page_stats>14 interactive, 23 links, 0 iframes, 312 total elements</page_stats>
//   <page_info>0.2 pages above, 1.8 pages below — scroll down to reveal more</page_info>
//   [Start of page]
//   [1]<a href=/login>Sign in</a>
//   [2]<button aria-label=Search />
//   [3]<input type=search placeholder="Search docs" />
//
// Modeled on browser-use's DomService + DOMTreeSerializer.

import type { SensitiveBoundingBox } from '../privacy/types.js';
import { inspectElementPrivacy, redactText } from '../privacy/pii-detector.js';
import os from 'os';
import { execSync } from 'child_process';

/** Retrieve known local user identity tokens to guarantee personal name redaction on local profiles. */
export function getKnownUserTokens(): string[] {
  const tokens = new Set<string>();
  try {
    const u = os.userInfo?.()?.username || process.env.USERNAME || process.env.USER;
    if (u && u.length >= 3) tokens.add(u);
  } catch {}
  try {
    const gitUser = execSync('git config user.name', { encoding: 'utf8', timeout: 500 }).trim();
    if (gitUser && gitUser.length >= 3) {
      tokens.add(gitUser);
      gitUser.split(/\s+/).forEach((t) => {
        if (t.length >= 3 && !/^(admin|user|test|root|null|undefined)$/i.test(t)) tokens.add(t);
      });
    }
  } catch {}
  return Array.from(tokens);
}

/** Build in-page DOM scanner script to find personal names, avatars, and name form inputs. */
export function buildDomSensitiveScannerScript(userTokens: string[] = []): string {
  const tokensJson = JSON.stringify(userTokens || []);
  return `(() => {
    const domSensitiveBoxes = [];
    try {
      const userTokens = ${tokensJson};
      const vpW = window.innerWidth || 1280;
      const vpH = window.innerHeight || 800;

      const isElVisible = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') < 0.05) return false;
        return true;
      };

      const pushBox = (r, type, label) => {
        if (!r || r.width < 2 || r.height < 2) return;
        if (r.bottom <= 0 || r.top >= vpH || r.right <= 0 || r.left >= vpW) return;
        domSensitiveBoxes.push({
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          type: type || 'person_name',
          label: label || 'NAME',
          coordType: 'css',
        });
      };

      // 1. Form Inputs, Textareas, Selects
      document.querySelectorAll('input, textarea, select').forEach((el) => {
        if (!isElVisible(el)) return;
        const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
        const nm = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        const al = (el.getAttribute('aria-label') || '').toLowerCase();

        const isNameField = ac === 'name' || ac.includes('given-name') || ac.includes('family-name') ||
          ac.includes('nickname') || ac.includes('username') ||
          /(?:^|[-_])(first[-_]?name|last[-_]?name|full[-_]?name|fname|lname|user[-_]?name|display[-_]?name|customer[-_]?name|author[-_]?name|cardholder[-_]?name|profile[-_]?name)(?:$|[-_])/i.test(nm) ||
          /(?:^|[-_])(first[-_]?name|last[-_]?name|full[-_]?name|fname|lname|user[-_]?name|display[-_]?name|customer[-_]?name|author[-_]?name|cardholder[-_]?name|profile[-_]?name)(?:$|[-_])/i.test(id) ||
          /\\b(?:first\\s+name|last\\s+name|full\\s+name|username|display\\s+name|your\\s+name)\\b/i.test(ph) ||
          /\\b(?:first\\s+name|last\\s+name|full\\s+name|username|display\\s+name|your\\s+name)\\b/i.test(al);

        if (isNameField) {
          pushBox(el.getBoundingClientRect(), 'person_name', 'NAME');
        }
      });

      // 2. Avatar / Profile Pictures
      document.querySelectorAll('img, svg, [role="img"]').forEach((el) => {
        if (!isElVisible(el)) return;
        const cls = (el.className && typeof el.className === 'string' ? el.className : '').toLowerCase();
        const alt = (el.getAttribute('alt') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const src = (el.getAttribute('src') || '').toLowerCase();
        const testId = (el.getAttribute('data-testid') || '').toLowerCase();

        const isAvatar = /avatar|profile[-_]?photo|profile[-_]?picture|profile[-_]?image|user[-_]?avatar|user[-_]?photo|author[-_]?img|presence-entity/i.test(cls) ||
          /avatar|profile/i.test(alt) || /avatar|profile/i.test(id) || /avatar|profile/i.test(testId) ||
          /profile_images|avatars|user_photos/i.test(src);

        if (isAvatar) {
          const r = el.getBoundingClientRect();
          if (r.width >= 14 && r.height >= 14 && r.width <= 700 && r.height <= 700) {
            pushBox(r, 'person_name', 'AVATAR');
          }
        }
      });

      // 3. Headings & Profile / Author / User Elements
      const profileAndHeadingEls = document.querySelectorAll(
        'h1, h2, h3, [role="heading"], ' +
        '[class*="name" i], [class*="user" i], [class*="author" i], [class*="profile" i], ' +
        '[class*="member" i], [class*="byline" i], [class*="account" i], [class*="owner" i], ' +
        '[id*="name" i], [id*="user" i], [id*="author" i], [id*="profile" i], ' +
        '[data-testid*="name" i], [data-testid*="user" i], [itemprop="name"], [itemprop="author"]'
      );

      const SKIP_WORDS = new Set([
        'name', 'user', 'username', 'profile', 'edit', 'account', 'menu', 'search', 'home',
        'settings', 'login', 'sign in', 'feed', 'notifications', 'jobs', 'messaging', 'terms',
        'privacy', 'help', 'about', 'contact', 'dashboard', 'overview', 'projects', 'repositories',
        'pricing', 'enterprise', 'products', 'solutions', 'community', 'company', 'submit', 'cancel',
        'delete', 'save', 'close', 'back', 'next', 'all', 'view', 'share', 'like', 'comment',
        'repost', 'send', 'follow', 'connect', 'message', 'more', 'filter', 'sort', 'open', 'details',
        'my network', 'try premium', 'premium', 'for business', 'business', 'work'
      ]);

      profileAndHeadingEls.forEach((el) => {
        if (!isElVisible(el)) return;
        if (el.children.length > 3) return;
        const txt = (el.innerText || el.textContent || '').trim();
        if (!txt || txt.length < 2 || txt.length > 70) return;
        const lower = txt.toLowerCase();
        if (SKIP_WORDS.has(lower)) return;

        const matchesUser = userTokens.some((tok) => tok.length >= 3 && lower.includes(tok.toLowerCase()));
        const isCapitalizedName = /^[A-Z][a-z]+(?:['’][a-zA-Z]+)?(?:\\s+[A-Z][a-z]+(?:['’][a-zA-Z]+)?){0,3}$/.test(txt);
        const isContextualName = /\\b(?:name|full\\s*name|user(?:name)?|author|signed\\s+in\\s+as|logged\\s+in\\s+as|welcome(?:\\s+back)?)\\s*[:=–-]?\\s*[A-Z]/i.test(txt);

        if (matchesUser || isCapitalizedName || isContextualName) {
          pushBox(el.getBoundingClientRect(), 'person_name', 'NAME');
        }
      });

      // 4. TreeWalker: Exact Substring Bounding Boxes across ALL text nodes
      if (document.body) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        const NAME_PATTERN = /\\b(?:(?:name|full\\s*name|first\\s*name|last\\s*name|user(?:name)?|author|customer|cardholder|candidate|patient|profile|contact|account)\\s*[:=–-]\\s*([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3})|(?:welcome(?:\\s+back)?,?|signed\\s+in\\s+as:?|logged\\s+in\\s+as:?|hello,?|hi,?|hey,?)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3})|(?:Mr\\.|Mrs\\.|Ms\\.|Miss|Dr\\.|Prof\\.|Sir|Madam)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3}))\\b/gi;

        while ((textNode = walker.nextNode())) {
          const str = textNode.nodeValue;
          if (!str || str.length < 3) continue;

          // A. User Known Tokens (e.g. Sarthak, Patil)
          for (const tok of userTokens) {
            if (tok.length < 3) continue;
            let idx = -1;
            const lowerStr = str.toLowerCase();
            const lowerTok = tok.toLowerCase();
            while ((idx = lowerStr.indexOf(lowerTok, idx + 1)) !== -1) {
              try {
                const range = document.createRange();
                range.setStart(textNode, idx);
                range.setEnd(textNode, idx + tok.length);
                const r = range.getBoundingClientRect();
                pushBox(r, 'person_name', 'NAME');
              } catch (_) {}
            }
          }

          // B. General Name Patterns
          let m;
          NAME_PATTERN.lastIndex = 0;
          while ((m = NAME_PATTERN.exec(str)) !== null) {
            try {
              const range = document.createRange();
              range.setStart(textNode, m.index);
              range.setEnd(textNode, m.index + m[0].length);
              const r = range.getBoundingClientRect();
              pushBox(r, 'person_name', 'NAME');
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
    return domSensitiveBoxes;
  })()`;
}

export interface IndexedElement {
  index: number;
  tag: string;
  type?: string;
  role?: string;
  name?: string;
  ariaLabel?: string;
  /** Computed accessible name (label/aria-labelledby/aria-label/text/title chain).
   *  Often differs from raw `text` or `ariaLabel` and is what a screen reader
   *  would actually announce. Higher-signal target for the LLM. */
  axName?: string;
  placeholder?: string;
  href?: string;
  value?: string;
  text?: string;
  /** Native checkbox/radio checked state. */
  checked?: boolean;
  /** True when document.activeElement === this element at snapshot time. */
  focused?: boolean;
  /** aria-expanded — disclosure widgets, comboboxes, menus. */
  expanded?: boolean;
  /** aria-pressed — toggle buttons. */
  pressed?: boolean;
  /** aria-selected — tabs, options, treeitems. */
  ariaSelected?: boolean;
  /** True when element is disabled (aria-disabled or DOM disabled). */
  disabled?: boolean;
  /** aria-current — "page", "step", "true", etc. */
  current?: string;
  /** For <select>: the currently selected option text. */
  selected?: string;
  /** For <select>: list of option labels (capped). */
  options?: string[];
  inViewport: boolean;
  /** True when this element wasn't present in the immediately-prior snapshot
   *  (same URL). Surface as `*N` in serialized form so the LLM notices new
   *  popovers / modals / autocomplete results. */
  isNew?: boolean;
  rect: { x: number; y: number; w: number; h: number };
  isSensitive?: boolean;
  sensitiveType?: string;
  autocomplete?: string;
  id?: string;
}

/** Screen-reader-style page announcement. Captured by an in-page MutationObserver
 *  on aria-live regions + focus changes since the previous snapshot. */
export interface PageAnnouncement {
  /** ms since epoch, set by the in-page collector. */
  t: number;
  /** What kind of event fired. */
  kind: 'live' | 'alert' | 'status' | 'log' | 'focus' | 'expand' | 'route';
  /** The text the assistive tech would have read (already trimmed). */
  text: string;
  /** Source role/region/element tag for context. */
  source?: string;
}

export interface PageStats {
  interactive: number;
  links: number;
  inputs: number;
  buttons: number;
  iframes: number;
  total: number;
  textChars: number;
  canvasCount?: number;
  canvasCoverageRatio?: number;
}

export interface DomSufficiencyReport {
  isSufficient: boolean;
  score: number; // 0.0 to 1.0 (1.0 = rich DOM, 0.0 = completely inaccessible / empty / pure canvas)
  hasDominantCanvas: boolean;
  canvasCoverageRatio: number;
  canvasCount: number;
  interactiveDensity: number;
  reasons: string[];
}

export interface PageInfo {
  url: string;
  title: string;
  vw: number; vh: number;
  scrollX: number; scrollY: number;
  docHeight: number;
  pagesAbove: number;
  pagesBelow: number;
  readyState: string;
  isPlaceholder: boolean;
  isEmpty: boolean;
}

export interface PageSnapshot {
  capturedAt: number;
  info: PageInfo;
  stats: PageStats;
  sufficiency?: DomSufficiencyReport;
  elements: IndexedElement[];
  /** Recent announcements collected since the previous snapshot
   *  (focus changes + aria-live region updates). */
  announcements: PageAnnouncement[];
  sensitiveBoxes?: SensitiveBoundingBox[];
}

interface CdpLike {
  send: (method: string, params?: unknown) => Promise<unknown>;
}

const SNAPSHOT_CACHE = new WeakMap<object, PageSnapshot>();

/** Build a fresh page snapshot. Tags interactive elements with data-browy-id
 *  in the live DOM so action tools can resolve N → element later. */
export async function capturePageSnapshot(cdp: CdpLike): Promise<PageSnapshot> {
  // The script returns a JSON string to keep the round-trip cheap.
  const script = `(() => {
    const INTERACTIVE_TAGS = new Set(['a','button','input','select','textarea','details','summary','label']);
    const INTERACTIVE_ROLES = new Set(['button','link','checkbox','radio','tab','menuitem','combobox','option','switch','textbox','searchbox','listbox','menuitemcheckbox','menuitemradio','treeitem','slider','spinbutton']);
    const SKIP_INPUTS = new Set(['hidden']);

    // ── Aria-live + focus observer (install once per document) ─────────────
    // We stash a small ring buffer on window.__browy_ax. Each capture drains
    // it and ships entries up alongside the snapshot — the agent gets the
    // equivalent of NVDA's recent announcements.
    if (!window.__browy_ax) {
      const ring = [];
      const MAX = 50;
      const push = (entry) => {
        try {
          if (!entry || !entry.text) return;
          entry.text = String(entry.text).replace(/\\s+/g, ' ').trim().slice(0, 240);
          if (!entry.text) return;
          ring.push(entry);
          if (ring.length > MAX) ring.shift();
        } catch (_) {}
      };
      const ax = {
        ring,
        drain() { const out = ring.slice(); ring.length = 0; return out; },
      };
      window.__browy_ax = ax;

      // Live regions: aria-live, role=status|alert|log
      const liveSel = '[aria-live],[role="status"],[role="alert"],[role="log"]';
      const isLive = (n) => n && n.nodeType === 1 && (
        n.matches?.(liveSel) || n.closest?.(liveSel)
      );
      const liveText = (n) => {
        const host = n.matches?.(liveSel) ? n : n.closest?.(liveSel);
        if (!host) return '';
        const role = (host.getAttribute('role') || '').toLowerCase();
        const live = (host.getAttribute('aria-live') || '').toLowerCase();
        const kind = role === 'alert' ? 'alert'
                   : role === 'log' ? 'log'
                   : role === 'status' || live === 'polite' || live === 'assertive' ? (role === 'status' ? 'status' : 'live')
                   : 'live';
        return { text: (host.innerText || '').slice(0, 400), kind, source: role || ('aria-live=' + live) };
      };
      try {
        new MutationObserver((muts) => {
          for (const m of muts) {
            const target = m.target;
            if (!isLive(target) && !(m.addedNodes && Array.from(m.addedNodes).some(isLive))) continue;
            const info = liveText(target);
            if (info && info.text) push({ t: Date.now(), kind: info.kind, text: info.text, source: info.source });
          }
        }).observe(document.documentElement || document, {
          subtree: true, childList: true, characterData: true, attributes: true,
          attributeFilter: ['aria-live', 'aria-atomic', 'aria-hidden'],
        });
      } catch (_) {}

      // Focus changes
      try {
        document.addEventListener('focusin', (e) => {
          const el = e.target;
          if (!el || el === document.body) return;
          const name = (el.getAttribute?.('aria-label') || el.textContent || el.getAttribute?.('placeholder') || '').trim().slice(0, 100);
          const role = (el.getAttribute?.('role') || el.tagName || '').toLowerCase();
          push({ t: Date.now(), kind: 'focus', text: 'focus → ' + role + (name ? ' "' + name + '"' : ''), source: role });
        }, true);
      } catch (_) {}

      // aria-expanded toggles (menu / disclosure / combobox open-close)
      try {
        new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type !== 'attributes' || m.attributeName !== 'aria-expanded') continue;
            const el = m.target;
            const v = el.getAttribute?.('aria-expanded');
            const name = (el.getAttribute?.('aria-label') || el.textContent || '').trim().slice(0, 80);
            push({ t: Date.now(), kind: 'expand', text: (v === 'true' ? 'expanded' : 'collapsed') + (name ? ' "' + name + '"' : ''), source: el.tagName?.toLowerCase() });
          }
        }).observe(document.documentElement || document, {
          subtree: true, attributes: true, attributeFilter: ['aria-expanded'],
        });
      } catch (_) {}

      // Route changes (SPA pushState/replaceState/popstate)
      try {
        const announceRoute = () => push({ t: Date.now(), kind: 'route', text: 'navigation → ' + location.pathname + location.search });
        window.addEventListener('popstate', announceRoute);
        const wrap = (name) => {
          const orig = history[name];
          if (typeof orig !== 'function') return;
          history[name] = function () { const r = orig.apply(this, arguments); try { announceRoute(); } catch(_){} return r; };
        };
        wrap('pushState'); wrap('replaceState');
      } catch (_) {}
    }

    // ── Computed-ish accessible name (label / aria-labelledby / aria-label / text / title) ──
    function axNameFor(el) {
      try {
        // 1) aria-labelledby — concatenate referenced elements' text
        const lb = el.getAttribute && el.getAttribute('aria-labelledby');
        if (lb) {
          const ids = lb.split(/\\s+/).filter(Boolean);
          const txt = ids.map(id => (document.getElementById(id)?.textContent || '').trim()).filter(Boolean).join(' ');
          if (txt) return txt.slice(0, 120);
        }
        // 2) aria-label (cheap — already on raw attrs but include here for fallthrough)
        const al = el.getAttribute && el.getAttribute('aria-label');
        if (al && al.trim()) return al.trim().slice(0, 120);
        // 3) <label for=> + label parents (HTMLInputElement.labels)
        if (el.labels && el.labels.length) {
          const t = Array.from(el.labels).map(l => (l.textContent || '').trim()).filter(Boolean).join(' ');
          if (t) return t.slice(0, 120);
        }
        // 4) For buttons/links/option/menuitem: use innerText (handled elsewhere via .text but include explicitly)
        const tag = el.tagName.toLowerCase();
        if (tag === 'button' || tag === 'a' || tag === 'option' || tag === 'summary') {
          const t = (el.innerText || el.textContent || '').trim();
          if (t) return t.slice(0, 120);
        }
        // 5) For <input type=image>: alt
        if (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image') {
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, 120);
        }
        // 6) <img alt=…> — when delegated as the labelling element
        if (tag === 'img') {
          const alt = el.getAttribute('alt');
          if (alt) return alt.trim().slice(0, 120);
        }
        // 7) title
        const ti = el.getAttribute && el.getAttribute('title');
        if (ti && ti.trim()) return ti.trim().slice(0, 120);
      } catch (_) {}
      return undefined;
    }

    function isInteractive(el) {
      if (!(el instanceof Element)) return false;
      if (el.hasAttribute('disabled')) return false;
      const tag = el.tagName.toLowerCase();
      if (INTERACTIVE_TAGS.has(tag)) {
        if (tag === 'input' && SKIP_INPUTS.has((el.getAttribute('type') || '').toLowerCase())) return false;
        return true;
      }
      if (el.hasAttribute('onclick')) return true;
      const ce = el.getAttribute('contenteditable');
      if (ce && ce !== 'false') return true;
      const ti = el.getAttribute('tabindex');
      if (ti != null && parseInt(ti, 10) >= 0) return true;
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role && INTERACTIVE_ROLES.has(role)) return true;
      return false;
    }

    function isVisible(el) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity || '1') < 0.05) return false;
      if (cs.pointerEvents === 'none' && el.tagName.toLowerCase() !== 'input') return false;
      return true;
    }

    function nearViewport(el, margin) {
      const r = el.getBoundingClientRect();
      return r.bottom > -margin && r.top < window.innerHeight + margin
          && r.right  > -margin && r.left < window.innerWidth + margin;
    }

    // Strip stale tags from a previous snapshot, including shadow trees.
    function clearStale(root) {
      try {
        const tagged = root.querySelectorAll('[data-browy-id]');
        tagged.forEach(el => el.removeAttribute('data-browy-id'));
      } catch (_) {}
    }
    clearStale(document);

    // Collect candidates: walk the entire DOM including same-origin iframes
    // and shadow roots. Use a custom recursive walk because TreeWalker doesn't
    // descend into shadow DOM.
    const candidates = [];
    let totalElements = 0;
    let textChars = 0;
    let iframeCount = 0;
    let canvasCount = 0;
    let totalCanvasAreaInViewport = 0;
    const vpW = window.innerWidth || 1280;
    const vpH = window.innerHeight || 800;
    const vpArea = Math.max(1, vpW * vpH);

    function walk(root) {
      if (!root) return;
      try { clearStale(root); } catch (_) {}
      const stack = [root.documentElement || root];
      while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (node.nodeType === 1) {
          totalElements++;
          const tag = node.tagName ? node.tagName.toLowerCase() : '';
          if (tag === 'canvas') {
            canvasCount++;
            try {
              const cr = node.getBoundingClientRect();
              if (cr.width > 0 && cr.height > 0) {
                const overlapW = Math.max(0, Math.min(cr.right, vpW) - Math.max(cr.left, 0));
                const overlapH = Math.max(0, Math.min(cr.bottom, vpH) - Math.max(cr.top, 0));
                totalCanvasAreaInViewport += (overlapW * overlapH);
              }
            } catch (_) {}
          }
          if (tag === 'iframe' || tag === 'frame') {
            iframeCount++;
            try {
              if (node.contentDocument) walk(node.contentDocument);
            } catch (_) { /* cross-origin */ }
          }
          if (isInteractive(node) && isVisible(node) && nearViewport(node, 2000)) {
            candidates.push(node);
          }
          if (node.shadowRoot) walk(node.shadowRoot);
          for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
        } else if (node.nodeType === 3) {
          textChars += (node.nodeValue || '').trim().length;
        }
      }
    }
    walk(document);

    // Sort by visual order (top-to-bottom, left-to-right) so the indices
    // align with how a human reads the page.
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) > 8) return ar.top - br.top;
      return ar.left - br.left;
    });

    // Containment filter: drop elements ≥99% contained inside another
    // already-indexed interactive element (e.g. an inner <span> inside an
    // <a> tag). browser-use uses the same heuristic.
    const kept = [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      let contained = false;
      for (const kr of kept) {
        const k = kr.r;
        const overlapW = Math.max(0, Math.min(r.right, k.right) - Math.max(r.left, k.left));
        const overlapH = Math.max(0, Math.min(r.bottom, k.bottom) - Math.max(r.top, k.top));
        const elArea = r.width * r.height;
        if (elArea > 0 && (overlapW * overlapH) / elArea >= 0.99) {
          contained = true; break;
        }
      }
      if (!contained) kept.push({ el, r });
    }

    // Cap to a reasonable number to keep prompts bounded.
    const MAX_ELEMENTS = 150;
    const final = kept.slice(0, MAX_ELEMENTS);

    let links = 0, inputs = 0, buttons = 0;
    const items = final.map(({ el, r }, i) => {
      const idx = i + 1;
      el.setAttribute('data-browy-id', String(idx));
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') links++;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') inputs++;
      if (tag === 'button' || el.getAttribute('role') === 'button') buttons++;

      const text = (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      const ariaLabel = el.getAttribute('aria-label') || undefined;
      const placeholder = el.getAttribute('placeholder') || undefined;
      const value = (tag === 'input' || tag === 'textarea') && typeof el.value === 'string'
        ? String(el.value).slice(0, 100)
        : undefined;

      // Checkbox / radio state — high signal for the agent ("is this already on?")
      let checked;
      const inputType = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
        checked = !!el.checked;
      } else {
        const ariaChecked = el.getAttribute('aria-checked');
        if (ariaChecked === 'true') checked = true;
        else if (ariaChecked === 'false') checked = false;
      }

      // <select> options + currently-selected
      let selected, options;
      if (tag === 'select') {
        try {
          const opts = Array.from(el.options || []);
          options = opts.slice(0, 12).map(o => (o.label || o.text || o.value || '').trim().slice(0, 40)).filter(Boolean);
          if (opts.length > 12) options.push('… +' + (opts.length - 12) + ' more');
          const sel = opts[el.selectedIndex];
          if (sel) selected = (sel.label || sel.text || sel.value || '').trim().slice(0, 60);
        } catch (_) {}
      }

      // Accessibility states — high-signal, what a screen reader would say.
      const focused = (document.activeElement === el);
      const expandedAttr = el.getAttribute('aria-expanded');
      const expanded = expandedAttr === 'true' ? true : expandedAttr === 'false' ? false : undefined;
      const pressedAttr = el.getAttribute('aria-pressed');
      const pressed = pressedAttr === 'true' ? true : pressedAttr === 'false' ? false : undefined;
      const selectedAttr = el.getAttribute('aria-selected');
      const ariaSelected = selectedAttr === 'true' ? true : selectedAttr === 'false' ? false : undefined;
      const disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || undefined;
      const current = el.getAttribute('aria-current') || undefined;
      const axName = axNameFor(el);

      const inVp = (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth);

      return {
        index: idx,
        tag,
        type: el.getAttribute('type') || undefined,
        role: el.getAttribute('role') || undefined,
        name: el.getAttribute('name') || undefined,
        id: el.id || undefined,
        autocomplete: el.getAttribute('autocomplete') || undefined,
        ariaLabel,
        axName: axName && axName !== ariaLabel && axName !== text ? axName : undefined,
        placeholder,
        href: tag === 'a' ? (el.getAttribute('href') || undefined) : undefined,
        text: text || undefined,
        value,
        checked,
        focused: focused || undefined,
        expanded,
        pressed,
        ariaSelected,
        disabled,
        current,
        selected,
        options,
        inViewport: inVp,
        rect: {
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
        },
      };
    });

    const docHeight = Math.max(
      document.documentElement?.scrollHeight || 0,
      document.body?.scrollHeight || 0,
      window.innerHeight
    );

    const canvasCoverageRatio = Math.min(1.0, Math.round((totalCanvasAreaInViewport / vpArea) * 100) / 100);
    const hasDominantCanvas = canvasCoverageRatio >= 0.25;

    // Evaluate DOM Sufficiency
    const domReasons = [];
    let domScore = 1.0;

    if (totalElements < 10) {
      domScore -= 0.6;
      domReasons.push('DOM appears nearly empty (<10 elements)');
    }
    if (hasDominantCanvas) {
      domScore -= 0.5;
      domReasons.push('Dominant canvas covers ' + Math.round(canvasCoverageRatio * 100) + '% of viewport (Google Sheets, Figma, Canva, or WebGL detected)');
    }
    if (candidates.length < 6 && totalElements > 20) {
      domScore -= 0.3;
      domReasons.push('Very few interactive elements (' + candidates.length + ') found on rendered page');
    }
    domScore = Math.max(0.0, Math.min(1.0, Math.round(domScore * 100) / 100));

    // Sufficient if score >= 0.6 and not dominated by an inaccessible canvas
    const isSufficient = domScore >= 0.6 && !(hasDominantCanvas && candidates.length < 35);
    if (!isSufficient && domReasons.length === 0) {
      domReasons.push('Low DOM actionability score (' + domScore + ')');
    }

    const sufficiency = {
      isSufficient,
      score: domScore,
      hasDominantCanvas,
      canvasCoverageRatio,
      canvasCount,
      interactiveDensity: candidates.length,
      reasons: domReasons,
    };

    const stats = {
      interactive: items.length,
      links, inputs, buttons,
      iframes: iframeCount,
      total: totalElements,
      textChars,
      canvasCount,
      canvasCoverageRatio,
    };

    const isEmpty = totalElements < 10;
    const isPlaceholder = !isEmpty && totalElements > 30 && textChars < totalElements * 4;

    const info = {
      url: location.href,
      title: document.title,
      vw: window.innerWidth, vh: window.innerHeight,
      scrollX: window.scrollX, scrollY: window.scrollY,
      docHeight,
      readyState: document.readyState,
      isEmpty, isPlaceholder,
    };

    // ── Universal Personal Name, Avatar & PII DOM Scanner ───────────────────
    const domSensitiveBoxes = (${buildDomSensitiveScannerScript(getKnownUserTokens())})();

    // Drain accumulated a11y announcements since the last snapshot.
    let announcements = [];
    try {
      announcements = (window.__browy_ax && window.__browy_ax.drain()) || [];
    } catch (_) {}

    return JSON.stringify({ info, stats, sufficiency, items, announcements, domSensitiveBoxes });
  })()`;

  const { result } = await cdp.send('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    timeout: 5000,
  }) as { result: { value?: string } };

  const raw = String(result?.value ?? '{}');
  let parsed: { info?: any; stats?: any; sufficiency?: DomSufficiencyReport; items?: IndexedElement[]; announcements?: PageAnnouncement[]; domSensitiveBoxes?: SensitiveBoundingBox[] };
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const info: PageInfo = {
    url: parsed.info?.url || '',
    title: parsed.info?.title || '',
    vw: parsed.info?.vw || 0,
    vh: parsed.info?.vh || 0,
    scrollX: parsed.info?.scrollX || 0,
    scrollY: parsed.info?.scrollY || 0,
    docHeight: parsed.info?.docHeight || 0,
    pagesAbove: parsed.info?.vh ? (parsed.info.scrollY / parsed.info.vh) : 0,
    pagesBelow: parsed.info?.vh
      ? Math.max(0, (parsed.info.docHeight - parsed.info.vh - parsed.info.scrollY) / parsed.info.vh)
      : 0,
    readyState: parsed.info?.readyState || '',
    isEmpty: !!parsed.info?.isEmpty,
    isPlaceholder: !!parsed.info?.isPlaceholder,
  };

  const stats: PageStats = {
    interactive: parsed.stats?.interactive || 0,
    links: parsed.stats?.links || 0,
    inputs: parsed.stats?.inputs || 0,
    buttons: parsed.stats?.buttons || 0,
    iframes: parsed.stats?.iframes || 0,
    total: parsed.stats?.total || 0,
    textChars: parsed.stats?.textChars || 0,
    canvasCount: parsed.stats?.canvasCount || 0,
    canvasCoverageRatio: parsed.stats?.canvasCoverageRatio || 0,
  };

  const snap: PageSnapshot = {
    capturedAt: Date.now(),
    info, stats,
    sufficiency: parsed.sufficiency as DomSufficiencyReport | undefined,
    elements: parsed.items || [],
    announcements: Array.isArray(parsed.announcements) ? parsed.announcements as PageAnnouncement[] : [],
  };

  // ── Client-Side Privacy Inspection & Dynamic Redaction ──────────────────
  const sensitiveBoxes: SensitiveBoundingBox[] = [];
  for (const el of snap.elements) {
    const inspection = inspectElementPrivacy({
      tag: el.tag,
      type: el.type,
      name: el.name,
      id: el.id,
      autocomplete: el.autocomplete,
      placeholder: el.placeholder,
      ariaLabel: el.ariaLabel || el.axName,
      value: el.value,
      text: el.text,
    });

    if (inspection.isSensitive) {
      el.isSensitive = true;
      el.sensitiveType = inspection.type;
      el.value = inspection.sanitizedValue;
      el.text = inspection.sanitizedText;
      el.placeholder = inspection.sanitizedPlaceholder;
      el.ariaLabel = inspection.sanitizedAriaLabel;

      if (el.inViewport && el.rect.w > 0 && el.rect.h > 0) {
        sensitiveBoxes.push({
          x: el.rect.x,
          y: el.rect.y,
          w: el.rect.w,
          h: el.rect.h,
          type: inspection.type || 'password',
          label: inspection.type === 'person_name' ? (el.placeholder === '[AVATAR]' ? 'AVATAR' : 'NAME') : (inspection.type || 'PII').toUpperCase(),
          elementIndex: el.index,
          coordType: 'css',
        });
      }
    } else {
      let foundMatch = false;
      let matchType: any = 'pii';

      if (el.value) {
        const r = redactText(el.value);
        if (r.matches.length > 0) {
          el.value = r.sanitized;
          el.isSensitive = true;
          foundMatch = true;
          matchType = r.matches[0].type;
        }
      }
      if (el.text) {
        const r = redactText(el.text);
        if (r.matches.length > 0) {
          el.text = r.sanitized;
          el.isSensitive = true;
          foundMatch = true;
          matchType = r.matches[0].type;
        }
      }

      if (foundMatch && el.inViewport && el.rect.w > 0 && el.rect.h > 0) {
        sensitiveBoxes.push({
          x: el.rect.x,
          y: el.rect.y,
          w: el.rect.w,
          h: el.rect.h,
          type: matchType,
          label: matchType === 'person_name' ? 'NAME' : String(matchType).toUpperCase(),
          elementIndex: el.index,
          coordType: 'css',
        });
      }
    }
  }

  // Merge direct DOM detected sensitive boxes (names, avatars, form fields)
  if (Array.isArray(parsed.domSensitiveBoxes)) {
    sensitiveBoxes.push(...parsed.domSensitiveBoxes);
  }

  // Deduplicate overlapping sensitive boxes
  const uniqueBoxes: SensitiveBoundingBox[] = [];
  for (const b of sensitiveBoxes) {
    if (!b || b.w <= 0 || b.h <= 0) continue;
    const isDup = uniqueBoxes.some((u) => {
      const overlapW = Math.max(0, Math.min(b.x + b.w, u.x + u.w) - Math.max(b.x, u.x));
      const overlapH = Math.max(0, Math.min(b.y + b.h, u.y + u.h) - Math.max(b.y, u.y));
      const overlapArea = overlapW * overlapH;
      const bArea = b.w * b.h;
      return bArea > 0 && (overlapArea / bArea) > 0.8;
    });
    if (!isDup) uniqueBoxes.push(b);
  }

  for (const a of snap.announcements) {
    if (a.text) {
      a.text = redactText(a.text).sanitized;
    }
  }
  snap.sensitiveBoxes = uniqueBoxes;

  // Diff against the immediately-prior snapshot (same URL only). Mark elements
  // whose signature wasn't in the previous set as `isNew`. browser-use uses the
  // same `*N` convention so the LLM notices popovers / modals / autocomplete
  // results that just appeared.
  const prev = SNAPSHOT_CACHE.get(cdp as object);
  if (prev && prev.info.url === info.url) {
    const prevSigs = new Set(prev.elements.map(elementSignature));
    for (const el of snap.elements) {
      if (!prevSigs.has(elementSignature(el))) el.isNew = true;
    }
  }

  SNAPSHOT_CACHE.set(cdp as object, snap);
  return snap;
}

/** Stable-ish identity for an element — used for diffing snapshots.
 *  Indices change every snapshot (sort order can shift); identity is the
 *  combination of structural attributes that the LLM would actually use to
 *  recognise the element. Intentionally NOT including position or text-with-
 *  state to avoid spurious "new" marks on every keystroke. */
function elementSignature(el: IndexedElement): string {
  return [
    el.tag,
    el.type || '',
    el.role || '',
    el.name || '',
    el.href || '',
    el.ariaLabel || '',
    el.placeholder || '',
    (el.text || '').slice(0, 40),
  ].join('|');
}

/** Returns the most recent snapshot for this cdp session, if any. */
export function getCachedSnapshot(cdp: CdpLike): PageSnapshot | undefined {
  return SNAPSHOT_CACHE.get(cdp as object);
}

/** Returns either the cached snapshot or a freshly-captured one. */
export async function ensureSnapshot(cdp: CdpLike, maxAgeMs = 1500): Promise<PageSnapshot> {
  const cached = getCachedSnapshot(cdp);
  if (cached && Date.now() - cached.capturedAt < maxAgeMs) return cached;
  return capturePageSnapshot(cdp);
}

/** Format a snapshot for an LLM prompt. */
export function serializeSnapshot(snap: PageSnapshot, opts?: { maxChars?: number }): string {
  const max = opts?.maxChars ?? 12_000;
  const lines: string[] = [];

  // <page_stats>
  let hint = '';
  if (snap.info.isEmpty) hint = 'Page appears empty (SPA not loaded?) — ';
  else if (snap.info.isPlaceholder) hint = 'Page appears to show skeleton/placeholder content (still loading?) — ';
  lines.push(
    `<page_stats>${hint}${snap.stats.interactive} interactive, ${snap.stats.links} links, ` +
    `${snap.stats.buttons} buttons, ${snap.stats.inputs} inputs, ${snap.stats.iframes} iframes, ` +
    `${snap.stats.total} total elements</page_stats>`
  );

  // <dom_sufficiency> — high-signal note if DOM actionability is constrained
  if (snap.sufficiency && !snap.sufficiency.isSufficient) {
    const reasons = snap.sufficiency.reasons.join('; ');
    lines.push(`<dom_sufficiency status="insufficient" canvas="${Math.round(snap.sufficiency.canvasCoverageRatio * 100)}%" reasons="${reasons}">DOM has limited actionability. Use vision fallback / coordinates if target is not in the snapshot.</dom_sufficiency>`);
  }

  // <page_info>
  const above = snap.info.pagesAbove.toFixed(1);
  const below = snap.info.pagesBelow.toFixed(1);
  let scrollHint = '';
  if (snap.info.pagesBelow > 0.2) scrollHint = ' — scroll down to reveal more';
  else if (snap.info.pagesAbove > 0.2 && snap.info.pagesBelow < 0.05) scrollHint = ' — at end of page';
  lines.push(`<page_info>${above} pages above, ${below} pages below${scrollHint}</page_info>`);

  // <page_announcements> — what a screen reader heard between turns.
  // High-signal evidence of "did my last action work" without a screenshot.
  if (snap.announcements && snap.announcements.length) {
    const items = snap.announcements.slice(-12); // newest 12
    const annLines = items.map(a => `  [${a.kind}] ${truncate(a.text, 160)}`);
    lines.push('<page_announcements>');
    lines.push(...annLines);
    lines.push('</page_announcements>');
  }

  // Sentinels
  if (snap.info.pagesAbove < 0.05) lines.push('[Start of page]');

  // Elements
  for (const el of snap.elements) {
    lines.push(formatElement(el));
  }

  if (snap.info.pagesBelow < 0.05) lines.push('[End of page]');

  let out = lines.join('\n');
  if (out.length > max) out = out.slice(0, max) + `\n… (truncated, ${snap.elements.length} elements total)`;
  return out;
}

function formatElement(el: IndexedElement): string {
  const attrs: string[] = [];
  if (el.type) attrs.push(`type=${el.type}`);
  if (el.role) attrs.push(`role=${el.role}`);
  if (el.name) attrs.push(`name=${el.name}`);
  if (el.isSensitive) attrs.push(`redacted=${el.sensitiveType || 'pii'}`);
  if (el.focused) attrs.push('focused');
  if (el.disabled) attrs.push('disabled');
  if (el.expanded === true)  attrs.push('expanded');
  else if (el.expanded === false) attrs.push('collapsed');
  if (el.pressed === true)   attrs.push('pressed');
  if (el.ariaSelected === true) attrs.push('selected');
  if (el.current) attrs.push(`current=${el.current}`);
  if (el.checked === true) attrs.push('checked');
  else if (el.checked === false && (el.type === 'checkbox' || el.type === 'radio')) attrs.push('unchecked');
  if (el.placeholder) attrs.push(`placeholder=${q(el.placeholder)}`);
  if (el.ariaLabel) attrs.push(`aria-label=${q(el.ariaLabel)}`);
  if (el.axName)    attrs.push(`aria-name=${q(el.axName)}`);
  if (el.href) attrs.push(`href=${truncate(el.href, 60)}`);
  if (el.value) attrs.push(`value=${q(truncate(el.value, 40))}`);
  if (el.selected) attrs.push(`selected=${q(truncate(el.selected, 40))}`);
  if (el.options && el.options.length) attrs.push(`options=[${el.options.map(o => q(o)).join(',')}]`);
  const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
  const vp = el.inViewport ? '' : '~'; // ~ marks elements outside viewport
  const nu = el.isNew ? '*' : '';      // * marks elements new since last snapshot
  if (el.text) {
    return `[${nu}${vp}${el.index}]<${el.tag}${attrStr}>${truncate(el.text, 100)}</${el.tag}>`;
  }
  return `[${nu}${vp}${el.index}]<${el.tag}${attrStr} />`;
}

function q(s: string): string {
  if (!/[\s"'<>=]/.test(s)) return s;
  return JSON.stringify(s);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Resolve an index → element handle for action execution.
 *  Returns the bounding rect (page coordinates → for clicks via Input.dispatchMouseEvent)
 *  and the JS expression that resolves to the element. */
export interface ResolvedElement {
  found: boolean;
  reason?: string;
  rect?: { x: number; y: number; w: number; h: number; cx: number; cy: number };
  tag?: string;
  isEditable?: boolean;
  isSelect?: boolean;
}

export async function resolveIndex(cdp: CdpLike, index: number): Promise<ResolvedElement> {
  const expr = `(() => {
    const el = document.querySelector('[data-browy-id="${index}"]');
    if (!el) {
      // Search shadow roots and same-origin iframes.
      const stack = [document];
      while (stack.length) {
        const root = stack.pop();
        if (!root) continue;
        const found = root.querySelector?.('[data-browy-id="${index}"]');
        if (found) return resolve(found);
        const all = root.querySelectorAll?.('*') || [];
        for (const n of all) {
          if (n.shadowRoot) stack.push(n.shadowRoot);
          if (n.tagName === 'IFRAME' || n.tagName === 'FRAME') {
            try { if (n.contentDocument) stack.push(n.contentDocument); } catch(_) {}
          }
        }
      }
      return JSON.stringify({ found: false, reason: 'no element with data-browy-id=' + index + ' (snapshot may be stale, or target lives inside a <canvas>/graphic — call inspect_page or use look_at_screen + click_coordinate)' });
    }
    return resolve(el);
    function resolve(el) {
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); } catch(_) {}
      const r = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const editable = tag === 'input' || tag === 'textarea' || (el.getAttribute('contenteditable') || 'false') !== 'false';
      const isSelect = tag === 'select';
      return JSON.stringify({
        found: true,
        rect: { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 },
        tag, isEditable: editable, isSelect,
      });
    }
  })()`;
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    timeout: 3000,
  }) as { result: { value?: string } };
  try { return JSON.parse(String(result?.value ?? '{"found":false}')); }
  catch { return { found: false, reason: 'resolver returned non-JSON' }; }
}
