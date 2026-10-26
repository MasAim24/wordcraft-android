import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const VERSION = process.env.WORDCRAFT_VERSION || '0.11.0';
const RELEASE_URL = `https://github.com/storytold/wordcraft/releases/download/v${VERSION}/wordcraft-web-${VERSION}.zip`;

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

// 2. Write Android Mobile Bridge script (Virtual Keyboard, UI Scale, File Save & Share polyfill)
const mobileBridgeCode = `/**
 * WordCraft Android Mobile Bridge
 * - Polyfills window.showSaveFilePicker for Android WebView (Save / Export PDF / Export PNG -> Share or Download)
 * - Adds a collapsible floating Mobile Helper Pill (Keyboard focus, UI Zoom Scale, Orientation Lock)
 */
(function () {
  if (window.__wordcraftMobileBridgeLoaded) return;
  window.__wordcraftMobileBridgeLoaded = true;

  // Set default compact UI scale (85%) on small mobile screens if not yet configured
  try {
    const PREF_KEY = 'wordcraft.ui';
    const existing = localStorage.getItem(PREF_KEY);
    if (!existing && Math.min(window.innerWidth, window.innerHeight) < 600) {
      localStorage.setItem(PREF_KEY, JSON.stringify({ uiScale: 85 }));
    }
  } catch (_) {}

  // Toast helper for saved/exported files
  function showSaveToast(filename, bytes, mime) {
    let old = document.getElementById('wc-mobile-toast');
    if (old) old.remove();

    const toast = document.createElement('div');
    toast.id = 'wc-mobile-toast';
    toast.style.cssText = [
      'position:fixed;bottom:68px;left:50%;transform:translateX(-50%);z-index:99999;',
      'background:#1e293b;color:#f8fafc;padding:10px 14px;border-radius:12px;',
      'box-shadow:0 10px 25px rgba(0,0,0,0.35);font:13px/1.4 system-ui,sans-serif;',
      'display:flex;align-items:center;gap:10px;max-width:92vw;border:1px solid rgba(255,255,255,0.14);'
    ].join('');

    const label = document.createElement('span');
    label.textContent = '📄 ' + filename + ' (' + Math.max(1, Math.round(bytes.byteLength / 1024)) + ' KB)';
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:52vw;';
    toast.appendChild(label);

    const shareBtn = document.createElement('button');
    shareBtn.textContent = 'Simpan / Bagikan';
    shareBtn.style.cssText = [
      'background:#2563eb;color:#fff;border:none;border-radius:8px;padding:6px 11px;',
      'font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;'
    ].join('');
    shareBtn.onclick = async () => {
      try {
        const file = new File([bytes], filename, { type: mime || 'application/octet-stream' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: filename });
          toast.remove();
          return;
        }
      } catch (err) {
        console.warn('navigator.share fallback:', err);
      }
      // Fallback: data URL download
      const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
      const reader = new FileReader();
      reader.onload = () => {
        const a = document.createElement('a');
        a.href = reader.result;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      reader.readAsDataURL(blob);
      toast.remove();
    };
    toast.appendChild(shareBtn);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:transparent;color:#94a3b8;border:none;font-size:14px;padding:4px;cursor:pointer;';
    closeBtn.onclick = () => toast.remove();
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 15000);
  }

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const map = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
      odt: 'application/vnd.oasis.opendocument.text',
      rtf: 'application/rtf',
      md: 'text/markdown',
      txt: 'text/plain',
      html: 'text/html',
      png: 'image/png'
    };
    return map[ext] || 'application/octet-stream';
  }

  // Polyfill showSaveFilePicker for Android WebView so File > Save / Export works reliably
  if (typeof window.showSaveFilePicker !== 'function') {
    window.showSaveFilePicker = async function (opts) {
      const suggested = (opts && opts.suggestedName) ? opts.suggestedName : 'Document.docx';
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
              const mime = guessMime(suggested);
              showSaveToast(suggested, merged, mime);
            }
          };
        }
      };
    };
  }

  // Build Floating Mobile Control Pill
  window.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'wc-mobile-pill';
    bar.style.cssText = [
      'position:fixed;right:10px;bottom:10px;z-index:99998;',
      'display:flex;align-items:center;gap:5px;background:rgba(15,23,42,0.82);',
      'backdrop-filter:blur(8px);padding:5px 8px;border-radius:999px;',
      'border:1px solid rgba(255,255,255,0.16);box-shadow:0 4px 14px rgba(0,0,0,0.3);',
      'font:600 11px system-ui,sans-serif;color:#f8fafc;user-select:none;'
    ].join('');

    const btnStyle = [
      'background:rgba(255,255,255,0.12);color:#f8fafc;border:none;border-radius:999px;',
      'padding:5px 9px;font:600 11px system-ui,sans-serif;cursor:pointer;'
    ].join('');

    // 1. Virtual Keyboard button
    const kbBtn = document.createElement('button');
    kbBtn.textContent = '⌨️ Ketik';
    kbBtn.style.cssText = btnStyle;
    kbBtn.title = 'Munculkan Keyboard Android';
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

    // 2. UI Scale cycle button (75% -> 85% -> 100% -> 115%)
    const scaleBtn = document.createElement('button');
    const scales = [75, 85, 100, 115];
    function getSavedScale() {
      try {
        const parsed = JSON.parse(localStorage.getItem('wordcraft.ui') || '{}');
        return typeof parsed.uiScale === 'number' ? parsed.uiScale : 85;
      } catch (_) {
        return 85;
      }
    }
    scaleBtn.textContent = '🔍 ' + getSavedScale() + '%';
    scaleBtn.style.cssText = btnStyle;
    scaleBtn.title = 'Ubah Skala Ukuran UI';
    scaleBtn.onclick = (e) => {
      e.stopPropagation();
      const cur = getSavedScale();
      const next = scales[(scales.indexOf(cur) + 1) % scales.length] || 85;
      try {
        const parsed = JSON.parse(localStorage.getItem('wordcraft.ui') || '{}');
        parsed.uiScale = next;
        localStorage.setItem('wordcraft.ui', JSON.stringify(parsed));
        location.reload();
      } catch (_) {}
    };

    // 3. Fullscreen / Landscape toggle
    const rotBtn = document.createElement('button');
    rotBtn.textContent = '⛶ Layar';
    rotBtn.style.cssText = btnStyle;
    rotBtn.title = 'Toggle Layar Penuh / Landscape';
    rotBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
          if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape').catch(() => {});
          }
        } else if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      } catch (_) {}
    };

    // 4. Collapse/Minimize toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '‹';
    toggleBtn.style.cssText = 'background:transparent;color:#94a3b8;border:none;padding:2px 5px;font-size:13px;cursor:pointer;';
    let collapsed = false;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      collapsed = !collapsed;
      kbBtn.style.display = collapsed ? 'none' : '';
      scaleBtn.style.display = collapsed ? 'none' : '';
      rotBtn.style.display = collapsed ? 'none' : '';
      toggleBtn.textContent = collapsed ? '⚙️' : '‹';
    };

    bar.appendChild(kbBtn);
    bar.appendChild(scaleBtn);
    bar.appendChild(rotBtn);
    bar.appendChild(toggleBtn);
    document.body.appendChild(bar);
  });
})();
`;

fs.writeFileSync(path.join(DIST, 'mobile-bridge.js'), mobileBridgeCode, 'utf8');

// 3. Inject <script src="./mobile-bridge.js"></script> into dist/index.html if not already present
const indexHtmlPath = path.join(DIST, 'index.html');
let html = fs.readFileSync(indexHtmlPath, 'utf8');
if (!html.includes('mobile-bridge.js')) {
  html = html.replace('<head>', '<head>\n  <script src="./mobile-bridge.js"></script>');
  fs.writeFileSync(indexHtmlPath, html, 'utf8');
  console.log('✅ Injected mobile-bridge.js into dist/index.html');
}
