
import { Language } from "../types";

export async function translateEconomic(
  texts: string[],
  sourceLang: Language,
  targetLang: Language
): Promise<string[]> {
  // O Vite faz o proxy de '/api' para 'localhost:3001' automaticamente em dev
  const API_URL = '/api/translate';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, sourceLang, targetLang })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Erro no servidor");
    }

    return await response.json();
  } catch (e: any) {
    console.error("Erro na tradução:", e);
    alert(e.message || "Erro na tradução.");
    return texts;
  }
}
