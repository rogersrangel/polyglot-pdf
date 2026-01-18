
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configurações de Segurança para Hostinger
app.use(helmet({
  contentSecurityPolicy: false, 
}));
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Limita o número de requisições para evitar custos inesperados na API
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { error: "Muitas solicitações. Aguarde 15 minutos." }
});
app.use('/api/', limiter);

app.post('/api/translate', async (req, res) => {
  const { texts, sourceLang, targetLang } = req.body;
  
  // API key must be obtained exclusively from the environment variable process.env.API_KEY.
  if (!process.env.API_KEY) {
    return res.status(500).json({ error: "Configuração do servidor incompleta: API_KEY não encontrada." });
  }

  if (!texts || texts.length === 0) return res.json([]);

  try {
    // Correct initialization using named parameter as per guidelines
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Using gemini-3-flash-preview for translation tasks as per guidelines
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Translate this JSON array from ${sourceLang} to ${targetLang}. 
          Maintain all formatting and programming terms. Return ONLY the JSON array.
          ARRAY: ${JSON.stringify(texts)}`,
      config: {
        responseMimeType: "application/json",
        // Using responseSchema for structural integrity of the response
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.STRING
          }
        }
      }
    });

    // Access the extracted string output using the .text property (not a method)
    const jsonStr = response.text;
    res.json(JSON.parse(jsonStr));
  } catch (error) {
    console.error("ERRO:", error.message);
    res.status(500).json({ error: "Erro interno no processamento da tradução." });
  }
});

app.listen(PORT, () => {
  console.log(`
  =========================================
  ✅ SERVIDOR DE SEGURANÇA ATIVO
  📡 Porta: ${PORT}
  🔗 API: http://localhost:${PORT}/api/translate
  =========================================
  `);
});
