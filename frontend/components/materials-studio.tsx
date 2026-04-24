"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  Atom,
  Bot,
  Box,
  Download,
  Eye,
  FileText,
  Layers,
  Move3D,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";

import {
  DEFAULT_BROWSER_AI_CONFIG,
  MATERIAL_AI_CONFIG_STORAGE_KEY,
  type BrowserAiConfig,
} from "@/lib/ai-config";
import {
  applyMaterialOperation,
  createSampleStructure,
  exportCif,
  exportPoscar,
  fracToCart,
  getCartesianBounds,
  getCartesianPositions,
  getElementColor,
  getElementRadius,
  getLikelyBonds,
  getUniqueElements,
  interpretMaterialCommand,
  operationLabel,
  parseStructure,
  SAMPLE_POSCAR,
  summarizeStructure,
  type AxisName,
  type InterpretedMaterialCommand,
  type MaterialOperation,
  type MaterialStructure,
  type Vec3,
} from "@/lib/materials";

interface HistoryEntry {
  structure: MaterialStructure;
  note: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
}

interface ViewSettings {
  mode: "ball-stick" | "spacefill";
  showCell: boolean;
  showBonds: boolean;
  atomScale: number;
}

const DEFAULT_VIEW: ViewSettings = {
  mode: "ball-stick",
  showCell: true,
  showBonds: true,
  atomScale: 1,
};

