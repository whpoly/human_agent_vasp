export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MaterialAtom {
  id: string;
  element: string;
  fractional: Vec3;
}

export interface MaterialStructure {
  title: string;
  sourceFormat: "poscar" | "cif" | "unknown";
  lattice: [Vec3, Vec3, Vec3];
  atoms: MaterialAtom[];
  notes?: string;
}

export type AxisName = "x" | "y" | "z";

export type MaterialOperation =
  | { type: "repeat"; nx: number; ny: number; nz: number }
  | { type: "vacuum"; axis: AxisName; amount: number; center?: boolean }
  | { type: "translate"; selector: string; delta: Vec3; wrap?: boolean }
  | { type: "center" }
  | { type: "wrap" };

export interface InterpretedMaterialCommand {
  operation: MaterialOperation | "undo";
  explanation: string;
}

export interface StructureSummary {
  atomCount: number;
  elementCount: number;
  formula: string;
  latticeLengths: Vec3;
  latticeAngles: Vec3;
  volume: number;
}

export interface MaterialBond {
  from: number;
  to: number;
  distance: number;
}

const ELEMENT_COLORS: Record<string, string> = {
  H: "#f4f7fb",
  B: "#d2a75d",
  C: "#3c4a54",
  N: "#356fd0",
  O: "#d3483d",
  F: "#57a45a",
  Na: "#8d65d8",
  Mg: "#3fba77",
  Al: "#9aa5ad",
  Si: "#d4a153",
  P: "#d6802b",
  S: "#dfc33a",
  Cl: "#54b35d",
  K: "#7c5ad4",
  Ca: "#5fbe72",
  Ti: "#8e9aa2",
  V: "#7e91a9",
  Cr: "#7b8fb5",
  Mn: "#9b7ab3",
  Fe: "#c6633f",
  Co: "#4f78b7",
  Ni: "#4c9a80",
  Cu: "#bd7a3a",
  Zn: "#7887c5",
  Br: "#9a4d2f",
  Ag: "#aab4bd",
  I: "#6e4aa6",
  Au: "#d8a833",
  Pb: "#586979",
};

const COVALENT_RADII: Record<string, number> = {
  H: 0.31,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  Na: 1.66,
  Mg: 1.41,
  Al: 1.21,
  Si: 1.11,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  K: 2.03,
  Ca: 1.76,
  Ti: 1.6,
  V: 1.53,
  Cr: 1.39,
  Mn: 1.39,
  Fe: 1.32,
  Co: 1.26,
  Ni: 1.24,
  Cu: 1.32,
  Zn: 1.22,
  Br: 1.2,
  Ag: 1.45,
  I: 1.39,
  Au: 1.36,
  Pb: 1.46,
};

export const SAMPLE_POSCAR = `NaCl conventional cell
1.0
5.640000 0.000000 0.000000
0.000000 5.640000 0.000000
0.000000 0.000000 5.640000
Na Cl
4 4
Direct
0.000000 0.000000 0.000000
0.000000 0.500000 0.500000
0.500000 0.000000 0.500000
0.500000 0.500000 0.000000
0.500000 0.500000 0.500000
0.500000 0.000000 0.000000
0.000000 0.500000 0.000000
0.000000 0.000000 0.500000`;

export function createSampleStructure(): MaterialStructure {
  return parseStructure(SAMPLE_POSCAR, "NaCl-example.vasp");
}

export function parseStructure(text: string, fileName = "material"): MaterialStructure {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("文件为空，请上传或粘贴 POSCAR/CIF 内容。");
  }

  const looksLikeCif = /\.cif$/i.test(fileName) || /_cell_length_a|_atom_site_/i.test(trimmed);
  const firstParser = looksLikeCif ? parseCif : parsePoscar;
  const secondParser = looksLikeCif ? parsePoscar : parseCif;

  try {
    return firstParser(trimmed, fileName);
  } catch (firstError) {
    try {
      return secondParser(trimmed, fileName);
    } catch {
      throw firstError instanceof Error
        ? firstError
        : new Error("无法识别该结构文件，请确认它是 POSCAR 或 CIF。");
    }
  }
}

