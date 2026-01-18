
import { Language } from "../types";

/**
 * PADRÕES DE PROTEÇÃO (Singularity Heuristics)
 * Identifica o que NÃO deve ser traduzido em um contexto de programação.
 */
const TECHNICAL_PATTERNS = [
  /\bnode\b/gi,                        // Node.js command
  /\bnpm\s+[a-z-]+\b/gi,               // npm commands
  /\bgit\s+[a-z-]+\b/gi,               // git commands
  /\byarn\s+[a-z-]+\b/gi,              // yarn commands
  /\bdocker\s+[a-z-]+\b/gi,            // docker commands
  /\b(build|dev|lint|runtime|deploy|hot-reload|setup|preview|version)\b/gi, // Termos de fluxo
  /[a-z0-9_\-]+\.(js|json|tsx|ts|html|css|md|py|go|c|cpp)\b/gi,      // Arquivos
  /\b[a-z]+[A-Z][a-z0-9]+\b/g,         // camelCase (ex: useEffect)
  /\b[A-Z][a-z0-9]+[A-Z][a-z0-9]+\b/g, // PascalCase (ex: ReactComponent)
  /\.\/[a-z0-9\-_/.]+/gi,              // Relative paths
  /--[a-z0-9\-]+/gi                    // CLI flags (--save, --dev, --version)
];

/**
 * Verifica se um segmento inteiro parece ser apenas código ou comando
 */
function isPureCode(text: string): boolean {
  const trimmed = text.trim();
  // Se for muito curto ou começar com comandos clássicos
  if (/^(node|npm|git|yarn|sudo|docker|cd|ls|mkdir)\b/i.test(trimmed)) return true;
  // Se contiver apenas caracteres típicos de código/config
  if (/^[\w\d\-_.]+$/i.test(trimmed) && trimmed.includes('.')) return true;
  return false;
}

export async function translateFree(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  const langMap: Record<string, string> = {
    'English': 'en',
    'Português': 'pt',
    'Español (Spanish)': 'es',
    '日本語 (Japanese)': 'ja',
    '中文 (Chinese)': 'zh'
  };

  const sl = langMap[sourceLang] || 'auto';
  const tl = langMap[targetLang] || 'pt';

  if (!texts || texts.length === 0) return [];

  const vault = texts.map(text => {
    if (isPureCode(text)) return { isCode: true, original: text, processed: text, tokens: {} };

    let processed = text;
    const tokens: Record<string, string> = {};
    let tokenCount = 0;

    TECHNICAL_PATTERNS.forEach(pattern => {
      processed = processed.replace(pattern, (match) => {
        const tokenId = `[[_${tokenCount++}_]]`;
        tokens[tokenId] = match;
        return tokenId;
      });
    });

    return { isCode: false, original: text, processed, tokens };
  });

  const toTranslate = vault.map(v => v.isCode ? "---SKIP---" : v.processed);
  
  try {
    const delimiter = " ||| ";
    const combinedText = toTranslate.join(delimiter);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(combinedText)}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Google API Error");
    
    const data = await response.json();
    let fullTranslated = "";
    if (data && data[0]) {
      fullTranslated = data[0].map((part: any) => part[0]).join("");
    } else {
      return texts;
    }

    const translatedParts = fullTranslated.split(/\s?\|\|\|\s?/);

    return vault.map((v, i) => {
      if (v.isCode) return v.original;
      
      let finalStr = translatedParts[i] || v.original;

      Object.entries(v.tokens).forEach(([tokenId, originalValue]) => {
        const escapedToken = tokenId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        finalStr = finalStr.replace(new RegExp(escapedToken, 'g'), originalValue);
      });

      return finalStr;
    });

  } catch (e) {
    console.error("Falha na tradução com proteção:", e);
    return texts;
  }
}