export function MaterialsStudio() {
  const [structure, setStructure] = useState<MaterialStructure>(() => createSampleStructure());
  const [sourceText, setSourceText] = useState(SAMPLE_POSCAR);
  const [sourceName, setSourceName] = useState("NaCl-example.vasp");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState("已加载 NaCl 示例；上传 POSCAR/CIF 后会替换当前结构。");
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);

  const [repeatForm, setRepeatForm] = useState({ nx: 2, ny: 2, nz: 1 });
  const [vacuumForm, setVacuumForm] = useState<{ axis: AxisName; amount: number }>({ axis: "z", amount: 15 });
  const [translateForm, setTranslateForm] = useState({ selector: "all", x: 0, y: 0, z: 0.1 });

  const [exportFormat, setExportFormat] = useState<"poscar" | "cif">("poscar");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiConfig, setAiConfig] = useState<BrowserAiConfig>(DEFAULT_BROWSER_AI_CONFIG);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([
    {
      id: "ai-welcome",
      role: "system",
      content: "可输入：扩胞 2x2x1、z 方向加 15A 真空、平移 O 0 0 0.1、居中、撤销。",
    },
  ]);

  const summary = useMemo(() => summarizeStructure(structure), [structure]);
  const elements = useMemo(() => getUniqueElements(structure), [structure]);

  useEffect(() => {
    const stored = window.localStorage.getItem(MATERIAL_AI_CONFIG_STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      setAiConfig({ ...DEFAULT_BROWSER_AI_CONFIG, ...(JSON.parse(stored) as Partial<BrowserAiConfig>) });
    } catch {
      window.localStorage.removeItem(MATERIAL_AI_CONFIG_STORAGE_KEY);
    }
  }, []);

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const nextStructure = parseStructure(text, file.name);
      setStructure(nextStructure);
      setSourceText(text);
      setSourceName(file.name);
      setHistory([]);
      setError(null);
      setStatus(`已导入 ${file.name}，识别为 ${nextStructure.sourceFormat.toUpperCase()}，包含 ${nextStructure.atoms.length} 个原子。`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "结构文件解析失败。");
    }
  }

  function parsePastedText() {
    try {
      const nextStructure = parseStructure(sourceText, sourceName || "pasted-structure");
      setStructure(nextStructure);
      setHistory([]);
      setError(null);
      setStatus(`已从文本区导入结构，包含 ${nextStructure.atoms.length} 个原子。`);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "文本区结构解析失败。");
    }
  }

  function commitOperation(operation: MaterialOperation, note = operationLabel(operation)) {
    const nextStructure = applyMaterialOperation(structure, operation);
    setHistory((current) => [...current, { structure, note }].slice(-24));
    setStructure(nextStructure);
    setError(null);
    setStatus(`${note} 已应用。`);
  }

  function undoLast() {
    const previous = history[history.length - 1];
    if (!previous) {
      setStatus("没有可撤销的材料操作。");
      return;
    }

    setStructure(previous.structure);
    setHistory((current) => current.slice(0, -1));
    setError(null);
    setStatus(`已撤销：${previous.note}`);
  }

  async function handleAiSubmit() {
    const command = aiPrompt.trim();
    if (!command || aiBusy) {
      return;
    }

    setAiBusy(true);
    setAiPrompt("");
    pushAiMessage("user", command);

    try {
      const interpreted = await resolveAiCommand(command, structure, aiConfig);
      if (interpreted.operation === "undo") {
        undoLast();
        pushAiMessage("assistant", interpreted.explanation);
      } else {
        const label = `AI: ${operationLabel(interpreted.operation)}`;
        commitOperation(interpreted.operation, label);
        pushAiMessage("assistant", `${interpreted.explanation}\n${operationLabel(interpreted.operation)}`);
      }
    } catch (aiError) {
      const message = aiError instanceof Error ? aiError.message : "AI 指令解析失败。";
      setError(message);
      pushAiMessage("assistant", message);
    } finally {
      setAiBusy(false);
    }
  }

  function pushAiMessage(role: AiMessage["role"], content: string) {
    setAiMessages((current) => [
      ...current.slice(-7),
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        role,
        content,
      },
    ]);
  }

  function exportStructure() {
    const text = exportFormat === "poscar" ? exportPoscar(structure) : exportCif(structure);
    const extension = exportFormat === "poscar" ? "vasp" : "cif";
    const baseName = (structure.title || "prepared-material").replace(/[^\w.-]+/g, "_");
    downloadText(`${baseName}.${extension}`, text);
    setStatus(`已生成 ${exportFormat.toUpperCase()} 文件。`);
  }

  return (
    <div className="materials-page content-stack">
      <section className="hero compact-hero materials-hero">
        <div className="hero-copy">
          <p className="eyebrow">材料准备 / VESTA-like Studio</p>
          <h1>上传、检查、操作并保存材料结构。</h1>
          <p className="lede">
            支持 POSCAR 与 CIF 导入，三维查看晶胞、原子和键，常用结构操作会自动进入历史栈。
            AI 指令同样先记录上一步，判断失误时可以一键撤销。
          </p>
          <div className="hero-actions">
            <label className="primary-button icon-button-label file-action">
              <Upload size={16} />
              上传 POSCAR / CIF
              <input accept=".vasp,.poscar,.cif,.txt" onChange={handleFileUpload} type="file" />
            </label>
            <button className="secondary-button icon-button-label" onClick={undoLast} type="button">
              <Undo2 size={16} />
              撤销上一步
            </button>
          </div>
        </div>
      </section>

      <section className="materials-workbench">
        <aside className="panel form-grid materials-import-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">结构来源</p>
              <h2>导入与摘要</h2>
            </div>
            <FileText size={24} />
          </div>

          <div className="material-summary-grid">
            <div className="mini-metric">
              <span className="meta-label">化学式</span>
              <strong>{summary.formula}</strong>
            </div>
            <div className="mini-metric">
              <span className="meta-label">原子数</span>
              <strong>{summary.atomCount}</strong>
            </div>
            <div className="mini-metric">
              <span className="meta-label">体积 A^3</span>
              <strong>{summary.volume.toFixed(2)}</strong>
            </div>
            <div className="mini-metric">
              <span className="meta-label">来源</span>
              <strong>{structure.sourceFormat.toUpperCase()}</strong>
            </div>
          </div>

          <div className="hint-box">
            <strong>{structure.title}</strong>
            <p className="support-text">
              a={summary.latticeLengths.x.toFixed(3)} A,
              b={summary.latticeLengths.y.toFixed(3)} A,
              c={summary.latticeLengths.z.toFixed(3)} A
            </p>
            <p className="support-text">
              alpha={summary.latticeAngles.x.toFixed(2)} deg,
              beta={summary.latticeAngles.y.toFixed(2)} deg,
              gamma={summary.latticeAngles.z.toFixed(2)} deg
            </p>
          </div>

          <div className="element-legend">
            {elements.map((element) => (
              <span className="tag-chip element-chip" key={element}>
                <span className="element-swatch" style={{ background: getElementColor(element) }} />
                {element}
              </span>
            ))}
          </div>

          <label>
            文件名 / 标题
            <input onChange={(event) => setSourceName(event.target.value)} value={sourceName} />
          </label>
          <label>
            粘贴 POSCAR / CIF
            <textarea
              onChange={(event) => setSourceText(event.target.value)}
              rows={9}
              value={sourceText}
            />
          </label>
          <button className="secondary-button icon-button-label" onClick={parsePastedText} type="button">
            <Upload size={16} />
            从文本区导入
          </button>
        </aside>

        <section className="material-viewport-shell">
          <div className="material-toolbar">
            <div className="segmented-control" aria-label="显示模式">
              <button
                className={`segmented-button ${view.mode === "ball-stick" ? "selected-tab" : ""}`}
                onClick={() => setView((current) => ({ ...current, mode: "ball-stick" }))}
                title="球棍模型"
                type="button"
              >
                <Atom size={16} />
              </button>
              <button
                className={`segmented-button ${view.mode === "spacefill" ? "selected-tab" : ""}`}
                onClick={() => setView((current) => ({ ...current, mode: "spacefill" }))}
                title="空间填充"
                type="button"
              >
                <Box size={16} />
              </button>
            </div>

            <label className="checkbox-row toolbar-toggle">
              <input
                checked={view.showCell}
                onChange={(event) => setView((current) => ({ ...current, showCell: event.target.checked }))}
                type="checkbox"
              />
              晶胞
            </label>
            <label className="checkbox-row toolbar-toggle">
              <input
                checked={view.showBonds}
                onChange={(event) => setView((current) => ({ ...current, showBonds: event.target.checked }))}
                type="checkbox"
              />
              键
            </label>
            <label className="toolbar-slider">
              <SlidersHorizontal size={16} />
              <input
                max="1.8"
                min="0.5"
                onChange={(event) => setView((current) => ({ ...current, atomScale: Number(event.target.value) }))}
                step="0.1"
                type="range"
                value={view.atomScale}
              />
            </label>
          </div>

          <MaterialViewer structure={structure} view={view} />

          <div className="viewer-statusbar">
            <span>{status}</span>
            {error ? <span className="warning-text">{error}</span> : null}
          </div>
        </section>

        <aside className="panel form-grid operation-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">结构工具</p>
              <h2>操作与保存</h2>
            </div>
            <Wand2 size={24} />
          </div>

          <section className="operation-block">
            <div className="inline-spread">
              <strong>超胞扩展</strong>
              <Layers size={18} />
            </div>
            <div className="number-row three-cols">
              {(["nx", "ny", "nz"] as const).map((key) => (
                <label key={key}>
                  {key.toUpperCase()}
                  <input
                    max={8}
                    min={1}
                    onChange={(event) =>
                      setRepeatForm((current) => ({ ...current, [key]: Number(event.target.value) }))
                    }
                    type="number"
                    value={repeatForm[key]}
                  />
                </label>
              ))}
            </div>
            <button
              className="secondary-button icon-button-label"
              onClick={() => commitOperation({ type: "repeat", ...repeatForm })}
              type="button"
            >
              <Layers size={16} />
              应用扩胞
            </button>
          </section>

          <section className="operation-block">
            <div className="inline-spread">
              <strong>真空层</strong>
              <Eye size={18} />
            </div>
            <div className="number-row">
              <label>
                方向
                <select
                  onChange={(event) => setVacuumForm((current) => ({ ...current, axis: event.target.value as AxisName }))}
                  value={vacuumForm.axis}
                >
                  <option value="x">X / a</option>
                  <option value="y">Y / b</option>
                  <option value="z">Z / c</option>
                </select>
              </label>
              <label>
                增量 A
                <input
                  min={0.1}
                  onChange={(event) => setVacuumForm((current) => ({ ...current, amount: Number(event.target.value) }))}
                  step={0.5}
                  type="number"
                  value={vacuumForm.amount}
                />
              </label>
            </div>
            <button
              className="secondary-button icon-button-label"
              onClick={() => commitOperation({ type: "vacuum", ...vacuumForm, center: true })}
              type="button"
            >
              <Box size={16} />
              增加真空
            </button>
          </section>

          <section className="operation-block">
            <div className="inline-spread">
              <strong>分数坐标平移</strong>
              <Move3D size={18} />
            </div>
            <label>
              对象
              <select
                onChange={(event) => setTranslateForm((current) => ({ ...current, selector: event.target.value }))}
                value={translateForm.selector}
              >
                <option value="all">全部原子</option>
                {elements.map((element) => (
                  <option key={element} value={element}>
                    {element}
                  </option>
                ))}
              </select>
            </label>
            <div className="number-row three-cols">
              {(["x", "y", "z"] as const).map((key) => (
                <label key={key}>
                  d{key}
                  <input
                    onChange={(event) =>
                      setTranslateForm((current) => ({ ...current, [key]: Number(event.target.value) }))
                    }
                    step={0.01}
                    type="number"
                    value={translateForm[key]}
                  />
                </label>
              ))}
            </div>
            <button
              className="secondary-button icon-button-label"
              onClick={() =>
                commitOperation({
                  type: "translate",
                  selector: translateForm.selector,
                  delta: { x: translateForm.x, y: translateForm.y, z: translateForm.z },
                  wrap: true,
                })
              }
              type="button"
            >
              <Move3D size={16} />
              应用平移
            </button>
          </section>

          <div className="inline-actions compact-actions">
            <button className="secondary-button icon-button-label" onClick={() => commitOperation({ type: "center" })} type="button">
              <RotateCcw size={16} />
              居中
            </button>
            <button className="secondary-button icon-button-label" onClick={() => commitOperation({ type: "wrap" })} type="button">
              <Box size={16} />
              包裹
            </button>
            <button className="secondary-button icon-button-label" onClick={undoLast} type="button">
              <Undo2 size={16} />
              撤销
            </button>
          </div>

          <section className="operation-block ai-operation-block">
            <div className="inline-spread">
              <strong>AI 操作材料</strong>
              <Bot size={18} />
            </div>
            <textarea
              onChange={(event) => setAiPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  void handleAiSubmit();
                }
              }}
              placeholder="例如：把结构扩成 2x2x1；沿 z 加 15A 真空；平移 Cl 0 0 0.05；撤销。"
              rows={3}
              value={aiPrompt}
            />
            <button
              className="primary-button icon-button-label"
              disabled={aiBusy}
              onClick={() => void handleAiSubmit()}
              type="button"
            >
              <Sparkles size={16} />
              {aiBusy ? "AI 解析中..." : "执行 AI 指令"}
            </button>
            <div className="ai-chat-log">
              {aiMessages.map((message) => (
                <div className={`ai-message role-${message.role}`} key={message.id}>
                  <strong>{message.role === "user" ? "我" : message.role === "assistant" ? "AI" : "系统"}</strong>
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="operation-block">
            <div className="inline-spread">
              <strong>保存结构</strong>
              <Save size={18} />
            </div>
            <div className="segmented-control export-switch">
              <button
                className={`segmented-button ${exportFormat === "poscar" ? "selected-tab" : ""}`}
                onClick={() => setExportFormat("poscar")}
                type="button"
              >
                POSCAR
              </button>
              <button
                className={`segmented-button ${exportFormat === "cif" ? "selected-tab" : ""}`}
                onClick={() => setExportFormat("cif")}
                type="button"
              >
                CIF
              </button>
            </div>
            <button className="primary-button icon-button-label" onClick={exportStructure} type="button">
              <Download size={16} />
              下载 {exportFormat.toUpperCase()}
            </button>
          </section>

          <section className="operation-block">
            <div className="inline-spread">
              <strong>历史</strong>
              <span className="status-pill">{history.length}</span>
            </div>
            <div className="history-list">
              {history.slice(-5).reverse().map((entry, index) => (
                <div className="history-row" key={`${entry.note}-${index}`}>
                  <span>{history.length - index}</span>
                  <p>{entry.note}</p>
                </div>
              ))}
              {history.length === 0 ? <p className="muted-text">还没有结构操作。</p> : null}
            </div>
          </section>
        </aside>
      </section>
    </div>
  );
}

function MaterialViewer({ structure, view }: { structure: MaterialStructure; view: ViewSettings }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    async function mountViewer() {
      const THREE = await import("three");
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
      const canvas = canvasRef.current;
      const parent = canvas?.parentElement;
      if (!canvas || !parent || disposed) {
        return;
      }

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor("#edf3f6", 1);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#edf3f6");
      const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 5000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const renderFrame = getCellFrame(structure);
      const center = toThreeVector(THREE, renderFrame.center);
      const distance = Math.max(renderFrame.maxSpan * 1.9, 10);
      camera.position.set(center.x + distance * 0.7, center.y - distance * 1.05, center.z + distance * 0.72);
      camera.near = 0.01;
      camera.far = distance * 25;
      camera.lookAt(center);
      controls.target.copy(center);

      scene.add(new THREE.AmbientLight("#ffffff", 0.74));
      const keyLight = new THREE.DirectionalLight("#ffffff", 1.25);
      keyLight.position.set(distance, -distance, distance * 1.4);
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight("#b7d8e6", 0.55);
      fillLight.position.set(-distance, distance, distance * 0.8);
      scene.add(fillLight);

      const materialGroup = buildMaterialGroup(THREE, structure, view);
      scene.add(materialGroup);

      const resizeCanvas = () => {
        const rect = parent.getBoundingClientRect();
        const width = Math.max(rect.width, 320);
        const height = Math.max(rect.height, 360);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      const resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(parent);
      resizeCanvas();

      let frame = 0;
      const render = () => {
        controls.update();
        renderer.render(scene, camera);
        frame = window.requestAnimationFrame(render);
      };
      render();

      cleanup = () => {
        window.cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        controls.dispose();
        disposeScene(scene);
        renderer.dispose();
      };
    }

    void mountViewer();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [structure, view]);

  return (
    <div className="material-viewer" data-testid="material-viewer">
      <canvas ref={canvasRef} />
    </div>
  );
}

function buildMaterialGroup(
  THREE: typeof import("three"),
  structure: MaterialStructure,
  view: ViewSettings
) {
  const group = new THREE.Group();
  const positions = getCartesianPositions(structure);
  const bounds = getCellFrame(structure);
  const atomBase = view.mode === "spacefill" ? 0.34 : 0.2;
  const atomGloss = view.mode === "spacefill" ? 0.48 : 0.36;

  if (view.showCell) {
    group.add(buildCellLines(THREE, structure));
  }

  if (view.showBonds && view.mode === "ball-stick") {
    const bondMaterial = new THREE.MeshStandardMaterial({
      color: "#7c8a91",
      roughness: 0.55,
      metalness: 0.05,
    });
    for (const bond of getLikelyBonds(structure)) {
      group.add(buildCylinderBetween(THREE, positions[bond.from], positions[bond.to], 0.055 * view.atomScale, bondMaterial));
    }
  }

  for (let index = 0; index < structure.atoms.length; index += 1) {
    const atom = structure.atoms[index];
    const position = positions[index];
    const radius = Math.max(0.12, getElementRadius(atom.element) * atomBase * view.atomScale);
    const geometry = new THREE.SphereGeometry(radius, 32, 18);
    const material = new THREE.MeshStandardMaterial({
      color: getElementColor(atom.element),
      roughness: atomGloss,
      metalness: 0.08,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(toThreeVector(THREE, position));
    group.add(sphere);
  }

  const axesLength = Math.max(bounds.maxSpan * 0.22, 1.2);
  const origin = toThreeVector(THREE, bounds.min);
  group.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, axesLength, "#c2493d", axesLength * 0.18, axesLength * 0.08));
  group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, axesLength, "#2c8d60", axesLength * 0.18, axesLength * 0.08));
  group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, axesLength, "#2f6cc8", axesLength * 0.18, axesLength * 0.08));

  return group;
}

