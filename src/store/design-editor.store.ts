import { create } from "zustand";
import type { CustomFont, Design } from "@/src/types";
import type { DesignDoc, DesignElement, DesignPage, PageBackground } from "@/src/lib/design-studio/types";
import { emptyPage, parseDesignPages } from "@/src/lib/design-studio/types";
import { registerCustomFonts } from "@/src/lib/design-studio/fonts";

const MAX_HISTORY = 50;

function genId(): string {
  return crypto.randomUUID();
}

interface DesignEditorState {
  doc: DesignDoc | null;
  currentPageId: string | null;
  selectedElementIds: string[];
  history: DesignPage[][];
  future: DesignPage[][];
  customFonts: CustomFont[];

  loadDesign: (design: Design) => void;
  setCustomFonts: (fonts: CustomFont[]) => void;
  addCustomFont: (font: CustomFont) => void;
  removeCustomFont: (id: number) => void;
  setCurrentPageId: (pageId: string) => void;
  selectElements: (ids: string[]) => void;
  clearSelection: () => void;

  /** Snapshot current pages onto the undo stack — call before a discrete edit. */
  snapshot: () => void;
  undo: () => void;
  redo: () => void;

  addElement: (pageId: string, element: DesignElement) => void;
  updateElement: (pageId: string, elementId: string, patch: Partial<DesignElement>) => void;
  duplicateElement: (pageId: string, elementId: string) => void;
  removeElements: (pageId: string, elementIds: string[]) => void;
  reorderElement: (pageId: string, elementId: string, direction: "front" | "back" | "forward" | "backward") => void;

  addPage: () => void;
  duplicatePage: (pageId: string) => void;
  removePage: (pageId: string) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  updatePageBackground: (pageId: string, background: PageBackground) => void;
  updatePageSize: (pageId: string, width: number, height: number) => void;
}

