/* O Cubo — service worker: atalhos de teclado, captura de tela e chamadas à IA (Claude, Gemini ou Ollama local) */

const MAX_INPUT_CHARS = 60000;

async function injectCube(tabId, method) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: m => window.__oCubo && window.__oCubo[m](),
    args: [method]
  });
}

const COMMAND_METHODS = { 'toggle-inspect': 'toggle', 'capture-area': 'startShot', 'clone-page': 'chooseClone' };

chrome.commands.onCommand.addListener(async (command, tab) => {
  const method = COMMAND_METHODS[command];
  if (!method) return;
  const target = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  try {
    await injectCube(target.id, method);
  } catch (err) {
    console.warn('[O Cubo] Não foi possível injetar nesta aba:', err);
  }
});

const STACK_PROMPTS = {
  'react-tailwind':
    'Reescreva como um componente React funcional (export default) usando apenas classes utilitárias do Tailwind CSS ' +
    '(use valores arbitrários como bg-[#0c131a] quando necessário). Extraia dados repetidos para arrays/props e recrie ' +
    'com useState qualquer estado interativo óbvio (abas, toggles, contadores).',
  html:
    'Reescreva como HTML semântico e acessível seguido de um bloco <style> com CSS limpo: nomes de classe descritivos (BEM), ' +
    'variáveis CSS para as cores e nenhuma propriedade redundante.',
  logic:
    'Extraia apenas a lógica JavaScript/estado que este componente provavelmente tem (abas, toggles, contadores, animações), ' +
    'como funções ou hooks reutilizáveis em JavaScript moderno, com comentários curtos em português.'
};

const IMAGE_STACK_PROMPTS = {
  'react-tailwind':
    'Gere um componente React funcional (export default) com classes utilitárias do Tailwind CSS ' +
    '(use valores arbitrários como bg-[#0c131a] para cores exatas). Recrie com useState qualquer interação óbvia (abas, toggles).',
  html:
    'Gere um único arquivo HTML completo (<!doctype html>) com marcação semântica e um bloco <style> com CSS limpo, ' +
    'sem frameworks e sem JavaScript, pronto para abrir no navegador.'
};

const SYSTEM_PROMPT =
  'Você é O Cubo, um assistente que limpa e reconstrói componentes web capturados de sites reais. ' +
  'O HTML e o CSS recebidos já foram extraídos dos estilos computados do navegador, então podem ser verbosos. ' +
  'Responda SOMENTE com o código final, sem explicações fora do código e sem cercas de markdown.';

const IMAGE_SYSTEM_PROMPT =
  'Você é O Cubo, um assistente que transforma capturas de tela de interfaces web em código front-end fiel. ' +
  'Reproduza layout, cores, espaçamentos, tamanhos de fonte, bordas, sombras e hierarquia visual exatamente como na imagem. ' +
  'Copie os textos exatamente como aparecem. Substitua fotos por blocos de cor neutra com proporção igual e ícones por SVG simples. ' +
  'Responda SOMENTE com o código final, sem explicações fora do código e sem cercas de markdown.';

const PROVIDERS = {
  claude: { label: 'Claude', defaultModel: 'claude-opus-5-5' },
  gemini: { label: 'Gemini', defaultModel: 'gemini-3.0-flash' },
  ollama: { label: 'Ollama (local)', defaultModel: 'qwen2.5vl:7b' }
};
// Sem chave padrão embutida no código
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const STORAGE_KEYS = ['aiProvider', 'claudeKey', 'claudeModel', 'geminiKey', 'geminiModel', 'ollamaUrl', 'ollamaModel'];