function buildCellLines(THREE: typeof import("three"), structure: MaterialStructure) {
  const corners = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 0, y: 1, z: 1 },
    { x: 1, y: 1, z: 1 },
  ].map((point) => toThreeVector(THREE, fracToCart(point, structure.lattice)));
  const edgePairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 4],
    [1, 5],
    [2, 4],
    [2, 6],
    [3, 5],
    [3, 6],
    [4, 7],
    [5, 7],
    [6, 7],
  ];
  const points = edgePairs.flatMap(([start, end]) => [corners[start], corners[end]]);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color: "#214c5d", linewidth: 1 });
  return new THREE.LineSegments(geometry, material);
}

function getCellFrame(structure: MaterialStructure) {
  const corners = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 0, y: 1, z: 1 },
    { x: 1, y: 1, z: 1 },
  ].map((point) => fracToCart(point, structure.lattice));
  const atomBounds = getCartesianBounds(structure);
  const points = [...corners, atomBounds.min, atomBounds.max];
  const min = { ...points[0] };
  const max = { ...points[0] };

  for (const point of points) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  }

  const span = {
    x: max.x - min.x,
    y: max.y - min.y,
    z: max.z - min.z,
  };

  return {
    min,
    max,
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
    span,
    maxSpan: Math.max(span.x, span.y, span.z, 1),
  };
}

