
import * as pdfjsLib from 'pdfjs-dist';

// Tenta pegar a versão da lib ou assume a do package.json
const VERSION = (pdfjsLib as any).version || '4.10.38';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VERSION}/pdf.worker.min.mjs`;

export async function getPdfInfo(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  return {
    numPages: pdf.numPages,
    pdf
  };
}

export async function extractTextSegments(pdf: any, pageNumber: number): Promise<any[]> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.0 });
  const textContent = await page.getTextContent();
  
  return textContent.items
    .filter((item: any) => item.str && item.str.trim().length > 0)
    .map((item: any) => {
      const tx = item.transform[4];
      const ty = item.transform[5];
      const fontSize = Math.sqrt(item.transform[0] * item.transform[0] + item.transform[1] * item.transform[1]);
      
      return {
        text: item.str,
        width: item.width,
        height: fontSize,
        fontSize: fontSize,
        xRatio: tx / viewport.width,
        yRatio: (viewport.height - ty) / viewport.height,
        widthRatio: item.width / viewport.width,
        heightRatio: fontSize / viewport.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        fontName: item.fontName
      };
    });
}

export async function getPageImage(pdf: any, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 3.0 }); 
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  if (!context) return '';

  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1]; 
}
