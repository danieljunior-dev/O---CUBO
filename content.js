/* O Cubo — content script: modo Inspecionar, captura do DOM e painel de código */
(() => {
  if (window.__oCubo) return;

  /******************************************************************
   * 1. CONSTANTES DE CAPTURA
   ******************************************************************/
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_NODES = 800;
  const RAW_LIMIT = 200000;
  const PAGE_MAX_NODES = 12000;
  const PAGE_RAW_LIMIT = 3000000;

  const DROP_TAGS = new Set(['script', 'noscript', 'style', 'link', 'meta', 'template', 'base', 'head', 'title']);
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  const SIZED_TAGS = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'picture', 'input', 'textarea', 'select', 'hr', 'progress', 'meter', 'object', 'embed']);
  const SVG_GEOMETRY = new Set(['d', 'x', 'y', 'r', 'rx', 'ry', 'cx', 'cy']);
  const ALLOWED_PREFIXED = new Set([
    '-webkit-text-fill-color', '-webkit-line-clamp', '-webkit-box-orient',
    '-webkit-text-stroke-width', '-webkit-text-stroke-color', '-webkit-background-clip'
  ]);
  const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch',
    'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing',
    'font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian',
    'font-variant-alternates', 'font-variant-position', 'font-palette', 'font-size-adjust',
    'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps',
    'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform',
    'text-shadow', 'text-rendering', 'white-space', 'white-space-collapse', 'text-wrap', 'text-wrap-mode',
    'text-wrap-style', 'word-break', 'overflow-wrap', 'hyphens', 'tab-size', 'direction', 'visibility',
    'cursor', 'list-style-type', 'list-style-position', 'list-style-image', 'quotes', 'caret-color',
    'border-collapse', 'border-spacing', 'caption-side', 'empty-cells', 'orphans', 'widows',
    'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'paint-order',
    'color-scheme', 'accent-color', 'pointer-events', 'user-select', 'writing-mode', 'text-orientation',
    'text-underline-position', 'text-decoration-skip-ink', 'image-rendering', 'shape-rendering',
    'text-anchor', 'dominant-baseline', 'clip-rule', 'color-interpolation', 'color-interpolation-filters',
    'marker-start', 'marker-mid', 'marker-end', 'line-break', 'ruby-position', 'hyphenate-character',
    'print-color-adjust', 'forced-color-adjust', 'math-depth', 'math-shift', 'math-style',
    'text-emphasis-color', 'text-emphasis-style', 'text-emphasis-position', 'text-spacing-trim', 'text-autospace',
    '-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color'
  ]);
  const SKIP_PROP = new RegExp(
    '^(block-size|inline-size|(min|max)-(block|inline)-size|(margin|padding|inset|border)-(block|inline)|' +
    'border-(start|end)-|scroll-|overscroll-|animation|will-change|view-transition|contain-intrinsic|anchor-|' +
    'position-try|position-anchor|position-visibility|transition-behavior|app-region|interactivity|reading-|' +
    'field-sizing|timeline-scope|view-timeline|scroll-timeline|content-visibility|perspective-origin|' +
    'transform-origin|text-size-adjust|zoom$|overflow-(block|inline)$)'
  );
  const PSEUDO_PROPS = [
    'content', 'display', 'position', 'top', 'right', 'bottom', 'left', 'inset', 'width', 'height', 'z-index',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'border-top-width', 'border-top-style', 'border-top-color', 'border-right-width', 'border-right-style',
    'border-right-color', 'border-bottom-width', 'border-bottom-style', 'border-bottom-color',
    'border-left-width', 'border-left-style', 'border-left-color', 'border-top-left-radius',
    'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'color', 'font-size', 'font-weight', 'opacity', 'transform', 'box-shadow', 'filter', 'margin-top',
    'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'
  ];

  /******************************************************************
   * 2. INTERFACE (SHADOW DOM ISOLADO DA PÁGINA)
   ******************************************************************/
  // Sites com Trusted Types (YouTube, Gmail…) bloqueiam innerHTML/srcdoc com string comum
  let ttPolicy = null;
  try {
    if (window.trustedTypes?.createPolicy) ttPolicy = trustedTypes.createPolicy('o-cubo', { createHTML: s => s });
  } catch { /* nome de política não permitido pela página */ }
  const trusted = html => (ttPolicy ? ttPolicy.createHTML(html) : html);

  const host = document.createElement('div');
  host.id = 'o-cubo-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });

  const cubeFace = cls => `<div class="face ${cls}">${'<span></span>'.repeat(9)}</div>`;

  shadow.innerHTML = trusted(`
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; }
    .ui { font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #f1f5f9; font-size: 13px; line-height: 1.4; }
    .mono { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace; }
    button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
    [hidden] { display: none !important; }

    /* Caixa de destaque do elemento sob o mouse */
    .hl { position: fixed; pointer-events: none; border: 2px dashed #00ff88; background: rgba(0,255,136,.07);
          box-shadow: 0 0 22px rgba(0,255,136,.35); border-radius: 4px; transition: all .08s ease-out; display: none; }
    .hl-tag { position: fixed; pointer-events: none; display: none; padding: 2px 8px; border-radius: 6px;
              background: #05080b; border: 1px solid #00ff88; color: #00ff88; font-size: 11px; font-weight: 600;
              white-space: nowrap; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 0 12px rgba(0,255,136,.5); }
    .hl-tag b { color: #fff; font-weight: 600; margin-left: 6px; }

    /* Barra superior do modo inspecionar */
    .bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; align-items: center;
           gap: 10px; padding: 6px 8px 6px 14px; border-radius: 999px; background: rgba(5,8,11,.92); border: 1px solid #00ff88;
           box-shadow: 0 0 20px rgba(0,255,136,.3); backdrop-filter: blur(12px); font-size: 12px; white-space: nowrap; }
    .bar .dot { width: 8px; height: 8px; border-radius: 50%; background: #00ff88; box-shadow: 0 0 8px #00ff88; animation: pulse 1.4s infinite; }
    .bar kbd { font-family: inherit; font-size: 10px; padding: 1px 5px; border-radius: 4px; border: 1px solid #182632; background: #0c131a; color: #94a3b8; }
    .bar .muted { color: #94a3b8; }
    .bar button { padding: 4px 10px; border-radius: 999px; background: #0c131a; border: 1px solid #182632; font-size: 11px; }
    .bar button:hover { border-color: #00ff88; color: #00ff88; }
    @keyframes pulse { 50% { opacity: .35; } }

    /* Botão flutuante com o mini cubo 3D */
    .fab-wrap { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 8px; pointer-events: auto; }
    .hint { padding: 4px 10px; border-radius: 8px; background: rgba(0,0,0,.85); border: 1px solid rgba(0,255,136,.4);
            color: #00ff88; font-size: 11px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
    .fab { width: 56px; height: 56px; border-radius: 16px; background: #071016; border: 2px solid #00ff88; display: grid; place-items: center;
           box-shadow: 0 0 30px rgba(0,255,136,.55), 0 0 60px rgba(16,185,129,.3); transition: transform .15s; }
    .fab:active { transform: scale(.9); }
    .fab.off { border-color: #334155; box-shadow: 0 6px 20px rgba(0,0,0,.5); }
    .scene { width: 28px; height: 28px; perspective: 120px; }
    .cube { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; animation: spin 6s infinite linear; }
    .cube.fast { animation-duration: .7s; }
    .face { position: absolute; width: 28px; height: 28px; background: rgba(5,12,16,.88); border: 1.5px solid #00ff88;
            box-shadow: inset 0 0 6px rgba(0,255,136,.4); display: grid; grid-template: repeat(3,1fr) / repeat(3,1fr); gap: 1px; padding: 1px; }
    .face span { background: rgba(0,255,136,.2); border: .5px solid rgba(0,255,136,.5); }
    .front { transform: rotateY(0) translateZ(14px); } .right { transform: rotateY(90deg) translateZ(14px); }
    .back { transform: rotateY(180deg) translateZ(14px); } .left { transform: rotateY(-90deg) translateZ(14px); }
    .top { transform: rotateX(90deg) translateZ(14px); } .bottom { transform: rotateX(-90deg) translateZ(14px); }
    @keyframes spin { from { transform: rotateX(-28deg) rotateY(0) rotateZ(15deg); } to { transform: rotateX(-28deg) rotateY(360deg) rotateZ(15deg); } }

    /* Partículas de absorção DOM -> Cubo */
    .particle { position: fixed; pointer-events: none; font-size: 10px; font-weight: 700; color: #00ff88; background: rgba(5,12,16,.9);
                border: 1px solid #00ff88; padding: 2px 6px; border-radius: 6px; box-shadow: 0 0 12px rgba(0,255,136,.8);
                transition: transform .65s cubic-bezier(.5,0,.2,1), opacity .65s ease; }

    /* Painel de resultado */
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.72); backdrop-filter: blur(6px); display: flex;
                align-items: center; justify-content: center; padding: 16px; pointer-events: auto; }
    .panel { width: 100%; max-width: 820px; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
             background: #080e14; border: 2px solid #00ff88; border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 40px rgba(0,255,136,.15); }
    .p-head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #0c151e; border-bottom: 1px solid #182632; }
    .badge3 { width: 30px; height: 30px; flex: none; border-radius: 8px; display: grid; place-items: center; background: rgba(0,255,136,.2);
              border: 1px solid #00ff88; color: #00ff88; font-weight: 700; font-size: 12px; }
    .p-titles { flex: 1; min-width: 0; }
    .row { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .p-title { margin: 0; font-size: 14px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pill { flex: none; font-size: 10px; padding: 1px 6px; border-radius: 4px; background: rgba(0,255,136,.15); color: #00ff88; border: 1px solid rgba(0,255,136,.3); }
    .p-stats { margin: 2px 0 0; font-size: 11px; color: #34d399; }
    .icon-btn { width: 32px; height: 32px; flex: none; border-radius: 10px; background: rgba(30,41,59,.8); color: #cbd5e1; }
    .icon-btn:hover { color: #fff; }
    .p-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; border-bottom: 1px solid rgba(30,41,59,.8); }
    .seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 12px; background: #0d1620; border: 1px solid #1e293b; }
    .seg button { padding: 6px 10px; border-radius: 9px; font-size: 12px; font-weight: 700; color: #94a3b8; }
    .seg button:hover { color: #fff; }
    .seg button.on { background: #00ff88; color: #020617; }
    .stack { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #94a3b8; }
    .stack button { padding: 4px 9px; border-radius: 8px; font-size: 11px; font-weight: 600; background: #0f172a; color: #94a3b8; border: 1px solid #1e293b; }
    .stack button.on { background: rgba(0,255,136,.2); color: #00ff88; border-color: #00ff88; }
    .p-body { padding: 14px 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .code-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #0d1722;
                 border: 1px solid #1e293b; border-bottom: 0; border-radius: 12px 12px 0 0; }
    .code-label { font-size: 11px; color: #00ff88; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .code-label.warn { color: #fbbf24; }
    .actions { display: flex; gap: 6px; flex: none; }
    .btn { padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; background: #1e293b; color: #e2e8f0; }
    .btn:hover { background: #334155; }
    .btn.primary { background: #00ff88; color: #020617; }
    .btn.primary:hover { background: #34ffa0; }
    .btn:disabled { opacity: .5; cursor: progress; }
    pre { margin: 0; padding: 12px 14px; background: #05090e; border: 1px solid #1e293b; border-radius: 0 0 12px 12px; overflow: auto;
          max-height: 52vh; font-size: 12px; line-height: 1.6; color: #6ee7b7; white-space: pre; tab-size: 2; user-select: text; }
    .note { padding: 10px 12px; border-radius: 12px; background: rgba(2,44,34,.35); border: 1px solid rgba(16,185,129,.3); font-size: 12px; color: #cbd5e1; }
    .note b { color: #fff; }
    .note a { color: #00ff88; }
    .ai-cta { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .preview { width: 100%; height: 52vh; border: 1px dashed rgba(0,255,136,.5); border-radius: 16px; background: #fff; }
    .p-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 16px; background: #0c151e; border-top: 1px solid #1e293b; }
    .p-foot .model { font-size: 11px; color: #94a3b8; }

    /* Seleção de área para captura por imagem */
    .sel-layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: rgba(5,8,11,.35); }
    .sel-box { position: fixed; display: none; border: 2px solid #00ff88; background: rgba(0,255,136,.08);
               box-shadow: 0 0 0 9999px rgba(5,8,11,.55), 0 0 24px rgba(0,255,136,.5); border-radius: 4px; }
    .sel-size { position: absolute; right: 0; bottom: -24px; padding: 1px 6px; border-radius: 5px; background: #05080b;
                border: 1px solid #00ff88; color: #00ff88; font-size: 11px; white-space: nowrap; }
    .sel-hint { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 999px;
                background: rgba(5,8,11,.92); border: 1px solid #00ff88; color: #f1f5f9; font-size: 12px; white-space: nowrap;
                box-shadow: 0 0 20px rgba(0,255,136,.3); pointer-events: none; }
    .sel-hint b { color: #00ff88; }

    /* Escolha: só esta página ou site inteiro */
    .choice-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.72); backdrop-filter: blur(6px); display: flex;
                       align-items: center; justify-content: center; padding: 16px; pointer-events: auto; }
    .choice { width: 100%; max-width: 640px; max-height: 88vh; overflow: auto; background: #080e14; border: 2px solid #00ff88;
              border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.6), 0 0 40px rgba(0,255,136,.15); }
    .choice-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid #182632; background: #0c151e; }
    .choice-head h3 { margin: 0; font-size: 15px; color: #fff; }
    .choice-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
    .choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .choice-card { display: flex; flex-direction: column; gap: 6px; text-align: left; padding: 16px; border-radius: 16px;
                   background: #070c10; border: 1px solid #182632; transition: border-color .15s, transform .15s; }
    .choice-card:hover { border-color: #00ff88; transform: translateY(-2px); }
    .choice-card .big { font-size: 28px; }
    .choice-card b { color: #fff; font-size: 14px; }
    .choice-card small { color: #94a3b8; font-size: 12px; line-height: 1.45; }
    .site-opts { display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: #cbd5e1; }
    .site-opts label { display: flex; align-items: center; gap: 8px; }
    .site-opts input[type=number] { width: 90px; padding: 6px 8px; border-radius: 8px; background: #070c10; color: #fff;
                                    border: 1px solid #182632; font: inherit; }
    .site-opts input[type=checkbox] { accent-color: #00ff88; width: 16px; height: 16px; }
    .site-opts p { margin: 0; color: #94a3b8; line-height: 1.5; }
    .site-opts b { color: #00ff88; }
    .bar-track { height: 8px; border-radius: 999px; background: #16222c; overflow: hidden; }
    .bar-fill { height: 100%; width: 0; background: linear-gradient(90deg, #10b981, #00ff88); box-shadow: 0 0 12px #00ff88; transition: width .3s; }
    .crawl-status { margin: 0; font-size: 12px; color: #00ff88; }
    .crawl-log { list-style: none; margin: 0; padding: 10px 12px; max-height: 34vh; overflow: auto; border-radius: 12px;
                 background: #05090e; border: 1px solid #1e293b; font-size: 11px; color: #94a3b8; }
    .crawl-log li { padding: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .crawl-log li.err { color: #fca5a5; }
    .crawl-log li.ok { color: #00ff88; font-weight: 700; }
    @media (max-width: 560px) { .choice-grid { grid-template-columns: 1fr; } }

    /* Cópia exata com assets (página inteira) */
    .exact-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
                 padding: 10px 12px; border-radius: 12px; background: rgba(0,255,136,.07); border: 1px solid rgba(0,255,136,.45); }
    .exact-bar p { margin: 0; font-size: 12px; color: #cbd5e1; flex: 1; min-width: 260px; }
    .exact-bar b { color: #fff; }
    .exact-status { display: block; margin-top: 4px; font-size: 11px; color: #00ff88; }

    /* Aba Por Imagem */
    .shot-wrap { display: flex; flex-direction: column; gap: 10px; }
    .shot-stage { display: flex; justify-content: center; padding: 12px; border-radius: 16px; background: #05090e;
                  border: 1px dashed rgba(0,255,136,.5); max-height: 34vh; overflow: auto; }
    .shot-img { max-width: 100%; height: auto; border-radius: 6px; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
    .shot-empty { color: #94a3b8; font-size: 12px; padding: 30px 0; }
    .shot-preview { width: 100%; height: 42vh; border: 1px dashed rgba(0,255,136,.5); border-radius: 16px; background: #fff; }
    .seg.solo button:not([data-view="image"]) { display: none; }

    /* Toast */
    .toast { position: fixed; top: 60px; left: 50%; transform: translate(-50%, -8px); opacity: 0; transition: all .3s; pointer-events: none;
             padding: 8px 16px; border-radius: 999px; background: #071218; border: 1px solid #00ff88; color: #00ff88; font-size: 12px; font-weight: 700;
             box-shadow: 0 0 20px rgba(0,255,136,.25); }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
  </style>

  <div class="ui">
    <div class="hl"></div>
    <div class="hl-tag mono"></div>

    <div class="bar" hidden>
      <span class="dot"></span>
      <strong>O Cubo · Inspecionando</strong>
      <span class="muted">Clique num elemento · <kbd>↑</kbd> pai · <kbd>↓</kbd> filho · <kbd>Esc</kbd> sair</span>
      <button data-act="page" title="Clonar esta página ou o site inteiro, sem IA (Alt+Shift+P)">🌐 Clonar</button>
      <button data-act="shot" title="Recortar uma área e gerar código pela imagem (Alt+Shift+S)">📸 Área</button>
      <button data-act="stop">Pausar</button>
      <button data-act="destroy" title="Remover O Cubo desta página">✕</button>
    </div>

    <div class="fab-wrap">
      <div class="hint mono">Toque num elemento ↑</div>
      <button class="fab" data-act="toggle" title="Ativar/Desativar O Cubo (Alt+Shift+C)">
        <div class="scene"><div class="cube">
          ${cubeFace('front')}${cubeFace('back')}${cubeFace('right')}${cubeFace('left')}${cubeFace('top')}${cubeFace('bottom')}
        </div></div>
      </button>
    </div>

    <div class="backdrop" hidden>
      <div class="panel" role="dialog" aria-modal="true">
        <header class="p-head">
          <div class="badge3 mono">3³</div>
          <div class="p-titles">
            <div class="row"><h3 class="p-title"></h3><span class="pill mono p-dims"></span></div>
            <p class="p-stats mono"></p>
          </div>
          <button class="icon-btn" data-act="close" title="Fechar (Esc)">✕</button>
        </header>

        <div class="p-bar">
          <div class="seg">
            <button data-view="clean" class="on">✨ Código Limpo</button>
            <button data-view="raw">🕸️ Bruto do Site</button>
            <button data-view="preview">▶️ Preview Isolado</button>
            <button data-view="ai">🧠 Refatorar com IA</button>
            <button data-view="image">📸 Por Imagem</button>
          </div>
          <div class="stack mono" data-for="clean">
            Stack:
            <button data-stack="html" class="on">HTML + CSS</button>
            <button data-stack="react">React (JSX)</button>
          </div>
          <div class="stack mono" data-for="ai" hidden>
            Saída:
            <button data-ai="react-tailwind" class="on">React + Tailwind</button>
            <button data-ai="html">HTML + CSS</button>
            <button data-ai="logic">Só Lógica JS</button>
          </div>
          <div class="stack mono" data-for="image" hidden>
            Saída:
            <button data-img="react-tailwind" class="on">React + Tailwind</button>
            <button data-img="html">HTML + CSS</button>
          </div>
        </div>

        <div class="p-body">
          <div class="exact-bar" hidden>
            <p><b>📦 Cópia exata com assets:</b> HTML e CSS originais do site (hover, responsivo, animações), imagens, fontes, ícones e links funcionando — tudo local, sem IA.
              <span class="exact-status mono"></span></p>
            <div class="actions">
              <button class="btn" data-act="exact-html" title="Um único arquivo .html com tudo embutido">📄 HTML único</button>
              <button class="btn primary" data-act="exact-zip" title="index.html + pasta assets/">📦 Baixar ZIP</button>
            </div>
          </div>
          <div class="ai-cta" hidden>
            <div class="note ai-note"></div>
            <button class="btn primary" data-act="ai-run">⚡ Gerar com IA</button>
          </div>
          <div class="shot-wrap" hidden>
            <div class="shot-stage"><img class="shot-img" alt="Captura de tela"><span class="shot-empty mono" hidden>Capturando a tela…</span></div>
            <div class="ai-cta">
              <div class="note img-note"></div>
              <div class="actions">
                <button class="btn" data-act="shot-again">📸 Recortar outra área</button>
                <button class="btn" data-act="img-local" title="Lê o código real da página dentro da área — sem IA, sem internet">🧩 Gerar local (sem IA)</button>
                <button class="btn primary" data-act="img-run">⚡ Gerar com IA</button>
              </div>
            </div>
          </div>
          <div class="code-wrap">
            <div class="code-head">
              <span class="code-label mono"></span>
              <div class="actions">
                <button class="btn" data-act="download">Baixar</button>
                <button class="btn primary" data-act="copy">Copiar Código</button>
              </div>
            </div>
            <pre class="mono"><code class="code"></code></pre>
          </div>
          <div class="preview-wrap" hidden>
            <div class="note">🧪 <b>Sandbox isolado:</b> o componente clonado renderizado fora do site de origem, só com o CSS extraído.</div>
            <iframe class="preview" sandbox="allow-same-origin" title="Preview isolado"></iframe>
          </div>
          <iframe class="shot-preview" sandbox="allow-same-origin" title="Preview do código gerado pela imagem" hidden></iframe>
        </div>

        <footer class="p-foot">
          <span class="model mono">Extração local · estilos computados</span>
          <div class="actions">
            <button class="btn" data-act="reselect">Capturar outro</button>
            <button class="btn" data-act="close">Fechar Painel</button>
          </div>
        </footer>
      </div>
    </div>

    <div class="choice-backdrop" hidden>
      <div class="choice" role="dialog" aria-modal="true">
        <header class="choice-head">
          <h3>🌐 O que você quer clonar?</h3>
          <button class="icon-btn" data-act="choice-close" title="Fechar (Esc)">✕</button>
        </header>
        <div class="choice-body">
          <div class="choice-grid">
            <button class="choice-card" data-act="choose-page">
              <span class="big">📄</span><b>Só esta página</b>
              <small>A página aberta: código limpo, preview, React e cópia exata com assets (ZIP ou HTML único).</small>
            </button>
            <button class="choice-card" data-act="choose-site">
              <span class="big">🗺️</span><b>Site inteiro</b>
              <small>Todas as páginas do mesmo domínio, com assets e links internos funcionando offline, num ZIP navegável.</small>
            </button>
          </div>
          <div class="site-opts" hidden>
            <label>Máximo de páginas <input type="number" class="opt-max" min="1" max="500" value="50"></label>
            <label><input type="checkbox" class="opt-robots" checked> Respeitar o robots.txt do site</label>
            <p>Fica só em <b class="opt-host"></b>. Links de sair/logout/excluir são ignorados. As páginas abrem numa janela
              minimizada — <b>mantenha esta aba aberta</b> até o ZIP baixar.</p>
            <div class="actions">
              <button class="btn" data-act="choice-back">← Voltar</button>
              <button class="btn primary" data-act="crawl-start">🚀 Clonar site inteiro</button>
            </div>
          </div>
          <div class="crawl-progress" hidden>
            <div class="bar-track"><div class="bar-fill"></div></div>
            <p class="crawl-status mono"></p>
            <ul class="crawl-log mono"></ul>
            <div class="actions">
              <button class="btn" data-act="crawl-cancel">⏹ Parar e baixar o que já foi</button>
              <button class="btn" data-act="choice-close">Fechar</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="sel-layer" hidden>
      <div class="sel-hint">📸 <b>Arraste</b> para recortar a área que O Cubo vai transformar em código · <b>Esc</b> cancela</div>
      <div class="sel-box"><span class="sel-size mono"></span></div>
    </div>

    <div class="toast mono"></div>
  </div>`);

  const $ = sel => shadow.querySelector(sel);
  const ui = {
    hl: $('.hl'), tag: $('.hl-tag'), bar: $('.bar'), fab: $('.fab'), cube: $('.cube'), hint: $('.hint'),
    backdrop: $('.backdrop'), title: $('.p-title'), dims: $('.p-dims'), stats: $('.p-stats'),
    codeWrap: $('.code-wrap'), codeLabel: $('.code-label'), code: $('.code'),
    previewWrap: $('.preview-wrap'), preview: $('.preview'), aiCta: $('.ai-cta'), aiNote: $('.ai-note'),
    aiRun: $('[data-act="ai-run"]'), model: $('.model'), toast: $('.toast'),
    seg: $('.seg'), shotWrap: $('.shot-wrap'), shotImg: $('.shot-img'), shotEmpty: $('.shot-empty'),
    imgNote: $('.img-note'), imgRun: $('[data-act="img-run"]'), imgLocal: $('[data-act="img-local"]'), shotPreview: $('.shot-preview'),
    selLayer: $('.sel-layer'), selBox: $('.sel-box'), selSize: $('.sel-size'),
    exactBar: $('.exact-bar'), exactStatus: $('.exact-status'),
    choice: $('.choice-backdrop'), choiceGrid: $('.choice-grid'), siteOpts: $('.site-opts'), optMax: $('.opt-max'),
    optRobots: $('.opt-robots'), optHost: $('.opt-host'), crawlProgress: $('.crawl-progress'), crawlFill: $('.bar-fill'),
    crawlStatus: $('.crawl-status'), crawlLog: $('.crawl-log'), crawlCancelBtn: $('[data-act="crawl-cancel"]'),
    exactBtns: [$('[data-act="exact-html"]'), $('[data-act="exact-zip"]')]
  };
  document.documentElement.appendChild(host);

  /******************************************************************
   * 3. ESTADO
   ******************************************************************/
  let inspecting = false;
  let hovered = null;
  const childTrail = [];
  let result = null;
  let view = 'clean';
  let cleanStack = 'html';
  let aiStack = 'react-tailwind';
  const aiResults = {};
  let aiBusy = false;
  let capturedEl = null;      // elemento da última captura DOM (para o print sob demanda)
  let shot = null;            // { dataUrl, width, height } da captura por imagem
  let imageStack = 'react-tailwind';
  const imageResults = {};
  let imageBusy = false;
  let areaResult = null;      // código local (DOM) da área recortada

  const isOurs = e => e.composedPath().includes(host);

  /******************************************************************
   * 4. MODO INSPECIONAR
   ******************************************************************/
  function setHint(text) { ui.hint.textContent = text; }

  function activate() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (inspecting) return;
    inspecting = true;
    ui.bar.hidden = false;
    ui.fab.classList.remove('off');
    setHint('Toque num elemento ↑');
    showToast('Modo Inspecionar d\'O Cubo ATIVADO');
  }

  function stop() {
    inspecting = false;
    hovered = null;
    ui.bar.hidden = true;
    ui.hl.style.display = ui.tag.style.display = 'none';
    ui.fab.classList.add('off');
    setHint('Inspeção pausada');
  }

  function toggle() { inspecting ? stop() : activate(); }

  function destroy() {
    stop();
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('keydown', onKey, true);
    BLOCKED_EVENTS.forEach(t => window.removeEventListener(t, onBlock, true));
    window.removeEventListener('click', onClick, true);
    host.remove();
    delete window.__oCubo;
  }

  function describe(el) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return el.localName + (el.id ? '#' + el.id : '') + cls.map(c => '.' + c).join('');
  }

  function highlight(el) {
    hovered = el;
    if (!el) { ui.hl.style.display = ui.tag.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(ui.hl.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
    ui.tag.replaceChildren();
    ui.tag.append(describe(el));
    const size = document.createElement('b');
    size.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
    ui.tag.append(size);
    ui.tag.style.display = 'block';
    const tagTop = r.top > 26 ? r.top - 24 : Math.min(r.bottom + 4, innerHeight - 24);
    ui.tag.style.left = Math.max(4, Math.min(r.left, innerWidth - 260)) + 'px';
    ui.tag.style.top = tagTop + 'px';
  }

  function onMove(e) {
    if (!inspecting || !ui.backdrop.hidden) return;
    if (isOurs(e)) { highlight(null); return; }
    const el = e.target;
    if (el && el !== hovered && el.nodeType === 1) {
      childTrail.length = 0;
      highlight(el);
    }
  }

  function onScroll() { if (hovered) highlight(hovered); }

  const BLOCKED_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick', 'auxclick', 'contextmenu'];
  function onBlock(e) {
    if (!inspecting || !ui.backdrop.hidden || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!inspecting || !ui.backdrop.hidden || isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = hovered || e.target;
    if (el && el.nodeType === 1) absorb(el);
  }

  function onKey(e) {
    if (!ui.choice.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeChoice(); }
      return;
    }
    if (!ui.selLayer.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancelShot(); }
      return;
    }
    if (!ui.backdrop.hidden) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closePanel(); }
      return;
    }
    if (!inspecting) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); }
    else if (e.key === 'ArrowUp' && hovered && hovered.parentElement && hovered.parentElement !== document.documentElement) {
      e.preventDefault(); childTrail.push(hovered); highlight(hovered.parentElement);
    } else if (e.key === 'ArrowDown' && hovered) {
      e.preventDefault();
      const next = childTrail.pop() || hovered.firstElementChild;
      if (next) highlight(next);
    } else if (e.key === 'Enter' && hovered) {
      e.preventDefault(); absorb(hovered);
    }
  }

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('click', onClick, true);
  BLOCKED_EVENTS.forEach(t => window.addEventListener(t, onBlock, { capture: true, passive: false }));

  /******************************************************************
   * 5. ABSORÇÃO (ANIMAÇÃO) -> CAPTURA -> PAINEL
   ******************************************************************/
  function spawnParticles(el) {
    const r = el.getBoundingClientRect();
    const c = ui.fab.getBoundingClientRect();
    const dx0 = c.left + c.width / 2, dy0 = c.top + c.height / 2;
    ['<div>', 'flex', 'blur()', '::after', 'useState', '#00ff88', 'grid'].forEach(txt => {
      const p = document.createElement('div');
      p.className = 'particle mono';
      p.textContent = txt;
      const x = Math.max(0, r.left) + Math.random() * Math.max(20, Math.min(r.width, innerWidth) - 50);
      const y = Math.max(0, r.top) + Math.random() * Math.max(20, Math.min(r.height, innerHeight) - 20);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      shadow.querySelector('.ui').appendChild(p);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        p.style.transform = `translate(${dx0 - x}px, ${dy0 - y}px) scale(.2)`;
        p.style.opacity = '0';
      }));
      setTimeout(() => p.remove(), 750);
    });
  }

  function absorb(el) {
    spawnParticles(el);
    ui.cube.classList.add('fast');
    setHint('Absorvendo HTML/CSS...');
    ui.hl.style.display = ui.tag.style.display = 'none';
    setTimeout(() => {
      try {
        result = capture(el);
        capturedEl = el;
        areaResult = null;
        shotTriedFor = null;
        shot = null;
        [aiResults, imageResults].forEach(o => Object.keys(o).forEach(k => delete o[k]));
        openPanel();
        setHint('Componente Clonado!');
      } catch (err) {
        console.error('[O Cubo] Falha na captura', err);
        showToast('Não foi possível capturar este elemento');
        setHint('Falha na captura');
      } finally {
        ui.cube.classList.remove('fast');
      }
    }, 650);
  }

  // Clona o <body> inteiro como um documento HTML independente — tudo local, sem IA
  function clonePage() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (inspecting) stop();
    ui.backdrop.hidden = true;
    ui.cube.classList.add('fast');
    setHint('Clonando a página inteira…');
    showToast('Clonando a página inteira… pode levar alguns segundos');
    setTimeout(() => {
      try {
        const t0 = performance.now();
        result = capture(document.body, { fullPage: true });
        setExactStatus('Escolha ZIP (pasta de assets) ou HTML único (tudo em um arquivo).');
        result.ms = Math.round(performance.now() - t0);
        capturedEl = document.body;
        areaResult = null;
        shotTriedFor = null;
        shot = null;
        [aiResults, imageResults].forEach(o => Object.keys(o).forEach(k => delete o[k]));
        openPanel();
        setHint('Página clonada!');
      } catch (err) {
        console.error('[O Cubo] Falha ao clonar a página', err);
        showToast('Não foi possível clonar esta página');
        setHint('Falha na captura');
      } finally {
        ui.cube.classList.remove('fast');
      }
    }, 80);
  }

  // Fontes do site: @font-face de folhas acessíveis e @import do Google Fonts
  function collectFontCss() {
    const imports = new Set();
    const faces = new Set();
    const fix = (css, base) => css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      if (/^(data:|https?:|blob:)/i.test(u)) return m;
      try { return `url("${new URL(u, base).href}")`; } catch { return m; }
    });
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch {
        if (sheet.href && /fonts\.googleapis\.com/.test(sheet.href)) imports.add(`@import url("${sheet.href}");`);
        continue;
      }
      const base = sheet.href || location.href;
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE && faces.size < 200) faces.add(fix(rule.cssText, base));
        else if (rule.type === CSSRule.IMPORT_RULE && /fonts\.googleapis\.com/.test(rule.href)) imports.add(`@import url("${rule.href}");`);
      }
    }
    return [...imports, ...faces].join('\n');
  }

  /******************************************************************
   * 5a. CÓPIA EXATA: DOM RENDERIZADO + CSS ORIGINAL + ASSETS LOCAIS
   ******************************************************************/
  const ASSET_CONCURRENCY = 6;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let exactBusy = false;

  function setExactStatus(text) {
    ui.exactStatus.textContent = text;
    if (crawling) ui.crawlStatus.textContent = text;
  }

  // Rola a página para disparar o carregamento preguiçoso de imagens
  async function preloadLazyContent() {
    const start = scrollY;
    const step = Math.max(200, innerHeight * 0.85);
    const max = Math.min(document.documentElement.scrollHeight, 60000);
    for (let y = 0; y < max; y += step) {
      scrollTo(0, y);
      setExactStatus(`Carregando imagens da página… ${Math.min(100, Math.round((y / max) * 100))}%`);
      await sleep(110);
    }
    scrollTo(0, start);
    const pending = [...document.images].filter(img => !img.complete);
    await Promise.race([
      Promise.all(pending.map(img => new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }))),
      sleep(4000)
    ]);
  }

  const resolveUrl = (u, base) => { try { return new URL(u, base).href; } catch { return u; } };
  const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/g;

  // Deixa todos os url() de um CSS absolutos (base = arquivo de origem do CSS)
  const absolutizeCss = (css, base) => css.replace(CSS_URL_RE, (m, a, b, c) => {
    const u = (a ?? b ?? c ?? '').trim();
    if (!u || /^(data:|blob:|#|about:)/i.test(u)) return m;
    return `url("${resolveUrl(u, base)}")`;
  });

  const decodeBase64 = b64 => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const encodeBase64 = bytes => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };

  // Busca um arquivo pelo service worker (sem bloqueio de CORS); blob: só existe nesta aba
  async function fetchBytes(url) {
    if (url.startsWith('blob:')) {
      const res = await fetch(url);
      return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
    }
    const res = await chrome.runtime.sendMessage({ type: 'cubo:fetch', url });
    if (!res?.ok) throw new Error(res?.error || 'falha');
    return { bytes: decodeBase64(res.base64), type: res.type };
  }

  async function fetchText(url) {
    const { bytes } = await fetchBytes(url);
    return new TextDecoder().decode(bytes);
  }

  // CSS de uma folha: regras vivas (inclui CSS-in-JS via insertRule) com @import embutido
  async function sheetCss(sheet, base, depth = 0) {
    let rules;
    try { rules = sheet.cssRules; } catch { rules = null; }
    if (!rules) {
      if (!sheet.href) return '';
      try { return await cssTextWithImports(await fetchText(sheet.href), sheet.href, depth); } catch { return `@import url("${sheet.href}");`; }
    }
    const parts = [];
    for (const rule of rules) {
      if (rule.type === CSSRule.IMPORT_RULE && depth < 4) {
        const href = resolveUrl(rule.href, base);
        const inner = rule.styleSheet ? await sheetCss(rule.styleSheet, href, depth + 1) : '';
        const media = rule.media?.mediaText;
        parts.push(media && media !== 'all' ? `@media ${media} {\n${inner}\n}` : inner);
      } else {
        parts.push(absolutizeCss(rule.cssText, base));
      }
    }
    return parts.join('\n');
  }

  // CSS em texto (folha de outro domínio): resolve @import recursivamente
  async function cssTextWithImports(text, base, depth) {
    const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*([^;]*);/g;
    const imports = [...text.matchAll(IMPORT_RE)];
    let css = text;
    for (const m of imports) {
      const href = resolveUrl(m[1], base);
      let inner = '';
      if (depth < 4) { try { inner = await cssTextWithImports(await fetchText(href), href, depth + 1); } catch { inner = `@import url("${href}");`; } }
      const media = m[2].trim();
      css = css.replace(m[0], media ? `@media ${media} {\n${inner}\n}` : inner);
    }
    return absolutizeCss(css, base);
  }

  const URL_ATTRS = ['href', 'src', 'poster', 'action', 'data', 'background', 'xlink:href', 'formaction', 'cite'];
  const LAZY_ATTRS = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-url'];

  // Clona o DOM renderizado, copiando o estado vivo (canvas, formulários, imagens carregadas)
  function cloneLiveDocument() {
    // Marca temporária para casar cada <style>/<link> do clone com a folha viva
    const sheetNodes = [...document.querySelectorAll('link[rel~="stylesheet"], style')];
    sheetNodes.forEach((n, i) => n.setAttribute('data-cubo-sheet', i));
    const docClone = document.documentElement.cloneNode(true);
    sheetNodes.forEach(n => n.removeAttribute('data-cubo-sheet'));
    cloneLiveDocument.sheetNodes = sheetNodes;
    const live = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
    const copy = [docClone, ...docClone.querySelectorAll('*')];
    live.forEach((el, i) => {
      const c = copy[i];
      if (!c || el === host || host.contains(el)) return;
      const tag = el.localName;
      // URLs sempre absolutas, já resolvidas pelo navegador (respeita <base>)
      for (const name of URL_ATTRS) {
        const v = c.getAttribute(name);
        if (v == null || v.startsWith('#') || /^(data:|javascript:|mailto:|tel:)/i.test(v)) continue;
        c.setAttribute(name, resolveUrl(v, document.baseURI));
      }
      if (tag === 'a' && /^javascript:/i.test(c.getAttribute('href') || '')) c.setAttribute('href', '#');
      for (const attr of [...c.attributes]) if (/^on/i.test(attr.name)) c.removeAttribute(attr.name);
      const style = c.getAttribute('style');
      if (style && style.includes('url(')) c.setAttribute('style', absolutizeCss(style, document.baseURI));

      if (tag === 'img') {
        const lazy = LAZY_ATTRS.map(a => el.getAttribute(a)).find(Boolean);
        const src = el.currentSrc || el.src || (lazy && resolveUrl(lazy, document.baseURI));
        if (src) c.setAttribute('src', src);
        ['srcset', 'sizes', 'loading', 'decoding'].forEach(a => c.removeAttribute(a));
      } else if (tag === 'source' && el.parentElement?.localName === 'picture') {
        c.remove(); // o <img> do <picture> já aponta para a imagem que estava na tela
      } else if (tag === 'canvas') {
        try {
          const img = document.createElement('img');
          img.src = el.toDataURL();
          for (const a of el.attributes) if (a.name !== 'width' && a.name !== 'height') img.setAttribute(a.name, a.value);
          img.setAttribute('width', el.width);
          img.setAttribute('height', el.height);
          c.replaceWith(img);
        } catch { /* canvas protegido (cross-origin) */ }
      } else if (tag === 'input') {
        if (el.type === 'checkbox' || el.type === 'radio') el.checked ? c.setAttribute('checked', '') : c.removeAttribute('checked');
        else if (el.type !== 'password' && el.type !== 'file') c.setAttribute('value', el.value);
      } else if (tag === 'textarea') {
        c.textContent = el.value;
      } else if (tag === 'option') {
        el.selected ? c.setAttribute('selected', '') : c.removeAttribute('selected');
      } else if (tag === 'iframe' && el.getAttribute('srcdoc') == null) {
        c.setAttribute('src', el.src);
      }
    });
    docClone.querySelector('#o-cubo-host')?.remove();
    // Sem scripts: a cópia é o visual renderizado, não a aplicação
    docClone.querySelectorAll(
      'script, noscript, base, link[rel~="preload"], link[rel~="prefetch"], link[rel~="modulepreload"], ' +
      'link[rel~="dns-prefetch"], link[rel~="preconnect"], link[rel~="manifest"], meta[http-equiv="Content-Security-Policy" i], ' +
      'meta[http-equiv="refresh" i], meta[charset]'
    ).forEach(n => n.remove());
    return docClone;
  }

  // Troca <link rel=stylesheet> e <style> pelo CSS vivo, com URLs absolutas
  async function inlineStylesheets(docClone) {
    const liveSheets = new Map();
    for (const sheet of document.styleSheets) if (sheet.ownerNode) liveSheets.set(sheet.ownerNode, sheet);
    const liveNodes = cloneLiveDocument.sheetNodes || [];
    const cloneNodes = [...docClone.querySelectorAll('[data-cubo-sheet]')];
    for (let i = 0; i < cloneNodes.length; i++) {
      const node = cloneNodes[i];
      const liveNode = liveNodes[Number(node.getAttribute('data-cubo-sheet'))];
      setExactStatus(`Copiando folhas de estilo… ${i + 1}/${cloneNodes.length}`);
      const sheet = liveNode && liveSheets.get(liveNode);
      let css = '';
      if (sheet) css = await sheetCss(sheet, sheet.href || document.baseURI);
      else if (node.localName === 'link' && node.getAttribute('href')) {
        try { css = await cssTextWithImports(await fetchText(node.getAttribute('href')), node.getAttribute('href'), 0); } catch { continue; }
      } else css = absolutizeCss(node.textContent, document.baseURI);
      const style = document.createElement('style');
      const media = node.getAttribute('media');
      if (media) style.setAttribute('media', media);
      if (node.localName === 'link') style.setAttribute('data-cubo-href', node.getAttribute('href'));
      if (sheet?.disabled) style.setAttribute('media', 'not all');
      style.textContent = css;
      node.replaceWith(style);
    }
    // Folhas construídas via JS (adoptedStyleSheets)
    for (const sheet of document.adoptedStyleSheets || []) {
      const style = document.createElement('style');
      style.setAttribute('data-cubo-adopted', '');
      style.textContent = await sheetCss(sheet, document.baseURI);
      docClone.querySelector('head')?.appendChild(style);
    }
  }

  // Lista todos os assets referenciados (atributos + url() do CSS)
  function collectAssetUrls(docClone) {
    const urls = new Set();
    const add = u => { if (u && /^(https?:|blob:)/i.test(u)) urls.add(u); };
    docClone.querySelectorAll('img[src], input[type="image"][src], video[poster], embed[src]').forEach(n => add(n.getAttribute(n.localName === 'video' ? 'poster' : 'src')));
    docClone.querySelectorAll('link[href]').forEach(n => { if (/icon|apple-touch/i.test(n.getAttribute('rel') || '')) add(n.getAttribute('href')); });
    docClone.querySelectorAll('image, use').forEach(n => {
      const h = n.getAttribute('href') || n.getAttribute('xlink:href');
      if (h && !h.startsWith('#')) add(h.split('#')[0]);
    });
    docClone.querySelectorAll('video source[src], audio source[src], video[src], audio[src]').forEach(n => add(n.getAttribute('src')));
    const scanCss = css => { for (const m of css.matchAll(CSS_URL_RE)) add((m[1] ?? m[2] ?? m[3] ?? '').trim()); };
    docClone.querySelectorAll('style').forEach(s => scanCss(s.textContent));
    docClone.querySelectorAll('[style]').forEach(n => scanCss(n.getAttribute('style')));
    return [...urls];
  }

  const MIME_EXT = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
    'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico', 'font/woff2': 'woff2',
    'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff': 'woff', 'video/mp4': 'mp4',
    'video/webm': 'webm', 'audio/mpeg': 'mp3', 'text/css': 'css'
  };

  function assetName(url, type, index) {
    let base = 'arquivo';
    let ext = '';
    try {
      const path = new URL(url).pathname.split('/').pop() || '';
      const m = /^(.*?)(?:\.([a-z0-9]{1,5}))?$/i.exec(decodeURIComponent(path));
      base = (m[1] || 'arquivo').replace(/[^\w.-]+/g, '-').slice(0, 40) || 'arquivo';
      ext = (m[2] || '').toLowerCase();
    } catch { /* URL incomum */ }
    const mimeExt = MIME_EXT[(type || '').split(';')[0].trim()];
    return `assets/${String(index).padStart(3, '0')}-${base}.${mimeExt || ext || 'bin'}`;
  }

  // Baixa os assets em paralelo; o que falhar continua apontando para o site original
  async function downloadAssets(urls, asDataUrl, budget = Infinity) {
    const map = new Map();
    const files = [];
    let done = 0, failed = 0, next = 0, total = 0;
    const worker = async () => {
      while (next < urls.length) {
        const i = next++;
        const url = urls[i];
        try {
          const { bytes, type } = await fetchBytes(url);
          total += bytes.length;
          if (total > budget) throw new Error('limite total de tamanho atingido');
          if (asDataUrl) {
            map.set(url, `data:${(type || 'application/octet-stream').split(';')[0]};base64,${encodeBase64(bytes)}`);
          } else {
            const name = assetName(url, type, i + 1);
            files.push({ name, data: bytes });
            map.set(url, name);
          }
        } catch {
          failed++;
        }
        done++;
        setExactStatus(`Baixando assets… ${done}/${urls.length}${failed ? ` · ${failed} indisponível(is)` : ''}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(ASSET_CONCURRENCY, urls.length) }, worker));
    return { map, files, failed };
  }

  // Aponta atributos e url() do CSS para os arquivos locais
  function rewriteAssetUrls(docClone, map) {
    const swap = u => {
      if (map.has(u)) return map.get(u);
      const [file, frag] = u.split('#');
      return frag !== undefined && map.has(file) ? `${map.get(file)}#${frag}` : u;
    };
    const swapCss = css => css.replace(CSS_URL_RE, (m, a, b, c) => {
      const u = (a ?? b ?? c ?? '').trim();
      return map.has(u) ? `url("${map.get(u)}")` : m;
    });
    for (const el of docClone.querySelectorAll('*')) {
      for (const name of ['src', 'poster', 'href', 'xlink:href']) {
        const v = el.getAttribute(name);
        if (!v || (name === 'href' && el.localName === 'a')) continue;
        if (name === 'href' && el.localName === 'link' && !/icon|apple-touch/i.test(el.getAttribute('rel') || '')) continue;
        const nv = swap(v);
        if (nv !== v) el.setAttribute(name, nv);
      }
      const style = el.getAttribute('style');
      if (style && style.includes('url(')) el.setAttribute('style', swapCss(style));
    }
    docClone.querySelectorAll('style').forEach(s => { s.textContent = swapCss(s.textContent); });
  }

  /* ZIP sem compressão (método STORE), suficiente para empacotar a cópia */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = bytes => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nomes em UTF-8
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(local.buffer), name, f.data);
      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true);
      dir.setUint16(4, 20, true);
      dir.setUint16(6, 20, true);
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(12, time, true);
      dir.setUint16(14, date, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, size, true);
      dir.setUint32(24, size, true);
      dir.setUint16(28, name.length, true);
      dir.setUint32(42, offset, true);
      central.push(new Uint8Array(dir.buffer), name);
      offset += 30 + name.length + size;
    }
    const dirSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, dirSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  const pageSlug = () => (location.hostname.replace(/^www\./, '') + '-' + (document.title || 'pagina'))
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'pagina';

  // Cópia exata: format = 'zip' (index.html + assets/) ou 'html' (tudo embutido num arquivo)
  async function exportExact(format) {
    if (exactBusy) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) { showToast('A cópia exata só funciona na extensão instalada'); return; }
    exactBusy = true;
    ui.exactBtns.forEach(b => { b.disabled = true; });
    ui.cube.classList.add('fast');
    const t0 = performance.now();
    try {
      await preloadLazyContent();
      setExactStatus('Copiando o HTML renderizado…');
      const docClone = cloneLiveDocument();
      await inlineStylesheets(docClone);
      const urls = collectAssetUrls(docClone);
      const { map, files, failed } = await downloadAssets(urls, format === 'html');
      rewriteAssetUrls(docClone, map);

      setExactStatus('Montando o arquivo…');
      const head = docClone.querySelector('head') || docClone.insertBefore(document.createElement('head'), docClone.firstChild);
      const charset = document.createElement('meta');
      charset.setAttribute('charset', 'utf-8');
      head.prepend(charset);
      const stamp = `Cópia exata feita pel'O Cubo de ${location.href} em ${new Date().toLocaleString('pt-BR')}`;
      const html = `<!DOCTYPE html>\n<!-- ${stamp.replace(/--/g, '- -')} -->\n${docClone.outerHTML}`;
      const htmlBytes = new TextEncoder().encode(html);

      let blob, name;
      if (format === 'zip') {
        blob = makeZip([{ name: 'index.html', data: htmlBytes }, ...files]);
        name = `${pageSlug()}.zip`;
      } else {
        blob = new Blob([htmlBytes], { type: 'text/html;charset=utf-8' });
        name = `${pageSlug()}.html`;
      }
      const href = URL.createObjectURL(blob);
      saveFile(href, name);
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      const mb = (blob.size / 1048576).toFixed(1);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      setExactStatus(`✓ ${name} · ${urls.length - failed}/${urls.length} assets · ${mb} MB · ${secs}s` +
        (failed ? ` · ${failed} ficaram apontando para o site original` : ''));
      showToast(format === 'zip' ? 'Cópia exata baixada (ZIP com assets)!' : 'Cópia exata baixada (HTML único)!');
    } catch (err) {
      console.error('[O Cubo] Falha na cópia exata', err);
      setExactStatus('✕ Falha na cópia exata: ' + String(err.message || err));
    } finally {
      exactBusy = false;
      ui.exactBtns.forEach(b => { b.disabled = false; });
      ui.cube.classList.remove('fast');
    }
  }

  /******************************************************************
   * 5c. CLONAR O SITE INTEIRO: TODAS AS PÁGINAS + ASSETS + LINKS LOCAIS
   ******************************************************************/
  const SITE_MAX_PAGES = 500;
  const SITE_MAX_BYTES = 1024 * 1024 * 1024;
  const SKIP_EXT_RE = /\.(pdf|zip|rar|7z|gz|tar|exe|dmg|msi|apk|jpe?g|png|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|avi|mov|docx?|xlsx?|pptx?|csv|json|xml|txt|css|js|woff2?|ttf|otf)$/i;
  // Visitar estes links pode deslogar a conta ou executar ações — nunca são seguidos
  const DANGER_RE = /(log-?out|sign-?out|log-?off|sair|desconectar|delete|excluir|remover|unsubscribe|descadastrar|cancelar-assinatura)/i;
  let crawling = false;
  let crawlCancel = false;

  const normalizePageUrl = u => { const x = new URL(u, location.href); x.hash = ''; return x.href; };

  function chooseClone() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    if (inspecting) stop();
    ui.backdrop.hidden = true;
    if (!crawling) {
      ui.choiceGrid.hidden = false;
      ui.siteOpts.hidden = true;
      ui.crawlProgress.hidden = true;
      ui.optHost.textContent = location.host;
    }
    ui.choice.hidden = false;
  }

  function closeChoice() {
    if (crawling) return;
    ui.choice.hidden = true;
  }

  async function loadRobots(origin) {
    try {
      const text = await fetchText(origin + '/robots.txt');
      const allow = [], disallow = [];
      let applies = false, lastWasAgent = false;
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim();
        const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
        if (!m) continue;
        const key = m[1].toLowerCase(), val = m[2].trim();
        if (key === 'user-agent') {
          applies = (lastWasAgent && applies) || val === '*';
          lastWasAgent = true;
          continue;
        }
        lastWasAgent = false;
        if (!applies || !val) continue;
        if (key === 'disallow') disallow.push(val.replace(/\*.*$/, ''));
        else if (key === 'allow') allow.push(val.replace(/\*.*$/, ''));
      }
      return { allow, disallow };
    } catch {
      return null;
    }
  }

  function robotsAllows(robots, url) {
    if (!robots) return true;
    const u = new URL(url);
    const path = u.pathname + u.search;
    const longest = rules => rules.filter(r => path.startsWith(r)).reduce((a, r) => Math.max(a, r.length), -1);
    return longest(robots.allow) >= longest(robots.disallow);
  }

  function isCrawlable(url, origin, robots) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol)) return false;
    if (SKIP_EXT_RE.test(u.pathname) || DANGER_RE.test(u.pathname + u.search)) return false;
    return robotsAllows(robots, u.href);
  }

  // Cópia exata da página aberta nesta aba (usada também nas páginas do crawler)
  async function snapshotPage() {
    const docClone = cloneLiveDocument();
    await inlineStylesheets(docClone);
    const links = [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https?:/i.test(h)))];
    return { url: location.href, title: document.title, html: `<!DOCTYPE html>\n${docClone.outerHTML}`, links };
  }

  // Nome curto: caminho relativo à pasta da página inicial, sem extensão
  function pageFileName(url, used, baseDir) {
    const u = new URL(url);
    let path = u.pathname.startsWith(baseDir) ? u.pathname.slice(baseDir.length) : u.pathname;
    path = path.replace(/(^|\/)index\.(html?|php|aspx?)$/i, '$1').replace(/\.(html?|php|aspx?|jsp)$/i, '');
    const raw = path + (u.search ? '-' + u.search.slice(1) : '');
    const base = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'pagina';
    let name = base, n = 2;
    while (used.has(name)) name = `${base}-${n++}`;
    used.add(name);
    return `paginas/${name}.html`;
  }

  function logCrawl(text, cls = '') {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
    ui.crawlLog.prepend(li);
    while (ui.crawlLog.children.length > 200) ui.crawlLog.lastChild.remove();
  }

  async function crawlSite() {
    if (crawling) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) { showToast('Clonar o site só funciona na extensão instalada'); return; }
    const maxPages = Math.max(1, Math.min(SITE_MAX_PAGES, parseInt(ui.optMax.value, 10) || 50));
    const respectRobots = ui.optRobots.checked;
    crawling = true;
    crawlCancel = false;
    ui.choiceGrid.hidden = true;
    ui.siteOpts.hidden = true;
    ui.crawlProgress.hidden = false;
    ui.crawlLog.replaceChildren();
    ui.crawlCancelBtn.disabled = false;
    ui.cube.classList.add('fast');
    const t0 = performance.now();
    const origin = location.origin;

    try {
      setExactStatus(respectRobots ? 'Lendo robots.txt…' : 'Preparando…');
      const robots = respectRobots ? await loadRobots(origin) : null;
      const start = normalizePageUrl(location.href);
      const queue = [start];
      const seen = new Set(queue);
      const pages = [];
      let failedPages = 0;

      while (queue.length && pages.length < maxPages && !crawlCancel) {
        const url = queue.shift();
        ui.crawlFill.style.width = `${Math.round((pages.length / maxPages) * 100)}%`;
        setExactStatus(`Página ${pages.length + 1} de até ${maxPages} · ${seen.size} links encontrados · ${queue.length} na fila`);
        let snap;
        try {
          if (url === start && !pages.length) {
            snap = await snapshotPage();
          } else {
            const res = await chrome.runtime.sendMessage({ type: 'cubo:render-page', url });
            if (!res?.ok) throw new Error(res?.error || 'falha ao abrir');
            snap = res.snapshot;
          }
        } catch (err) {
          failedPages++;
          logCrawl(`✕ ${url} — ${String(err.message || err).slice(0, 80)}`, 'err');
          continue;
        }
        if (new URL(snap.url).origin !== origin) { logCrawl(`↪ ${url} redirecionou para fora do site`, 'err'); continue; }
        const finalUrl = normalizePageUrl(snap.url);
        if (finalUrl !== url && pages.some(p => p.key === finalUrl)) continue;
        seen.add(finalUrl);
        pages.push({ ...snap, key: url, finalKey: finalUrl });
        logCrawl(`✓ ${snap.title || url}`);
        for (const link of snap.links) {
          if (!isCrawlable(link, origin, robots)) continue;
          const n = normalizePageUrl(link);
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        }
      }
      ui.crawlCancelBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'cubo:crawl-done' });
      if (!pages.length) throw new Error('nenhuma página foi capturada');

      // Nome de arquivo de cada página (a inicial vira index.html)
      const used = new Set(['index', 'mapa-do-site']);
      const pageFile = new Map();
      const baseDir = new URL(start).pathname.replace(/[^/]*$/, '');
      pages.forEach((p, i) => {
        const file = i === 0 ? 'index.html' : pageFileName(p.finalKey, used, baseDir);
        p.file = file;
        pageFile.set(p.key, file);
        pageFile.set(p.finalKey, file);
      });

      // Assets de todas as páginas, baixados uma vez só
      setExactStatus('Lendo assets de todas as páginas…');
      const parser = new DOMParser();
      const docs = pages.map(p => parser.parseFromString(trusted(p.html), 'text/html'));
      const urls = [...new Set(docs.flatMap(d => collectAssetUrls(d.documentElement)))];
      const { map, files, failed } = await downloadAssets(urls, false, SITE_MAX_BYTES);

      setExactStatus('Reescrevendo links para os arquivos locais…');
      const enc = new TextEncoder();
      const zipFiles = [];
      docs.forEach((doc, i) => {
        const page = pages[i];
        const prefix = page.file.includes('/') ? '../' : '';
        rewriteAssetUrls(doc.documentElement, prefix ? new Map([...map].map(([k, v]) => [k, prefix + v])) : map);
        for (const a of doc.querySelectorAll('a[href]')) {
          const href = a.getAttribute('href');
          if (!/^https?:/i.test(href)) continue;
          let target;
          try { target = new URL(href); } catch { continue; }
          const file = pageFile.get(normalizePageUrl(href));
          if (file) a.setAttribute('href', prefix + file + (target.hash || ''));
        }
        const head = doc.querySelector('head');
        if (head && !head.querySelector('meta[charset]')) {
          const meta = doc.createElement('meta');
          meta.setAttribute('charset', 'utf-8');
          head.prepend(meta);
        }
        const stamp = `Cópia feita pel'O Cubo de ${page.finalKey}`.replace(/--/g, '- -');
        zipFiles.push({ name: page.file, data: enc.encode(`<!DOCTYPE html>\n<!-- ${stamp} -->\n${doc.documentElement.outerHTML}`) });
      });

      // Mapa do site com todas as páginas clonadas
      const items = pages.map(p => `    <li><a href="${escAttr(p.file)}">${escHtml(p.title || p.finalKey)}</a> <small>${escHtml(p.finalKey)}</small></li>`).join('\n');
      zipFiles.push({
        name: 'mapa-do-site.html',
        data: enc.encode(
          `<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8"><title>Mapa do site · ${escHtml(location.host)}</title>\n` +
          `<style>body{font:15px/1.6 system-ui,sans-serif;max-width:880px;margin:40px auto;padding:0 16px;background:#05080b;color:#e2e8f0}` +
          `a{color:#00ff88}small{color:#64748b;margin-left:6px}h1{font-size:22px}</style></head>\n<body>\n` +
          `  <h1>Mapa do site · ${escHtml(location.host)}</h1>\n  <p>${pages.length} páginas clonadas pel'O Cubo em ${new Date().toLocaleString('pt-BR')}.</p>\n` +
          `  <ul>\n${items}\n  </ul>\n</body></html>\n`
        )
      });
      zipFiles.push(...files);

      setExactStatus('Montando o ZIP…');
      const blob = makeZip(zipFiles);
      const href = URL.createObjectURL(blob);
      const name = `site-${location.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-')}.zip`;
      saveFile(href, name);
      setTimeout(() => URL.revokeObjectURL(href), 120000);
      ui.crawlFill.style.width = '100%';
      const secs = Math.round((performance.now() - t0) / 1000);
      setExactStatus(`✓ ${name} · ${pages.length} páginas · ${urls.length - failed}/${urls.length} assets · ` +
        `${(blob.size / 1048576).toFixed(1)} MB · ${secs}s${failedPages ? ` · ${failedPages} página(s) com erro` : ''}`);
      logCrawl('✓ Abra index.html ou mapa-do-site.html depois de extrair o ZIP', 'ok');
      showToast('Site clonado! ZIP baixado.');
    } catch (err) {
      console.error('[O Cubo] Falha ao clonar o site', err);
      setExactStatus('✕ Falha ao clonar o site: ' + String(err.message || err));
      chrome.runtime.sendMessage({ type: 'cubo:crawl-done' });
    } finally {
      crawling = false;
      ui.cube.classList.remove('fast');
      ui.crawlCancelBtn.disabled = true;
    }
  }

  /******************************************************************
   * 5b. CAPTURA POR IMAGEM: RECORTE DE ÁREA -> PRINT -> CÓDIGO VIA IA
   ******************************************************************/
  const MAX_SHOT_WIDTH = 1600;
  const MAX_SHOT_DATAURL = 3500000;
  let selStart = null;
  let wasInspecting = false;
  let resumeAfterShot = false;
  let lastShotPreview = null;

  function startShot() {
    if (!host.isConnected) document.documentElement.appendChild(host);
    wasInspecting = inspecting;
    if (inspecting) stop();
    ui.backdrop.hidden = true;
    ui.selBox.style.display = 'none';
    ui.selLayer.hidden = false;
    setHint('Recorte uma área da tela');
  }

  function cancelShot() {
    ui.selLayer.hidden = true;
    selStart = null;
    if (wasInspecting) activate();
    else setHint('Inspeção pausada');
  }

  const selRect = (a, b) => ({
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)
  });

  ui.selLayer.addEventListener('pointerdown', e => {
    e.preventDefault();
    selStart = { x: e.clientX, y: e.clientY };
    ui.selLayer.setPointerCapture(e.pointerId);
  });
  ui.selLayer.addEventListener('pointermove', e => {
    if (!selStart) return;
    const r = selRect(selStart, { x: e.clientX, y: e.clientY });
    Object.assign(ui.selBox.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    ui.selSize.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
  });
  ui.selLayer.addEventListener('pointerup', async e => {
    if (!selStart) return;
    const r = selRect(selStart, { x: e.clientX, y: e.clientY });
    selStart = null;
    ui.selLayer.hidden = true;
    if (r.width < 12 || r.height < 12) { showToast('Área muito pequena — arraste para recortar'); return startShot(); }
    result = null;
    capturedEl = null;
    Object.keys(imageResults).forEach(k => delete imageResults[k]);
    try {
      areaResult = captureArea(r);
    } catch (err) {
      console.warn('[O Cubo] Extração local da área falhou', err);
      areaResult = null;
    }
    resumeAfterShot = wasInspecting;
    await shootRect(r, 'Área recortada da tela');
  });

  const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Esconde a UI d'O Cubo, pede o print da aba ao service worker e recorta o retângulo
  async function grabRect(rect) {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) throw new Error('A captura de tela só funciona na extensão instalada.');
    const prevVisibility = host.style.visibility;
    host.style.visibility = 'hidden';
    await nextFrame();
    await new Promise(r => setTimeout(r, 60));
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'cubo:shot' });
    } finally {
      host.style.visibility = prevVisibility;
    }
    if (!res?.ok) throw new Error(res?.error || 'Falha ao capturar a tela.');

    const img = new Image();
    img.src = res.dataUrl;
    await img.decode();
    const scale = img.naturalWidth / innerWidth;
    const sx = Math.max(0, rect.left) * scale;
    const sy = Math.max(0, rect.top) * scale;
    const sw = Math.min(rect.width, innerWidth - Math.max(0, rect.left)) * scale;
    const sh = Math.min(rect.height, innerHeight - Math.max(0, rect.top)) * scale;
    if (sw < 2 || sh < 2) throw new Error('O elemento está fora da área visível — role a página até ele.');
    const out = Math.min(1, MAX_SHOT_WIDTH / sw);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * out);
    canvas.height = Math.round(sh * out);
    canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    // PNG grande demais estoura o limite de imagem da IA (5 MB no Claude) → cai para JPEG
    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > MAX_SHOT_DATAURL) dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return { dataUrl, width: Math.round(sw / scale), height: Math.round(sh / scale) };
  }

  async function shootRect(rect, title) {
    ui.cube.classList.add('fast');
    setHint('Fotografando a tela…');
    try {
      shot = await grabRect(rect);
      openImagePanel(title);
      setHint('Imagem capturada!');
    } catch (err) {
      showToast(String(err.message || err));
      setHint('Falha na captura');
      if (resumeAfterShot) { resumeAfterShot = false; activate(); }
    } finally {
      ui.cube.classList.remove('fast');
    }
  }

  // Acha o menor elemento que cobre a área recortada e captura só o que fica dentro dela
  function captureArea(rect) {
    const clip = { left: rect.left, top: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height };
    const selArea = rect.width * rect.height;
    const coverage = r => {
      const w = Math.min(r.right, clip.right) - Math.max(r.left, clip.left);
      const h = Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top);
      return w > 0 && h > 0 ? (w * h) / selArea : 0;
    };
    const hits = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      .filter(el => el !== host && el !== document.documentElement);
    let el = hits[0];
    if (!el) return null;
    while (el.parentElement && el !== document.body && coverage(el.getBoundingClientRect()) < 0.9) el = el.parentElement;
    if (el === document.documentElement) el = document.body;
    const res = capture(el, { clip });
    res.title = 'Área recortada · código local da página';
    return res;
  }

  function runLocal() {
    if (areaResult) {
      result = areaResult;
      openPanel();
      showToast('Código gerado localmente, sem IA');
    } else if (result) {
      setView('clean');
    } else {
      showToast('Não há HTML nesta área (é imagem ou canvas) — use a IA');
    }
  }

  // Abre o painel só com a aba Por Imagem (captura de área, sem DOM)
  function openImagePanel(title) {
    ui.title.textContent = title;
    ui.dims.textContent = `${shot.width} × ${shot.height} px`;
    ui.stats.textContent = areaResult
      ? `✓ Captura pronta · ${areaResult.nodes} elementos da página dentro da área — gere local ou com IA`
      : '✓ Captura pronta · nenhum HTML na área (imagem/canvas) — use a IA';
    ui.seg.classList.add('solo');
    ui.backdrop.hidden = false;
    setView('image');
  }

  // Na captura por elemento, o print é tirado só quando a aba Por Imagem é aberta
  let shotTriedFor = null;
  async function ensureElementShot() {
    if (shot || !capturedEl || !capturedEl.isConnected || shotTriedFor === capturedEl) return;
    shotTriedFor = capturedEl;
    ui.shotEmpty.textContent = 'Capturando a tela…';
    ui.shotEmpty.hidden = false;
    ui.shotImg.hidden = true;
    ui.backdrop.hidden = true;
    capturedEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await nextFrame();
    try {
      shot = await grabRect(capturedEl.getBoundingClientRect());
    } catch (err) {
      showToast(String(err.message || err));
      ui.shotEmpty.textContent = 'Não foi possível fotografar o elemento — use "Recortar outra área".';
    } finally {
      ui.backdrop.hidden = false;
    }
    if (view === 'image') setView('image');
  }

  function renderShot() {
    ui.shotEmpty.hidden = !!shot;
    ui.shotImg.hidden = !shot;
    if (shot) ui.shotImg.src = shot.dataUrl;
    ui.imgLocal.disabled = !areaResult && !result;
    const code = imageResults[imageStack];
    const showPreview = !!code && imageStack === 'html';
    ui.shotPreview.hidden = !showPreview;
    if (showPreview && lastShotPreview !== code) {
      ui.shotPreview.srcdoc = trusted(code);
      lastShotPreview = code;
    }
    ui.imgNote.textContent = 'Carregando configuração…';
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      ui.imgNote.textContent = 'A geração por imagem só funciona na extensão instalada.';
      ui.imgRun.disabled = true;
      return;
    }
    chrome.runtime.sendMessage({ type: 'cubo:model' }, res => {
      if (chrome.runtime.lastError || !res) { ui.imgNote.textContent = 'Recarregue a página para reconectar O Cubo.'; return; }
      ui.imgNote.replaceChildren();
      if (res.hasKey) {
        ui.imgNote.append('O Cubo envia a captura para ');
        const b = document.createElement('b'); b.textContent = `${res.provider} · ${res.model}`; ui.imgNote.append(b);
        ui.imgNote.append(', que gera o código do que está na imagem.');
      } else {
        ui.imgNote.append('Sem IA configurada: use ');
        const l = document.createElement('b'); l.textContent = '🧩 Gerar local'; ui.imgNote.append(l);
        ui.imgNote.append(' para pegar o código da própria página, ou configure uma IA (Ollama no seu PC, Claude ou Gemini) em ');
        const b = document.createElement('b'); b.textContent = 'Configurações de IA'; ui.imgNote.append(b);
        ui.imgNote.append('.');
      }
      ui.imgRun.disabled = imageBusy || !res.hasKey || !shot;
      ui.imgLocal.disabled = !areaResult && !result;
    });
  }

  function runImageAi() {
    if (imageBusy || !shot) return;
    imageBusy = true;
    ui.imgRun.disabled = true;
    ui.imgRun.textContent = 'Lendo a imagem…';
    ui.cube.classList.add('fast');
    const stack = imageStack;
    chrome.runtime.sendMessage({ type: 'cubo:ai-image', stack, ...shot }, res => {
      imageBusy = false;
      ui.imgRun.disabled = false;
      ui.imgRun.textContent = '⚡ Gerar com IA';
      ui.cube.classList.remove('fast');
      if (chrome.runtime.lastError || !res) { showToast('Falha ao falar com a extensão'); return; }
      if (!res.ok) { showToast('IA: ' + res.error.slice(0, 120)); return; }
      imageResults[stack] = res.text;
      ui.model.textContent = 'Modelo: ' + res.model;
      if (view === 'image' && imageStack === stack) setView('image');
      showToast('Código gerado a partir da imagem!');
    });
  }

  /******************************************************************
   * 6. MOTOR DE CAPTURA: DOM + ESTILOS COMPUTADOS -> HTML/CSS LIMPO
   ******************************************************************/
  let defaultsDoc = null;
  const defaultsCache = new Map();
  let hoistBorderBox = false;
  const BORDER_BOX_RESET = '.cubo-root,\n.cubo-root *,\n.cubo-root *::before,\n.cubo-root *::after {\n  box-sizing: border-box;\n}\n';

  function getDefaults(el) {
    if (!defaultsDoc) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0;';
      shadow.appendChild(frame);
      defaultsDoc = frame.contentDocument;
      defaultsDoc.open();
      defaultsDoc.write(trusted('<!doctype html><html><head></head><body></body></html>'));
      defaultsDoc.close();
    }
    const ns = el.namespaceURI || HTML_NS;
    const key = ns + '|' + el.localName;
    if (defaultsCache.has(key)) return defaultsCache.get(key);
    const body = defaultsDoc.body;
    let probe, wrapper;
    if (ns === SVG_NS && el.localName !== 'svg') {
      wrapper = defaultsDoc.createElementNS(SVG_NS, 'svg');
      probe = defaultsDoc.createElementNS(SVG_NS, el.localName);
      wrapper.appendChild(probe);
      body.appendChild(wrapper);
    } else {
      probe = defaultsDoc.createElementNS(ns, el.localName);
      body.appendChild(probe);
    }
    const cs = defaultsDoc.defaultView.getComputedStyle(probe);
    const map = {};
    for (let i = 0; i < cs.length; i++) map[cs[i]] = cs.getPropertyValue(cs[i]);
    (wrapper || probe).remove();
    defaultsCache.set(key, map);
    return map;
  }

  const keepProp = p => (p.startsWith('-') ? ALLOWED_PREFIXED.has(p) : !SKIP_PROP.test(p) && !SVG_GEOMETRY.has(p));

  // Caixas sem texto (barras, ícones, divisores) dependem do tamanho explícito
  const hasText = el => (el.textContent || '').trim().length > 0;

  function computeDecls(el, cs, parentCs, isRoot) {
    const def = getDefaults(el);
    const tag = el.localName;
    const pos = cs.position;
    const sized = isRoot || SIZED_TAGS.has(tag) || pos === 'absolute' || pos === 'fixed' ||
      cs.display.startsWith('inline-') || !hasText(el);
    const out = new Map();
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      if (!keepProp(p)) continue;
      if ((p === 'width' || p === 'height') && !sized) continue;
      const v = cs.getPropertyValue(p);
      if (!v) continue;
      if (INHERITED.has(p) && parentCs && !isRoot) {
        if (parentCs.getPropertyValue(p) === v) continue;
      } else if (def[p] === v) continue;
      out.set(p, v);
    }
    pruneNoise(out, cs);
    restoreResponsive(el, cs, out);

    // Com border-box no componente todo, um reset global substitui a repetição em cada regra
    if (hoistBorderBox) {
      if (cs.boxSizing === 'border-box') out.delete('box-sizing');
      else out.set('box-sizing', cs.boxSizing);
    }

    if (isRoot) {
      ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'].forEach(p => out.delete(p));
      if (pos === 'fixed' || pos === 'sticky') {
        ['position', 'top', 'right', 'bottom', 'left', 'z-index'].forEach(p => out.delete(p));
      }
      if (!out.has('max-width')) out.set('max-width', '100%');
    }
    return compress(out);
  }

  // O navegador devolve margin:auto e larguras de barras fixas já resolvidas em px;
  // reconverte para manter o clone centralizado/esticado em qualquer largura de tela
  function restoreResponsive(el, cs, out) {
    const parent = el.parentElement;
    const ml = parseFloat(cs.marginLeft), mr = parseFloat(cs.marginRight);
    if (parent && ml > 0.5 && Math.abs(ml - mr) < 1 && /^(static|relative|sticky)$/.test(cs.position)) {
      const pcs = getComputedStyle(parent);
      const inner = parent.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
      if (Math.abs((inner - el.getBoundingClientRect().width) / 2 - ml) < 1.5) {
        out.set('margin-left', 'auto');
        out.set('margin-right', 'auto');
      }
    }
    if (cs.position === 'fixed' || cs.position === 'absolute') {
      const box = cs.position === 'fixed' ? document.documentElement.clientWidth : el.offsetParent?.clientWidth;
      if (box && Math.abs(el.getBoundingClientRect().width - box) < 2 && Math.abs(parseFloat(cs.left)) < 1) {
        out.delete('width');
        out.set('left', '0px');
        out.set('right', '0px');
      }
    }
  }

  // Remove valores derivados que não mudam nada visualmente (ex.: cor de borda sem borda)
  function pruneNoise(out, cs) {
    ['top', 'right', 'bottom', 'left'].forEach(side => {
      const style = cs.getPropertyValue(`border-${side}-style`);
      if (style === 'none' || style === 'hidden' || cs.getPropertyValue(`border-${side}-width`) === '0px') {
        ['width', 'style', 'color'].forEach(k => out.delete(`border-${side}-${k}`));
      }
    });
    if (cs.outlineStyle === 'none') ['outline-color', 'outline-width', 'outline-style', 'outline-offset'].forEach(p => out.delete(p));
    [...out.keys()].forEach(p => {
      if (/^(column|row)-rule-/.test(p) && cs.getPropertyValue(p.replace(/-(color|width|style)$/, '-style')) !== 'solid') out.delete(p);
    });
    const color = cs.color;
    ['text-decoration-color', 'text-emphasis-color', '-webkit-text-fill-color', '-webkit-text-stroke-color', 'caret-color',
      'column-rule-color', 'row-rule-color'].forEach(p => {
      if (out.get(p) === color) out.delete(p);
    });
    if (cs.textDecorationLine === 'none') ['text-decoration-color', 'text-decoration-style', 'text-decoration-thickness'].forEach(p => out.delete(p));
    if (cs.position === 'static') ['top', 'right', 'bottom', 'left', 'z-index'].forEach(p => out.delete(p));
    if (cs.position === 'relative') ['top', 'right', 'bottom', 'left'].forEach(p => { if (out.get(p) === '0px') out.delete(p); });
    ['min-width', 'min-height'].forEach(p => { if (out.get(p) === 'auto') out.delete(p); });
    out.delete('user-select');
  }

  // Junta lados/cantos iguais em shorthands (margin, padding, border, border-radius, inset)
  function compress(m) {
    const four = (prefix, suffix = '') => ['top', 'right', 'bottom', 'left'].map(s => `${prefix}${s}${suffix}`);
    const shorthand = vals => {
      const [t, r, b, l] = vals;
      if (t === r && r === b && b === l) return t;
      if (t === b && r === l) return `${t} ${r}`;
      if (r === l) return `${t} ${r} ${b}`;
      return `${t} ${r} ${b} ${l}`;
    };
    const merge = (name, props) => {
      if (!props.every(p => m.has(p))) return;
      const val = shorthand(props.map(p => m.get(p)));
      props.forEach(p => m.delete(p));
      m.set(name, val);
    };
    merge('margin', four('margin-'));
    merge('padding', four('padding-'));
    merge('inset', ['top', 'right', 'bottom', 'left']);
    merge('border-radius', ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']);
    const widths = four('border-', '-width'), styles = four('border-', '-style'), colors = four('border-', '-color');
    if ([...widths, ...styles, ...colors].every(p => m.has(p))) {
      const same = arr => arr.every(p => m.get(p) === m.get(arr[0]));
      if (same(widths) && same(styles) && same(colors)) {
        const val = `${m.get(widths[0])} ${m.get(styles[0])} ${m.get(colors[0])}`;
        [...widths, ...styles, ...colors].forEach(p => m.delete(p));
        m.set('border', val);
      }
    }
    return m;
  }

  function pseudoDecls(el, cs, which) {
    const pcs = getComputedStyle(el, which);
    const content = pcs.content;
    if (!content || content === 'none' || content === 'normal') return null;
    const def = getDefaults(el);
    const out = new Map();
    PSEUDO_PROPS.forEach(p => {
      const v = pcs.getPropertyValue(p);
      if (!v) return;
      if (p === 'content' || (INHERITED.has(p) ? cs.getPropertyValue(p) !== v : def[p] !== v)) out.set(p, v);
    });
    pruneNoise(out, pcs);
    return compress(out);
  }

  const declText = m => [...m].map(([p, v]) => `  ${p}: ${v};`).join('\n');

  function absolutize(value) {
    try { return new URL(value, location.href).href; } catch { return value; }
  }

  function copyAttributes(orig, clone) {
    const isHtml = orig.namespaceURI === HTML_NS;
    for (const attr of orig.attributes) {
      const name = attr.name;
      const lower = name.toLowerCase();
      if (lower === 'class' || lower === 'style' || lower === 'id' || lower === 'nonce' || lower === 'srcset' ||
          lower === 'sizes' || lower === 'loading' || lower === 'decoding' || lower.startsWith('on') ||
          lower.startsWith('data-') || lower.startsWith('js') || lower.startsWith('xmlns') || lower.startsWith('_ng') ||
          lower.startsWith('ng-') || lower.startsWith('v-') || lower.startsWith('x-') || lower.startsWith('@') || lower.startsWith(':')) continue;
      let value = attr.value;
      if (isHtml && ['src', 'href', 'poster', 'action'].includes(lower) && !value.startsWith('#') && !/^(javascript|data):/i.test(value)) {
        value = absolutize(value);
      }
      if (/^javascript:/i.test(value)) continue;
      try { clone.setAttribute(name, value); } catch { /* nome de atributo inválido */ }
    }
    if (orig.localName === 'img' && orig.currentSrc) clone.setAttribute('src', orig.currentSrc);
    if ((orig.localName === 'input' || orig.localName === 'select') && orig.value && orig.type !== 'password') clone.setAttribute('value', orig.value);
  }

  function nearestBackground(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return '#ffffff';
  }

  function guessTitle(el) {
    const aria = el.getAttribute('aria-label') || el.getAttribute('title');
    if (aria) return aria.trim().slice(0, 60);
    const heading = el.matches('h1,h2,h3,h4,h5,h6') ? el : el.querySelector('h1,h2,h3,h4,h5,h6');
    const text = (heading || el).textContent.replace(/\s+/g, ' ').trim();
    const base = { button: 'Botão', a: 'Link', nav: 'Navegação', header: 'Cabeçalho', footer: 'Rodapé', form: 'Formulário',
      img: 'Imagem', svg: 'Ícone SVG', ul: 'Lista', table: 'Tabela', input: 'Campo', section: 'Seção', article: 'Card' }[el.localName] || 'Componente';
    return text ? `${base}: ${text.slice(0, 48)}${text.length > 48 ? '…' : ''}` : `${base} <${describe(el)}>`;
  }

  function capture(root, { clip = null, fullPage = false } = {}) {
    const maxNodes = fullPage ? PAGE_MAX_NODES : MAX_NODES;
    const rawSource = fullPage ? document.documentElement : root;
    const rawLimit = fullPage ? PAGE_RAW_LIMIT : RAW_LIMIT;
    const rules = new Map();     // chave de declarações -> { cls, css }
    const counters = {};
    let count = 0;
    let truncated = false;

    function classFor(tag, decls, before, after, isRoot) {
      if (!decls.size && !before && !after) return null;
      const key = declText(decls) + '|' + (before ? declText(before) : '') + '|' + (after ? declText(after) : '');
      if (!isRoot && rules.has(key)) return rules.get(key).cls;
      const safeTag = tag.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'el';
      counters[safeTag] = (counters[safeTag] || 0) + 1;
      const cls = isRoot ? 'cubo-root' : `cubo-${safeTag}-${counters[safeTag]}`;
      let css = '';
      if (decls.size) css += `.${cls} {\n${declText(decls)}\n}\n`;
      if (before) css += `.${cls}::before {\n${declText(before)}\n}\n`;
      if (after) css += `.${cls}::after {\n${declText(after)}\n}\n`;
      rules.set(isRoot ? '__root__' : key, { cls, css });
      return cls;
    }

    // Na captura por área, descarta filhos que ficam totalmente fora do recorte
    const outsideClip = el => {
      if (!clip) return false;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return false;
      return r.right <= clip.left || r.left >= clip.right || r.bottom <= clip.top || r.top >= clip.bottom;
    };

    function walk(orig, parentCs, isRoot) {
      const cs = getComputedStyle(orig);
      if (!isRoot && cs.display === 'none') return null;
      if (count >= maxNodes) { truncated = true; return null; }
      count++;
      const tag = orig.localName;

      let clone;
      if (tag === 'canvas') {
        clone = document.createElement('img');
        try { clone.setAttribute('src', orig.toDataURL()); } catch { /* canvas protegido (cross-origin) */ }
      } else {
        clone = isRoot && fullPage
          ? document.createElement('div')
          : document.createElementNS(orig.namespaceURI || HTML_NS, tag);
        copyAttributes(orig, clone);
      }

      const decls = computeDecls(orig, cs, parentCs, isRoot);
      if (isRoot && fullPage) {
        ['width', 'height', 'max-width'].forEach(p => decls.delete(p));
        decls.set('min-height', '100vh');
      } else if (isRoot && !decls.has('width') && cs.width !== 'auto') decls.set('width', cs.width);
      const cls = classFor(tag, decls, pseudoDecls(orig, cs, '::before'), pseudoDecls(orig, cs, '::after'), isRoot);
      if (cls) clone.setAttribute('class', cls);

      if (tag !== 'canvas') {
        if (tag === 'textarea') clone.textContent = orig.value;
        else {
          for (const child of orig.childNodes) {
            if (child.nodeType === 3) clone.appendChild(document.createTextNode(child.data));
            else if (child.nodeType === 1 && !DROP_TAGS.has(child.localName) && child !== host && !outsideClip(child)) {
              const c = walk(child, cs, false);
              if (c) clone.appendChild(c);
            }
          }
        }
      }
      return clone;
    }

    const rect = root.getBoundingClientRect();
    hoistBorderBox = getComputedStyle(root).boxSizing === 'border-box';
    const tree = walk(root, root.parentElement ? getComputedStyle(root.parentElement) : null, true);
    const rootRule = rules.get('__root__');
    const css = [hoistBorderBox && BORDER_BOX_RESET, rootRule && rootRule.css, ...[...rules].filter(([k]) => k !== '__root__').map(([, r]) => r.css)].filter(Boolean).join('\n');
    const html = serialize(tree, 0, false);
    const jsx = serialize(tree, 2, true);
    const rawHtml = rawSource.outerHTML;
    const raw = rawHtml.length > rawLimit ? rawHtml.slice(0, rawLimit) + '\n<!-- … truncado pel\'O Cubo -->' : rawHtml;

    return {
      title: fullPage ? `Página inteira: ${document.title || location.hostname}` : guessTitle(root),
      dims: `${Math.round(rect.width)} × ${Math.round(rect.height)} px`,
      nodes: count,
      ruleCount: rules.size,
      truncated,
      maxNodes,
      fullPage,
      pageTitle: document.title,
      lang: document.documentElement.lang || '',
      fontCss: fullPage ? collectFontCss() : '',
      raw,
      html,
      css,
      jsx,
      background: fullPage ? nearestBackground(document.body) : nearestBackground(root.parentElement || root),
      source: location.href
    };
  }

  /******************************************************************
   * 7. SERIALIZAÇÃO: HTML FORMATADO E JSX
   ******************************************************************/
  const JSX_ATTRS = {
    class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    minlength: 'minLength', colspan: 'colSpan', rowspan: 'rowSpan', autocomplete: 'autoComplete', autofocus: 'autoFocus',
    crossorigin: 'crossOrigin', contenteditable: 'contentEditable', spellcheck: 'spellCheck', enctype: 'encType',
    'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', value: 'defaultValue', checked: 'defaultChecked',
    allowfullscreen: 'allowFullScreen', frameborder: 'frameBorder', referrerpolicy: 'referrerPolicy', datetime: 'dateTime',
    inputmode: 'inputMode', accesskey: 'accessKey', novalidate: 'noValidate'
  };

  const escText = (t, jsx) => {
    let s = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (jsx) s = s.replace(/[{}]/g, c => `{'${c}'}`);
    return s;
  };
  const escAttr = v => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  function formatAttr(attr, jsx) {
    let name = attr.name;
    if (jsx) {
      const lower = name.toLowerCase();
      if (JSX_ATTRS[lower]) name = JSX_ATTRS[lower];
      else if (name.includes('-') && !lower.startsWith('aria-') && !lower.startsWith('data-')) {
        name = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      } else if (name.includes(':')) {
        name = name.replace(/:([a-z])/g, (_, c) => c.toUpperCase());
      }
      if (attr.value === '' && /^(disabled|hidden|required|multiple|selected|open|readOnly|autoFocus|defaultChecked|noValidate|allowFullScreen)$/.test(name)) {
        return ' ' + name;
      }
    }
    return attr.value === '' && !jsx ? ` ${name}` : ` ${name}="${escAttr(attr.value)}"`;
  }

  function serialize(node, depth, jsx) {
    const pad = '  '.repeat(depth);
    if (node.nodeType === 3) {
      const t = node.data.replace(/\s+/g, ' ').trim();
      return t ? pad + escText(t, jsx) : '';
    }
    const tag = node.localName;
    const attrs = [...node.attributes].map(a => formatAttr(a, jsx)).join('');
    if (VOID_TAGS.has(tag)) return `${pad}<${tag}${attrs}${jsx ? ' />' : '>'}`;

    const kids = [...node.childNodes].filter(c => c.nodeType === 1 || (c.nodeType === 3 && c.data.trim()));
    if (!kids.length) return jsx ? `${pad}<${tag}${attrs} />` : `${pad}<${tag}${attrs}></${tag}>`;
    if (kids.length === 1 && kids[0].nodeType === 3) {
      const t = escText(kids[0].data.replace(/\s+/g, ' ').trim(), jsx);
      if (t.length + attrs.length < 100) return `${pad}<${tag}${attrs}>${t}</${tag}>`;
    }
    const lines = [];
    kids.forEach((k, i) => {
      let s = serialize(k, depth + 1, jsx);
      if (!s) return;
      // JSX descarta espaços entre texto e tags; preserva com {' '}
      if (jsx && k.nodeType === 3) {
        if (i > 0 && /^\s/.test(k.data)) s = s.replace(/^(\s*)/, "$1{' '}");
        if (i < kids.length - 1 && /\s$/.test(k.data)) s += "{' '}";
      }
      lines.push(s);
    });
    return `${pad}<${tag}${attrs}>\n${lines.join('\n')}\n${pad}</${tag}>`;
  }

  /******************************************************************
   * 8. PAINEL DE RESULTADO
   ******************************************************************/
  const escHtml = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Página inteira: documento completo, pronto para abrir offline
  const pageDocument = r =>
    `<!doctype html>\n<html${r.lang ? ` lang="${escAttr(r.lang)}"` : ''}>\n<head>\n` +
    `  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `  <title>${escHtml(r.pageTitle || 'Página clonada')}</title>\n  <!-- ✨ Clonado pel'O Cubo de ${r.source} -->\n` +
    `  <style>\n${r.fontCss ? r.fontCss + '\n\n' : ''}html, body { margin: 0; background: ${r.background}; }\n\n${r.css}  </style>\n` +
    `</head>\n<body>\n${r.html}\n</body>\n</html>\n`;

  const outputs = {
    html: r => r.fullPage
      ? pageDocument(r)
      : `<!-- ✨ Clonado pel'O Cubo de ${r.source} -->\n${r.html}\n\n<style>\n${r.css}</style>\n`,
    react: r => {
      const name = r.fullPage ? 'PaginaClonada' : 'ComponenteClonado';
      return `// ✨ Clonado pel'O Cubo de ${r.source}\n// Salve o CSS abaixo como ${name}.css\nimport './${name}.css';\n\n` +
        `export default function ${name}() {\n  return (\n${r.jsx}\n  );\n}\n\n/* ===== ${name}.css =====\n\n` +
        `${(r.fontCss ? r.fontCss + '\n\n' : '') + r.css.replace(/\*\//g, '* /')}\n*/\n`;
    }
  };

  function currentCode() {
    if (view === 'image') return imageResults[imageStack] || '';
    if (!result) return '';
    if (view === 'raw') return result.raw;
    if (view === 'ai') return aiResults[aiStack] || '';
    return outputs[cleanStack](result);
  }

  function openPanel() {
    ui.title.textContent = result.title;
    ui.dims.textContent = result.dims;
    const kbRaw = (result.raw.length / 1024).toFixed(1);
    const kbClean = ((result.html.length + result.css.length) / 1024).toFixed(1);
    ui.stats.textContent = `✓ ${result.nodes} elementos · ${result.ruleCount} regras CSS · ${kbRaw} KB bruto → ${kbClean} KB limpo` +
      (result.ms ? ` · ${result.ms} ms` : '') +
      (result.truncated ? ` · truncado em ${result.maxNodes} nós` : '');
    ui.preview.srcdoc = trusted(result.fullPage
      ? pageDocument(result).replace('<head>', `<head><base href="${escAttr(result.source)}">`)
      : `<!doctype html><html><head><meta charset="utf-8"><base href="${escAttr(result.source)}"><style>` +
        `html,body{margin:0}body{min-height:100vh;padding:24px;display:flex;justify-content:center;align-items:flex-start;` +
        `background:${result.background}}\n${result.css}</style></head><body>${result.html}</body></html>`
    );
    ui.seg.classList.remove('solo');
    ui.backdrop.hidden = false;
    setView('clean');
  }

  function closePanel() {
    ui.backdrop.hidden = true;
    shadow.querySelectorAll('.particle').forEach(p => p.remove());
    setHint(inspecting ? 'Toque num elemento ↑' : 'Inspeção pausada');
    if (resumeAfterShot) { resumeAfterShot = false; activate(); }
  }

  function setActive(group, attr, value) {
    shadow.querySelectorAll(`${group} [${attr}]`).forEach(b => b.classList.toggle('on', b.getAttribute(attr) === value));
  }

  function setView(v) {
    view = v;
    setActive('.seg', 'data-view', v);
    shadow.querySelector('[data-for="clean"]').hidden = v !== 'clean';
    shadow.querySelector('[data-for="ai"]').hidden = v !== 'ai';
    shadow.querySelector('[data-for="image"]').hidden = v !== 'image';
    ui.previewWrap.hidden = v !== 'preview';
    ui.aiCta.hidden = v !== 'ai';
    ui.shotWrap.hidden = v !== 'image';
    ui.exactBar.hidden = !result?.fullPage || v === 'image';
    if (v !== 'image') ui.shotPreview.hidden = true;
    ui.codeWrap.hidden = v === 'preview' || (v === 'ai' && !aiResults[aiStack]) || (v === 'image' && !imageResults[imageStack]);
    if (v === 'ai') refreshAiNote();
    if (v === 'image') { renderShot(); ensureElementShot(); }
    renderCode();
  }

  function renderCode() {
    ui.code.textContent = currentCode();
    ui.codeLabel.classList.toggle('warn', view === 'raw');
    ui.codeLabel.textContent = {
      raw: '⚠️ HTML bruto original (classes ofuscadas / difícil manutenção)',
      clean: cleanStack === 'react' ? '✨ Componente React + CSS extraído (pronto para copiar)' : '✨ HTML + CSS limpo extraído pel\'O Cubo',
      ai: '🧠 Código refatorado pela IA',
      image: '📸 Código gerado a partir da imagem',
      preview: ''
    }[view];
  }

  function refreshAiNote() {
    ui.aiNote.textContent = 'Carregando configuração…';
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
      ui.aiNote.textContent = 'A IA só está disponível dentro da extensão instalada.';
      ui.aiRun.disabled = true;
      return;
    }
    chrome.runtime.sendMessage({ type: 'cubo:model' }, res => {
      if (chrome.runtime.lastError || !res) { ui.aiNote.textContent = 'Recarregue a página para reconectar O Cubo.'; return; }
      ui.aiNote.replaceChildren();
      if (res.hasKey) {
        ui.aiNote.append('O Cubo envia o HTML/CSS limpo para ');
        const b = document.createElement('b'); b.textContent = `${res.provider} · ${res.model}`; ui.aiNote.append(b);
        ui.aiNote.append(' e reconstrói no formato escolhido.');
      } else {
        ui.aiNote.append('Para refatorar com IA, configure uma IA (Ollama no seu PC, Claude ou Gemini) no popup d\'O Cubo → ');
        const b = document.createElement('b'); b.textContent = 'Configurações de IA'; ui.aiNote.append(b);
        ui.aiNote.append('.');
      }
      ui.aiRun.disabled = aiBusy || !res.hasKey;
    });
  }

  function runAi() {
    if (aiBusy || !result) return;
    aiBusy = true;
    ui.aiRun.disabled = true;
    ui.aiRun.textContent = 'Absorvendo…';
    ui.cube.classList.add('fast');
    const stack = aiStack;
    chrome.runtime.sendMessage({ type: 'cubo:ai', stack, title: result.title, html: result.html, css: result.css }, res => {
      aiBusy = false;
      ui.aiRun.disabled = false;
      ui.aiRun.textContent = '⚡ Gerar com IA';
      ui.cube.classList.remove('fast');
      if (chrome.runtime.lastError || !res) { showToast('Falha ao falar com a extensão'); return; }
      if (!res.ok) { showToast('IA: ' + res.error.slice(0, 120)); return; }
      aiResults[stack] = res.text;
      ui.model.textContent = 'Modelo: ' + res.model;
      if (view === 'ai' && aiStack === stack) setView('ai');
      showToast('Componente reconstruído pela IA!');
    });
  }

  async function copyCode(btn) {
    const text = currentCode();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      shadow.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    showToast('Código copiado! Pronto para colar no seu projeto.');
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar Código'; }, 2000);
  }

  function saveFile(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    shadow.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadCode() {
    const text = currentCode();
    if (!text) {
      if (view === 'image' && shot) saveFile(shot.dataUrl, `captura-o-cubo.${shot.dataUrl.startsWith('data:image/jpeg') ? 'jpg' : 'png'}`);
      return;
    }
    const stack = view === 'ai' ? aiStack : view === 'image' ? imageStack : cleanStack;
    const ext = view === 'raw' || stack === 'html' ? 'html' : stack === 'logic' ? 'js' : 'jsx';
    const href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    saveFile(href, `${result?.fullPage && view !== 'image' ? 'pagina-clonada' : 'componente-clonado'}.${ext}`);
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  let toastTimer;
  function showToast(msg) {
    ui.toast.textContent = '✓ ' + msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2400);
  }

  shadow.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.view) return setView(t.dataset.view);
    if (t.dataset.stack) { cleanStack = t.dataset.stack; setActive('[data-for="clean"]', 'data-stack', cleanStack); return renderCode(); }
    if (t.dataset.ai) { aiStack = t.dataset.ai; setActive('[data-for="ai"]', 'data-ai', aiStack); return setView('ai'); }
    if (t.dataset.img) { imageStack = t.dataset.img; setActive('[data-for="image"]', 'data-img', imageStack); return setView('image'); }
    switch (t.dataset.act) {
      case 'toggle': return toggle();
      case 'stop': return stop();
      case 'destroy': return destroy();
      case 'close': return closePanel();
      case 'reselect': resumeAfterShot = false; closePanel(); return activate();
      case 'copy': return copyCode(t);
      case 'download': return downloadCode();
      case 'ai-run': return runAi();
      case 'img-run': return runImageAi();
      case 'img-local': return runLocal();
      case 'exact-zip': return exportExact('zip');
      case 'exact-html': return exportExact('html');
      case 'page': resumeAfterShot = false; return chooseClone();
      case 'choose-page': ui.choice.hidden = true; return clonePage();
      case 'choose-site': ui.choiceGrid.hidden = true; ui.siteOpts.hidden = false; return;
      case 'choice-back': ui.siteOpts.hidden = true; ui.choiceGrid.hidden = false; return;
      case 'choice-close': return closeChoice();
      case 'crawl-start': return crawlSite();
      case 'crawl-cancel': crawlCancel = true; t.disabled = true; setExactStatus('Parando… empacotando as páginas já capturadas'); return;
      case 'shot':
      case 'shot-again': return startShot();
    }
  });
  ui.backdrop.addEventListener('click', e => { if (e.target === ui.backdrop) closePanel(); });
  ui.choice.addEventListener('click', e => { if (e.target === ui.choice) closeChoice(); });

  window.__oCubo = { activate, stop, toggle, destroy, capture, captureArea, startShot, clonePage, chooseClone, crawlSite, snapshotPage, exportExact };
})();
