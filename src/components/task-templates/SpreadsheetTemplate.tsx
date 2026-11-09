import { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus, Trash2, Sparkles, HelpCircle, Save, Check, Type,
  Heading, ChevronRight, Calculator
} from "lucide-react";
import type { Task } from "@/src/types";
import { useTaskStore } from "@/src/store/task.store";
import * as taskService from "@/src/services/task.service";
import { Button } from "@/src/components/ui/button";

/* ─── TYPES ─── */

interface SpreadsheetState {
  columnsCount: number;
  rowsCount: number;
  grid: string[][]; // 2D array of raw cell strings
  columnWidths?: number[]; // Column widths in pixels
}

const DEFAULT_STATE: SpreadsheetState = {
  columnsCount: 5,
  rowsCount: 12,
  grid: [
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
  ],
  columnWidths: [200, 150, 100, 150, 150]
};

/* ─── HELPERS: FORMULA ENGINE ─── */

function getColumnLetter(colIndex: number): string {
  let letter = "";
  let temp = colIndex;
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

function parseCoordinates(coord: string) {
  const colLetter = coord.match(/[A-Z]+/)?.[0] || "";
  const rowNum = parseInt(coord.match(/[0-9]+/)?.[0] || "0");

  let colIndex = 0;
  for (let i = 0; i < colLetter.length; i++) {
    colIndex = colIndex * 26 + (colLetter.charCodeAt(i) - 64);
  }
  colIndex = colIndex - 1;
  const rowIndex = rowNum - 1;

  return { colIndex, rowIndex };
}

function getCellValue(coord: string, grid: string[][], visited = new Set<string>()): number {
  const { colIndex, rowIndex } = parseCoordinates(coord);
  if (rowIndex < 0 || rowIndex >= grid.length || colIndex < 0 || colIndex >= grid[rowIndex]?.length) {
    return 0;
  }

  const raw = grid[rowIndex][colIndex];
  if (typeof raw === "string" && raw.startsWith("=")) {
    const key = `${rowIndex},${colIndex}`;
    if (visited.has(key)) return 0; // prevent circular ref
    visited.add(key);
    const evaluated = evaluateFormula(raw, grid, visited);
    return Number(evaluated) || 0;
  }

  return Number(raw) || 0;
}

function getCellRangeValues(rangeStr: string, grid: string[][], visited = new Set<string>()): number[] {
  const [start, end] = rangeStr.split(":");
  const cStart = parseCoordinates(start);
  const cEnd = parseCoordinates(end);

  const values: number[] = [];
  const minRow = Math.min(cStart.rowIndex, cEnd.rowIndex);
  const maxRow = Math.max(cStart.rowIndex, cEnd.rowIndex);
  const minCol = Math.min(cStart.colIndex, cEnd.colIndex);
  const maxCol = Math.max(cStart.colIndex, cEnd.colIndex);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const cellCoord = `${getColumnLetter(c)}${r + 1}`;
      values.push(getCellValue(cellCoord, grid, visited));
    }
  }
  return values;
}