export function parsePoscar(text: string, fileName = "POSCAR"): MaterialStructure {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 8) {
    throw new Error("POSCAR 至少需要标题、缩放因子、三条晶格矢量、元素/数量和坐标。");
  }

  const title = lines[0] || fileName;
  const rawScale = Number.parseFloat(lines[1]);
  const scale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
  const lattice = [
    parseVectorLine(lines[2], scale),
    parseVectorLine(lines[3], scale),
    parseVectorLine(lines[4], scale),
  ] as [Vec3, Vec3, Vec3];

  const rowFiveTokens = splitWords(lines[5]);
  const hasElementRow = !rowFiveTokens.every(isIntegerToken);
  const elements = hasElementRow ? rowFiveTokens.map(normalizeElement) : rowFiveTokens.map((_, index) => `X${index + 1}`);
  const countIndex = hasElementRow ? 6 : 5;
  const counts = splitWords(lines[countIndex]).map((token) => Number.parseInt(token, 10));

  if (counts.length === 0 || counts.some((count) => !Number.isFinite(count) || count < 0)) {
    throw new Error("POSCAR 的元素数量行无法解析。");
  }

  let modeIndex = countIndex + 1;
  if (/^s/i.test(lines[modeIndex] ?? "")) {
    modeIndex += 1;
  }

  const coordinateMode = lines[modeIndex] ?? "";
  const direct = /^d/i.test(coordinateMode);
  const cartesian = /^c|^k/i.test(coordinateMode);
  if (!direct && !cartesian) {
    throw new Error("POSCAR 坐标模式应为 Direct 或 Cartesian。");
  }

  const coordinateStart = modeIndex + 1;
  const atomElements = counts.flatMap((count, index) => Array.from({ length: count }, () => elements[index] ?? `X${index + 1}`));
  const atoms: MaterialAtom[] = [];

  for (let index = 0; index < atomElements.length; index += 1) {
    const line = lines[coordinateStart + index];
    if (!line) {
      throw new Error(`POSCAR 缺少第 ${index + 1} 个原子的坐标。`);
    }
    const coordinate = parseVectorLine(line, cartesian ? scale : 1);
    const fractional = direct ? coordinate : cartToFrac(coordinate, lattice);
    atoms.push({
      id: `${atomElements[index]}-${index + 1}`,
      element: normalizeElement(atomElements[index]),
      fractional: wrapVec(fractional),
    });
  }

  return {
    title,
    sourceFormat: "poscar",
    lattice,
    atoms,
  };
}

export function parseCif(text: string, fileName = "material.cif"): MaterialStructure {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const dataName = lines.find((line) => /^data_/i.test(line))?.replace(/^data_/i, "").trim();
  const tagValues = new Map<string, string>();

  for (const line of lines) {
    if (!line.startsWith("_")) {
      continue;
    }
    const tokens = tokenizeCifLine(line);
    if (tokens.length >= 2) {
      tagValues.set(tokens[0].toLowerCase(), tokens.slice(1).join(" "));
    }
  }

  const a = readCifNumber(tagValues, "_cell_length_a");
  const b = readCifNumber(tagValues, "_cell_length_b");
  const c = readCifNumber(tagValues, "_cell_length_c");
  const alpha = readCifNumber(tagValues, "_cell_angle_alpha", 90);
  const beta = readCifNumber(tagValues, "_cell_angle_beta", 90);
  const gamma = readCifNumber(tagValues, "_cell_angle_gamma", 90);

  if (!a || !b || !c) {
    throw new Error("CIF 缺少 _cell_length_a/b/c 晶胞长度。");
  }

  const lattice = latticeFromLengthsAngles(a, b, c, alpha, beta, gamma);
  const atomRows = extractCifAtomRows(lines);

  if (atomRows.length === 0) {
    throw new Error("CIF 没有找到 _atom_site_ 原子坐标 loop。");
  }

  const atoms = atomRows.map((row, index) => ({
    id: `${row.element}-${index + 1}`,
    element: normalizeElement(row.element),
    fractional: wrapVec(row.fractional),
  }));

  return {
    title: dataName || fileName.replace(/\.[^.]+$/, "") || "CIF material",
    sourceFormat: "cif",
    lattice,
    atoms,
  };
}

