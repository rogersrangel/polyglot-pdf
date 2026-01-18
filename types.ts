
export enum Language {
  PORTUGUESE = 'Português',
  ENGLISH = 'English',
  JAPANESE = '日本語 (Japanese)',
  CHINESE = '中文 (Chinese)',
  SPANISH = 'Español (Spanish)'
}

export enum ExportTheme {
  EBOOK = 'Ebook',
  STANDARD = 'Standard'
}

export enum TranslationMode {
  AI_DESIGNER = 'AI_DESIGNER', // Recontrói layout (caro)
  ORIGINAL_OVERLAY = 'ORIGINAL_OVERLAY' // Sobrepõe texto no original (barato)
}

export interface TextSegment {
  text: string;
  originalText?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color?: string;
  transform?: number[];
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  viewportWidth: number;
  viewportHeight: number;
}

export interface TranslatedPage {
  pageNumber: number;
  originalText: string;
  translatedHtml: string;
  imageData?: string; 
  segments?: TextSegment[]; // Usado no modo econômico
  mode: TranslationMode;
}

export interface BookProject {
  id: string;
  name: string;
  fileName: string;
  numPages: number;
  timestamp: number;
  inputLanguage: Language;
  outputLanguage: Language;
  glossary?: Record<string, string>;
}

export interface TranslationBatch {
  id: string;
  startPage: number;
  endPage: number;
  pages: TranslatedPage[];
  timestamp: number;
}

export interface AppState {
  file: File | null;
  numPages: number;
  currentBatchIndex: number;
  batches: TranslationBatch[];
  isProcessing: boolean;
  inputLanguage: Language;
  outputLanguage: Language;
  selectedPages: number[];
  exportTheme: ExportTheme;
  requestedRange: { start: number; end: number };
  systemInstruction: string;
  activeProjectId: string | null;
  projects: BookProject[];
  glossary: Record<string, string>;
  translationMode: TranslationMode;
}