function buildCylinderBetween(
  THREE: typeof import("three"),
  start: Vec3,
  end: Vec3,
  radius: number,
  material: import("three").MeshStandardMaterial
) {
  const startVector = toThreeVector(THREE, start);
  const endVector = toThreeVector(THREE, end);
  const direction = new THREE.Vector3().subVectors(endVector, startVector);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 14);
  const mesh = new THREE.Mesh(geometry, material.clone());
  mesh.position.copy(new THREE.Vector3().addVectors(startVector, endVector).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function toThreeVector(THREE: typeof import("three"), vector: Vec3) {
  return new THREE.Vector3(vector.x, vector.y, vector.z);
}

function disposeScene(scene: import("three").Scene) {
  scene.traverse((object) => {
    const disposable = object as unknown as {
      geometry?: { dispose: () => void };
      material?: { dispose: () => void } | Array<{ dispose: () => void }>;
    };
    disposable.geometry?.dispose();
    if (Array.isArray(disposable.material)) {
      disposable.material.forEach((material) => material.dispose());
    } else {
      disposable.material?.dispose();
    }
  });
}

async function resolveAiCommand(
  command: string,
  structure: MaterialStructure,
  config: BrowserAiConfig
): Promise<InterpretedMaterialCommand> {
  if (config.enabled && config.baseUrl && config.model && config.apiKey) {
    try {
      return await callRemoteAi(command, structure, config);
    } catch {
      return interpretMaterialCommand(command);
    }
  }
  return interpretMaterialCommand(command);
}

async function callRemoteAi(
  command: string,
  structure: MaterialStructure,
  config: BrowserAiConfig
): Promise<InterpretedMaterialCommand> {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const endpoint = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const summary = summarizeStructure(structure);
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You translate materials editing instructions into JSON only. Supported actions: repeat, vacuum, translate, center, wrap, undo. Schema: {\"action\":\"repeat|vacuum|translate|center|wrap|undo\",\"parameters\":{},\"explanation\":\"short Chinese explanation\"}. repeat uses nx, ny, nz integers. vacuum uses axis x/y/z and amount in Angstrom. translate uses selector element or all, and dx, dy, dz in fractional coordinates.",
        },
        {
          role: "user",
          content: `Current structure: ${summary.formula}, ${summary.atomCount} atoms, cell lengths ${summary.latticeLengths.x.toFixed(3)}, ${summary.latticeLengths.y.toFixed(3)}, ${summary.latticeLengths.z.toFixed(3)} A.\nInstruction: ${command}`,
        },
      ],
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`AI 接口返回 ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content ?? "";
  return normalizeRemoteAiResponse(content);
}

function normalizeRemoteAiResponse(content: string): InterpretedMaterialCommand {
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;
  const parsed = JSON.parse(jsonText) as {
    action?: unknown;
    type?: unknown;
    parameters?: Record<string, unknown>;
    explanation?: unknown;
  };
  const action = String(parsed.action ?? parsed.type ?? "").toLowerCase();
  const parameters = parsed.parameters ?? {};
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation : "AI 已生成结构操作。";

  if (action === "undo") {
    return { operation: "undo", explanation };
  }
  if (action === "center") {
    return { operation: { type: "center" }, explanation };
  }
  if (action === "wrap") {
    return { operation: { type: "wrap" }, explanation };
  }
  if (action === "repeat") {
    return {
      operation: {
        type: "repeat",
        nx: numberParam(parameters.nx, 1),
        ny: numberParam(parameters.ny, 1),
        nz: numberParam(parameters.nz, 1),
      },
      explanation,
    };
  }
  if (action === "vacuum") {
    return {
      operation: {
        type: "vacuum",
        axis: axisParam(parameters.axis, "z"),
        amount: numberParam(parameters.amount, 15),
        center: true,
      },
      explanation,
    };
  }
  if (action === "translate") {
    return {
      operation: {
        type: "translate",
        selector: typeof parameters.selector === "string" ? parameters.selector : "all",
        delta: {
          x: numberParam(parameters.dx, 0),
          y: numberParam(parameters.dy, 0),
          z: numberParam(parameters.dz, 0),
        },
        wrap: true,
      },
      explanation,
    };
  }

  throw new Error("AI 返回的操作类型不在可执行范围内。");
}

function numberParam(value: unknown, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function axisParam(value: unknown, fallback: AxisName): AxisName {
  const axis = String(value ?? "").toLowerCase();
  return axis === "x" || axis === "y" || axis === "z" ? axis : fallback;
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
