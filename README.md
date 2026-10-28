# O Cubo — AI Web Component Cloner (extensão Chrome/Edge)

Extensão Manifest V3 criada a partir do protótipo `prototipo-cubo.html`.

## Instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta (`o-cubo-extensao`).
4. Fixe o ícone d'O Cubo na barra do navegador.

## Usar

- Clique no ícone → **⚡ Ativar O Cubo nesta página** (ou `Alt+Shift+C`).
- Passe o mouse sobre a página: o elemento sob o cursor fica destacado.
  - `↑` seleciona o elemento pai, `↓` volta ao filho, `Enter` ou clique captura, `Esc` sai.
- O painel mostra:
  - **✨ Código Limpo** — HTML formatado + CSS extraído dos estilos computados (classes `cubo-*`), ou um componente **React (JSX)**.
  - **🕸️ Bruto do Site** — o `outerHTML` original.
  - **▶️ Preview Isolado** — o clone renderizado num iframe sem scripts, fora do site.
  - **🧠 Refatorar com IA** — envia o HTML/CSS limpo à IA (Claude ou Gemini) e devolve React + Tailwind, HTML semântico ou só a lógica JS.
  - **📸 Por Imagem** — O Cubo tira um print do elemento e a IA gera o código do que está na imagem.
- **📸 Capturar área da tela** (popup, botão **📸 Área** na barra ou `Alt+Shift+S`): arraste para recortar qualquer parte da tela; a IA gera React + Tailwind ou HTML + CSS a partir do print (com preview do HTML gerado). Sem chave de IA, dá para baixar o PNG.
- **🌐 Clonar** (popup, botão **🌐 Clonar** na barra ou `Alt+Shift+P`) pergunta o que clonar:
  - **🗺️ Site inteiro** — percorre as páginas do mesmo domínio (até 500, padrão 50), abrindo cada uma numa janela minimizada para o JavaScript do site renderizar, tira a cópia exata de cada uma, baixa os assets uma vez só e reescreve os links internos para os arquivos locais. Sai um ZIP com `index.html`, `paginas/`, `assets/` e `mapa-do-site.html`, navegável offline. Respeita o `robots.txt` (pode desligar) e nunca segue links de sair/logout/excluir. Dá para parar no meio e baixar o que já foi capturado.
  - **📄 Só esta página** — gera um único arquivo `.html` com a página toda — HTML limpo, CSS extraído e as fontes do site — 100% local, sem IA. Também sai como componente React. Até 12.000 elementos por página.
- **📦 Cópia exata com assets** (no painel da página inteira): salva o HTML e o CSS **originais** do site (hover, responsivo, animações, CSS-in-JS), baixa imagens, fontes, ícones, SVGs e backgrounds e reescreve tudo para arquivos locais. Os links continuam apontando para o site. Antes de copiar, O Cubo rola a página para carregar imagens com lazy-load. Saída em **ZIP** (`index.html` + `assets/`) ou **HTML único** com tudo embutido.
- **🧩 Gerar local (sem IA)** — no painel de uma área recortada, O Cubo lê o HTML/CSS real da página dentro do recorte e gera o código na hora, sem IA e sem internet. Só não funciona quando a área é uma imagem ou um canvas.
- **Copiar Código** / **Baixar** salvam o resultado.

## IA (opcional)

No popup, abra **Configurações de IA** e escolha o provedor:

- **Local (Ollama)** — roda no seu PC, sem chave e sem internet. Instale em [ollama.com](https://ollama.com), rode `ollama pull qwen2.5vl:7b` (PC mais fraco: `gemma3:4b`) e clique em **Testar conexão**. Se aparecer "bloqueado", defina a variável de ambiente `OLLAMA_ORIGINS=chrome-extension://*` e reinicie o Ollama.
- **Claude (Anthropic)** — crie a chave em [console.anthropic.com](https://console.anthropic.com) → *API Keys* (a conta precisa de créditos). Modelos: Claude Opus 5.5 (padrão, mais preciso), Sonnet 5.5 (equilíbrio) ou Haiku 5.5 (mais rápido e barato).
- **Gemini (Google)** — chave grátis em [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Modelo padrão `gemini-2.5-flash`.

As chaves ficam em `chrome.storage.local`, só neste navegador. Sem chave, toda a extração local continua funcionando.

## Arquivos

| Arquivo | Função |
| --- | --- |
| `manifest.json` | Permissões: `activeTab`, `scripting`, `storage` + `<all_urls>` (baixar assets de qualquer domínio na cópia exata e falar com Claude/Gemini/Ollama) |
| `popup.html/css/js` | Laboratório 3D do cubo 3×3×3 (Three.js r128 local em `lib/`), estados, ajustes e configurações |
| `content.js` | Injetado sob demanda: modo Inspecionar, captura do DOM e painel (em Shadow DOM, isolado do CSS do site) |
| `background.js` | Atalhos, captura de tela e chamadas ao Claude/Gemini |

## Limitações

- Estados `:hover`/`:focus`, `@keyframes` e media queries não são capturados — o CSS reflete o estado visível no momento do clique.
- Na cópia exata, scripts não são copiados: o arquivo é o visual renderizado (menus e abas ficam no estado em que estavam). Conteúdo de `<iframe>` e vídeos de streaming continuam vindo do site original; componentes com Shadow DOM aparecem sem o conteúdo interno.
- Na página inteira, imagens com carregamento preguiçoso (lazy-load) só aparecem se você rolou até elas antes de clonar; scripts e interações do site não são copiados.
- Respeite os direitos do site: use os clones para estudo, prototipagem ou páginas suas.
- Páginas protegidas (`chrome://`, Chrome Web Store, visualizador de PDF) não aceitam extensões.
- Fontes da página só aparecem no preview se estiverem instaladas ou carregadas publicamente.

## Versões

- **0.15.0** — **🗺️ Clonar o site inteiro**: todas as páginas do domínio, com assets e links internos locais, num ZIP navegável.
- **0.14.0** — **📦 Cópia exata com assets**: HTML/CSS originais + imagens, fontes e ícones locais, em ZIP ou HTML único.
- **0.13.0** — **🌐 Clonar página inteira**: documento HTML completo e independente (com fontes), local e sem IA.
- **0.12.0** — **🧩 Gerar local**: código da área recortada sem IA (lê o DOM da página); provedor **Ollama** para IA de visão rodando no próprio PC.
- **0.11.0** — Claude (Anthropic) como provedor de IA, além do Gemini: escolha no popup, com seleção de modelo.
- **0.10.0** — Captura por imagem: recorte de área da tela ou print do elemento → código gerado pelo Gemini (visão).
- **0.9.1** — Three.js movido para `lib/` (a pasta `vendor/` não foi copiada e travava o popup); popup continua funcional mesmo se o 3D falhar; compatibilidade com sites que exigem Trusted Types (YouTube, Gmail, Google…).
- **0.9.0** — Primeira versão.