export function applyMaterialOperation(
  structure: MaterialStructure,
  operation: MaterialOperation
): MaterialStructure {
  switch (operation.type) {
    case "repeat":
      return repeatStructure(structure, operation.nx, operation.ny, operation.nz);
    case "vacuum":
      return addVacuum(structure, operation.axis, operation.amount, operation.center ?? true);
    case "translate":
      return translateAtoms(structure, operation.selector, operation.delta, operation.wrap ?? true);
    case "center":
      return centerStructure(structure);
    case "wrap":
      return {
        ...structure,
        atoms: structure.atoms.map((atom) => ({ ...atom, fractional: wrapVec(atom.fractional) })),
        notes: appendNote(structure.notes, "Wrapped atoms into the unit cell."),
      };
    default:
      return structure;
  }
}

export function operationLabel(operation: MaterialOperation | "undo"): string {
  if (operation === "undo") {
    return "撤销上一步";
  }
  if (operation.type === "repeat") {
    return `扩胞 ${operation.nx} x ${operation.ny} x ${operation.nz}`;
  }
  if (operation.type === "vacuum") {
    return `${operation.axis.toUpperCase()} 方向增加 ${operation.amount} A 真空层`;
  }
  if (operation.type === "translate") {
    return `平移 ${operation.selector || "全部原子"} (${formatNumber(operation.delta.x)}, ${formatNumber(operation.delta.y)}, ${formatNumber(operation.delta.z)})`;
  }
  if (operation.type === "center") {
    return "居中结构";
  }
  return "包裹原子到晶胞";
}

export function interpretMaterialCommand(command: string): InterpretedMaterialCommand {
  const text = command.trim();
  const normalized = text.toLowerCase();

  if (!text) {
    throw new Error("请输入要让 AI 执行的材料操作。");
  }

  if (/撤销|回退|undo|revert|上一步/.test(normalized)) {
    return { operation: "undo", explanation: "识别为回退请求，将恢复到上一步结构。" };
  }

  if (/居中|center|centre/.test(normalized)) {
    return { operation: { type: "center" }, explanation: "识别为结构居中操作。" };
  }

  if (/包裹|wrap/.test(normalized)) {
    return { operation: { type: "wrap" }, explanation: "识别为把分数坐标包裹回 0 到 1 的晶胞范围。" };
  }

  const repeatMatch =
    normalized.match(/(\d+)\s*[x*]\s*(\d+)\s*[x*]\s*(\d+)/) ??
    normalized.match(/(?:扩胞|超胞|supercell|repeat)[^\d]*(\d+)[^\d]+(\d+)[^\d]+(\d+)/);
  if (repeatMatch) {
    return {
      operation: {
        type: "repeat",
        nx: clampInteger(Number.parseInt(repeatMatch[1], 10), 1, 8),
        ny: clampInteger(Number.parseInt(repeatMatch[2], 10), 1, 8),
        nz: clampInteger(Number.parseInt(repeatMatch[3], 10), 1, 8),
      },
      explanation: "识别为超胞扩展操作。",
    };
  }

  if (/真空|vacuum/.test(normalized)) {
    const axis = inferAxis(normalized) ?? "z";
    const amount = inferNumbers(normalized).find((value) => value > 0) ?? 15;
    return {
      operation: { type: "vacuum", axis, amount: clampNumber(amount, 0.1, 80), center: true },
      explanation: "识别为增加真空层操作，默认保持结构居中。",
    };
  }

  if (/平移|移动|translate|move|shift/.test(normalized)) {
    const numbers = inferNumbers(normalized);
    const [x = 0, y = 0, z = 0] = numbers.slice(-3);
    return {
      operation: {
        type: "translate",
        selector: inferElement(text) ?? "all",
        delta: {
          x: clampNumber(x, -1, 1),
          y: clampNumber(y, -1, 1),
          z: clampNumber(z, -1, 1),
        },
        wrap: true,
      },
      explanation: "识别为分数坐标平移操作。",
    };
  }

  throw new Error("暂时无法把这条指令映射到可执行操作。可尝试：扩胞 2x2x1、z 方向加 15A 真空、平移 O 0 0 0.1、居中、撤销。");
}

