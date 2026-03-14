/**
 * AutoPublisher — Heuristic Category Classifier
 * Replaces LLM-based tagging for common topics to save tokens.
 */

export function classifyCategory(title: string, content: string = ""): string {
  const text = `${title} ${content}`.toLowerCase();

  // Esportes
  if (/\b(futebol|gol|campeonato|copa|basquete|vôlei|tênis|olimp|atleta|estádio|arena|clube|brasileirão|libertadores)\b/i.test(text)) {
    return "Esportes";
  }

  // Cinema & Entretenimento
  if (/\b(filme|cinema|série|netflix|estreia|ator|atriz|show|música|álbum|lançamento|reality|oscar|emmy|hollywood)\b/i.test(text)) {
    return "Cinema";
  }

  // Política
  if (/\b(prefeitura|governo|deputado|senador|presidente|voto|eleição|câmara|ministro|stf|pec|projeto de lei|política)\b/i.test(text)) {
    return "Política";
  }

  // Economia
  if (/\b(dólar|bolsa|ações|investimento|mercado|taxa selic|inflação|pib|banco|finanças|emprego|venda|compra|negócio)\b/i.test(text)) {
    return "Economia";
  }

  // Tecnologia
  if (/\b(tecnologia|apple|google|iphone|samsung|ia|inteligência artificial|software|hardware|startup|app|celular|internet)\b/i.test(text)) {
    return "Tecnologia";
  }

  return "Geral";
}