export const useDesignEditorStore = create<DesignEditorState>((set, get) => ({
  doc: null,
  currentPageId: null,
  selectedElementIds: [],
  history: [],
  future: [],
  customFonts: [],

  setCustomFonts: (fonts) => {
    registerCustomFonts(fonts);
    set({ customFonts: fonts });
  },

  addCustomFont: (font) => {
    set((state) => {
      const fonts = [...state.customFonts, font];
      registerCustomFonts(fonts);
      return { customFonts: fonts };
    });
  },

  removeCustomFont: (id) => {
    set((state) => {
      const fonts = state.customFonts.filter((f) => f.id !== id);
      registerCustomFonts(fonts);
      return { customFonts: fonts };
    });
  },

  loadDesign: (design) => {
    const pages = parseDesignPages(design.pages, design.width, design.height);
    set({
      doc: { id: design.id, name: design.name, width: design.width, height: design.height, pages },
      currentPageId: pages[0]?.id ?? null,
      selectedElementIds: [],
      history: [],
      future: [],
    });
  },

  setCurrentPageId: (pageId) => set({ currentPageId: pageId, selectedElementIds: [] }),

  selectElements: (ids) => set({ selectedElementIds: ids }),
  clearSelection: () => set({ selectedElementIds: [] }),

  snapshot: () => {
    const { doc, history } = get();
    if (!doc) return;
    const next = [...history, doc.pages].slice(-MAX_HISTORY);
    set({ history: next, future: [] });
  },

  undo: () => {
    const { doc, history, future } = get();
    if (!doc || history.length === 0) return;
    const previous = history[history.length - 1];
    set({
      doc: { ...doc, pages: previous },
      history: history.slice(0, -1),
      future: [doc.pages, ...future].slice(0, MAX_HISTORY),
    });
  },

  redo: () => {
    const { doc, history, future } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    set({
      doc: { ...doc, pages: next },
      history: [...history, doc.pages].slice(-MAX_HISTORY),
      future: future.slice(1),
    });
  },

  addElement: (pageId, element) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.map((p) =>
        p.id === pageId ? { ...p, elements: [...p.elements, element] } : p
      );
      return { doc: { ...state.doc, pages }, selectedElementIds: [element.id] };
    });
  },

  updateElement: (pageId, elementId, patch) => {
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.map((p) =>
        p.id !== pageId
          ? p
          : { ...p, elements: p.elements.map((el) => (el.id === elementId ? ({ ...el, ...patch } as DesignElement) : el)) }
      );
      return { doc: { ...state.doc, pages } };
    });
  },

  duplicateElement: (pageId, elementId) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const page = state.doc.pages.find((p) => p.id === pageId);
      const source = page?.elements.find((el) => el.id === elementId);
      if (!page || !source) return state;
      const copy: DesignElement = { ...source, id: genId(), x: source.x + 24, y: source.y + 24, zIndex: page.elements.length };
      const pages = state.doc.pages.map((p) =>
        p.id === pageId ? { ...p, elements: [...p.elements, copy] } : p
      );
      return { doc: { ...state.doc, pages }, selectedElementIds: [copy.id] };
    });
  },

  removeElements: (pageId, elementIds) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const idSet = new Set(elementIds);
      const pages = state.doc.pages.map((p) =>
        p.id === pageId ? { ...p, elements: p.elements.filter((el) => !idSet.has(el.id)) } : p
      );
      return { doc: { ...state.doc, pages }, selectedElementIds: [] };
    });
  },

  reorderElement: (pageId, elementId, direction) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.map((p) => {
        if (p.id !== pageId) return p;
        const sorted = [...p.elements].sort((a, b) => a.zIndex - b.zIndex);
        const idx = sorted.findIndex((el) => el.id === elementId);
        if (idx === -1) return p;
        const [el] = sorted.splice(idx, 1);
        if (direction === "front") sorted.push(el);
        else if (direction === "back") sorted.unshift(el);
        else if (direction === "forward") sorted.splice(Math.min(idx + 1, sorted.length), 0, el);
        else sorted.splice(Math.max(idx - 1, 0), 0, el);
        const reZIndexed = sorted.map((e, i) => ({ ...e, zIndex: i }));
        return { ...p, elements: reZIndexed };
      });
      return { doc: { ...state.doc, pages } };
    });
  },

  addPage: () => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const current = state.doc.pages.find((p) => p.id === state.currentPageId);
      const page = emptyPage(genId(), current?.width ?? state.doc.width, current?.height ?? state.doc.height);
      return { doc: { ...state.doc, pages: [...state.doc.pages, page] }, currentPageId: page.id };
    });
  },

  duplicatePage: (pageId) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const source = state.doc.pages.find((p) => p.id === pageId);
      if (!source) return state;
      const copy: DesignPage = {
        id: genId(),
        width: source.width,
        height: source.height,
        background: source.background,
        elements: source.elements.map((el) => ({ ...el, id: genId() })),
      };
      const idx = state.doc.pages.findIndex((p) => p.id === pageId);
      const pages = [...state.doc.pages];
      pages.splice(idx + 1, 0, copy);
      return { doc: { ...state.doc, pages }, currentPageId: copy.id };
    });
  },

  removePage: (pageId) => {
    const { doc } = get();
    if (!doc || doc.pages.length <= 1) return;
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.filter((p) => p.id !== pageId);
      const currentPageId = state.currentPageId === pageId ? pages[0]?.id ?? null : state.currentPageId;
      return { doc: { ...state.doc, pages }, currentPageId, selectedElementIds: [] };
    });
  },

  reorderPages: (fromIndex, toIndex) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = [...state.doc.pages];
      const [moved] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, moved);
      return { doc: { ...state.doc, pages } };
    });
  },

  updatePageBackground: (pageId, background) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.map((p) => (p.id === pageId ? { ...p, background } : p));
      return { doc: { ...state.doc, pages } };
    });
  },

  updatePageSize: (pageId, width, height) => {
    get().snapshot();
    set((state) => {
      if (!state.doc) return state;
      const pages = state.doc.pages.map((p) => (p.id === pageId ? { ...p, width, height } : p));
      return { doc: { ...state.doc, pages } };
    });
  },
}));

export { genId };
