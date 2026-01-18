
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getPdfInfo, getPageImage, extractTextSegments } from './services/pdfService';
import { translateFree } from './services/freeTranslateService';
import { translateEconomic } from './services/geminiService';
import { Language, TranslatedPage, BookProject, TranslationMode, ExportTheme, AppState, TextSegment } from './types';
import * as db from './services/db';
import { 
  FileUp, Loader2, Play, Library, Download, Globe, Eye, EyeOff, 
  Edit3, X, Hash, CheckSquare, Square, Sparkles, 
  Wand2, Trash2, Check, ChevronDown, ChevronUp, MousePointer2, BoxSelect, Eraser, Save, RotateCcw, Undo2, ArrowRight, Crosshair, ChevronLeft, Calendar, FileText, Type
} from 'lucide-react';

declare const jspdf: any;

const drawAutoFitText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, baseFontSize: number) => {
  let fontSize = baseFontSize;
  ctx.font = `${fontSize}px "Times New Roman", serif`;
  let metrics = ctx.measureText(text);
  if (metrics.width > maxWidth && maxWidth > 0) {
    const ratio = maxWidth / metrics.width;
    fontSize = baseFontSize * ratio;
    ctx.font = `${fontSize}px "Times New Roman", serif`;
  }
  ctx.fillText(text, x, y);
};

const languageLabels: Record<string, string> = {
  [Language.ENGLISH]: 'EN',
  [Language.SPANISH]: 'ES',
  [Language.JAPANESE]: 'JPN',
  [Language.CHINESE]: 'CHN',
  [Language.PORTUGUESE]: 'BR'
};

interface TranslatedCanvasPageProps {
  page: TranslatedPage;
  showOriginal?: boolean;
  isEditMode?: boolean;
  selectionMode: 'single' | 'area' | 'points';
  selectedIndices: number[];
  onSelectionChange: (indices: number[], pageNumber: number) => void;
}

