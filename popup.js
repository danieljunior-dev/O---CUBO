/* O Cubo — popup: laboratório 3D (Three.js) + ativação do modo Inspecionar */

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage;
const $ = id => document.getElementById(id);

/******************************************************************
 * 1. MOTOR 3D THREE.JS — O CUBO 3x3x3 VERDE NEON
 ******************************************************************/
let scene, camera, renderer, cubeGroup, radarRing;
const subCubes = [];
const codeParticles = [];

let cubeState = 'absorb'; // 'idle' | 'scan' | 'absorb' | 'ready'
let baseExpansion = 1.22;
let rotationSpeedMultiplier = 1.2;
let neonOpacity = 0.9;

let isDragging = false;
const prevPointer = { x: 0, y: 0 };
const userRotationOffset = { x: 0, y: 0 };
let readyFlashIntensity = 0;
let clock;

function initThreeCube() {
  clock = new THREE.Clock();
  const container = $('threeContainer');
  const width = container.clientWidth || 356;
  const height = container.clientHeight || 250;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(0, 0, 9.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x0a2e1f, 1.4));
  const dirLight1 = new THREE.DirectionalLight(0x00ff88, 1.8);
  dirLight1.position.set(6, 8, 7);
  scene.add(dirLight1);
  const dirLight2 = new THREE.DirectionalLight(0x10b981, 1.0);
  dirLight2.position.set(-6, -5, -4);
  scene.add(dirLight2);
  scene.add(new THREE.PointLight(0x00ff88, 2.5, 8));

  cubeGroup = new THREE.Group();
  cubeGroup.rotation.x = THREE.MathUtils.degToRad(32);
  cubeGroup.rotation.z = THREE.MathUtils.degToRad(28);
  scene.add(cubeGroup);

  const boxGeometry = new THREE.BoxGeometry(0.76, 0.76, 0.76);
  const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x071016, roughness: 0.22, metalness: 0.85 });

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const subGroup = new THREE.Group();
        const mesh = new THREE.Mesh(boxGeometry, faceMaterial.clone());
        subGroup.add(mesh);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: neonOpacity });
        subGroup.add(new THREE.LineSegments(edgesGeometry, edgeMat));
        subGroup.userData = {
          gridX: x, gridY: y, gridZ: z,
          basePos: new THREE.Vector3(x, y, z),
          edgeMat, meshMat: mesh.material,
          phase: Math.random() * Math.PI * 2
        };
        subGroup.position.set(x * baseExpansion, y * baseExpansion, z * baseExpansion);
        cubeGroup.add(subGroup);
        subCubes.push(subGroup);
      }
    }
  }

  radarRing = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 1.92, 48),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0 })
  );
  radarRing.rotation.x = Math.PI / 2;
  scene.add(radarRing);

  const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const particleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.85 });
  for (let i = 0; i < 36; i++) {
    const p = new THREE.Mesh(particleGeo, particleMat.clone());
    resetParticle(p);
    scene.add(p);
    codeParticles.push(p);
  }

  setupPointerControls(container);
}

function resetParticle(p) {
  const radius = 3.2 + Math.random() * 2.2;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  p.position.set(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
    radius * Math.cos(phi)
  );
  p.userData.speed = 0.025 + Math.random() * 0.035;
}

function setupPointerControls(container) {
  container.addEventListener('pointerdown', e => {
    isDragging = true;
    prevPointer.x = e.clientX;
    prevPointer.y = e.clientY;
    container.setPointerCapture(e.pointerId);
  });
  container.addEventListener('pointermove', e => {
    if (!isDragging) return;
    userRotationOffset.y += (e.clientX - prevPointer.x) * 0.012;
    userRotationOffset.x += (e.clientY - prevPointer.y) * 0.012;
    prevPointer.x = e.clientX;
    prevPointer.y = e.clientY;
  });
  const end = () => { isDragging = false; };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
}

