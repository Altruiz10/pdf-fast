# PDF FAST

Leitor e editor de PDF que roda no navegador, no computador e no celular. É um app web instalável
(PWA): funciona offline depois da primeira visita, e os arquivos nunca saem do aparelho.

**Usar agora:** https://pdf-fast-30oeu.netlify.app

As funcionalidades seguem as do [PdfCraft](https://github.com/storytold/pdfcraft) (MIT/Apache-2.0),
mas o código foi escrito do zero em TypeScript. Nenhum código, nome ou marca do PdfCraft/ArtCraft foi usado.

## Funcionalidades

| Área | O que faz |
| --- | --- |
| Leitura | Rolagem contínua, uma página ou duas lado a lado; zoom com pinça, Ctrl+roda e botões; ajustar à largura/página; modo leitura; tela cheia; tema claro/escuro |
| Navegação | Miniaturas, marcadores (com filtro que mantém os pais visíveis), rótulos de página do próprio PDF |
| Busca | Enquanto digita, ignora acentos e maiúsculas, Enter/Ctrl+G para a próxima ocorrência |
| Texto | Seleção de texto; botão "Destacar" sobre o texto selecionado |
| Comentários | Destaque, caneta, caixa de texto, nota (vira anotação PDF de verdade), retângulo, elipse, linha, seta; mover, redimensionar, mudar cor, excluir; lista de comentários |
| Formulários | Lê e preenche campos de texto, caixas, listas e rádios; opção de fixar os campos |
| Assinatura | Desenhada com o dedo/mouse ou digitada; posicionável e redimensionável |
| Páginas | Organizar em grade: selecionar, girar, excluir, reordenar arrastando, inserir em branco, inserir de outro PDF, extrair |
| Arquivos | Juntar PDFs (com um marcador por arquivo), dividir (a cada N, antes de páginas, intervalos → .zip), extrair intervalos, imagens para PDF |
| Segurança | Abre PDFs com senha; mantém a senha ao salvar; protege com AES-256 e permissões; tarjas de redação reais (o conteúdo sob a tarja é removido); remoção de metadados, scripts e anexos |
| Outros | OCR (Tesseract, português e outros idiomas), reduzir tamanho (sem perdas ou rasterizado), propriedades/metadados, imprimir, compartilhar (celular), desfazer/refazer com nome do passo, recuperação automática após fechar sem salvar, paleta de comandos (Ctrl+K) |

## Rodar

Requer Node.js 22 ou mais novo.

```bash
npm install
```

```bash
npm run dev
```

Abre em http://localhost:5173. Para testar no celular na mesma rede Wi-Fi, use `npm run dev -- --host`
e abra o endereço "Network" que aparece no terminal.

## Publicar

```bash
npm run build
```

A pasta `dist/` é um site estático: pode ir para Netlify, Vercel, GitHub Pages, Cloudflare Pages ou
qualquer servidor. Para instalar como app no celular, o site precisa estar em HTTPS.

## Como funciona

- **pdf.js** renderiza as páginas, a camada de texto (seleção/busca) e lê marcadores.
- **pdf-lib** faz as edições (páginas, formulários, metadados, comentários fixados no conteúdo).
- **qpdf** (WebAssembly) remove e aplica criptografia e otimiza arquivos.
- **Tesseract.js** faz o OCR. Na primeira vez, baixa o modelo do idioma (~10 MB) da internet.

Os comentários ficam editáveis até você salvar ou reorganizar páginas; nesse momento eles são
desenhados no conteúdo do PDF. As notas também viram anotações PDF, que outros leitores mostram como comentários.

## Limitações conhecidas

- Editar o texto original do PDF não é suportado (o PdfCraft também está fraco nisso).
- A assinatura é visual, não um certificado digital.
- Camadas (optional content) e anexos não aparecem na interface.
- Imprimir no iPhone abre o PDF para usar o botão de impressão do sistema.

## Estrutura

```
src/
  App.tsx              telas, barras e atalhos
  store.tsx            documento aberto, histórico, salvar, recuperação
  components/          Viewer, PageView, AnnotLayer, Sidebar, Organizer, Dialogs…
  lib/
    pdfjs.ts           carregamento e renderização
    pdfops.ts          operações com pdf-lib
    qpdf.ts            senha e otimização
    raster.ts          tarjas, rasterização e OCR
    search.ts          busca e realce
    files.ts           abrir, salvar, compartilhar, zip, recuperação
scripts/               cópia de assets, ícones e PDFs de teste
```

## Licença

[MIT](LICENSE). As bibliotecas usadas mantêm as próprias licenças: pdf.js (Apache-2.0),
pdf-lib (MIT), qpdf (Apache-2.0), Tesseract.js (Apache-2.0), lucide (ISC), dnd-kit (MIT), fflate (MIT).
