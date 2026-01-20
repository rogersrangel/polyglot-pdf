
import { GoogleGenAI, Type } from "@google/genai";
import { Language } from "../types";

export async function translateEconomic(
  texts: string[],
  sourceLang: Language,
  targetLang: Language,
  manualKey?: string
): Promise<string[]> {
  // Tenta usar a chave manual do usuário, senão cai na chave do ambiente
  const apiKey = manualKey || process.env.API_KEY;

  if (!apiKey) {
    throw new Error("API_KEY não configurada. Por favor, insira sua chave no botão 'Configurar Chave' no topo da página.");
  }

  if (!texts || texts.length === 0) return [];

  try {
    const ai = new GoogleGenAI({ apiKey });
    
    // Utilizando gemini-3-flash-preview para traduções eficientes
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate the following JSON array from ${sourceLang} to ${targetLang}. 
          Maintain all formatting, programming code context, and technical identifiers. 
          Return ONLY the translated JSON array.
          ARRAY: ${JSON.stringify(texts)}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        },
        temperature: 0.1,
      }
    });

    const jsonStr = response.text;
    if (!jsonStr) throw new Error("A IA retornou uma resposta vazia.");
    
    return JSON.parse(jsonStr);
  } catch (e: any) {
    console.error("Gemini Translation Error:", e);
    throw new Error(`Falha na tradução IA: ${e.message}. Verifique se sua API Key é válida.`);
  }
}
