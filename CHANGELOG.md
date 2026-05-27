# Changelog

## 0.3.1 (em desenvolvimento)

- Adicionada aba **Busca** ao PiP, ao lado de **Principal**, **Monitorados** e **Alertas**.
- Busca por nome/ID agora é compartilhada entre dashboard, PiP e painel flutuante.
- Busca textual ampla por `q` passa a preservar múltiplos resultados relacionados do bloco **Resultados da pesquisa**.
- Normalização de busca agora ignora estrelas, acentos, pontuação e conectores como `de`, evitando escolher item errado para termos como `lin yun`.
- Resultados locais sem `item_id` real não encerram mais a busca direta; a extensão busca candidatos no painel.
- Adicionado fallback em `localStorage` para abrir telas locais fora do contexto da extensão durante testes.

## 0.3.0

- Adicionado dashboard full screen (`src/dashboard.html`).
- Adicionada tela de itens monitorados com resumo do último dia e métricas de período.
- Adicionado histórico diário de preços em tabela e gráfico SVG local.
- Adicionados alertas de preço com notificações locais e cooldown configurável.
- Exportar/importar agora inclui alertas.
- Adicionado botão de PiP para item principal usando Document Picture-in-Picture quando disponível e fallback em popup.
- Popup e painel flutuante agora abrem o dashboard full screen.
- Rótulos de preço ajustados para deixar claro quando o dado é do último dia ou do período.

## 0.2.0

- Adicionado parser específico para o HTML real da página de análise.
- Extração direta dos arrays inline `rows` e `currencyRows`.
- Snapshot agora captura média, mediana, mínimo, máximo, trades filtrados, compras, vendas, volume total e variação do preço médio no período.
- Melhoria na captura do nome do item usando links `item_id` e `pwdatabase`.
- Correção de erro de sintaxe no service worker.

## 0.1.0

- Primeira versão Manifest V3.
- Painel flutuante.
- Histórico automático.
- Itens fixados.
- Atualização automática configurável.
- Exportar/importar JSON.