function evaluateFormula(formula: string, grid: string[][], visited = new Set<string>()): string | number {
  if (!formula || typeof formula !== "string" || !formula.startsWith("=")) {
    return formula;
  }

  let expr = formula.substring(1).toUpperCase().trim();

  // 1. SUM function
  const sumRegex = /SUM\(([A-Z0-9:]+)\)/g;
  expr = expr.replace(sumRegex, (_, range) => {
    const vals = range.includes(":") ? getCellRangeValues(range, grid, visited) : [getCellValue(range, grid, visited)];
    return String(vals.reduce((a, b) => a + b, 0));
  });

  // 2. AVERAGE function
  const avgRegex = /AVERAGE\(([A-Z0-9:]+)\)/g;
  expr = expr.replace(avgRegex, (_, range) => {
    const vals = range.includes(":") ? getCellRangeValues(range, grid, visited) : [getCellValue(range, grid, visited)];
    return String(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  });

  // 3. COUNT function
  const countRegex = /COUNT\(([A-Z0-9:]+)\)/g;
  expr = expr.replace(countRegex, (_, range) => {
    const vals = range.includes(":") ? getCellRangeValues(range, grid, visited) : [getCellValue(range, grid, visited)];
    return String(vals.filter(v => v !== 0).length);
  });

  // 4. Resolve cell references (e.g. A1, B2)
  const coordRegex = /[A-Z]+[0-9]+/g;
  expr = expr.replace(coordRegex, (coord) => {
    return String(getCellValue(coord, grid, visited));
  });

  // 5. Evaluate arithmetic safely
  try {
    const sanitized = expr.replace(/[^0-9+\-*/().\s]/g, "");
    if (!sanitized.trim()) return "";

    const result = new Function(`return (${sanitized})`)();
    return typeof result === "number" && !isNaN(result) ? Number(result.toFixed(2)) : result;
  } catch (e) {
    return "#VALOR!";
  }
}

/* ─── MAIN COMPONENT ─── */

interface SpreadsheetTemplateProps {
  currentTask: Task;
  readOnly?: boolean;
}

export function SpreadsheetTemplate({ currentTask, readOnly = false }: SpreadsheetTemplateProps) {
  const updateTaskInState = useTaskStore((s) => s.updateTaskInState);

  // Load state from DB
  const getInitialState = (): SpreadsheetState => {
    try {
      if (currentTask.content) {
        const parsed = JSON.parse(currentTask.content);
        if (parsed && Array.isArray(parsed.grid) && typeof parsed.columnsCount === "number") {
          return {
            ...parsed,
            columnWidths: parsed.columnWidths || Array(parsed.columnsCount).fill(150)
          };
        }
      }
    } catch (e) { }
    return {
      ...DEFAULT_STATE,
      columnWidths: Array(DEFAULT_STATE.columnsCount).fill(150)
    };
  };

  const [state, setState] = useState<SpreadsheetState>(getInitialState);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [showFormulaHelp, setShowFormulaHelp] = useState(false);

  const editInputRef = useRef<HTMLInputElement | null>(null);
  const formulaInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);

  const selectCellAndFocus = (r: number, c: number) => {
    setSelectedCell({ r, c });
    setTimeout(() => {
      gridWrapperRef.current?.focus({ preventScroll: true });
    }, 10);
  };

  // Reload state if currentTask changes
  useEffect(() => {
    setState(getInitialState());
    setSelectedCell(null);
    setEditingCell(null);
  }, [currentTask.id]);

  // Persist grid state back to task content
  const persistState = (updatedState: SpreadsheetState) => {
    setState(updatedState);
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    saveTimerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        const updated = await taskService.updateTask(currentTask.id, {
          content: JSON.stringify(updatedState),
        });
        updateTaskInState(updated);
      } catch (err) {
        console.error("Auto-save spreadsheet error", err);
      } finally {
        setSaving(false);
      }
    }, 850);
  };

  // Evaluate the entire grid to render calculated values
  const renderedGrid = useMemo(() => {
    return state.grid.map((row) =>
      row.map((cell) => {
        if (cell && cell.startsWith("=")) {
          return evaluateFormula(cell, state.grid);
        }
        return cell;
      })
    );
  }, [state.grid]);

  const tableWidth = useMemo(() => {
    const widths = state.columnWidths || Array(state.columnsCount).fill(150);
    return 48 + widths.slice(0, state.columnsCount).reduce((a, w) => a + (w || 150), 0);
  }, [state.columnWidths, state.columnsCount]);

  // Cell Editing
  const startEdit = (r: number, c: number) => {
    if (readOnly) return;
    setEditingCell({ r, c });
    setInputVal(state.grid[r][c] || "");
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const commitEdit = (r: number, c: number, value: string) => {
    setEditingCell(null);
    const newGrid = state.grid.map((row, ri) =>
      row.map((cell, ci) => (ri === r && ci === c ? value : cell))
    );
    persistState({ ...state, grid: newGrid });
    
    // Restore focus to grid wrapper so keyboard navigation continues to work!
    setTimeout(() => {
      gridWrapperRef.current?.focus({ preventScroll: true });
    }, 50);
  };

  // Add / Delete Rows and Columns
  const addRow = () => {
    const newRow = Array(state.columnsCount).fill("");
    persistState({
      ...state,
      rowsCount: state.rowsCount + 1,
      grid: [...state.grid, newRow],
    });
  };

  const deleteRow = () => {
    const targetRow = selectedCell ? selectedCell.r : state.rowsCount - 1;
    if (state.rowsCount <= 1) return;

    const newGrid = state.grid.filter((_, i) => i !== targetRow);
    setSelectedCell(null);
    setEditingCell(null);
    persistState({
      ...state,
      rowsCount: state.rowsCount - 1,
      grid: newGrid,
    });
  };

  const addColumn = () => {
    const newGrid = state.grid.map((row) => [...row, ""]);
    const currentWidths = state.columnWidths || Array(state.columnsCount).fill(150);
    persistState({
      ...state,
      columnsCount: state.columnsCount + 1,
      grid: newGrid,
      columnWidths: [...currentWidths, 150]
    });
  };

  const deleteColumn = () => {
    if (state.columnsCount <= 1) return;
    const targetCol = selectedCell ? selectedCell.c : state.columnsCount - 1;

    const newGrid = state.grid.map((row) => row.filter((_, i) => i !== targetCol));
    const currentWidths = state.columnWidths || Array(state.columnsCount).fill(150);
    setSelectedCell(null);
    setEditingCell(null);
    persistState({
      ...state,
      columnsCount: state.columnsCount - 1,
      grid: newGrid,
      columnWidths: currentWidths.filter((_, i) => i !== targetCol)
    });
  };

  // Column Width Resizing Handler
  const handleResizeMouseDown = (e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidths = state.columnWidths || Array(state.columnsCount).fill(150);
    const startWidth = startWidths[colIndex] || 150;

    const doDrag = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const newWidths = [...startWidths];
      newWidths[colIndex] = Math.max(70, startWidth + delta);
      setState((prev) => ({
        ...prev,
        columnWidths: newWidths,
      }));
    };

    const stopDrag = (moveEvent: MouseEvent) => {
      window.removeEventListener("mousemove", doDrag);
      window.removeEventListener("mouseup", stopDrag);

      // Save to DB on drag end
      setState((current) => {
        const delta = moveEvent.clientX - startX;
        const newWidths = [...startWidths];
        newWidths[colIndex] = Math.max(70, startWidth + delta);
        const nextState = { ...current, columnWidths: newWidths };
        persistState(nextState);
        return nextState;
      });
    };

    window.addEventListener("mousemove", doDrag);
    window.addEventListener("mouseup", stopDrag);
  };

  // Keyboard Navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedCell || editingCell) return;

    const { r, c } = selectedCell;

    if (readOnly) {
      // Allow only navigation keys
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          if (r > 0) setSelectedCell({ r: r - 1, c });
          break;
        case "ArrowDown":
          e.preventDefault();
          if (r < state.rowsCount - 1) setSelectedCell({ r: r + 1, c });
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (c > 0) setSelectedCell({ r, c: c - 1 });
          break;
        case "ArrowRight":
          e.preventDefault();
          if (c < state.columnsCount - 1) setSelectedCell({ r, c: c + 1 });
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (c > 0) setSelectedCell({ r, c: c - 1 });
          } else {
            if (c < state.columnsCount - 1) setSelectedCell({ r, c: c + 1 });
          }
          break;
      }
      return;
    }

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (r > 0) setSelectedCell({ r: r - 1, c });
        break;
      case "ArrowDown":
        e.preventDefault();
        if (r < state.rowsCount - 1) setSelectedCell({ r: r + 1, c });
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (c > 0) setSelectedCell({ r, c: c - 1 });
        break;
      case "ArrowRight":
        e.preventDefault();
        if (c < state.columnsCount - 1) setSelectedCell({ r, c: c + 1 });
        break;
      case "Enter":
        e.preventDefault();
        startEdit(r, c);
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) setSelectedCell({ r, c: c - 1 });
        } else {
          if (c < state.columnsCount - 1) setSelectedCell({ r, c: c + 1 });
        }
        break;
      case "Backspace":
      case "Delete":
        e.preventDefault();
        commitEdit(r, c, "");
        break;
      default:
        // Start editing directly when user types
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setEditingCell({ r, c });
          setInputVal(e.key);
          setTimeout(() => editInputRef.current?.focus(), 50);
        }
    }
  };

  // Formula Bar Sync
  const selectedCellValue = selectedCell ? (state.grid[selectedCell.r]?.[selectedCell.c] || "") : "";

  return (
    <div className="flex flex-col h-full bg-background border rounded-xl overflow-hidden shadow-sm">
      {/* 1. Header Toolbar */}
      <div className="flex flex-col border-b bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && (
              <>
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8" onClick={addRow}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar Linha
                </Button>
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8 text-destructive hover:bg-destructive/10" onClick={deleteRow}>
                  <Trash2 className="h-3.5 w-3.5" /> Excluir Linha
                </Button>
                <div className="h-5 w-px bg-border mx-1" />
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8" onClick={addColumn}>
                  <Plus className="h-3.5 w-3.5" /> Adicionar Coluna
                </Button>
                <Button variant="outline" size="sm" className="gap-1 text-xs h-8 text-destructive hover:bg-destructive/10" onClick={deleteColumn}>
                  <Trash2 className="h-3.5 w-3.5" /> Excluir Coluna
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            {saving ? (
              <span className="flex items-center gap-1 text-xs text-primary">
                <Save className="h-3 w-3 animate-pulse" />
                Salvando...
              </span>
            ) : readOnly ? (
              <span className="text-xs text-muted-foreground">Somente leitura</span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowFormulaHelp((v) => !v)}
            >
              <HelpCircle className="h-4 w-4" />
              Ajuda de Fórmulas
            </Button>
          </div>
        </div>

        {/* Formula Bar (Premium UI details) */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-2 bg-card border-t text-xs">
          <div className="flex items-center gap-1 text-muted-foreground font-mono font-semibold bg-muted px-2 py-1 rounded select-none">
            <Calculator className="h-3.5 w-3.5 text-primary" />
            <span>{selectedCell ? `${getColumnLetter(selectedCell.c)}${selectedCell.r + 1}` : "—"}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          <div className="font-mono text-sm text-muted-foreground font-bold select-none px-1">fx</div>
          <input
            ref={formulaInputRef}
            type="text"
            disabled={readOnly || !selectedCell}
            value={selectedCellValue}
            onChange={(e) => {
              if (readOnly) return;
              if (selectedCell) {
                const { r, c } = selectedCell;
                const newGrid = state.grid.map((row, ri) =>
                  row.map((cell, ci) => (ri === r && ci === c ? e.target.value : cell))
                );
                persistState({ ...state, grid: newGrid });
              }
            }}
            placeholder={
              readOnly 
                ? (selectedCell ? "Visualizando fórmula/valor" : "Selecione uma célula para visualizar") 
                : (selectedCell ? "Insira texto, número ou fórmula iniciada com =" : "Selecione uma célula para editar")
            }
            className="flex-1 bg-muted/40 border rounded px-3 py-1.5 font-mono text-sm outline-none focus:bg-background focus:ring-1 focus:ring-primary transition-all disabled:opacity-50"
          />
        </div>
      </div>

      {/* Formula Help Area */}
      {showFormulaHelp && (
        <div className="bg-primary/5 p-4 border-b text-xs space-y-2">
          <p className="font-semibold text-primary flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" /> Fórmulas suportadas:
          </p>
          <ul className="list-disc pl-5 grid grid-cols-1 md:grid-cols-3 gap-1.5 text-muted-foreground">
            <li><strong>Soma:</strong> <code>=SUM(A1:A5)</code> ou <code>=SUM(A1,B2)</code></li>
            <li><strong>Média:</strong> <code>=AVERAGE(B1:B10)</code></li>
            <li><strong>Contar:</strong> <code>=COUNT(C1:C8)</code></li>
            <li><strong>Aritmética básica:</strong> <code>=A1*B1</code>, <code>=A1-B1</code>, <code>=(A1+B2)/2</code></li>
          </ul>
        </div>
      )}

      {/* 2. Grid Table Wrapper */}
      <div
        ref={gridWrapperRef}
        className="flex-1 overflow-auto bg-muted/10 p-4 outline-none overscroll-contain"
        onKeyDown={handleKeyDown}
        tabIndex={0}
      >
        <div
          className="rounded-xl border bg-card shadow-sm"
          style={{ width: `${tableWidth}px` }}
        >
          <table
            className="border-collapse table-fixed select-none"
            style={{ width: `${tableWidth}px` }}
          >
            <colgroup>
              <col style={{ width: "48px" }} />
              {Array(state.columnsCount)
                .fill(null)
                .map((_, i) => (
                  <col key={i} style={{ width: `${state.columnWidths?.[i] || 150}px` }} />
                ))}
            </colgroup>
            <thead>
              <tr className="border-b bg-muted/30">
                {/* corner header */}
                <th className="border-r bg-muted/50 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase" />
                {/* columns headers (A, B, C...) */}
                {Array(state.columnsCount)
                  .fill(null)
                  .map((_, i) => (
                    <th
                      key={i}
                      className="border-r py-2 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wider relative group/th"
                    >
                      {getColumnLetter(i)}
                      {/* Resize Handle */}
                      <div
                        onMouseDown={(e) => handleResizeMouseDown(e, i)}
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary z-20 transition-colors"
                        style={{ width: "6px" }}
                      />
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {state.grid.map((row, ri) => (
                <tr key={ri} className="border-b hover:bg-muted/10 transition-colors">
                  {/* Row number header */}
                  <td className="border-r bg-muted/30 py-2 text-center text-xs font-semibold text-muted-foreground select-none">
                    {ri + 1}
                  </td>

                  {row.map((cell, ci) => {
                    const isSelected = selectedCell?.r === ri && selectedCell?.c === ci;
                    const isEditing = editingCell?.r === ri && editingCell?.c === ci;
                    const value = renderedGrid[ri]?.[ci] ?? "";

                    return (
                      <td
                        key={ci}
                        onClick={() => {
                          selectCellAndFocus(ri, ci);
                          if (editingCell && (editingCell.r !== ri || editingCell.c !== ci)) {
                            setEditingCell(null);
                          }
                        }}
                        onDoubleClick={() => startEdit(ri, ci)}
                        className={`border-r px-2 py-1.5 text-sm transition-all relative break-words min-h-[36px] ${isSelected ? "ring-2 ring-primary/80 bg-primary/5 z-10" : ""
                          }`}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            onBlur={() => commitEdit(ri, ci, inputVal)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                commitEdit(ri, ci, inputVal);
                                if (ri < state.rowsCount - 1) {
                                  setTimeout(() => selectCellAndFocus(ri + 1, ci), 60);
                                }
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                commitEdit(ri, ci, inputVal);
                                if (e.shiftKey) {
                                  if (ci > 0) setTimeout(() => selectCellAndFocus(ri, ci - 1), 60);
                                } else {
                                  if (ci < state.columnsCount - 1) setTimeout(() => selectCellAndFocus(ri, ci + 1), 60);
                                }
                              } else if (e.key === "Escape") {
                                setEditingCell(null);
                                setTimeout(() => gridWrapperRef.current?.focus(), 50);
                              }
                            }}
                            className="w-full h-full bg-transparent font-mono text-sm outline-none border-none p-0 focus:ring-0"
                          />
                        ) : (
                          <div className="w-full h-full min-h-[20px] flex items-center font-sans">
                            {cell && cell.startsWith("=") ? (
                              <span className="font-mono text-xs font-medium text-primary">
                                {value}
                              </span>
                            ) : (
                              <span>{value}</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Footer Status Bar */}
      <div className="px-6 py-2.5 border-t bg-muted/10 text-xs text-muted-foreground flex items-center gap-1.5">
        <Heading className="h-3.5 w-3.5 text-primary" />
        {readOnly 
          ? "Modo de visualização. Pressione as setas do teclado ou clique para navegar pelas células e visualizar fórmulas." 
          : "Dica: Clique duas vezes para editar a célula inline, ou use a barra de fórmulas (fx) no topo para editar. Pressione setas do teclado para navegar."}
      </div>
    </div>
  );
}
