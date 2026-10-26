import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const VERSION = process.env.WORDCRAFT_VERSION || '0.11.0';
const RELEASE_URL = `https://github.com/storytold/wordcraft/releases/download/v${VERSION}/wordcraft-web-${VERSION}.zip`;

const ARABIC_FONTS = [
  {
    name: 'NotoSansArabic-Regular.ttf',
    url: 'https://raw.githubusercontent.com/storytold/craft-fonts/main/fonts/noto-sans-arabic/NotoSansArabic.ttf'
  },
  {
    name: 'Amiri-Regular.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Regular.ttf'
  },
  {
    name: 'Amiri-Bold.ttf',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/Amiri-Bold.ttf'
  }
];

function hasWasm(dir) {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith('.wasm'));
}

// 1. Download & extract official WordCraft WebAssembly bundle if not present
if (!hasWasm(DIST)) {
  console.log(`⬇️ Downloading WordCraft Web v${VERSION} from ${RELEASE_URL}...`);
  const zipPath = path.join(ROOT, 'wordcraft-web.zip');
  execSync(`curl -fSL -o "${zipPath}" "${RELEASE_URL}"`, { stdio: 'inherit' });
  const tmpExtract = path.join(ROOT, '.tmp_extract');
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.mkdirSync(tmpExtract, { recursive: true });
  execSync(`unzip -q "${zipPath}" -d "${tmpExtract}"`, { stdio: 'inherit' });
  fs.rmSync(zipPath, { force: true });

  const entries = fs.readdirSync(tmpExtract);
  const innerDir = entries.length === 1 && fs.statSync(path.join(tmpExtract, entries[0])).isDirectory()
    ? path.join(tmpExtract, entries[0])
    : tmpExtract;

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.renameSync(innerDir, DIST);
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  console.log('✅ Extracted WordCraft Web bundle to dist/');
} else {
  console.log('✅ WordCraft Web WASM bundle already exists in dist/');
}

// 2. Bundle Arabic fonts into dist/fonts/
const distFontsDir = path.join(DIST, 'fonts');
fs.mkdirSync(distFontsDir, { recursive: true });
for (const font of ARABIC_FONTS) {
  const dest = path.join(distFontsDir, font.name);
  const localCache = path.join(ROOT, 'fonts', font.name);
  if (!fs.existsSync(dest)) {
    if (fs.existsSync(localCache)) {
      fs.copyFileSync(localCache, dest);
      console.log(`✅ Copied cached ${font.name} to dist/fonts/`);
    } else {
      console.log(`⬇️ Downloading ${font.name}...`);
      execSync(`curl -fSL -o "${dest}" "${font.url}"`, { stdio: 'inherit' });
    }
  }
}