export function exportPoscar(structure: MaterialStructure): string {
  const groups = groupAtomsByElement(structure);
  const coordinates = groups.flatMap((group) =>
    group.atoms.map((atom) => `${formatFixed(wrapFraction(atom.fractional.x))} ${formatFixed(wrapFraction(atom.fractional.y))} ${formatFixed(wrapFraction(atom.fractional.z))}`)
  );

  return [
    structure.title || "Prepared material",
    "1.0",
    ...structure.lattice.map((vector) => `${formatFixed(vector.x)} ${formatFixed(vector.y)} ${formatFixed(vector.z)}`),
    groups.map((group) => group.element).join(" "),
    groups.map((group) => String(group.atoms.length)).join(" "),
    "Direct",
    ...coordinates,
    "",
  ].join("\n");
}

export function exportCif(structure: MaterialStructure): string {
  const summary = summarizeStructure(structure);
  const safeTitle = (structure.title || "prepared_material").replace(/[^\w.-]+/g, "_");
  const rows = structure.atoms.map((atom, index) => {
    const label = `${atom.element}${index + 1}`;
    return `${label} ${atom.element} ${formatFixed(wrapFraction(atom.fractional.x))} ${formatFixed(wrapFraction(atom.fractional.y))} ${formatFixed(wrapFraction(atom.fractional.z))}`;
  });

  return [
    `data_${safeTitle}`,
    "_symmetry_space_group_name_H-M 'P 1'",
    `_cell_length_a ${formatFixed(summary.latticeLengths.x)}`,
    `_cell_length_b ${formatFixed(summary.latticeLengths.y)}`,
    `_cell_length_c ${formatFixed(summary.latticeLengths.z)}`,
    `_cell_angle_alpha ${formatFixed(summary.latticeAngles.x)}`,
    `_cell_angle_beta ${formatFixed(summary.latticeAngles.y)}`,
    `_cell_angle_gamma ${formatFixed(summary.latticeAngles.z)}`,
    "",
    "loop_",
    "_atom_site_label",
    "_atom_site_type_symbol",
    "_atom_site_fract_x",
    "_atom_site_fract_y",
    "_atom_site_fract_z",
    ...rows,
    "",
  ].join("\n");
}

export function summarizeStructure(structure: MaterialStructure): StructureSummary {
  const [a, b, c] = structure.lattice;
  const volume = Math.abs(dot(a, cross(b, c)));
  return {
    atomCount: structure.atoms.length,
    elementCount: getUniqueElements(structure).length,
    formula: structureFormula(structure),
    latticeLengths: {
      x: norm(a),
      y: norm(b),
      z: norm(c),
    },
    latticeAngles: {
      x: angleBetween(b, c),
      y: angleBetween(a, c),
      z: angleBetween(a, b),
    },
    volume,
  };
}

export function structureFormula(structure: MaterialStructure): string {
  return groupAtomsByElement(structure)
    .map((group) => `${group.element}${group.atoms.length > 1 ? group.atoms.length : ""}`)
    .join(" ");
}

export function getUniqueElements(structure: MaterialStructure): string[] {
  return [...new Set(structure.atoms.map((atom) => atom.element))];
}

export function getElementColor(element: string): string {
  return ELEMENT_COLORS[normalizeElement(element)] ?? "#7a8792";
}

export function getElementRadius(element: string): number {
  return COVALENT_RADII[normalizeElement(element)] ?? 1.15;
}

export function getCartesianPositions(structure: MaterialStructure): Vec3[] {
  return structure.atoms.map((atom) => fracToCart(atom.fractional, structure.lattice));
}