function animateThreeCube() {
  requestAnimationFrame(animateThreeCube);
  const elapsed = clock.getElapsedTime();
  const delta = 0.016;

  const stateSpeedFactor = { idle: 0.65, scan: 1.85, absorb: 1.35, ready: 0.8 }[cubeState];
  if (!isDragging) userRotationOffset.y += delta * 0.75 * rotationSpeedMultiplier * stateSpeedFactor;

  cubeGroup.rotation.x = THREE.MathUtils.degToRad(32) + userRotationOffset.x;
  cubeGroup.rotation.y = userRotationOffset.y;
  cubeGroup.position.y = Math.sin(elapsed * 2.2) * 0.14;

  subCubes.forEach(sub => {
    const { gridX, gridY, gridZ, basePos, edgeMat, meshMat, phase } = sub.userData;
    let targetExpansion = baseExpansion;
    let localRotX = 0;
    let localRotY = 0;

    if (cubeState === 'idle') {
      targetExpansion = baseExpansion + Math.sin(elapsed * 2 + phase) * 0.03;
    } else if (cubeState === 'scan') {
      targetExpansion = baseExpansion + 0.12 + Math.sin(elapsed * 6) * 0.06;
    } else if (cubeState === 'absorb') {
      const wave = Math.sin(elapsed * 4.5 + (gridX + gridY + gridZ));
      targetExpansion = baseExpansion + 0.28 + wave * 0.12;
      if (gridY === 1) localRotY = elapsed * 1.6;
      if (gridY === -1) localRotY = -elapsed * 1.6;
      if (gridX === 0) localRotX = Math.sin(elapsed * 2.5) * 0.5;
    } else if (cubeState === 'ready') {
      targetExpansion = 1.04;
    }

    sub.position.x = THREE.MathUtils.lerp(sub.position.x, basePos.x * targetExpansion, 0.12);
    sub.position.y = THREE.MathUtils.lerp(sub.position.y, basePos.y * targetExpansion, 0.12);
    sub.position.z = THREE.MathUtils.lerp(sub.position.z, basePos.z * targetExpansion, 0.12);
    sub.rotation.x = THREE.MathUtils.lerp(sub.rotation.x, localRotX, 0.1);
    sub.rotation.y = THREE.MathUtils.lerp(sub.rotation.y, localRotY, 0.1);

    const pulse = 0.85 + Math.sin(elapsed * 4 + phase) * 0.15;
    edgeMat.opacity = Math.min(1, neonOpacity * pulse + readyFlashIntensity);

    if (readyFlashIntensity > 0.01) {
      meshMat.emissive.setHex(0x00ff88);
      meshMat.emissiveIntensity = readyFlashIntensity * 0.7;
    } else {
      meshMat.emissiveIntensity = 0;
    }
  });

  if (readyFlashIntensity > 0) readyFlashIntensity *= 0.93;

  if (cubeState === 'scan') {
    const scale = 0.6 + ((elapsed * 1.4) % 1.8);
    radarRing.scale.set(scale, scale, scale);
    radarRing.material.opacity = Math.max(0, 0.75 - (scale - 0.6) * 0.45);
    radarRing.rotation.z = elapsed;
  } else {
    radarRing.material.opacity = 0;
  }

  codeParticles.forEach(p => {
    if (cubeState === 'absorb') {
      p.visible = true;
      p.position.multiplyScalar(1 - p.userData.speed);
      p.rotation.x += 0.08;
      p.rotation.y += 0.08;
      if (p.position.length() < 0.45) resetParticle(p);
    } else {
      p.visible = false;
    }
  });

  renderer.render(scene, camera);
}

const STATE_LABELS = {
  idle: 'Modo Espera',
  scan: 'Escaneando Página',
  absorb: 'Absorvendo HTML/CSS',
  ready: 'Componente Pronto!'
};

function setCubeState(newState) {
  cubeState = newState;
  $('stateLabel').textContent = STATE_LABELS[newState];
  if (newState === 'ready') readyFlashIntensity = 1.0;
  document.querySelectorAll('.state-btn').forEach(b => b.classList.toggle('active', b.dataset.state === newState));
}