// 3. Write Android Mobile Bridge v4 (Full Native Java Bridge for Save, Save As, Open, Print, Clipboard, Arabic Fonts)
const mobileBridgeCode = `/**
 * WordCraft Android Mobile Bridge v4
 * Connects WordCraft WebAssembly to Native Android (window.WordCraftAndroid in MainActivity.java):
 * 1. Save / Save As / Export PDF / Export PNG -> Native MediaStore Downloads + Intent.ACTION_CREATE_DOCUMENT + Share
 * 2. Open File / Insert Picture / Add Font -> Fixes Android WebView <input type="file" accept=".docx"> greyed-out files
 * 3. File > Print -> Intercepts #wordcraft-print-frame blob PDF and saves/shares natively
 * 4. Native Android Clipboard integration (Copy/Paste)
 * 5. Pre-seeds Noto Sans Arabic & Amiri into IndexedDB ("wordcraft" -> "fonts")
 */
(function () {
  if (window.__wordcraftMobileBridgeLoaded) return;
  window.__wordcraftMobileBridgeLoaded = true;

  const PREF_KEY = 'wordcraft.ui';
  const TOP_OFFSET_KEY = 'wordcraft.android.topOffset';
  const REL_SCALE_KEY = 'wordcraft.android.relScale';
  const dpr = Math.max(1, window.devicePixelRatio || 1);

  // Convert Uint8Array to Base64 string safely in chunks
  function uint8ToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      docm: 'application/vnd.ms-word.document.macroEnabled.12',
      dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
      pdf: 'application/pdf',
      odt: 'application/vnd.oasis.opendocument.text',
      rtf: 'application/rtf',
      md: 'text/markdown',
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html',
      xml: 'application/xml',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg'
    };
    return map[ext] || 'application/octet-stream';
  }

  // Central handler for all saved/exported/printed files
  function handleNativeFileSave(filename, bytes, mime) {
    const safeName = filename || 'Document1.docx';
    const safeMime = mime || guessMime(safeName);
    const b64 = uint8ToBase64(bytes);

    // 1. Immediately save to /sdcard/Download/WordCraft/<safeName> via Native Java Bridge
    if (window.WordCraftAndroid && typeof window.WordCraftAndroid.saveToDownloads === 'function') {
      try {
        window.WordCraftAndroid.saveToDownloads(b64, safeName, safeMime);
      } catch (e) {
        console.error('Native saveToDownloads error:', e);
      }
    }

    // 2. Show action bar for "Save As (Pilih Folder)" and "Bagikan / Buka"
    showSaveActionToast(safeName, b64, bytes, safeMime);
  }

  function showSaveActionToast(filename, b64, bytes, mime) {
    let old = document.getElementById('wc-mobile-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'wc-mobile-toast';
    toast.style.cssText = [
      'position:fixed;bottom:76px;left:50%;transform:translateX(-50%);z-index:99999;',
      'background:#0f172a;color:#f8fafc;padding:12px 14px;border-radius:14px;',
      'box-shadow:0 12px 28px rgba(0,0,0,0.45);font:13px/1.4 system-ui,sans-serif;',
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:94vw;',
      'border:1px solid rgba(255,255,255,0.18);'
    ].join('');

    const label = document.createElement('div');
    label.textContent = '✅ Tersimpan: Download/WordCraft/' + filename + ' (' + Math.max(1, Math.round(bytes.byteLength / 1024)) + ' KB)';
    label.style.cssText = 'width:100%;font-weight:600;color:#4ade80;margin-bottom:2px;word-break:break-all;';
    toast.appendChild(label);

    // Button 1: Native Android "Save As..." folder chooser (Intent.ACTION_CREATE_DOCUMENT)
    const pickerBtn = document.createElement('button');
    pickerBtn.textContent = '📁 Pilih Folder (Save As)';
    pickerBtn.style.cssText = [
      'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 12px;',
      'font:600 12px system-ui,sans-serif;cursor:pointer;'
    ].join('');
    pickerBtn.onclick = () => {
      if (window.WordCraftAndroid && typeof window.WordCraftAndroid.saveWithSystemPicker === 'function') {
        window.WordCraftAndroid.saveWithSystemPicker(b64, filename, mime);
      }
    };
    toast.appendChild(pickerBtn);

    // Button 2: Native Android Share / Open with other app
    const shareBtn = document.createElement('button');
    shareBtn.textContent = '📤 Bagikan / Buka';
    shareBtn.style.cssText = [
      'background:#059669;color:#fff;border:none;border-radius:8px;padding:7px 12px;',
      'font:600 12px system-ui,sans-serif;cursor:pointer;'
    ].join('');
    shareBtn.onclick = () => {
      if (window.WordCraftAndroid && typeof window.WordCraftAndroid.shareFile === 'function') {
        window.WordCraftAndroid.shareFile(b64, filename, mime);
      }
    };
    toast.appendChild(shareBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Tutup';
    closeBtn.style.cssText = [
      'background:rgba(255,255,255,0.1);color:#cbd5e1;border:none;border-radius:8px;',
      'padding:7px 10px;font:600 12px system-ui,sans-serif;cursor:pointer;margin-left:auto;'
    ].join('');
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 20000);
  }

  // A. Always override window.showSaveFilePicker so Save / Save As / Export routes to Native Android
  window.showSaveFilePicker = async function (opts) {
    const suggested = (opts && opts.suggestedName) ? opts.suggestedName : 'Document1.docx';
    const chunks = [];
    return {
      name: suggested,
      async createWritable() {
        return {
          async write(data) {
            if (data instanceof Uint8Array) {
              chunks.push(new Uint8Array(data));
            } else if (ArrayBuffer.isView(data)) {
              chunks.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
            } else if (data instanceof ArrayBuffer) {
              chunks.push(new Uint8Array(data));
            } else if (data instanceof Blob) {
              const ab = await data.arrayBuffer();
              chunks.push(new Uint8Array(ab));
            }
          },
          async close() {
            const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const c of chunks) {
              merged.set(c, offset);
              offset += c.byteLength;
            }
            handleNativeFileSave(suggested, merged, guessMime(suggested));
          }
        };
      }
    };
  };

  // B. Intercept <a download="..."> clicks AND <input type="file"> clicks
  const origElementClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    // 1. Fix <input type="file" accept=".docx,..."> on Android WebView
    //    Android's ACTION_GET_CONTENT greys out files when given dot-extensions like ".docx" instead of MIME types
    if (this.tagName === 'INPUT' && this.type === 'file') {
      const accept = (this.getAttribute('accept') || '').toLowerCase();
      if (accept.includes('.png') || accept.includes('.jpg')) {
        this.setAttribute('accept', 'image/*');
      } else if (accept.includes('.')) {
        this.removeAttribute('accept');
      }
    }

    // 2. Intercept <a href="blob:..." download="filename"> fallback downloads
    if (this.tagName === 'A' && this.hasAttribute('download') && this.href && this.href.startsWith('blob:')) {
      const dlName = this.getAttribute('download') || 'Document1.docx';
      const blobUrl = this.href;
      fetch(blobUrl)
        .then((r) => r.arrayBuffer())
        .then((ab) => {
          handleNativeFileSave(dlName, new Uint8Array(ab), guessMime(dlName));
        })
        .catch((err) => console.error('Blob download intercept failed:', err));
      return;
    }

    return origElementClick.apply(this, arguments);
  };

  // C. Intercept File > Print (#wordcraft-print-frame) so printing exports/shares PDF natively on Android
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node && node.id === 'wordcraft-print-frame' && node.tagName === 'IFRAME') {
          const checkSrc = () => {
            if (node.src && node.src.startsWith('blob:')) {
              fetch(node.src)
                .then((r) => r.arrayBuffer())
                .then((ab) => {
                  handleNativeFileSave('Document-Print.pdf', new Uint8Array(ab), 'application/pdf');
                })
                .catch(() => {});
            }
          };
          setTimeout(checkSrc, 150);
        }
      }
    }
  });
  window.addEventListener('DOMContentLoaded', () => {
    if (document.body) {
      observer.observe(document.body, { childList: true });
    }
  });

  // D. Bridge navigator.clipboard to Native Android ClipboardManager
  try {
    if (navigator.clipboard) {
      const origWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = async function (text) {
        if (window.WordCraftAndroid && typeof window.WordCraftAndroid.copyText === 'function') {
          window.WordCraftAndroid.copyText(String(text || ''));
        }
        return origWriteText(text).catch(() => {});
      };
      const origReadText = navigator.clipboard.readText.bind(navigator.clipboard);
      navigator.clipboard.readText = async function () {
        if (window.WordCraftAndroid && typeof window.WordCraftAndroid.pasteText === 'function') {
          const nativeText = window.WordCraftAndroid.pasteText();
          if (nativeText) return nativeText;
        }
        return origReadText().catch(() => '');
      };
    }
  } catch (_) {}

  // E. Preload bundled Arabic fonts into IndexedDB ("wordcraft" -> objectStore "fonts")
  window.__wordcraftPreloadFonts = async function () {
    const BUNDLED_ARABIC_FONTS = [
      'NotoSansArabic-Regular.ttf',
      'Amiri-Regular.ttf',
      'Amiri-Bold.ttf'
    ];
    if (!window.indexedDB) return;

    const db = await new Promise((resolve, reject) => {
      const req = window.indexedDB.open('wordcraft', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('fonts')) {
          d.createObjectStore('fonts');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const existingKeys = await new Promise((resolve) => {
      try {
        const tx = db.transaction('fonts', 'readonly');
        const store = tx.objectStore('fonts');
        const req = store.getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch (_) {
        resolve([]);
      }
    });

    for (const fontName of BUNDLED_ARABIC_FONTS) {
      if (existingKeys.includes(fontName)) continue;
      try {
        const resp = await fetch('./fonts/' + fontName);
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        const bytes = new Uint8Array(buf);
        await new Promise((resolve) => {
          const tx = db.transaction('fonts', 'readwrite');
          const store = tx.objectStore('fonts');
          const req = store.put(bytes, fontName);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        });
      } catch (_) {}
    }
    db.close();
  };

  function toWordcraftScale(relPct) {
    if (relPct === 100) return 'auto';
    return Math.min(300, Math.max(50, Math.round(relPct * dpr)));
  }

  try {
    let savedRel = parseInt(localStorage.getItem(REL_SCALE_KEY) || '', 10);
    let rawPrefs = {};
    try {
      rawPrefs = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
    } catch (_) {
      rawPrefs = {};
    }

    if (!savedRel || (typeof rawPrefs.uiScale === 'number' && rawPrefs.uiScale <= 115 && dpr > 1.5)) {
      savedRel = 80;
      localStorage.setItem(REL_SCALE_KEY, String(savedRel));
      rawPrefs.uiScale = toWordcraftScale(savedRel);
      localStorage.setItem(PREF_KEY, JSON.stringify(rawPrefs));
    }
  } catch (_) {}

  function getTopOffset() {
    const val = localStorage.getItem(TOP_OFFSET_KEY);
    return val === null ? 28 : (parseInt(val, 10) || 0);
  }

  function applyTopOffset(px) {
    const canvas = document.getElementById('wordcraft_canvas');
    if (!canvas) return;
    let banner = document.getElementById('wc-top-safe-bar');
    if (px > 0) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'wc-top-safe-bar';
        banner.style.cssText = [
          'position:fixed;top:0;left:0;right:0;z-index:99990;',
          'background:#18181b;border-bottom:1px solid #27272a;',
          'display:flex;align-items:center;justify-content:center;',
          'color:#71717a;font:600 10px system-ui,sans-serif;user-select:none;'
        ].join('');
        document.body.appendChild(banner);
      }
      banner.style.height = px + 'px';
      banner.style.display = 'flex';
      canvas.style.top = px + 'px';
      canvas.style.height = 'calc(100% - ' + px + 'px)';
    } else {
      if (banner) banner.style.display = 'none';
      canvas.style.top = '0px';
      canvas.style.height = '100%';
    }
    window.dispatchEvent(new Event('resize'));
  }

  window.addEventListener('DOMContentLoaded', () => {
    applyTopOffset(getTopOffset());

    const bar = document.createElement('div');
    bar.id = 'wc-mobile-pill';
    bar.style.cssText = [
      'position:fixed;right:10px;bottom:34px;z-index:99998;',
      'display:flex;align-items:center;gap:5px;background:rgba(15,23,42,0.86);',
      'backdrop-filter:blur(8px);padding:5px 8px;border-radius:999px;',
      'border:1px solid rgba(255,255,255,0.18);box-shadow:0 4px 14px rgba(0,0,0,0.35);',
      'font:600 11px system-ui,sans-serif;color:#f8fafc;user-select:none;'
    ].join('');

    const btnStyle = [
      'background:rgba(255,255,255,0.13);color:#f8fafc;border:none;border-radius:999px;',
      'padding:5px 9px;font:600 11px system-ui,sans-serif;cursor:pointer;'
    ].join('');

    const kbBtn = document.createElement('button');
    kbBtn.textContent = '⌨️ Ketik';
    kbBtn.style.cssText = btnStyle;
    kbBtn.onclick = (e) => {
      e.stopPropagation();
      const input = document.getElementById('egui_text_agent') || document.querySelector('input, textarea');
      if (input) {
        input.focus();
        input.click();
      } else {
        const canvas = document.getElementById('wordcraft_canvas');
        if (canvas) canvas.focus();
      }
    };

    const scaleBtn = document.createElement('button');
    const scales = [65, 80, 90, 100];
    function getSavedRelScale() {
      const v = parseInt(localStorage.getItem(REL_SCALE_KEY) || '80', 10);
      return scales.includes(v) ? v : 80;
    }
    scaleBtn.textContent = '🔍 ' + getSavedRelScale() + '%';
    scaleBtn.style.cssText = btnStyle;
    scaleBtn.onclick = (e) => {
      e.stopPropagation();
      const cur = getSavedRelScale();
      const next = scales[(scales.indexOf(cur) + 1) % scales.length] || 80;
      try {
        localStorage.setItem(REL_SCALE_KEY, String(next));
        const parsed = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
        parsed.uiScale = toWordcraftScale(next);
        localStorage.setItem(PREF_KEY, JSON.stringify(parsed));
        location.reload();
      } catch (_) {}
    };

    const topBtn = document.createElement('button');
    const offsets = [0, 28, 42];
    function updateTopBtnLabel() {
      const cur = getTopOffset();
      topBtn.textContent = cur === 0 ? '⬆️ Penuh' : ('⬇️ Atas ' + cur + 'px');
    }
    updateTopBtnLabel();
    topBtn.style.cssText = btnStyle;
    topBtn.onclick = (e) => {
      e.stopPropagation();
      const cur = getTopOffset();
      const next = offsets[(offsets.indexOf(cur) + 1) % offsets.length];
      localStorage.setItem(TOP_OFFSET_KEY, String(next));
      applyTopOffset(next);
      updateTopBtnLabel();
    };

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '‹';
    toggleBtn.style.cssText = 'background:transparent;color:#94a3b8;border:none;padding:2px 5px;font-size:13px;cursor:pointer;';
    let collapsed = false;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      kbBtn.style.display = collapsed ? 'none' : '';
      scaleBtn.style.display = collapsed ? 'none' : '';
      topBtn.style.display = collapsed ? 'none' : '';
      toggleBtn.textContent = collapsed ? '⚙️' : '‹';
    };

    bar.appendChild(kbBtn);
    bar.appendChild(scaleBtn);
    bar.appendChild(topBtn);
    bar.appendChild(toggleBtn);
    document.body.appendChild(bar);
  });
})();
`;

fs.writeFileSync(path.join(DIST, 'mobile-bridge.js'), mobileBridgeCode, 'utf8');

// 4. Inject mobile-bridge.js and await window.__wordcraftPreloadFonts() before WASM init in dist/index.html
const indexHtmlPath = path.join(DIST, 'index.html');
let html = fs.readFileSync(indexHtmlPath, 'utf8');
if (!html.includes('mobile-bridge.js')) {
  html = html.replace('<head>', '<head>\n  <script src="./mobile-bridge.js"></script>');
}
if (!html.includes('__wordcraftPreloadFonts')) {
  html = html.replace(
    'const wasm = await init(',
    'if (window.__wordcraftPreloadFonts) { try { await window.__wordcraftPreloadFonts(); } catch (e) { console.warn(e); } }\nconst wasm = await init('
  );
}
fs.writeFileSync(indexHtmlPath, html, 'utf8');
console.log('✅ Updated dist/index.html with Native Android Bridge v4');