export function getCartesianBounds(structure: MaterialStructure): { min: Vec3; max: Vec3; center: Vec3; span: Vec3; maxSpan: number } {
  const positions = getCartesianPositions(structure);
  const seed = positions[0] ?? { x: 0, y: 0, z: 0 };
  const min = { ...seed };
  const max = { ...seed };

  for (const position of positions) {
    min.x = Math.min(min.x, position.x);
    min.y = Math.min(min.y, position.y);
    min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x);
    max.y = Math.max(max.y, position.y);
    max.z = Math.max(max.z, position.z);
  }

  const span = sub(max, min);
  return {
    min,
    max,
    center: scale(add(min, max), 0.5),
    span,
    maxSpan: Math.max(span.x, span.y, span.z, ...structure.lattice.map(norm), 1),
  };
}

export function getLikelyBonds(structure: MaterialStructure): MaterialBond[] {
  const positions = getCartesianPositions(structure);
  const bonds: MaterialBond[] = [];

  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const leftAtom = structure.atoms[left];
      const rightAtom = structure.atoms[right];
      const distance = norm(sub(positions[left], positions[right]));
      const threshold = Math.min(getElementRadius(leftAtom.element) + getElementRadius(rightAtom.element) + 0.45, 3.25);
      if (distance > 0.25 && distance <= threshold) {
        bonds.push({ from: left, to: right, distance });
      }
    }
  }

  return bonds;
}

export function fracToCart(frac: Vec3, lattice: [Vec3, Vec3, Vec3]): Vec3 {
  return add(add(scale(lattice[0], frac.x), scale(lattice[1], frac.y)), scale(lattice[2], frac.z));
}

export function cartToFrac(cart: Vec3, lattice: [Vec3, Vec3, Vec3]): Vec3 {
  const [a, b, c] = lattice;
  const determinant = dot(a, cross(b, c));
  if (Math.abs(determinant) < 1e-10) {
    throw new Error("晶格矢量体积接近 0，无法进行坐标转换。");
  }

  return {
    x: dot(cart, cross(b, c)) / determinant,
    y: dot(cart, cross(c, a)) / determinant,
    z: dot(cart, cross(a, b)) / determinant,
  };
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3).replace(/\.?0+$/, "") : "0";
}

function repeatStructure(structure: MaterialStructure, nx: number, ny: number, nz: number): MaterialStructure {
  const reps = {
    x: clampInteger(nx, 1, 8),
    y: clampInteger(ny, 1, 8),
    z: clampInteger(nz, 1, 8),
  };
  const atoms: MaterialAtom[] = [];

  for (let ix = 0; ix < reps.x; ix += 1) {
    for (let iy = 0; iy < reps.y; iy += 1) {
      for (let iz = 0; iz < reps.z; iz += 1) {
        for (const atom of structure.atoms) {
          atoms.push({
            id: `${atom.element}-${atoms.length + 1}`,
            element: atom.element,
            fractional: {
              x: (atom.fractional.x + ix) / reps.x,
              y: (atom.fractional.y + iy) / reps.y,
              z: (atom.fractional.z + iz) / reps.z,
            },
          });
        }
      }
    }
  }

  return {
    ...structure,
    title: `${structure.title} ${reps.x}x${reps.y}x${reps.z}`,
    lattice: [
      scale(structure.lattice[0], reps.x),
      scale(structure.lattice[1], reps.y),
      scale(structure.lattice[2], reps.z),
    ],
    atoms,
    notes: appendNote(structure.notes, operationLabel({ type: "repeat", nx: reps.x, ny: reps.y, nz: reps.z })),
  };
}