const TranslatedCanvasPage: React.FC<TranslatedCanvasPageProps> = ({ 
  page, showOriginal = false, isEditMode = false, selectionMode, selectedIndices, onSelectionChange 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number, y: number } | null>(null);
  const [pointAnchor, setPointAnchor] = useState<{ x: number, y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page.imageData) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const aspectRatio = img.height / img.width;
      const renderWidth = 1200; 
      canvas.width = renderWidth;
      canvas.height = renderWidth * aspectRatio;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const segments = page.segments || [];
      
      if (!showOriginal) {
        ctx.fillStyle = "white";
        segments.forEach((seg: any) => {
          ctx.fillRect(seg.xRatio * canvas.width - 1, seg.yRatio * canvas.height - (seg.heightRatio * canvas.height * 0.8), seg.widthRatio * canvas.width + 2, seg.heightRatio * canvas.height * 1.1);
        });
        ctx.fillStyle = "black";
        ctx.textBaseline = "alphabetic";
        segments.forEach((seg: any) => {
          drawAutoFitText(ctx, seg.text, seg.xRatio * canvas.width, seg.yRatio * canvas.height, seg.widthRatio * canvas.width, seg.fontSize * (canvas.width / seg.viewportWidth));
        });
      }

      if (isEditMode) {
        ctx.save();
        segments.forEach((seg, idx) => {
          const isSelected = selectedIndices.includes(idx);
          ctx.strokeStyle = isSelected ? "#2563eb" : "rgba(37, 99, 235, 0.1)";
          ctx.lineWidth = isSelected ? 2.5 : 1;
          ctx.strokeRect(seg.xRatio * canvas.width - 2, seg.yRatio * canvas.height - (seg.heightRatio * canvas.height * 0.85), seg.widthRatio * canvas.width + 4, seg.heightRatio * canvas.height * 1.15);
          if (isSelected) {
            ctx.fillStyle = "rgba(37, 99, 235, 0.03)";
            ctx.fillRect(seg.xRatio * canvas.width - 2, seg.yRatio * canvas.height - (seg.heightRatio * canvas.height * 0.85), seg.widthRatio * canvas.width + 4, seg.heightRatio * canvas.height * 1.15);
          }
        });

        if (dragStart && dragCurrent && selectionMode === 'area') {
          ctx.strokeStyle = '#2563eb';
          ctx.setLineDash([5, 3]);
          ctx.lineWidth = 1.5;
          ctx.fillStyle = 'rgba(37, 99, 235, 0.05)';
          const x = dragStart.x * canvas.width;
          const y = dragStart.y * canvas.height;
          const w = (dragCurrent.x - dragStart.x) * canvas.width;
          const h = (dragCurrent.y - dragStart.y) * canvas.height;
          ctx.strokeRect(x, y, w, h);
          ctx.fillRect(x, y, w, h);
        }

        if (pointAnchor && selectionMode === 'points') {
          ctx.beginPath();
          ctx.arc(pointAnchor.x * canvas.width, pointAnchor.y * canvas.height, 8, 0, Math.PI * 2);
          ctx.fillStyle = '#2563eb';
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.closePath();
        }
        ctx.restore();
      }
    };
    img.src = `data:image/jpeg;base64,${page.imageData}`;
  }, [page, showOriginal, isEditMode, selectedIndices, dragStart, dragCurrent, selectionMode, pointAnchor]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isEditMode) return;
    if (selectionMode === 'points') return;
    setDragStart(getCoords(e));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (dragStart) setDragCurrent(getCoords(e));
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isEditMode) return;
    const end = getCoords(e);

    if (selectionMode === 'points') {
      if (!pointAnchor) {
        setPointAnchor(end);
        return;
      } else {
        const x1 = Math.min(pointAnchor.x, end.x), x2 = Math.max(pointAnchor.x, end.x);
        const y1 = Math.min(pointAnchor.y, end.y), y2 = Math.max(pointAnchor.y, end.y);
        const newIndices = page.segments?.reduce((acc: number[], s, i) => {
          const sx1 = s.xRatio, sx2 = s.xRatio + s.widthRatio;
          const sy1 = s.yRatio - s.heightRatio, sy2 = s.yRatio;
          if (sx1 < x2 && sx2 > x1 && sy1 < y2 && sy2 > y1) acc.push(i);
          return acc;
        }, []) || [];
        onSelectionChange(Array.from(new Set([...selectedIndices, ...newIndices])), page.pageNumber);
        setPointAnchor(null);
        return;
      }
    }

    if (dragStart && selectionMode === 'area' && Math.abs(end.x - dragStart.x) > 0.01) {
      const x1 = Math.min(dragStart.x, end.x), x2 = Math.max(dragStart.x, end.x);
      const y1 = Math.min(dragStart.y, end.y), y2 = Math.max(dragStart.y, end.y);
      const newIndices = page.segments?.reduce((acc: number[], s, i) => {
        const sx1 = s.xRatio, sx2 = s.xRatio + s.widthRatio;
        const sy1 = s.yRatio - s.heightRatio, sy2 = s.yRatio;
        if (sx1 < x2 && sx2 > x1 && sy1 < y2 && sy2 > y1) acc.push(i);
        return acc;
      }, []) || [];
      onSelectionChange(Array.from(new Set([...selectedIndices, ...newIndices])), page.pageNumber);
    } else {
      let best = -1; let minD = 0.05;
      page.segments?.forEach((s, i) => {
        const d = Math.sqrt(Math.pow(end.x - (s.xRatio + s.widthRatio/2), 2) + Math.pow(end.y - (s.yRatio - s.heightRatio/2), 2));
        if (d < minD) { best = i; minD = d; }
      });
      if (best !== -1) {
        const next = selectedIndices.includes(best) ? selectedIndices.filter(i => i !== best) : [...selectedIndices, best];
        onSelectionChange(next, page.pageNumber);
      }
    }
    setDragStart(null); setDragCurrent(null);
  };

  return (
    <canvas 
      ref={canvasRef} 
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`w-full h-auto block rounded-2xl shadow-sm border transition-all ${isEditMode ? 'cursor-crosshair border-blue-100' : 'cursor-default border-slate-50'}`} 
    />
  );
};

