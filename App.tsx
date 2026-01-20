
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getPdfInfo, getPageImage, extractTextSegments } from './services/pdfService';
import { translateFree } from './services/freeTranslateService';
import { translateEconomic } from './services/geminiService';
import { Language, TranslatedPage, BookProject, TranslationMode, ExportTheme, AppState, TextSegment } from './types';
import * as db from './services/db';
import { 
  FileUp, Loader2, Play, Library, Download, Globe, Eye, EyeOff, 
  Edit3, X, Hash, CheckSquare, Square, Sparkles, 
  Wand2, Trash2, Check, ChevronDown, ChevronUp, MousePointer2, BoxSelect, Eraser, Save, RotateCcw, Undo2, ArrowRight, Crosshair, ChevronLeft, ChevronRight, Calendar, FileText, Type, Key, ExternalLink, LayoutGrid, Maximize2, Rows3, Search, Plus, ArrowUp, AlertTriangle
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
  
  // Custom Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{ 
    isOpen: boolean; 
    title: string; 
    message: string; 
    onConfirm: () => void;
    type: 'danger' | 'info'
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'info'
  });

  // Modal Chave API
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);

  // UI UX States
  const [viewMode, setViewMode] = useState<'feed' | 'single' | 'grid'>('feed');
  const [visiblePagesCount, setVisiblePagesCount] = useState(3);
  const [singlePageViewIndex, setSinglePageViewIndex] = useState(0);
  const [jumpPageInput, setJumpPageInput] = useState("");
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  const [activeEditPageNumber, setActiveEditPageNumber] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [batchEditingData, setBatchEditingData] = useState<{index: number, text: string, original: string, initialTranslation: string, selected: boolean}[] | null>(null);
  const [progress, setProgress] = useState(0);

  const loaderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    refreshProjects();
    checkStoredKey();
    const handleScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const checkStoredKey = async () => {
    const key = await db.getSetting('gemini_api_key');
    if (key) {
      setHasStoredKey(true);
      setApiKeyInput(atob(key.replace("PG_", "")));
    }
  };

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return alert("Insira uma chave válida.");
    const obfuscated = "PG_" + btoa(apiKeyInput.trim());
    await db.setSetting('gemini_api_key', obfuscated);
    setHasStoredKey(true);
    setShowApiKeyModal(false);
  };

  const handleRemoveKey = async () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remover Chave',
      message: 'Deseja remover sua chave de API do armazenamento local?',
      type: 'danger',
      onConfirm: async () => {
        await db.setSetting('gemini_api_key', null);
        setApiKeyInput("");
        setHasStoredKey(false);
        setShowApiKeyModal(false);
        setConfirmDialog(s => ({ ...s, isOpen: false }));
      }
    });
  };

  // Infinite Scroll Observer
  useEffect(() => {
    if (viewMode !== 'feed' || state.isProcessing) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisiblePagesCount(prev => prev + 3);
      }
    }, { threshold: 0.1 });

    if (loaderRef.current) observer.observe(loaderRef.current);
    return () => observer.disconnect();
  }, [viewMode, state.isProcessing]);

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
    setVisiblePagesCount(3);
    setSinglePageViewIndex(0);
    setViewMode('feed');
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDialog({
      isOpen: true,
      title: 'Excluir Projeto',
      message: 'Tem certeza que deseja excluir este projeto e todas as suas traduções permanentemente?',
      type: 'danger',
      onConfirm: async () => {
        await db.deleteProject(id);
        await refreshProjects();
        setConfirmDialog(s => ({ ...s, isOpen: false }));
      }
    });
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

  const bulkDeleteLocalPages = (pageNumbers: number[]) => {
    setState(s => {
      const newBatches = s.batches.map(b => {
        if (b.id === 'r') {
          return {
            ...b,
            pages: b.pages.filter(p => !pageNumbers.includes(p.pageNumber))
          };
        }
        return b;
      });
      return { 
        ...s, 
        batches: newBatches, 
        selectedPages: s.selectedPages.filter(n => !pageNumbers.includes(n)) 
      };
    });
    if (viewMode === 'single') setSinglePageViewIndex(0);
  };

  const startTranslation = async () => {
    if (!pdfInstance || !state.activeProjectId) return;
    
    if (state.useAI && !hasStoredKey) {
      setShowApiKeyModal(true);
      return;
    }

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
        
        const manualKey = state.useAI ? apiKeyInput : undefined;
        let translatedTexts = state.useAI 
          ? await translateEconomic(textsToTranslate, state.inputLanguage, state.outputLanguage, manualKey) 
          : await translateFree(textsToTranslate, state.inputLanguage, state.outputLanguage);
          
        const entry: TranslatedPage = { pageNumber: n, originalText: textsToTranslate.join(' '), translatedHtml: '', imageData: imgD, segments: segs.map((s, i) => ({ ...s, text: translatedTexts[i] || s.text, originalText: s.text })), mode: TranslationMode.ORIGINAL_OVERLAY };
        await db.savePage(state.activeProjectId, entry);
        updateLocalState(n, entry);
        setProgress(Math.round(((n - start + 1) / total) * 100));
      }
    } catch (e: any) { 
      alert(e.message || "Erro na tradução."); 
    } finally { 
      setState(s => ({ ...s, isProcessing: false })); 
      setProgress(0); 
    }
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

  const visiblePageNumbers = useMemo(() => {
    if (viewMode === 'feed') return translatedPageNumbers.slice(0, visiblePagesCount);
    if (viewMode === 'single') return translatedPageNumbers[singlePageViewIndex] ? [translatedPageNumbers[singlePageViewIndex]] : [];
    return translatedPageNumbers; 
  }, [translatedPageNumbers, visiblePagesCount, viewMode, singlePageViewIndex]);

  const jumpToPage = (num: number) => {
    const idx = translatedPageNumbers.indexOf(num);
    if (idx !== -1) {
      if (viewMode === 'single' || viewMode === 'grid') {
        setViewMode('single');
        setSinglePageViewIndex(idx);
      } else {
        const el = document.getElementById(`page-anchor-${num}`);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    } else {
      alert("Página não encontrada ou ainda não traduzida.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900 overflow-x-hidden">
      
      {/* Custom Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-sm w-full p-8 border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto ${confirmDialog.type === 'danger' ? 'bg-rose-50 text-rose-500' : 'bg-blue-50 text-blue-500'}`}>
              {confirmDialog.type === 'danger' ? <AlertTriangle size={32} /> : <Hash size={32} />}
            </div>
            <h3 className="text-xl font-black text-center text-slate-800 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-slate-500 text-center leading-relaxed mb-8">{confirmDialog.message}</p>
            <div className="flex gap-4">
              <button 
                onClick={() => setConfirmDialog(s => ({ ...s, isOpen: false }))}
                className="flex-1 py-4 rounded-xl text-xs font-black uppercase text-slate-400 hover:bg-slate-50 transition-all tracking-widest"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDialog.onConfirm}
                className={`flex-1 py-4 rounded-xl text-xs font-black uppercase text-white shadow-lg transition-all tracking-widest ${confirmDialog.type === 'danger' ? 'bg-rose-500 shadow-rose-100 hover:bg-rose-600' : 'bg-blue-600 shadow-blue-100 hover:bg-blue-700'}`}
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

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

          <button 
            onClick={() => setShowApiKeyModal(true)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all flex items-center gap-2 border ${hasStoredKey ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
          >
            <Key size={14}/> {hasStoredKey ? 'Chave Ativa' : 'Configurar Chave'}
          </button>

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
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">Intervalo de Processamento</label>
                      <div className="flex gap-3">
                        <input type="number" value={rangeInput.start} onChange={e => setRangeInput(x => ({...x, start: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl font-bold text-center text-xs outline-none focus:border-blue-400" />
                        <input type="number" value={rangeInput.end} onChange={e => setRangeInput(x => ({...x, end: e.target.value}))} className="w-full bg-slate-50 border border-slate-100 p-4 rounded-xl font-bold text-center text-xs outline-none focus:border-blue-400" />
                      </div>
                    </section>
                  </div>
                  <div className="flex flex-wrap gap-3 items-center justify-between pt-4 border-t border-slate-50">
                    <div className="flex items-center gap-2">
                        <button onClick={() => setState(s => ({...s, useAI: !s.useAI}))} className={`px-5 py-3 rounded-xl text-[9px] font-black border transition-all uppercase tracking-widest ${state.useAI ? 'bg-indigo-600 text-white border-indigo-500 shadow-md' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}`}>
                          {state.useAI ? '✨ IA Flash On' : '⚙️ Tradução Free'}
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

          <main className="flex-1 max-w-5xl mx-auto w-full px-8 space-y-6 pb-40 pt-4">
            {translatedPageNumbers.length > 0 && (
              <div className="flex flex-col gap-4 sticky top-16 bg-[#f8fafc]/90 backdrop-blur-md z-[60] py-4 border-b border-slate-100">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                      <button onClick={() => { setViewMode('feed'); setVisiblePagesCount(3); }} className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-2 transition-all ${viewMode === 'feed' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><Rows3 size={14}/> Feed</button>
                      <button onClick={() => setViewMode('single')} className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-2 transition-all ${viewMode === 'single' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><Maximize2 size={14}/> Foco</button>
                      <button onClick={() => setViewMode('grid')} className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase flex items-center gap-2 transition-all ${viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={14}/> Grade</button>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="relative group">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                        <input 
                          type="text" 
                          placeholder="Buscar..." 
                          value={jumpPageInput}
                          onChange={e => setJumpPageInput(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && jumpToPage(parseInt(jumpPageInput))}
                          className="bg-white border border-slate-200 pl-9 pr-4 py-2 rounded-xl text-[10px] font-black w-24 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all shadow-sm"
                        />
                      </div>
                      <div className="h-4 w-px bg-slate-200" />
                      <button onClick={() => setState(s => ({ ...s, selectedPages: translatedPageNumbers }))} className="text-[9px] font-black uppercase text-blue-600 hover:underline">Tudo</button>
                      <button onClick={() => setState(s => ({ ...s, selectedPages: [] }))} className="text-[9px] font-black uppercase text-slate-400 hover:underline">Limpar</button>
                      <div className="h-4 w-px bg-slate-200" />
                      <button onClick={() => {
                        if (!state.activeProjectId || state.selectedPages.length === 0) return;
                        const translatedInSelection = state.selectedPages.filter(n => allPagesMap.has(n));
                        if (translatedInSelection.length === 0) return alert("Nenhuma tradução selecionada.");
                        
                        setConfirmDialog({
                          isOpen: true,
                          title: 'Apagar Lote',
                          message: `Tem certeza que deseja apagar permanentemente ${translatedInSelection.length} páginas traduzidas?`,
                          type: 'danger',
                          onConfirm: async () => {
                            await db.deletePagesFromProject(state.activeProjectId!, translatedInSelection);
                            bulkDeleteLocalPages(translatedInSelection);
                            setConfirmDialog(s => ({ ...s, isOpen: false }));
                          }
                        });
                      }} className="text-[9px] font-black uppercase text-rose-500 hover:underline flex items-center gap-1"><Trash2 size={12}/> Apagar Lote</button>
                    </div>
                  </div>

                  {(viewMode === 'single' || viewMode === 'grid') && translatedPageNumbers.length > 0 && (
                    <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center justify-center gap-6">
                           <button 
                            onClick={() => setSinglePageViewIndex(prev => Math.max(0, prev - 1))}
                            disabled={singlePageViewIndex === 0}
                            className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center hover:bg-white hover:shadow-md disabled:opacity-20 transition-all text-slate-600 bg-white"
                           >
                             <ChevronLeft size={24}/>
                           </button>
                           <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest bg-white px-4 py-2 rounded-xl border border-slate-100 shadow-sm">Página {translatedPageNumbers[singlePageViewIndex]} de {translatedPageNumbers.length}</span>
                           <button 
                            onClick={() => setSinglePageViewIndex(prev => Math.min(translatedPageNumbers.length - 1, prev + 1))}
                            disabled={singlePageViewIndex === translatedPageNumbers.length - 1}
                            className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center hover:bg-white hover:shadow-md disabled:opacity-20 transition-all text-slate-600 bg-white"
                           >
                             <ChevronRight size={24}/>
                           </button>
                        </div>
                        {viewMode === 'grid' && (
                          <div className="text-[9px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1 rounded-full">Foco: Página #{translatedPageNumbers[singlePageViewIndex]}</div>
                        )}
                    </div>
                  )}
              </div>
            )}

            {translatedPageNumbers.length > 0 ? (
              <div className={viewMode === 'grid' ? "grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-4 pt-4 pb-20" : "space-y-12"}>
                {visiblePageNumbers.map((n, idx) => {
                  const page = allPagesMap.get(n)!;
                  const isSelected = state.selectedPages.includes(n);
                  const isEditingThisPage = activeEditPageNumber === n;
                  const isCurrentSinglePage = translatedPageNumbers[singlePageViewIndex] === n;
                  
                  if (viewMode === 'grid') {
                    return (
                      <div 
                        key={n} 
                        onClick={() => { setSinglePageViewIndex(translatedPageNumbers.indexOf(n)); }}
                        className={`group relative p-6 rounded-2xl border-2 transition-all cursor-pointer flex flex-col items-center justify-center gap-2 hover:scale-105 active:scale-95 ${isCurrentSinglePage ? 'border-blue-500 bg-blue-50 shadow-blue-100 shadow-lg' : 'bg-white border-slate-100 text-slate-400 hover:border-blue-200'}`}
                      >
                         <button 
                           onClick={(e) => { e.stopPropagation(); setState(s => ({ ...s, selectedPages: isSelected ? s.selectedPages.filter(x => x !== n) : [...s.selectedPages, n] })); }}
                           className={`absolute -top-3 -right-3 w-8 h-8 rounded-full border shadow-md flex items-center justify-center transition-all ${isSelected ? 'bg-emerald-500 border-emerald-400 text-white' : 'bg-white border-slate-200 text-slate-300'}`}
                         >
                           {isSelected ? <Check size={14}/> : <Plus size={14}/>}
                         </button>
                         <span className={`text-xl font-black font-mono ${isCurrentSinglePage ? 'text-blue-600' : 'text-slate-400'}`}>#{n}</span>
                      </div>
                    );
                  }

                  return (
                    <div id={`page-anchor-${n}`} key={n} className={`group relative animate-in slide-in-from-bottom-10 duration-700 ${isEditingThisPage ? 'ring-8 ring-blue-50 rounded-[2.5rem]' : ''}`}>
                      <div className="flex items-center justify-between mb-4 px-2">
                        <div className="flex items-center gap-4">
                          <span className="text-3xl font-black text-slate-200 group-hover:text-blue-200 transition-colors font-mono tracking-tighter">#{n}</span>
                          <span className="bg-blue-600 text-white text-[8px] font-black uppercase px-3 py-1 rounded-lg flex items-center gap-1 shadow-lg shadow-blue-50">Pronta</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => {
                              if (!state.activeProjectId) return;
                              setConfirmDialog({
                                isOpen: true,
                                title: 'Excluir Página',
                                message: `Deseja excluir a tradução da página ${n} permanentemente?`,
                                type: 'danger',
                                onConfirm: async () => {
                                  await db.deletePagesFromProject(state.activeProjectId!, [n]);
                                  bulkDeleteLocalPages([n]);
                                  setConfirmDialog(s => ({ ...s, isOpen: false }));
                                }
                              });
                          }} title="Excluir Página" className="w-12 h-12 rounded-2xl flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all border border-transparent hover:border-rose-100"><Trash2 size={20}/></button>
                          <button onClick={() => setState(s => ({ ...s, selectedPages: isSelected ? s.selectedPages.filter(x => x !== n) : [...s.selectedPages, n] }))} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all border-2 ${isSelected ? 'bg-emerald-500 border-emerald-400 text-white shadow-xl shadow-emerald-50' : 'bg-white border-slate-100 text-slate-200 hover:border-blue-300'}`}>
                            {isSelected ? <Check size={24}/> : <Square size={24}/>}
                          </button>
                        </div>
                      </div>
                      <div className={`p-2 rounded-[2rem] bg-white shadow-xl border-4 transition-all ${isSelected ? 'border-emerald-50 shadow-emerald-50/20' : 'border-white group-hover:border-blue-50'} ${isEditingThisPage ? 'border-blue-400' : ''}`}>
                        <TranslatedCanvasPage page={page} showOriginal={showOriginal} isEditMode={isEditMode} selectionMode={selectionMode} selectedIndices={isEditingThisPage ? selectedIndices : []} onSelectionChange={(indices, pNum) => { setActiveEditPageNumber(pNum); setSelectedIndices(indices); }} />
                      </div>
                    </div>
                  );
                })}

                {viewMode === 'feed' && translatedPageNumbers.length > visiblePagesCount && (
                  <div ref={loaderRef} className="py-24 flex flex-col items-center justify-center gap-4 text-slate-300 animate-pulse">
                    <Loader2 size={40} className="animate-spin text-blue-300" />
                    <span className="text-[11px] font-black uppercase tracking-[0.4em] text-slate-400">Expandindo Feed...</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-40 flex flex-col items-center justify-center text-slate-300 opacity-40 text-center space-y-8">
                {state.isProcessing ? (
                  <div className="space-y-6">
                    <div className="relative w-24 h-24 mx-auto">
                        <Loader2 size={96} className="animate-spin text-blue-500 absolute inset-0" strokeWidth={1}/>
                        <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-blue-600">{progress}%</div>
                    </div>
                    <p className="font-black text-xs uppercase tracking-[0.5em] text-blue-600">Reconstruindo Livro...</p>
                  </div>
                ) : (
                  <>
                    <Library size={100} strokeWidth={1}/>
                    <div className="space-y-2">
                        <p className="font-black text-sm uppercase tracking-[0.4em]">Seu Feed está vazio</p>
                        <p className="text-[10px] font-bold uppercase tracking-widest max-w-xs leading-relaxed mx-auto">Traduza algumas páginas acima para visualizar o conteúdo aqui.</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </main>
        </>
      )}

      {showScrollTop && (
        <button 
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-24 right-8 w-14 h-14 bg-white text-blue-600 rounded-full shadow-2xl border border-slate-100 flex items-center justify-center z-[200] hover:scale-110 active:scale-90 transition-all animate-in slide-in-from-bottom-10"
        >
            <ArrowUp size={24} />
        </button>
      )}

      {showApiKeyModal && (
        <div className="fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white p-10 rounded-[2.5rem] max-w-md w-full shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.4em]">Chave API do Google</h2>
                <button onClick={() => setShowApiKeyModal(false)} className="text-slate-400 hover:text-rose-500 transition-colors"><X size={20}/></button>
             </div>
             
             <div className="bg-blue-50 p-6 rounded-2xl mb-8 text-left space-y-4 border border-blue-100">
                <div className="flex items-center gap-3 text-blue-600 font-black text-xs uppercase tracking-tighter">
                   <Key size={16}/> Configuração de Chave Própria
                </div>
                <p className="text-[11px] font-bold text-slate-600 leading-relaxed">
                   Insira sua chave API do Google AI Studio para usar a tradução avançada sem limites globais. Sua chave é criptografada e salva apenas no seu navegador.
                </p>
             </div>

             <input 
               type="password" 
               value={apiKeyInput} 
               onChange={e => setApiKeyInput(e.target.value)} 
               placeholder="Cole sua API Key aqui..." 
               className="w-full bg-slate-50 p-5 rounded-2xl outline-none mb-8 font-black text-center text-xs border border-slate-200 focus:border-blue-500 transition-all shadow-inner" 
             />
             
             <div className="flex gap-4">
               {hasStoredKey && (
                 <button onClick={handleRemoveKey} className="flex-1 bg-rose-50 text-rose-500 py-5 rounded-2xl font-black uppercase text-[10px] hover:bg-rose-100 transition-all">Limpar</button>
               )}
               <button onClick={handleSaveKey} className="flex-[2] bg-blue-600 text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all">Salvar Chave</button>
             </div>
          </div>
        </div>
      )}

      {isEditMode && state.activeProjectId && (
        <div className="fixed right-6 top-1/2 -translate-y-1/2 z-[150] flex flex-col gap-3 animate-in slide-in-from-right-10 duration-500">
           <div className="bg-white/90 backdrop-blur-xl border border-slate-100 p-3 rounded-2xl shadow-2xl flex flex-col items-center gap-3">
              <button onClick={() => setSelectionMode('single')} title="Individual" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'single' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50'}`}><MousePointer2 size={20}/></button>
              <button onClick={() => setSelectionMode('points')} title="Pontos" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'points' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-indigo-500 hover:bg-slate-50'}`}><Crosshair size={20}/></button>
              <button onClick={() => setSelectionMode('area')} title="Área" className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${selectionMode === 'area' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50'}`}><BoxSelect size={20}/></button>
              <div className="w-8 h-px bg-slate-100" />
              <button onClick={() => { setSelectedIndices([]); setActiveEditPageNumber(null); }} title="Limpar" className="w-12 h-12 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-slate-50"><Eraser size={20}/></button>
              <button onClick={() => { setIsEditMode(false); setSelectedIndices([]); setActiveEditPageNumber(null); }} title="Fechar" className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition-all"><X size={20}/></button>
           </div>
        </div>
      )}

      {state.activeProjectId && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl z-[130] px-6 pointer-events-none">
          <div className="flex justify-center items-center gap-6 pointer-events-auto">
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
                }} className="bg-blue-600 text-white px-10 h-16 rounded-[2rem] shadow-2xl shadow-blue-200 flex items-center gap-4 animate-in slide-in-from-bottom-20 duration-500 active:scale-95 transition-all">
                <Edit3 size={24}/>
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase leading-none opacity-80 tracking-widest">Editor Ativo</p>
                  <p className="text-base font-black leading-none mt-1">{selectedIndices.length} Blocos</p>
                </div>
              </button>
            )}
            {!isEditMode && translatedSelectedCount > 0 && (
               <button onClick={exportSelected} className="bg-emerald-600 text-white px-12 h-16 rounded-[2rem] shadow-2xl shadow-emerald-100 flex items-center gap-4 animate-in slide-in-from-bottom-20 duration-500 active:scale-95 transition-all">
                 <Download size={24}/>
                 <div className="text-left">
                   <p className="text-[10px] font-black uppercase leading-none opacity-80 tracking-widest">Compilar PDF</p>
                   <p className="text-base font-black leading-none mt-1">{translatedSelectedCount} Páginas</p>
                 </div>
               </button>
            )}
            <button onClick={() => { setIsEditMode(!isEditMode); setSelectedIndices([]); setActiveEditPageNumber(null); }} className={`w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all transform hover:scale-110 active:scale-90 ${isEditMode ? 'bg-amber-400 text-white' : 'bg-white text-blue-600 border border-slate-100'}`}>
              {isEditMode ? <Check size={32} /> : <Wand2 size={28}/>}
            </button>
          </div>
        </div>
      )}

      {batchEditingData && activeEditPageNumber !== null && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-5xl h-[92vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-500 border border-slate-200">
             <div className="px-10 py-8 border-b flex justify-between items-center bg-slate-50/50">
               <div className="flex items-center gap-6">
                 <div className="w-16 h-16 bg-blue-600 text-white rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-blue-100"><Edit3 size={32}/></div>
                 <div className="flex flex-col">
                   <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tighter leading-none">Editor de Tradução</h3>
                   <p className="text-[11px] font-black uppercase text-slate-400 tracking-[0.3em] mt-2">Página #{activeEditPageNumber} • {batchEditingData.length} blocos em edição</p>
                 </div>
               </div>
               <button onClick={() => setBatchEditingData(null)} className="w-14 h-14 bg-white border border-slate-100 rounded-2xl flex items-center justify-center text-slate-400 hover:text-rose-500 transition-all shadow-sm hover:rotate-90"><X size={28}/></button>
             </div>

             <div className="px-10 py-5 bg-white border-b flex items-center justify-between shadow-sm">
                <button onClick={() => {
                    setBatchEditingData(prev => {
                      if (!prev) return null;
                      const allSelected = prev.every(item => item.selected);
                      return prev.map(item => ({ ...item, selected: !allSelected }));
                    });
                  }} className="flex items-center gap-3 text-[11px] font-black uppercase text-slate-500 hover:text-blue-600 transition-colors bg-slate-50 px-6 py-3 rounded-2xl border border-slate-100">
                  {batchEditingData.every(item => item.selected) ? <CheckSquare size={20} className="text-blue-600"/> : <Square size={20}/>} Selecionar Todos
                </button>
                {batchEditingData.some(item => item.selected) && (
                  <div className="flex gap-3">
                    <button onClick={() => {
                        setBatchEditingData(prev => {
                          if (!prev) return null;
                          return prev.map(item => item.selected ? { ...item, text: item.original } : item);
                        });
                      }} className="flex items-center gap-2 bg-amber-50 text-amber-700 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-amber-100 transition-all border border-amber-200/50">
                      <Undo2 size={18}/> Restaurar Original
                    </button>
                    <button onClick={() => {
                        setBatchEditingData(prev => {
                          if (!prev) return null;
                          return prev.map(item => item.selected ? { ...item, text: item.initialTranslation } : item);
                        });
                      }} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-200/50">
                      <RotateCcw size={18}/> Restaurar Tradução
                    </button>
                  </div>
                )}
             </div>

             <div className="flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar bg-slate-50/20">
                {batchEditingData.map((item, i) => (
                  <div key={item.index} className={`group bg-white p-8 rounded-[2.5rem] border transition-all relative ${item.selected ? 'border-blue-400 shadow-2xl ring-4 ring-blue-50/50' : 'border-slate-100 shadow-md opacity-70 scale-[0.98]'}`}>
                    <div className="absolute left-8 top-10 z-10">
                      <button onClick={() => {
                          setBatchEditingData(prev => {
                            if (!prev) return null;
                            const copy = [...prev];
                            copy[i] = { ...copy[i], selected: !copy[i].selected };
                            return copy;
                          });
                        }} className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${item.selected ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-50 text-slate-300 border border-slate-100'}`}>
                        {item.selected ? <Check size={24}/> : <Square size={24}/>}
                      </button>
                    </div>
                    
                    <div className="pl-20 space-y-6">
                      <div className="relative group/source">
                        <div className="text-[13px] font-medium text-slate-500 bg-slate-50/80 p-6 rounded-2xl border border-slate-100/50 leading-relaxed group-hover:bg-slate-50 transition-colors pr-40 whitespace-pre-wrap">
                          {item.original}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="text-[10px] font-black text-blue-600 uppercase tracking-[0.3em] ml-3 flex items-center gap-2">
                            <Edit3 size={12}/> Campo de Edição
                        </label>
                        <textarea 
                          value={item.text} 
                          onChange={e => {
                            setBatchEditingData(prev => {
                              if (!prev) return null;
                              const copy = [...prev];
                              copy[i] = { ...copy[i], text: e.target.value };
                              return copy;
                            });
                          }} 
                          className="w-full bg-white border-2 border-slate-100 p-8 rounded-[2rem] outline-none font-bold text-base focus:ring-[1rem] focus:ring-blue-50/50 focus:border-blue-400 transition-all min-h-[160px] shadow-inner resize-none leading-relaxed text-slate-800" 
                          placeholder="Digite a tradução corrigida..." 
                        />
                      </div>
                    </div>
                  </div>
                ))}
             </div>

             <div className="p-10 bg-white border-t flex gap-6">
               <button onClick={() => setBatchEditingData(null)} className="flex-1 bg-slate-50 py-6 rounded-2xl font-black uppercase text-[12px] text-slate-500 hover:bg-slate-100 transition-all tracking-[0.3em]">Cancelar</button>
               <button onClick={async () => {
                 const page = allPagesMap.get(activeEditPageNumber);
                 if (page && page.segments) {
                   const newPage = JSON.parse(JSON.stringify(page));
                   batchEditingData.forEach(item => { newPage.segments[item.index].text = item.text; });
                   await db.savePage(state.activeProjectId!, newPage);
                   updateLocalState(newPage.pageNumber, newPage);
                   setBatchEditingData(null); setSelectedIndices([]); setActiveEditPageNumber(null);
                 }
                }} className="flex-[2] bg-blue-600 text-white py-6 rounded-2xl font-black uppercase text-[12px] shadow-2xl shadow-blue-100 flex items-center justify-center gap-4 hover:bg-blue-700 transition-all transform active:scale-95 tracking-[0.3em]">
                 <Save size={24}/> Salvar Alterações
               </button>
             </div>
          </div>
        </div>
      )}

      {showProjectModal && (
        <div className="fixed inset-0 z-[400] bg-slate-900/70 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-white p-12 rounded-[3rem] max-w-sm w-full shadow-2xl text-center border border-slate-100 animate-in zoom-in-95 duration-200">
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-8 shadow-xl shadow-blue-50">
                <FileText size={40}/>
            </div>
            <h2 className="text-[11px] font-black uppercase mb-10 text-slate-400 tracking-[0.5em]">Identificar Projeto</h2>
            <input type="text" value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Título do Livro..." className="w-full bg-slate-50 p-6 rounded-2xl outline-none mb-10 font-black text-center text-2xl border-2 border-slate-100 focus:border-blue-500 transition-all shadow-inner" />
            <button onClick={async () => {
              const id = crypto.randomUUID();
              const p: BookProject = { id, name: projectName, fileName: state.file?.name || '', numPages: state.numPages, timestamp: Date.now(), inputLanguage: state.inputLanguage, outputLanguage: state.outputLanguage };
              await db.saveProject(p);
              if ((window as any)._tempPdfBuffer) await db.saveFile(id, (window as any)._tempPdfBuffer);
              await refreshProjects();
              await loadProject(id);
              setShowProjectModal(false);
            }} className="w-full bg-blue-600 text-white py-6 rounded-2xl font-black uppercase text-sm tracking-[0.2em] shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95">Iniciar Tradução</button>
          </div>
        </div>
      )}

      <footer className="fixed bottom-4 left-4 z-[50]">
        <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-[9px] font-black uppercase text-slate-300 hover:text-blue-400 transition-colors tracking-widest bg-white/50 backdrop-blur px-3 py-1 rounded-full border border-slate-100">Informações de Faturamento API</a>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 8px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 20px; border: 2px solid #f8fafc; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
        html { scroll-behavior: smooth; }
        input[type="number"]::-webkit-inner-spin-button { display: none; }
      `}</style>
    </div>
  );
};

export default App;