/******************************************************************
 * 2. AJUSTES (PERSISTIDOS EM chrome.storage)
 ******************************************************************/
function applySettings(s) {
  if (s.expansion != null) baseExpansion = s.expansion;
  if (s.speed != null) rotationSpeedMultiplier = s.speed;
  if (s.glow != null) neonOpacity = s.glow / 100;
  $('sliderExpansion').value = baseExpansion;
  $('sliderSpeed').value = rotationSpeedMultiplier;
  $('sliderGlow').value = Math.round(neonOpacity * 100);
  $('valExpansion').textContent = baseExpansion.toFixed(2) + 'x';
  $('valSpeed').textContent = rotationSpeedMultiplier.toFixed(1) + 'x';
  $('valGlow').textContent = Math.round(neonOpacity * 100) + '%';
}

function saveSettings() {
  if (!hasChrome) return;
  chrome.storage.local.set({
    cubeSettings: { expansion: baseExpansion, speed: rotationSpeedMultiplier, glow: Math.round(neonOpacity * 100) }
  });
}

function setupSliders() {
  $('sliderExpansion').addEventListener('input', e => { applySettings({ expansion: parseFloat(e.target.value) }); saveSettings(); });
  $('sliderSpeed').addEventListener('input', e => { applySettings({ speed: parseFloat(e.target.value) }); saveSettings(); });
  $('sliderGlow').addEventListener('input', e => { applySettings({ glow: parseInt(e.target.value, 10) }); saveSettings(); });
}

/******************************************************************
 * 3. ATIVAÇÃO NA ABA ATUAL + CONFIGURAÇÕES DE IA
 ******************************************************************/
function showError(msg) {
  const box = $('errorBox');
  box.textContent = msg;
  box.hidden = !msg;
}

async function activateOnTab(method = 'activate', btn = $('activateBtn')) {
  showError('');
  if (!hasChrome) return showError('Abra este popup pela extensão instalada para ativar O Cubo.');
  btn.disabled = true;
  setCubeState('scan');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: m => window.__oCubo && window.__oCubo[m](), args: [method] });
    setCubeState('ready');
    setTimeout(() => window.close(), 350);
  } catch (err) {
    setCubeState('idle');
    btn.disabled = false;
    showError('O Cubo não pode rodar nesta aba (páginas chrome://, Chrome Web Store e visualizador de PDF são protegidas). Abra um site normal e tente de novo.');
    console.warn('[O Cubo]', err);
  }
}