function addVacuum(structure: MaterialStructure, axis: AxisName, amount: number, centerAtoms: boolean): MaterialStructure {
  const axisIndex = axisToIndex(axis);
  const lattice = [...structure.lattice] as [Vec3, Vec3, Vec3];
  const length = norm(lattice[axisIndex]);
  const safeAmount = clampNumber(amount, 0.1, 80);
  const factor = (length + safeAmount) / Math.max(length, 1e-8);
  lattice[axisIndex] = scale(lattice[axisIndex], factor);

  const centerShift = centerAtoms ? (1 - 1 / factor) / 2 : 0;
  const atoms = structure.atoms.map((atom) => {
    const fractional = { ...atom.fractional };
    fractional[axis] = fractional[axis] / factor + centerShift;
    return { ...atom, fractional: wrapVec(fractional) };
  });

  return {
    ...structure,
    lattice,
    atoms,
    notes: appendNote(structure.notes, operationLabel({ type: "vacuum", axis, amount: safeAmount, center: centerAtoms })),
  };
}

function translateAtoms(structure: MaterialStructure, selector: string, delta: Vec3, shouldWrap: boolean): MaterialStructure {
  const selected = normalizeSelector(selector);
  const atoms = structure.atoms.map((atom) => {
    if (selected !== "all" && normalizeElement(atom.element).toLowerCase() !== selected.toLowerCase()) {
      return atom;
    }
    const next = add(atom.fractional, delta);
    return { ...atom, fractional: shouldWrap ? wrapVec(next) : next };
  });

  return {
    ...structure,
    atoms,
    notes: appendNote(structure.notes, operationLabel({ type: "translate", selector, delta, wrap: shouldWrap })),
  };
}

function centerStructure(structure: MaterialStructure): MaterialStructure {
  const bounds = getCartesianBounds(structure);
  const targetCenter = scale(add(add(structure.lattice[0], structure.lattice[1]), structure.lattice[2]), 0.5);
  const deltaFrac = cartToFrac(sub(targetCenter, bounds.center), structure.lattice);
  return {
    ...translateAtoms(structure, "all", deltaFrac, true),
    notes: appendNote(structure.notes, "Centered structure in the unit cell."),
  };
}

function latticeFromLengthsAngles(a: number, b: number, c: number, alpha: number, beta: number, gamma: number): [Vec3, Vec3, Vec3] {
  const alphaRad = degreesToRadians(alpha);
  const betaRad = degreesToRadians(beta);
  const gammaRad = degreesToRadians(gamma);
  const sinGamma = Math.sin(gammaRad) || 1e-8;
  const vectorA = { x: a, y: 0, z: 0 };
  const vectorB = { x: b * Math.cos(gammaRad), y: b * sinGamma, z: 0 };
  const cx = c * Math.cos(betaRad);
  const cy = (c * (Math.cos(alphaRad) - Math.cos(betaRad) * Math.cos(gammaRad))) / sinGamma;
  const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 0));
  return [vectorA, vectorB, { x: cx, y: cy, z: cz }];
}

function extractCifAtomRows(lines: string[]): Array<{ element: string; fractional: Vec3 }> {
  const rows: Array<{ element: string; fractional: Vec3 }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^loop_$/i.test(lines[index])) {
      continue;
    }

    const headers: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].startsWith("_")) {
      headers.push(tokenizeCifLine(lines[cursor])[0].toLowerCase());
      cursor += 1;
    }

    if (!headers.some((header) => header.startsWith("_atom_site_"))) {
      continue;
    }

    const labelIndex = findHeaderIndex(headers, ["_atom_site_type_symbol", "_atom_site_label"]);
    const xIndex = findHeaderIndex(headers, ["_atom_site_fract_x"]);
    const yIndex = findHeaderIndex(headers, ["_atom_site_fract_y"]);
    const zIndex = findHeaderIndex(headers, ["_atom_site_fract_z"]);
    if (labelIndex < 0 || xIndex < 0 || yIndex < 0 || zIndex < 0) {
      continue;
    }

    while (cursor < lines.length && !/^loop_$/i.test(lines[cursor]) && !lines[cursor].startsWith("_")) {
      const tokens = tokenizeCifLine(lines[cursor]);
      if (tokens.length >= headers.length) {
        const x = parseCifNumber(tokens[xIndex]);
        const y = parseCifNumber(tokens[yIndex]);
        const z = parseCifNumber(tokens[zIndex]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          rows.push({
            element: normalizeElement(tokens[labelIndex]),
            fractional: { x, y, z },
          });
        }
      }
      cursor += 1;
    }
  }

  return rows;
}