async function getAiConfig() {
  const cfg = await chrome.storage.local.get(STORAGE_KEYS);
  const geminiKey = (cfg.geminiKey || '').trim();
  // Sem escolha explícita: usa Gemini (já com a chave padrão configurada) ou Claude se tiver chave própria
  const provider = cfg.aiProvider || (cfg.claudeKey && !cfg.geminiKey ? 'claude' : 'gemini');
  // O Ollama roda no próprio PC e não usa chave
  const key = { claude: cfg.claudeKey, gemini: geminiKey, ollama: 'local' }[provider];
  let rawModel = (cfg[provider + 'Model'] || '').trim();
  if (provider === 'gemini' && rawModel === 'gemini-2.5-flash') rawModel = '';
  const model = rawModel || PROVIDERS[provider].defaultModel;
  const baseUrl = (cfg.ollamaUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  return { provider, key, model, baseUrl, label: PROVIDERS[provider].label };
}

// Chamadas longas de IA: chamadas de API da extensão mantêm o service worker acordado
async function keepAlive(promise) {
  const timer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  try { return await promise; } finally { clearInterval(timer); }
}

const stripFences = text => text.trim().replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');

// Claude não aceita fallback de servidor no Haiku; nos demais modelos atuais ele reenvia recusas a outro modelo
const supportsFallbacks = model => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

async function callClaude({ key, model }, systemText, userText, image) {
  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } });
  content.push({ type: 'text', text: userText });
  const body = { model, max_tokens: 16000, system: systemText, messages: [{ role: 'user', content }] };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    // Requisição sai de uma origem chrome-extension:// (navegador)
    'anthropic-dangerous-direct-browser-access': 'true'
  };
  if (supportsFallbacks(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `Erro HTTP ${res.status}` };
  if (data.stop_reason === 'refusal') {
    return { ok: false, error: 'O Claude recusou este pedido' + (data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.') };
  }
  const text = stripFences((data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''));
  if (!text) return { ok: false, error: 'O Claude não retornou código.' };
  return { ok: true, text, model: data.model || model, truncated: data.stop_reason === 'max_tokens' };
}

async function fetchGeminiEndpoint(key, model, payload) {
  const isAqKey = /^AQ\./i.test(key);
  const endpoints = [
    {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }
    }
  ];
  if (isAqKey) {
    endpoints.push({
      url: `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  let res, data;
  for (const ep of endpoints) {
    res = await fetch(ep.url, { method: 'POST', headers: ep.headers, body: payload });
    data = await res.json().catch(() => ({}));
    if (res.ok) return { res, data };
    if (data?.error?.message && /models\//i.test(data.error.message)) break;
  }
  return { res, data };
}

async function callGemini({ key, model }, systemText, userText, image, temperature) {
  const parts = [];
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  parts.push({ text: userText });
  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature }
  });

  const tried = new Set();
  const queue = [model, 'gemini-3.0-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
  let lastRes, lastData, usedModel = model;

  while (queue.length) {
    const candidate = queue.shift().replace(/^models\//, '');
    if (!candidate || tried.has(candidate)) continue;
    tried.add(candidate);

    const out = await fetchGeminiEndpoint(key, candidate, payload);
    lastRes = out.res;
    lastData = out.data;
    usedModel = candidate;

    if (lastRes?.ok) {
      if (usedModel !== model) chrome.storage.local.set({ geminiModel: usedModel });
      break;
    }

    const msg = lastData?.error?.message || '';
    const suggested = /use\s+models\/([a-z0-9._-]+)/i.exec(msg)?.[1];
    if (suggested && !tried.has(suggested)) {
      queue.unshift(suggested);
      continue;
    }
    if (lastRes?.status !== 404 && !/model.*(no longer available|not found|not supported|deprecated)/i.test(msg)) {
      break;
    }
  }

  if (!lastRes?.ok) return { ok: false, error: lastData?.error?.message || `Erro HTTP ${lastRes?.status}` };
  const text = stripFences((lastData.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join(''));
  if (!text) return { ok: false, error: 'O Gemini não retornou código (resposta vazia ou bloqueada).' };
  return { ok: true, text, model: usedModel };
}

async function callOllama({ model, baseUrl }, systemText, userText, image, temperature) {
  const userMsg = { role: 'user', content: userText };
  if (image) userMsg.images = [image.data];
  let res;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'system', content: systemText }, userMsg],
        options: { temperature }
      })
    });
  } catch {
    return { ok: false, error: `Não encontrei o Ollama em ${baseUrl}. Ele está instalado e aberto?` };
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) {
    return { ok: false, error: 'O Ollama bloqueou a extensão. Defina OLLAMA_ORIGINS=chrome-extension://* e reinicie o Ollama.' };
  }
  if (!res.ok) {
    const msg = data.error || `Erro HTTP ${res.status}`;
    return { ok: false, error: /not found/i.test(msg) ? `Modelo ${model} não instalado. Rode no terminal: ollama pull ${model}` : msg };
  }
  const text = stripFences(data.message?.content || '');
  if (!text) return { ok: false, error: 'O modelo local não retornou código.' };
  return { ok: true, text, model };
}

async function callAI(systemText, userText, image, temperature) {
  const cfg = await getAiConfig();
  if (!cfg.key) {
    return { ok: false, error: `Configure sua chave do ${cfg.label} no popup d'O Cubo (ícone da extensão → Configurações de IA).` };
  }
  const call = {
    claude: () => callClaude(cfg, systemText, userText, image),
    gemini: () => callGemini(cfg, systemText, userText, image, temperature),
    ollama: () => callOllama(cfg, systemText, userText, image, temperature)
  }[cfg.provider]();
  return keepAlive(call);
}

function refactorWithAI({ stack, title, html, css }) {
  const source = `HTML:\n${html}\n\nCSS:\n${css}`.slice(0, MAX_INPUT_CHARS);
  const prompt = `${STACK_PROMPTS[stack] || STACK_PROMPTS.html}\n\nComponente: ${title}\n\n${source}`;
  return callAI(SYSTEM_PROMPT, prompt, null, 0.3);
}

function codeFromImage({ stack, dataUrl, width, height }) {
  const [, mimeType, data] = /^data:([^;]+);base64,(.*)$/.exec(dataUrl) || [];
  if (!data) return Promise.resolve({ ok: false, error: 'Imagem inválida.' });
  const prompt =
    `${IMAGE_STACK_PROMPTS[stack] || IMAGE_STACK_PROMPTS.html}\n\n` +
    `A captura mostra a interface em ${width}×${height} px (CSS) — use essas dimensões como referência de escala.`;
  return callAI(IMAGE_SYSTEM_PROMPT, prompt, { mimeType, data }, 0.2);
}

// Assets da cópia exata: o service worker tem <all_urls>, então não sofre bloqueio de CORS
const MAX_ASSET_BYTES = 30 * 1024 * 1024;

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fetchAsset(url) {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'URL não suportada' };
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_ASSET_BYTES) return { ok: false, error: 'arquivo grande demais' };
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_ASSET_BYTES) return { ok: false, error: 'arquivo grande demais' };
  return { ok: true, type: res.headers.get('content-type') || '', base64: toBase64(buffer) };
}