let toastTimer;
function showToast(msg) {
  const t = $('toast');
  t.textContent = '✓ ' + msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

let aiProvider = 'gemini';
const PROVIDER_LABELS = { claude: 'Claude', gemini: 'Gemini', ollama: 'Ollama (local)' };
// Sem chave padrão embutida no código
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

function setProvider(p) {
  aiProvider = p;
  document.querySelectorAll('.prov').forEach(b => {
    const on = b.dataset.provider === p;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  document.querySelectorAll('.prov-pane').forEach(pane => { pane.hidden = pane.dataset.pane !== p; });
  updateSaveStatus();
}

function updateSaveStatus() {
  const hasKey = aiProvider === 'ollama' || !!$(aiProvider + 'Key').value.trim();
  $('saveStatus').textContent = hasKey
    ? `✓ Usando ${PROVIDER_LABELS[aiProvider]}`
    : 'As chaves ficam salvas só neste navegador.';
}

async function loadStored() {
  if (!hasChrome) {
    $('geminiKey').value = '';
    return setProvider('gemini');
  }
  const s = await chrome.storage.local.get(['cubeSettings', 'aiProvider', 'claudeKey', 'claudeModel', 'geminiKey', 'geminiModel', 'ollamaUrl', 'ollamaModel']);
  if (s.cubeSettings) applySettings(s.cubeSettings);
  $('claudeKey').value = s.claudeKey || '';
  if (s.claudeModel) $('claudeModel').value = s.claudeModel;
  $('geminiKey').value = s.geminiKey || '';
  $('geminiModel').value = s.geminiModel === 'gemini-2.5-flash' ? '' : (s.geminiModel || '');
  $('ollamaUrl').value = s.ollamaUrl || '';
  $('ollamaModel').value = s.ollamaModel || '';
  const initialProvider = s.aiProvider || (s.claudeKey && !s.geminiKey ? 'claude' : 'gemini');
  setProvider(initialProvider);
  if (!s.geminiKey || s.geminiModel === 'gemini-2.5-flash') {
    await chrome.storage.local.set({ aiProvider: initialProvider, geminiKey: s.geminiKey || '', geminiModel: '' });
  }
}

async function saveAiSettings() {
  if (!hasChrome) return;
  await chrome.storage.local.set({
    aiProvider,
    claudeKey: $('claudeKey').value.trim(),
    claudeModel: $('claudeModel').value,
    geminiKey: $('geminiKey').value.trim(),
    geminiModel: $('geminiModel').value.trim(),
    ollamaUrl: $('ollamaUrl').value.trim(),
    ollamaModel: $('ollamaModel').value.trim()
  });
  updateSaveStatus();
  showToast(`Configurações salvas · ${PROVIDER_LABELS[aiProvider]}`);
}

// Lista os modelos instalados no Ollama e sugere um que entenda imagens
async function testOllama() {
  const status = $('ollamaStatus');
  const base = ($('ollamaUrl').value.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  status.className = 'small muted';
  status.textContent = 'Conectando…';
  try {
    const res = await fetch(`${base}/api/tags`);
    if (res.status === 403) throw new Error('bloqueado: defina OLLAMA_ORIGINS=chrome-extension://*');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const names = ((await res.json()).models || []).map(m => m.name);
    $('ollamaModels').replaceChildren(...names.map(n => Object.assign(document.createElement('option'), { value: n })));
    const vision = names.find(n => /vl|vision|llava|gemma3|minicpm-v|moondream|granite3.2-vision/i.test(n));
    if (!$('ollamaModel').value && vision) $('ollamaModel').value = vision;
    status.className = 'small status-ok';
    status.textContent = names.length
      ? `✓ Conectado · ${names.length} modelo(s)${vision ? '' : ' — nenhum de visão, rode ollama pull qwen2.5vl:7b'}`
      : '✓ Conectado, mas sem modelos: rode ollama pull qwen2.5vl:7b';
  } catch (err) {
    status.className = 'small status-err';
    status.textContent = /bloqueado/.test(err.message) ? `✕ Ollama ${err.message}` : `✕ Ollama não encontrado em ${base} — ele está aberto?`;
  }
}

/******************************************************************
 * 4. INICIALIZAÇÃO
 ******************************************************************/
document.querySelectorAll('.state-btn').forEach(b => b.addEventListener('click', () => setCubeState(b.dataset.state)));
$('resetBtn').addEventListener('click', () => {
  userRotationOffset.x = 0;
  userRotationOffset.y = 0;
  showToast('Ângulo isométrico restaurado');
});
$('activateBtn').addEventListener('click', () => activateOnTab('activate', $('activateBtn')));
$('shotBtn').addEventListener('click', () => activateOnTab('startShot', $('shotBtn')));
$('pageBtn').addEventListener('click', () => activateOnTab('chooseClone', $('pageBtn')));
$('saveBtn').addEventListener('click', saveAiSettings);
document.querySelectorAll('.prov').forEach(b => b.addEventListener('click', () => setProvider(b.dataset.provider)));
$('ollamaTest').addEventListener('click', testOllama);

applySettings({});
setupSliders();
loadStored();
try {
  initThreeCube();
  animateThreeCube();
} catch (err) {
  console.warn('[O Cubo] Visual 3D indisponível:', err);
}