function readCifNumber(values: Map<string, string>, key: string, fallback = 0): number {
  const value = values.get(key.toLowerCase());
  return value ? parseCifNumber(value) : fallback;
}

function parseCifNumber(value: string): number {
  const cleaned = value.replace(/^['"]|['"]$/g, "").replace(/\(.+\)$/, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenizeCifLine(line: string): string[] {
  return (
    line.match(/'[^']*'|"[^"]*"|\S+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? []
  );
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  return candidates.reduce((found, candidate) => {
    if (found >= 0) {
      return found;
    }
    return headers.findIndex((header) => header === candidate);
  }, -1);
}

function groupAtomsByElement(structure: MaterialStructure): Array<{ element: string; atoms: MaterialAtom[] }> {
  const groups = new Map<string, MaterialAtom[]>();
  for (const atom of structure.atoms) {
    const element = normalizeElement(atom.element);
    groups.set(element, [...(groups.get(element) ?? []), atom]);
  }
  return [...groups.entries()].map(([element, atoms]) => ({ element, atoms }));
}

function parseVectorLine(line: string, factor = 1): Vec3 {
  const [x, y, z] = splitWords(line).map((token) => Number.parseFloat(token));
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error(`无法解析向量行：${line}`);
  }
  return {
    x: x * factor,
    y: y * factor,
    z: z * factor,
  };
}

function splitWords(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

function isIntegerToken(token: string): boolean {
  return /^\d+$/.test(token);
}

function normalizeSelector(selector: string): string {
  const trimmed = selector.trim();
  return !trimmed || /^all|全部|所有$/i.test(trimmed) ? "all" : normalizeElement(trimmed);
}

function normalizeElement(value: string): string {
  const cleaned = value.replace(/[0-9_+\-.]/g, "").trim();
  const match = cleaned.match(/[A-Z][a-z]?|[a-z]{1,2}/);
  if (!match) {
    return value.trim() || "X";
  }
  const symbol = match[0];
  return symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
}

function inferElement(text: string): string | null {
  const candidates = text.match(/\b[A-Z][a-z]?\b/g) ?? [];
  const ignored = new Set(["A", "X", "Y", "Z"]);
  return candidates.find((candidate) => !ignored.has(candidate)) ?? null;
}

function inferAxis(text: string): AxisName | null {
  if (/(?:x|a)\s*(?:方向|axis)?/.test(text)) {
    return "x";
  }
  if (/(?:y|b)\s*(?:方向|axis)?/.test(text)) {
    return "y";
  }
  if (/(?:z|c)\s*(?:方向|axis)?/.test(text)) {
    return "z";
  }
  return null;
}

function inferNumbers(text: string): number[] {
  return (text.match(/[-+]?\d*\.?\d+/g) ?? [])
    .map((token) => Number.parseFloat(token))
    .filter(Number.isFinite);
}

function axisToIndex(axis: AxisName): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

function wrapVec(vector: Vec3): Vec3 {
  return {
    x: wrapFraction(vector.x),
    y: wrapFraction(vector.y),
    z: wrapFraction(vector.z),
  };
}

function wrapFraction(value: number): number {
  const wrapped = value - Math.floor(value);
  return Math.abs(wrapped - 1) < 1e-10 ? 0 : wrapped;
}

function add(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function sub(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function dot(left: Vec3, right: Vec3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function norm(vector: Vec3): number {
  return Math.sqrt(dot(vector, vector));
}

function angleBetween(left: Vec3, right: Vec3): number {
  const denominator = norm(left) * norm(right);
  if (denominator < 1e-10) {
    return 90;
  }
  return radiansToDegrees(Math.acos(clampNumber(dot(left, right) / denominator, -1, 1)));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? Math.round(value) : min));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function formatFixed(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(10);
}

function appendNote(current: string | undefined, next: string): string {
  return [current, next].filter(Boolean).join("\n");
}