// Clonar o site inteiro: cada página abre numa janela minimizada, renderiza e é copiada pelo content script
let crawlWin = null; // { windowId, tabId }
const RENDER_TIMEOUT = 30000;
const RENDER_SETTLE = 1500;
const wait = ms => new Promise(r => setTimeout(r, ms));

chrome.windows.onRemoved.addListener(id => { if (crawlWin?.windowId === id) crawlWin = null; });

function waitTabComplete(tabId) {
  return new Promise(resolve => {
    const timer = setTimeout(done, RENDER_TIMEOUT);
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }
    function onUpdated(id, info) { if (id === tabId && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureCrawlWindow() {
  if (crawlWin) {
    try { await chrome.tabs.get(crawlWin.tabId); return crawlWin; } catch { crawlWin = null; }
  }
  const win = await chrome.windows.create({ url: 'about:blank', focused: false, state: 'minimized' });
  crawlWin = { windowId: win.id, tabId: win.tabs[0].id };
  return crawlWin;
}

// Confere o status HTTP antes de abrir: páginas de erro (404, 500…) não entram no clone
async function pageStatus(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', credentials: 'include', redirect: 'follow' });
    return res.status === 405 || res.status === 501 ? 200 : res.status;
  } catch {
    return 0;
  }
}

async function renderPage(url) {
  const status = await pageStatus(url);
  if (status >= 400) return { ok: false, error: `HTTP ${status}` };
  const { tabId } = await ensureCrawlWindow();
  const loaded = waitTabComplete(tabId);
  await chrome.tabs.update(tabId, { url });
  await loaded;
  await wait(RENDER_SETTLE); // tempo para o JavaScript do site montar a página
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__oCubo.snapshotPage() });
  if (!result) throw new Error('página sem conteúdo');
  return { ok: true, snapshot: result };
}

async function closeCrawlWindow() {
  if (!crawlWin) return;
  const { windowId } = crawlWin;
  crawlWin = null;
  try { await chrome.windows.remove(windowId); } catch { /* já fechada */ }
}

const fail = sendResponse => err => sendResponse({ ok: false, error: String(err?.message || err) });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'cubo:ai':
      refactorWithAI(msg).then(sendResponse, fail(sendResponse));
      return true;
    case 'cubo:ai-image':
      codeFromImage(msg).then(sendResponse, fail(sendResponse));
      return true;
    case 'cubo:render-page':
      keepAlive(renderPage(msg.url)).then(sendResponse, fail(sendResponse));
      return true;
    case 'cubo:crawl-done':
      closeCrawlWindow();
      return false;
    case 'cubo:fetch':
      fetchAsset(msg.url).then(sendResponse, fail(sendResponse));
      return true;
    case 'cubo:shot':
      // activeTab (concedido pelo popup ou atalho) permite capturar a área visível da aba
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
        .then(dataUrl => sendResponse({ ok: true, dataUrl }), fail(sendResponse));
      return true;
    case 'cubo:model':
      getAiConfig().then(cfg => sendResponse({ hasKey: !!cfg.key, model: cfg.model, provider: cfg.label }));
      return true;
  }
});