const App: React.FC = () => {
  const [projectName, setProjectName] = useState("");
  const [state, setState] = useState<AppState & { useAI: boolean }>({
    file: null, numPages: 0, currentBatchIndex: 0, batches: [], isProcessing: false,
    inputLanguage: Language.ENGLISH, outputLanguage: Language.PORTUGUESE,
    selectedPages: [], exportTheme: ExportTheme.EBOOK, requestedRange: { start: 1, end: 5 },
    systemInstruction: "", activeProjectId: null, projects: [], glossary: {},
    translationMode: TranslationMode.ORIGINAL_OVERLAY, useAI: false
  });

  const [rangeInput, setRangeInput] = useState({ start: "1", end: "5" });
  const [pdfInstance, setPdfInstance] = useState<any>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'single' | 'area' | 'points'>('points');
  
  const [activeEditPageNumber, setActiveEditPageNumber] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [batchEditingData, setBatchEditingData] = useState<{index: number, text: string, original: string, initialTranslation: string, selected: boolean}[] | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    refreshProjects();
  }, []);

  const refreshProjects = async () => {
    const ps = await db.getAllProjects();
    setState(s => ({ ...s, projects: ps as BookProject[] }));
  };

  const loadProject = async (id: string) => {
    const ps = await db.getAllProjects();
    const p = ps.find((x: any) => x.id === id);
    if (!p) return;
    const pgs = await db.getProjectPages(id);
    const buf = await db.getFile(id);
    if (buf) setPdfInstance(await pdfjsLib.getDocument({ data: buf }).promise);
    setState(s => ({ 
      ...s, activeProjectId: id, 
      batches: [{ id: 'r', startPage: 1, endPage: p.numPages, pages: pgs as TranslatedPage[], timestamp: 0 }], 
      numPages: p.numPages,
      inputLanguage: p.inputLanguage || Language.ENGLISH,
      outputLanguage: p.outputLanguage || Language.PORTUGUESE,
      selectedPages: pgs.map(p => p.pageNumber)
    }));
    setRangeInput({ start: "1", end: p.numPages.toString() });
  };

  const handleDeleteProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("Excluir projeto e todas as traduções permanentemente?")) return;
    await db.deleteProject(id);
    await refreshProjects();
  };

  const allPagesMap = useMemo(() => {
    const m = new Map<number, TranslatedPage>();
    state.batches.forEach(b => b.pages.forEach(p => m.set(p.pageNumber, p)));
    return m;
  }, [state.batches]);

  const translatedSelectedCount = useMemo(() => {
    return state.selectedPages.filter(n => allPagesMap.has(n)).length;
  }, [state.selectedPages, allPagesMap]);

  const updateLocalState = (pageNumber: number, entry: TranslatedPage | null) => {
    setState(s => {
      const b = [...s.batches];
      let m = b.find(x => x.id === 'r') || { id: 'r', startPage: 1, endPage: s.numPages, pages: [], timestamp: 0 };
      if (!b.find(x => x.id === 'r')) b.push(m);
      if (entry) {
        m.pages = [...m.pages.filter(x => x.pageNumber !== pageNumber), entry].sort((a: TranslatedPage, b: TranslatedPage) => a.pageNumber - b.pageNumber);
      } else {
        m.pages = m.pages.filter(x => x.pageNumber !== pageNumber);
      }
      return { ...s, batches: [...b] };
    });
  };

  const startTranslation = async () => {
    if (!pdfInstance || !state.activeProjectId) return;
    const start = Math.max(1, parseInt(rangeInput.start));
    const end = Math.min(state.numPages, parseInt(rangeInput.end));
    const total = end - start + 1;
    setState(s => ({ ...s, isProcessing: true }));
    setProgress(0);
    try {
      for (let n = start; n <= end; n++) {
        const imgD = await getPageImage(pdfInstance, n);
        const segs = await extractTextSegments(pdfInstance, n);
        const textsToTranslate = segs.map(s => s.text);
        let translatedTexts = state.useAI ? await translateEconomic(textsToTranslate, state.inputLanguage, state.outputLanguage) : await translateFree(textsToTranslate, state.inputLanguage, state.outputLanguage);
        const entry: TranslatedPage = { pageNumber: n, originalText: textsToTranslate.join(' '), translatedHtml: '', imageData: imgD, segments: segs.map((s, i) => ({ ...s, text: translatedTexts[i] || s.text, originalText: s.text })), mode: TranslationMode.ORIGINAL_OVERLAY };
        await db.savePage(state.activeProjectId, entry);
        updateLocalState(n, entry);
        setProgress(Math.round(((n - start + 1) / total) * 100));
      }
    } catch (e) { alert("Erro na tradução."); } finally { setState(s => ({ ...s, isProcessing: false })); setProgress(0); }
  };

  const exportSelected = async () => {
    const pagesToExport = state.selectedPages.filter(n => allPagesMap.has(n)).sort((a: number, b: number) => a - b);
    if (pagesToExport.length === 0) return alert("Apenas páginas traduzidas podem ser exportadas.");
    setIsExporting(true);
    try {
      const doc = new jspdf.jsPDF();
      for (let i = 0; i < pagesToExport.length; i++) {
        const p = allPagesMap.get(pagesToExport[i]);
        if (!p) continue;
        if (i > 0) doc.addPage();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image(); img.src = `data:image/jpeg;base64,${p.imageData}`;
        await new Promise(r => img.onload = r);
        canvas.width = 1600; canvas.height = 1600 * (img.height / img.width);
        ctx!.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx!.fillStyle = "white";
        p.segments?.forEach(seg => ctx!.fillRect(seg.xRatio * canvas.width - 1, seg.yRatio * canvas.height - (seg.heightRatio * canvas.height * 0.8), seg.widthRatio * canvas.width + 2, seg.heightRatio * canvas.height * 1.1));
        ctx!.fillStyle = "black";
        p.segments?.forEach(seg => drawAutoFitText(ctx!, seg.text, seg.xRatio * canvas.width, seg.yRatio * canvas.height, seg.widthRatio * canvas.width, seg.fontSize * (canvas.width / seg.viewportWidth)));
        doc.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, 210, 210 * (canvas.height / canvas.width));
      }
      doc.save(`${state.projects.find(x=>x.id===state.activeProjectId)?.name || 'Polyglot'}-Export.pdf`);
    } finally { setIsExporting(false); }
  };

  const translatedPageNumbers = useMemo(() => {
    return Array.from(allPagesMap.keys()).sort((a: number, b: number) => a - b);
  }, [allPagesMap]);

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900 overflow-x-hidden">
      
      {/* HEADER */}
      <header className="sticky top-0 z-[100] bg-white/80 backdrop-blur-md border-b border-slate-100 px-8 h-16 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100 cursor-pointer" onClick={() => setState(s => ({...s, activeProjectId: null}))}>
            <Sparkles size={18} fill="white"/>
          </div>
          <h1 className="text-base font-black tracking-tight text-blue-600 uppercase">Polyglot <span className="text-slate-800">Pro</span></h1>
        </div>
        
        <div className="flex items-center gap-3">
          {state.activeProjectId && (
            <button onClick={() => setState(s => ({...s, activeProjectId: null}))} className="text-[10px] font-black uppercase text-slate-400 hover:text-blue-600 transition-all flex items-center gap-2 mr-4">
              <ChevronLeft size={16}/> Meus Projetos
            </button>
          )}
          <label className="bg-slate-900 text-white px-5 py-2 rounded-xl text-[10px] font-black cursor-pointer hover:bg-slate-800 transition-all flex items-center gap-2 uppercase tracking-widest">
            <FileUp size={14}/> Novo PDF
            <input type="file" className="hidden" accept="application/pdf" onChange={async e => {
                const f = e.target.files?.[0]; if (!f) return;
                const { numPages, pdf } = await getPdfInfo(f);
                setPdfInstance(pdf); setProjectName(f.name.replace('.pdf', ''));
                (window as any)._tempPdfBuffer = await f.arrayBuffer();
                setState(s => ({ ...s, file: f, numPages })); setShowProjectModal(true);
            }} />
          </label>
        </div>
      </header>

      {/* GALERIA DE PROJETOS */}
      {!state.activeProjectId ? (
        <main className="flex-1 max-w-6xl mx-auto w-full px-8 py-12">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-2xl font-black text-slate-800 uppercase tracking-tighter">Biblioteca de Projetos</h2>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Seus livros salvos localmente</p>
            </div>
            <div className="bg-blue-50 text-blue-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border border-blue-100 flex items-center gap-2">
              <Library size={14}/> {state.projects.length} Projetos Ativos
            </div>
          </div>

          {state.projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {state.projects.sort((a,b) => b.timestamp - a.timestamp).map(p => (
                <div key={p.id} onClick={() => loadProject(p.id)} className="group bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-blue-50 hover:border-blue-100 transition-all cursor-pointer relative overflow-hidden">
                  <div className="flex flex-col h-full justify-between gap-6">
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all duration-500">
                          <FileText size={20}/>
                        </div>
                        <button onClick={(e) => handleDeleteProject(e, p.id)} className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-200 hover:text-rose-500 hover:bg-rose-50 transition-all">
                          <Trash2 size={18}/>
                        </button>
                      </div>
                      <h3 className="font-black text-lg text-slate-800 leading-tight mb-2 group-hover:text-blue-600 transition-colors truncate">{p.name}</h3>
                      <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Calendar size={12}/> {new Date(p.timestamp).toLocaleDateString()}</span>
                        <span className="w-1 h-1 bg-slate-200 rounded-full"/>
                        <span className="flex items-center gap-1"><Hash size={12}/> {p.numPages} pág.</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                       <div className="flex gap-2">
                         <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[8px] font-black">{languageLabels[p.inputLanguage]}</span>
                         <ArrowRight size={10} className="text-slate-300"/>
                         <span className="bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded text-[8px] font-black">{languageLabels[p.outputLanguage]}</span>
                       </div>
                       <div className="text-blue-600 font-black text-[10px] uppercase tracking-widest opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all">Abrir Agora</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-32 flex flex-col items-center justify-center text-slate-300 opacity-40 text-center">
              <Library size={80} strokeWidth={1} className="mb-6"/>
              <p className="font-black text-[10px] uppercase tracking-[0.4em]">Nenhum projeto salvo no IndexedDB</p>
              <p className="text-[10px] mt-2 font-bold max-w-xs uppercase leading-relaxed">Carregue um PDF acima para começar sua primeira tradução profissional</p>
            </div>
          )}
        </main>
      ) : (
        <>
          {/* HUB CONTROLES */}
          <div className="transition-all duration-500 overflow-hidden mb-6">
            <div className="max-w-6xl mx-auto px-8 pt-6">
              <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col gap-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <section className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">Fluxo de Tradução</label>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <select value={state.inputLanguage} onChange={e => setState(s => ({...s, inputLanguage: e.target.value as Language}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl text-xs font-black outline-none focus:border-blue-400 transition-all appearance-none text-center cursor-pointer">
                            {Object.values(Language).map(l => <option key={l} value={l}>{languageLabels[l] || l}</option>)}
                          </select>
                        </div>
                        <ArrowRight size={16} className="text-slate-300 shrink-0" />
                        <div className="flex-1">
                          <select value={state.outputLanguage} onChange={e => setState(s => ({...s, outputLanguage: e.target.value as Language}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl text-xs font-black outline-none focus:border-blue-400 transition-all appearance-none text-center cursor-pointer">
                            {Object.values(Language).map(l => <option key={l} value={l}>{languageLabels[l] || l}</option>)}
                          </select>
                        </div>
                      </div>
                    </section>
                    <section className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">Filtro de Páginas</label>
                      <div className="flex gap-3">
                        <input type="number" value={rangeInput.start} onChange={e => setRangeInput(x => ({...x, start: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl font-bold text-center text-xs outline-none focus:border-blue-400" />
                        <input type="number" value={rangeInput.end} onChange={e => setRangeInput(x => ({...x, end: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl font-bold text-center text-xs outline-none focus:border-blue-400" />
                      </div>
                    </section>
                  </div>
                  <div className="flex flex-wrap gap-3 items-center justify-between pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setState(s => ({...s, useAI: !s.useAI}))} className={`px-5 py-3 rounded-xl text-[9px] font-black border transition-all uppercase tracking-widest ${state.useAI ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}`}>
                          {state.useAI ? '✨ IA Flash Active' : '⚙️ Tradução Free'}
                        </button>
                        <button onClick={() => setShowOriginal(!showOriginal)} className={`px-5 py-3 rounded-xl text-[9px] font-black border transition-all uppercase tracking-widest ${showOriginal ? 'bg-slate-800 text-white border-slate-700' : 'bg-white text-slate-400 border-slate-200'}`}>
                          {showOriginal ? <Eye size={12} className="inline mr-1"/> : <EyeOff size={12} className="inline mr-1"/>} Ver Original
                        </button>
                    </div>
                    <button onClick={startTranslation} disabled={state.isProcessing} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-blue-100 flex items-center gap-2 hover:bg-blue-700 active:scale-95 disabled:opacity-50 transition-all">
                      {state.isProcessing ? <Loader2 className="animate-spin" size={16}/> : <Play size={14} fill="white"/>} Traduzir Seleção
                    </button>
                  </div>
              </div>
            </div>
          </div>

          {/* FEED DE PÁGINAS */}
          <main className="flex-1 max-w-5xl mx-auto w-full px-8 space-y-10 pb-40 pt-4">
            {translatedPageNumbers.length > 0 && (
              <div className="flex items-center justify-between px-2 pb-2 border-b border-slate-200 sticky top-16 bg-[#f8fafc]/80 backdrop-blur-md z-50">
                  <h2 className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Feed de Traduções ({translatedPageNumbers.length})</h2>
                  <div className="flex gap-4 items-center">
                    <button onClick={() => setState(s => ({ ...s, selectedPages: translatedPageNumbers }))} className="text-[9px] font-black uppercase text-blue-600 hover:underline">Marcar Tudo</button>
                    <button onClick={() => setState(s => ({ ...s, selectedPages: [] }))} className="text-[9px] font-black uppercase text-slate-400 hover:underline">Limpar</button>
                    <div className="h-4 w-px bg-slate-200" />
                    <button onClick={async () => {
                      if (!state.activeProjectId || state.selectedPages.length === 0) return;
                      const translatedInSelection = state.selectedPages.filter(n => allPagesMap.has(n));
                      if (translatedInSelection.length === 0) return alert("Nenhuma tradução encontrada na seleção.");
                      if (!confirm(`Excluir ${translatedInSelection.length} traduções permanentemente?`)) return;
                      await db.deletePagesFromProject(state.activeProjectId, translatedInSelection);
                      translatedInSelection.forEach(n => updateLocalState(n, null));
                      setState(s => ({ ...s, selectedPages: [] }));
                    }} className="text-[9px] font-black uppercase text-rose-500 hover:underline flex items-center gap-1"><Trash2 size={12}/> Excluir Selecionados</button>
                  </div>
              </div>
            )}

            {translatedPageNumbers.length > 0 ? (
              translatedPageNumbers.map(n => {
                const page = allPagesMap.get(n)!;
                const isSelected = state.selectedPages.includes(n);
                const isEditingThisPage = activeEditPageNumber === n;
                
                return (
                  <div key={n} className={`group relative animate-in slide-in-from-bottom-5 duration-500 ${isEditingThisPage ? 'ring-4 ring-blue-50 rounded-3xl' : ''}`}>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-black text-slate-200 group-hover:text-blue-200 transition-colors font-mono tracking-tighter">#{n}</span>
                        <span className="bg-emerald-50 text-emerald-600 text-[8px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1 border border-emerald-100">Página Traduzida</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={async () => {
                            if (!state.activeProjectId) return;
                            if (!confirm(`Excluir tradução da página ${n}?`)) return;
                            await db.deletePagesFromProject(state.activeProjectId, [n]);
                            updateLocalState(n, null);
                        }} title="Excluir Tradução" className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all"><Trash2 size={18}/></button>
                        <button onClick={() => setState(s => ({ ...s, selectedPages: isSelected ? s.selectedPages.filter(x => x !== n) : [...s.selectedPages, n] }))} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all border ${isSelected ? 'bg-emerald-500 border-emerald-400 text-white shadow-md' : 'bg-white border-slate-200 text-slate-200 hover:border-blue-300'}`}>
                          {isSelected ? <Check size={20}/> : <Square size={20}/>}
                        </button>
                      </div>
                    </div>
                    <div className={`p-1.5 rounded-3xl bg-white shadow-sm border-2 transition-all ${isSelected ? 'border-emerald-100' : 'border-white group-hover:border-blue-50'} ${isEditingThisPage ? 'border-blue-400' : ''}`}>
                      <TranslatedCanvasPage page={page} showOriginal={showOriginal} isEditMode={isEditMode} selectionMode={selectionMode} selectedIndices={isEditingThisPage ? selectedIndices : []} onSelectionChange={(indices, pNum) => { setActiveEditPageNumber(pNum); setSelectedIndices(indices); }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-32 flex flex-col items-center justify-center text-slate-300 opacity-40">
                {state.isProcessing ? (
                  <div className="text-center">
                    <Loader2 size={48} className="animate-spin text-blue-400 mb-6 mx-auto" />
                    <p className="font-black text-[10px] uppercase tracking-[0.4em]">Traduzindo Documento...</p>
                    <p className="text-[10px] mt-2 font-bold">{progress}% concluído</p>
                  </div>
                ) : (
                  <>
                    <Library size={80} strokeWidth={1} className="mb-6"/>
                    <p className="font-black text-[10px] uppercase tracking-[0.4em]">Use o painel acima para traduzir as páginas</p>
                  </>
                )}
              </div>
            )}
          </main>
        </>
      )}

      {/* DOCK EDIÇÃO */}
      {isEditMode && state.activeProjectId && (
        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-[150] flex flex-col gap-3 animate-in slide-in-from-right-10 duration-500">
           <div className="bg-white/90 backdrop-blur-xl border border-slate-100 p-2 rounded-2xl shadow-2xl flex flex-col items-center gap-2">
              <button onClick={() => setSelectionMode('single')} title="Seleção Individual" className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'single' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50'}`}><MousePointer2 size={18}/></button>
              <button onClick={() => setSelectionMode('points')} title="Seleção por Pontos" className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'points' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-indigo-500 hover:bg-slate-50'}`}><Crosshair size={18}/></button>
              <button onClick={() => setSelectionMode('area')} title="Seleção por Área" className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'area' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50'}`}><BoxSelect size={18}/></button>
              <div className="w-6 h-px bg-slate-100" />
              <button onClick={() => { setSelectedIndices([]); setActiveEditPageNumber(null); }} title="Limpar Seleção Interna" className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-slate-50"><Eraser size={18}/></button>
              <button onClick={() => { setIsEditMode(false); setSelectedIndices([]); setActiveEditPageNumber(null); }} title="Sair do Editor" className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all"><X size={18}/></button>
           </div>
        </div>
      )}

      {/* FOOTER ACTIONS */}
      {state.activeProjectId && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl z-[130] px-6 pointer-events-none">
          <div className="flex justify-center items-center gap-4 pointer-events-auto">
            {selectedIndices.length > 0 && isEditMode && activeEditPageNumber !== null && (
              <button onClick={() => {
                  const page = allPagesMap.get(activeEditPageNumber);
                  if (page?.segments) {
                    setBatchEditingData(selectedIndices.map(i => ({ 
                      index: i, 
                      text: page.segments![i].text, 
                      original: page.segments![i].originalText || page.segments![i].text, 
                      initialTranslation: page.segments![i].text,
                      selected: true 
                    })));
                  }
                }} className="bg-blue-600 text-white px-8 h-14 rounded-2xl shadow-xl shadow-blue-200 flex items-center gap-3 animate-in slide-in-from-bottom-10 duration-500 active:scale-95 transition-all">
                <Edit3 size={20}/>
                <div className="text-left">
                  <p className="text-[8px] font-black uppercase leading-none opacity-80">Editar Lote</p>
                  <p className="text-sm font-black leading-none">{selectedIndices.length} Selecionados</p>
                </div>
              </button>
            )}
            {!isEditMode && translatedSelectedCount > 0 && (
               <button onClick={exportSelected} className="bg-emerald-600 text-white px-10 h-14 rounded-2xl shadow-xl shadow-emerald-100 flex items-center gap-3 animate-in slide-in-from-bottom-10 duration-500 active:scale-95 transition-all">
                 <Download size={20}/>
                 <div className="text-left">
                   <p className="text-[8px] font-black uppercase leading-none opacity-80">Exportar PDF</p>
                   <p className="text-sm font-black leading-none">{translatedSelectedCount} Páginas Prontas</p>
                 </div>
               </button>
            )}
            <button onClick={() => { setIsEditMode(!isEditMode); setSelectedIndices([]); setActiveEditPageNumber(null); }} className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all transform hover:scale-105 active:scale-90 ${isEditMode ? 'bg-amber-400 text-white' : 'bg-white text-slate-400 border border-slate-100'}`}>
              <Wand2 size={24}/>
            </button>
          </div>
        </div>
      )}

      {/* MODAL EDITOR LOTE */}
      {batchEditingData && activeEditPageNumber !== null && (
        <div className="fixed inset-0 z-[300] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-4xl h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-500 border border-slate-200">
             <div className="px-8 py-6 border-b flex justify-between items-center bg-slate-50/50">
               <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center"><Edit3 size={22}/></div>
                 <div className="flex flex-col">
                   <h3 className="text-xl font-black text-slate-800 uppercase tracking-tighter">Editor de Lote</h3>
                   <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Página #{activeEditPageNumber} • {batchEditingData.length} blocos ativos</p>
                 </div>
               </div>
               <button onClick={() => setBatchEditingData(null)} className="w-12 h-12 bg-white border border-slate-200 rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all shadow-sm hover:rotate-90"><X size={24}/></button>
             </div>

             {/* BARRA DE FERRAMENTAS DO MODAL */}
             <div className="px-8 py-4 bg-white border-b flex items-center justify-between shadow-sm">
                <button onClick={() => {
                    const allSelected = batchEditingData.every(i => i.selected);
                    setBatchEditingData(prev => prev!.map(i => ({ ...i, selected: !allSelected })));
                  }} className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500 hover:text-blue-600 transition-colors bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                  {batchEditingData.every(i => i.selected) ? <CheckSquare size={18} className="text-blue-600"/> : <Square size={18}/>} Alternar Seleção
                </button>
                {batchEditingData.some(i => i.selected) && (
                  <div className="flex gap-2">
                    <button onClick={() => {
                        const selectedCount = batchEditingData.filter(i => i.selected).length;
                        if(!confirm(`Restaurar para o ORIGINAL os ${selectedCount} blocos marcados?`)) return;
                        setBatchEditingData(prev => prev!.map(i => i.selected ? { ...i, text: i.original } : i));
                      }} className="flex items-center gap-2 bg-amber-50 text-amber-700 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 transition-all border border-amber-200/50">
                      <Undo2 size={16}/> Original ({batchEditingData.filter(i => i.selected).length})
                    </button>
                    <button onClick={() => {
                        const selectedCount = batchEditingData.filter(i => i.selected).length;
                        if(!confirm(`Restaurar para o TRADUZIDO os ${selectedCount} blocos marcados?`)) return;
                        setBatchEditingData(prev => prev!.map(i => i.selected ? { ...i, text: i.initialTranslation } : i));
                      }} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-200/50">
                      <RotateCcw size={16}/> Traduzido ({batchEditingData.filter(i => i.selected).length})
                    </button>
                  </div>
                )}
             </div>

             <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar bg-slate-50/20">
                {batchEditingData.map((item, i) => (
                  <div key={item.index} className={`group bg-white p-6 rounded-[2rem] border transition-all relative ${item.selected ? 'border-blue-200 shadow-md ring-1 ring-blue-50' : 'border-slate-100 shadow-sm opacity-80'}`}>
                    <div className="absolute left-6 top-1/2 -translate-y-1/2 z-10">
                      <button onClick={() => {
                          const copy = [...batchEditingData];
                          copy[i].selected = !copy[i].selected;
                          setBatchEditingData(copy);
                        }} className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${item.selected ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-50 text-slate-300 border border-slate-100'}`}>
                        {item.selected ? <Check size={20}/> : <Square size={20}/>}
                      </button>
                    </div>
                    
                    <div className="pl-16 space-y-5">
                      {/* Texto de Origem */}
                      <div className="relative group/source">
                        <p className="text-[11px] font-medium text-slate-400 italic bg-slate-50/80 p-5 rounded-2xl border border-slate-100/50 leading-relaxed group-hover:bg-slate-50 transition-colors pr-32">
                          {item.original}
                        </p>
                        
                        {/* Botões de Restauração individuais */}
                        <div className="absolute top-1/2 -translate-y-1/2 right-4 flex gap-2">
                           <button 
                             onClick={() => { const copy = [...batchEditingData]; copy[i].text = item.original; setBatchEditingData(copy); }}
                             className="bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all border border-amber-200/50 flex items-center gap-1"
                           >
                             <Undo2 size={10}/> Original
                           </button>
                           <button 
                             onClick={() => { const copy = [...batchEditingData]; copy[i].text = item.initialTranslation; setBatchEditingData(copy); }}
                             className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-wider transition-all border border-indigo-200/50 flex items-center gap-1"
                           >
                             <RotateCcw size={10}/> Traduzido
                           </button>
                        </div>
                      </div>

                      {/* Área de Edição */}
                      <div className="space-y-2">
                        <label className="text-[9px] font-black text-blue-600 uppercase tracking-[0.2em] ml-2">Editor de Tradução</label>
                        <textarea 
                          value={item.text} 
                          onChange={e => { const copy = [...batchEditingData]; copy[i].text = e.target.value; setBatchEditingData(copy); }} 
                          className="w-full bg-white border-2 border-slate-100 p-6 rounded-3xl outline-none font-bold text-sm focus:ring-8 focus:ring-blue-50/50 focus:border-blue-400 transition-all min-h-[120px] shadow-sm resize-none leading-relaxed" 
                          placeholder="Digite ou corrija a tradução..." 
                        />
                      </div>
                    </div>
                  </div>
                ))}
             </div>

             <div className="p-8 bg-white border-t flex gap-4">
               <button onClick={() => setBatchEditingData(null)} className="flex-1 bg-slate-50 py-5 rounded-2xl font-black uppercase text-[11px] text-slate-500 hover:bg-slate-100 transition-all tracking-widest">Descartar</button>
               <button onClick={async () => {
                 const page = allPagesMap.get(activeEditPageNumber);
                 if (page && page.segments) {
                   const newPage = JSON.parse(JSON.stringify(page));
                   batchEditingData.forEach(item => { newPage.segments[item.index].text = item.text; });
                   await db.savePage(state.activeProjectId!, newPage);
                   updateLocalState(newPage.pageNumber, newPage);
                   setBatchEditingData(null); setSelectedIndices([]); setActiveEditPageNumber(null);
                 }
                }} className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-[11px] shadow-xl shadow-blue-100 flex items-center justify-center gap-3 hover:bg-blue-700 transition-all transform active:scale-95 tracking-widest">
                 <Save size={20}/> Salvar Alterações
               </button>
             </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIG NOVO PROJETO */}
      {showProjectModal && (
        <div className="fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-white p-10 rounded-[2.5rem] max-w-sm w-full shadow-2xl text-center border border-slate-100 animate-in zoom-in-95">
            <h2 className="text-[10px] font-black uppercase mb-8 text-slate-400 tracking-[0.4em]">Configurar Novo Projeto</h2>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Nome do Livro..." className="w-full bg-slate-50 p-5 rounded-2xl outline-none mb-8 font-black text-center text-xl border border-slate-200 focus:border-blue-500 transition-all shadow-inner" />
            <button onClick={async () => {
              const id = crypto.randomUUID();
              const p: BookProject = { id, name: projectName, fileName: state.file?.name || '', numPages: state.numPages, timestamp: Date.now(), inputLanguage: state.inputLanguage, outputLanguage: state.outputLanguage };
              await db.saveProject(p);
              if ((window as any)._tempPdfBuffer) await db.saveFile(id, (window as any)._tempPdfBuffer);
              await refreshProjects();
              await loadProject(id);
              setShowProjectModal(false);
            }} className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all">Criar e Abrir</button>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        html { scroll-behavior: smooth; }
        input[type="number"]::-webkit-inner-spin-button { display: none; }
      `}</style>
    </div>
  );
};

export default App;
