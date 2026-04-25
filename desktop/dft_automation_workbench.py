from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
try:
    from tkinter import filedialog, messagebox, ttk
    import tkinter as tk
except ModuleNotFoundError as exc:
    message = (
        "This application requires Python with tkinter/Tcl/Tk support.\n\n"
        "Install the standard Windows Python from python.org and make sure "
        "'tcl/tk and IDLE' is selected. The Microsoft Store Python alias or "
        "minimal embedded Python builds usually do not include tkinter."
    )
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "Missing tkinter", 0x10)
    except Exception:
        pass
    raise SystemExit(message) from exc


APP_TITLE = "自动化 DFT 工作台"

SAMPLE_POSCAR = """Si conventional cell
1.0
5.431 0.000 0.000
0.000 5.431 0.000
0.000 0.000 5.431
Si
8
Direct
0.000 0.000 0.000
0.000 0.500 0.500
0.500 0.000 0.500
0.500 0.500 0.000
0.250 0.250 0.250
0.250 0.750 0.750
0.750 0.250 0.750
0.750 0.750 0.250"""

COMMON_VESTA_PATHS = [
    r"C:\Program Files\VESTA-win64\VESTA.exe",
    r"C:\Program Files (x86)\VESTA-win64\VESTA.exe",
    r"C:\Program Files\VESTA\VESTA.exe",
]

DEFAULT_OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.5")
DEFAULT_OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
MAX_UPLOADED_PROMPT_CHARS = 60000

VASP_TEMPLATES = {
    "Relax": {
        "description": "几何优化：优化离子位置和晶胞。",
        "kpoints": "Automatic mesh\n0\nGamma\n3 3 3\n0 0 0\n",
        "incar": """SYSTEM = automated-relax
PREC = Accurate
ENCUT = 520
EDIFF = 1E-5
EDIFFG = -0.02
ISMEAR = 0
SIGMA = 0.05
IBRION = 2
NSW = 100
ISIF = 3
LREAL = Auto
LWAVE = .FALSE.
LCHARG = .FALSE.
"""
    },
    "Static SCF": {
        "description": "静态自洽计算：通常接在优化结构后。",
        "kpoints": "Automatic mesh\n0\nGamma\n5 5 5\n0 0 0\n",
        "incar": """SYSTEM = automated-static
PREC = Accurate
ENCUT = 520
EDIFF = 1E-6
ISMEAR = 0
SIGMA = 0.05
IBRION = -1
NSW = 0
LREAL = .FALSE.
LWAVE = .TRUE.
LCHARG = .TRUE.
"""
    },
    "DOS": {
        "description": "态密度计算：需要较密 k 点，并通常依赖静态电荷密度。",
        "kpoints": "Automatic mesh\n0\nGamma\n7 7 7\n0 0 0\n",
        "incar": """SYSTEM = automated-dos
PREC = Accurate
ENCUT = 520
EDIFF = 1E-6
ISMEAR = -5
SIGMA = 0.05
IBRION = -1
NSW = 0
LORBIT = 11
NEDOS = 2000
LWAVE = .FALSE.
LCHARG = .TRUE.
"""
    },
    "Band": {
        "description": "能带计算：KPOINTS 需要按材料体系人工确认高对称路径。",
        "kpoints": """Band path placeholder
40
Line-mode
reciprocal
0.000 0.000 0.000 ! G
0.500 0.000 0.000 ! X

0.500 0.000 0.000 ! X
0.500 0.500 0.000 ! M
""",
        "incar": """SYSTEM = automated-band
PREC = Accurate
ENCUT = 520
EDIFF = 1E-6
ISMEAR = 0
SIGMA = 0.05
IBRION = -1
NSW = 0
ICHARG = 11
LORBIT = 11
LWAVE = .FALSE.
LCHARG = .FALSE.
"""
    },
}

VASP_INPUT_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "template": {
            "type": "string",
            "enum": ["Relax", "Static SCF", "DOS", "Band"],
        },
        "poscar": {
            "type": "string",
            "description": "Complete VASP POSCAR text. Use VASP 5 style element and count lines.",
        },
        "incar": {
            "type": "string",
            "description": "Complete INCAR text for the requested draft calculation.",
        },
        "kpoints": {
            "type": "string",
            "description": "Complete KPOINTS text. Use automatic mesh unless band path is explicitly requested.",
        },
        "potcar_required": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Element or potential labels in the exact order required for POTCAR concatenation.",
        },
        "notes": {
            "type": "array",
            "items": {"type": "string"},
        },
        "warnings": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["template", "poscar", "incar", "kpoints", "potcar_required", "notes", "warnings"],
}

OPENAI_VASP_SYSTEM_PROMPT = """You are a VASP input-file generator for DFT workflows.

Your only task is to generate draft VASP input files from the user's material description and optional uploaded local file content.

Output must follow the provided JSON schema exactly.

Rules:
- Generate only VASP input-file content and concise review notes: POSCAR, INCAR, KPOINTS, POTCAR_REQUIRED order, notes, warnings.
- Do not run calculations, do not claim results, and do not generate OUTCAR/OSZICAR/CHGCAR/WAVECAR.
- Do not invent licensed POTCAR content. Only list the required element or potential order.
- If a CIF or POSCAR is provided, use it as the primary structure source and convert to a clean POSCAR draft when possible.
- If no local structure is provided, generate a chemically plausible initial POSCAR draft and explicitly warn that the structure must be verified.
- Keep POSCAR valid VASP 5 style with title, scale, three lattice vectors, element symbols, counts, coordinate mode, and coordinates.
- Keep INCAR conservative and suitable for an initial draft. Add TODO comments for spin, DFT+U, hybrid, SOC, or magnetic settings when uncertain.
- Keep KPOINTS simple and valid. For band calculations, provide a placeholder high-symmetry path and warn that it must be confirmed.
- Prefer English VASP tags and comments inside files; notes and warnings may be Chinese.
"""


def parse_formula(formula: str) -> list[tuple[str, int]]:
    tokens = re.findall(r"([A-Z][a-z]?)(\d*)", formula.strip())
    parsed: list[tuple[str, int]] = []
    for symbol, count_text in tokens:
        parsed.append((normalize_element(symbol), int(count_text or "1")))
    return parsed


def infer_template_from_requirements(requirements: str) -> str:
    text = requirements.lower()
    if "dos" in text or "态密度" in requirements:
        return "DOS"
    if "band" in text or "能带" in requirements:
        return "Band"
    if "static" in text or "scf" in text or "单点" in requirements or "静态" in requirements:
        return "Static SCF"
    return "Relax"


def generate_poscar_from_formula(formula: str, requirements: str) -> tuple[str, list[str]]:
    composition = parse_formula(formula)
    if not composition:
        return SAMPLE_POSCAR, ["未能解析材料公式，已回退到 Si 示例结构。"]

    normalized_formula = "".join(f"{symbol}{count if count != 1 else ''}" for symbol, count in composition)
    lower_req = requirements.lower()
    notes = [
        f"根据材料输入生成初始结构草案：{normalized_formula}",
        "该结构是 AI 初始草案，需要用户用 VESTA 或专业结构库确认后再计算。",
    ]

    if len(composition) == 1 and composition[0][0] in {"Si", "C", "Ge"}:
        symbol = composition[0][0]
        a = 5.431 if symbol == "Si" else 3.567 if symbol == "C" else 5.658
        poscar = f"""{symbol} diamond conventional cell - AI draft
1.0
{format_number(a)} 0.000000 0.000000
0.000000 {format_number(a)} 0.000000
0.000000 0.000000 {format_number(a)}
{symbol}
8
Direct
0.000000 0.000000 0.000000
0.000000 0.500000 0.500000
0.500000 0.000000 0.500000
0.500000 0.500000 0.000000
0.250000 0.250000 0.250000
0.250000 0.750000 0.750000
0.750000 0.250000 0.750000
0.750000 0.750000 0.250000
"""
        notes.append(f"检测到 {symbol}，使用 diamond conventional cell 草案。")
        return poscar, notes

    if len(composition) == 2 and composition[0][1] == composition[1][1] == 1:
        a = 5.6
        if "nacl" in normalized_formula.lower() or "rocksalt" in lower_req or "岩盐" in requirements:
            a = 5.64
        poscar = f"""{normalized_formula} binary rocksalt-like primitive cell - AI draft
1.0
{format_number(a)} 0.000000 0.000000
0.000000 {format_number(a)} 0.000000
0.000000 0.000000 {format_number(a)}
{composition[0][0]} {composition[1][0]}
1 1
Direct
0.000000 0.000000 0.000000
0.500000 0.500000 0.500000
"""
        notes.append("检测到二元 1:1 化学式，生成 rocksalt-like 初始草案。")
        return poscar, notes

    total_atoms = sum(count for _symbol, count in composition)
    grid = max(2, math.ceil(total_atoms ** (1 / 3)))
    a = 4.0 + 0.35 * grid
    if "真空" in requirements or "vacuum" in lower_req or "2d" in lower_req or "slab" in lower_req:
        c = max(18.0, a * 3)
        notes.append("检测到真空层/二维/slab 要求，已放大 c 方向晶胞。")
    else:
        c = a

    coords: list[str] = []
    atom_index = 0
    for _symbol, count in composition:
        for _ in range(count):
            x = ((atom_index % grid) + 0.5) / grid
            y = (((atom_index // grid) % grid) + 0.5) / grid
            z = (((atom_index // (grid * grid)) % grid) + 0.5) / grid
            coords.append(f"{format_number(x)} {format_number(y)} {format_number(z)}")
            atom_index += 1

    poscar_lines = [
        f"{normalized_formula} generated primitive draft",
        "1.0",
        f"{format_number(a)} 0.000000 0.000000",
        f"0.000000 {format_number(a)} 0.000000",
        f"0.000000 0.000000 {format_number(c)}",
        " ".join(symbol for symbol, _count in composition),
        " ".join(str(count) for _symbol, count in composition),
        "Direct",
        *coords,
    ]
    notes.append("未知或复杂结构使用简单分数坐标草案；后续必须人工替换为真实晶体结构。")
    return "\n".join(poscar_lines) + "\n", notes


def tune_incar_for_requirements(incar: str, formula: str, requirements: str) -> str:
    lines = []
    has_system = False
    lower_req = requirements.lower()
    for line in incar.strip().splitlines():
        if line.strip().upper().startswith("SYSTEM"):
            lines.append(f"SYSTEM = {formula or 'ai-generated-dft'}")
            has_system = True
        else:
            lines.append(line)
    if not has_system:
        lines.insert(0, f"SYSTEM = {formula or 'ai-generated-dft'}")
    if "spin" in lower_req or "磁" in requirements or any(element in formula for element in ("Fe", "Co", "Ni", "Mn", "Cr")):
        if not any(line.strip().upper().startswith("ISPIN") for line in lines):
            lines.append("ISPIN = 2")
        lines.append("# TODO: AI detected possible spin polarization. Confirm MAGMOM manually.")
    if "hse" in lower_req or "hybrid" in lower_req or "杂化" in requirements:
        lines.append("# TODO: Hybrid functional requested. Confirm LHFCALC/HFSCREEN/AEXX settings manually.")
    if "+u" in lower_req or "ldau" in lower_req or "hubbard" in lower_req:
        lines.append("# TODO: DFT+U requested. Confirm LDAU, LDAUL, LDAUU, LDAUJ manually.")
    return "\n".join(lines).strip() + "\n"


def build_openai_prompt(material: str, requirements: str, uploaded_name: str, uploaded_content: str) -> str:
    source_lines = [
        "Generate a draft VASP input bundle for the following request.",
        "",
        f"Material or task description: {material or '(infer from uploaded file if possible)'}",
        f"User requirements: {requirements or 'Generate initial POSCAR, INCAR, KPOINTS, and POTCAR order for a geometry optimization.'}",
    ]
    if uploaded_content:
        clipped_content = uploaded_content[:MAX_UPLOADED_PROMPT_CHARS]
        if len(uploaded_content) > MAX_UPLOADED_PROMPT_CHARS:
            clipped_content += "\n\n[TRUNCATED: uploaded file is longer than the prompt limit.]"
        source_lines.extend(
            [
                "",
                f"Uploaded local file name: {uploaded_name or 'uploaded-structure.txt'}",
                "Uploaded local file content:",
                "```",
                clipped_content,
                "```",
            ]
        )
    return "\n".join(source_lines)


def call_openai_responses(
    api_key: str,
    base_url: str,
    payload: dict[str, object],
    timeout: int = 90,
) -> dict[str, object]:
    endpoint = f"{base_url.rstrip('/')}/responses"
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "dft-automation-workbench/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            error_json = json.loads(detail)
            message = error_json.get("error", {}).get("message") or detail
        except json.JSONDecodeError:
            message = detail
        raise RuntimeError(f"OpenAI API 请求失败（HTTP {exc.code}）：{message}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"无法连接 OpenAI API：{exc.reason}") from exc


def extract_openai_text(response_data: dict[str, object]) -> str:
    output_text = response_data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text

    chunks: list[str] = []
    for item in response_data.get("output", []):
        if not isinstance(item, dict):
            continue
        for content in item.get("content", []):
            if not isinstance(content, dict):
                continue
            if content.get("type") in {"output_text", "text"} and isinstance(content.get("text"), str):
                chunks.append(content["text"])
    return "\n".join(chunks).strip()


def request_openai_vasp_inputs(
    api_key: str,
    base_url: str,
    model: str,
    material: str,
    requirements: str,
    uploaded_name: str,
    uploaded_content: str,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": model,
        "instructions": OPENAI_VASP_SYSTEM_PROMPT,
        "input": build_openai_prompt(material, requirements, uploaded_name, uploaded_content),
        "max_output_tokens": 6000,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "vasp_input_bundle",
                "strict": True,
                "schema": VASP_INPUT_JSON_SCHEMA,
            }
        },
    }
    response_data = call_openai_responses(api_key, base_url, payload)
    response_text = extract_openai_text(response_data)
    if not response_text:
        raise RuntimeError("OpenAI API 没有返回可解析文本。")
    try:
        result = json.loads(response_text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"OpenAI 返回内容不是合法 JSON：{exc}") from exc

    missing = [key for key in VASP_INPUT_JSON_SCHEMA["required"] if key not in result]
    if missing:
        raise RuntimeError(f"OpenAI 返回内容缺少字段：{', '.join(missing)}")
    return result


@dataclass
class AtomSite:
    element: str
    label: str
    x: float
    y: float
    z: float


@dataclass
class Lattice:
    a: float
    b: float
    c: float
    alpha: float
    beta: float
    gamma: float


@dataclass
class ParsedStructure:
    format: str
    title: str
    lattice: Lattice | None
    atoms: list[AtomSite]
    elements: list[tuple[str, int]]
    warnings: list[str]


def detect_format(content: str) -> str:
    text = content.strip()
    if not text:
        return "unknown"
    if re.search(r"(_cell_length_a|_atom_site_fract_x|data_)", text, re.I):
        return "cif"
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) >= 8 and all(len(parse_number_list(lines[index])) >= 3 for index in (2, 3, 4)):
        return "poscar"
    return "unknown"


def parse_structure(content: str) -> ParsedStructure:
    fmt = detect_format(content)
    if fmt == "cif":
        return parse_cif(content)
    if fmt == "poscar":
        return parse_poscar(content)
    return ParsedStructure("unknown", "未识别结构", None, [], [], ["请粘贴或读取 CIF/POSCAR 内容。"])


def parse_poscar(content: str) -> ParsedStructure:
    lines = [line.strip() for line in content.replace("\r", "").split("\n") if line.strip()]
    warnings: list[str] = []
    if len(lines) < 8:
        return ParsedStructure("poscar", "POSCAR", None, [], [], ["POSCAR 内容不足。"])

    title = lines[0]
    scale = parse_number(lines[1]) or 1.0
    vectors = [parse_number_list(lines[index])[:3] for index in (2, 3, 4)]
    lattice = vectors_to_lattice(vectors, scale)
    if lattice is None:
        warnings.append("晶格向量无法完整解析。")

    symbols_line = lines[5].split()
    counts_line = lines[6].split()
    symbols_are_elements = all(re.match(r"^[A-Z][a-z]?$", item) for item in symbols_line)
    symbols = symbols_line if symbols_are_elements else [f"X{index + 1}" for index in range(len(counts_line))]
    raw_counts = counts_line if symbols_are_elements else symbols_line
    counts = [int(item) for item in raw_counts if item.isdigit()]
    coord_start = find_coordinate_start(lines, 7 if symbols_are_elements else 6)

    atoms: list[AtomSite] = []
    atom_index = 0
    for symbol, count in zip(symbols, counts):
        for local_index in range(count):
            coords = parse_number_list(lines[coord_start + atom_index]) if coord_start + atom_index < len(lines) else []
            atoms.append(
                AtomSite(
                    element=symbol,
                    label=f"{symbol}{local_index + 1}",
                    x=coords[0] if len(coords) > 0 else 0.0,
                    y=coords[1] if len(coords) > 1 else 0.0,
                    z=coords[2] if len(coords) > 2 else 0.0,
                )
            )
            atom_index += 1

    if sum(counts) != len(atoms):
        warnings.append("原子数量和坐标行数量不一致。")

    return ParsedStructure("poscar", title, lattice, atoms, list(zip(symbols, counts)), warnings)


def parse_cif(content: str) -> ParsedStructure:
    lines = content.replace("\r", "").split("\n")
    warnings: list[str] = []
    data_line = next((line.strip() for line in lines if line.strip().lower().startswith("data_")), "")
    title = re.sub(r"^data_", "", data_line, flags=re.I) or "CIF"

    a = read_cif_number(lines, "_cell_length_a")
    b = read_cif_number(lines, "_cell_length_b")
    c = read_cif_number(lines, "_cell_length_c")
    alpha = read_cif_number(lines, "_cell_angle_alpha") or 90.0
    beta = read_cif_number(lines, "_cell_angle_beta") or 90.0
    gamma = read_cif_number(lines, "_cell_angle_gamma") or 90.0
    lattice = Lattice(a, b, c, alpha, beta, gamma) if a and b and c else None
    if lattice is None:
        warnings.append("CIF 晶胞参数不完整。")

    atoms = read_cif_atoms(lines)
    if not atoms:
        warnings.append("未找到 _atom_site_fract_x/y/z 原子坐标。")

    return ParsedStructure("cif", title, lattice, atoms, count_elements(atoms), warnings)


def read_cif_atoms(lines: list[str]) -> list[AtomSite]:
    for index, line in enumerate(lines):
        if line.strip().lower() != "loop_":
            continue
        headers: list[str] = []
        cursor = index + 1
        while cursor < len(lines) and lines[cursor].strip().startswith("_"):
            headers.append(lines[cursor].strip().lower())
            cursor += 1
        required = ("_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z")
        if not all(item in headers for item in required):
            continue

        x_index = headers.index("_atom_site_fract_x")
        y_index = headers.index("_atom_site_fract_y")
        z_index = headers.index("_atom_site_fract_z")
        type_index = headers.index("_atom_site_type_symbol") if "_atom_site_type_symbol" in headers else -1
        label_index = headers.index("_atom_site_label") if "_atom_site_label" in headers else -1

        atoms: list[AtomSite] = []
        while cursor < len(lines):
            row = lines[cursor].strip()
            if not row or row == "#" or row.startswith("_") or row.lower() == "loop_" or row.lower().startswith("data_"):
                break
            tokens = tokenize_cif_row(row)
            raw_element = tokens[type_index] if 0 <= type_index < len(tokens) else ""
            raw_label = tokens[label_index] if 0 <= label_index < len(tokens) else f"Atom{len(atoms) + 1}"
            atoms.append(
                AtomSite(
                    element=normalize_element(raw_element or raw_label),
                    label=raw_label,
                    x=parse_cif_value(tokens[x_index]) if x_index < len(tokens) else 0.0,
                    y=parse_cif_value(tokens[y_index]) if y_index < len(tokens) else 0.0,
                    z=parse_cif_value(tokens[z_index]) if z_index < len(tokens) else 0.0,
                )
            )
            cursor += 1
        return atoms
    return []


def export_poscar(content: str) -> tuple[str | None, list[str]]:
    parsed = parse_structure(content)
    if parsed.format == "unknown":
        return None, ["结构无法识别，不能生成 POSCAR。"]
    if parsed.format == "poscar":
        return content.strip() + "\n", parsed.warnings
    if not parsed.lattice or not parsed.atoms:
        return None, ["CIF 缺少晶胞或原子坐标，不能转换为 POSCAR。"] + parsed.warnings

    vectors = lattice_to_vectors(parsed.lattice)
    grouped: dict[str, list[AtomSite]] = {}
    for atom in parsed.atoms:
        grouped.setdefault(atom.element, []).append(atom)
    elements = list(grouped.keys())
    lines = [
        parsed.title or "converted-from-cif",
        "1.0",
        *[" ".join(format_number(value) for value in vector) for vector in vectors],
        " ".join(elements),
        " ".join(str(len(grouped[element])) for element in elements),
        "Direct",
    ]
    for element in elements:
        for atom in grouped[element]:
            lines.append(f"{format_number(atom.x)} {format_number(atom.y)} {format_number(atom.z)}")
    return "\n".join(lines) + "\n", parsed.warnings


def apply_structure_draft(content: str, instruction: str) -> tuple[str, str]:
    text = instruction.strip()
    if not content.strip():
        return content, "请先输入结构内容。"
    if not text:
        return content, "请先输入修改指令。"

    next_content = content
    notes: list[str] = []

    replace_match = re.search(r"(?:替换|replace)\s*([A-Z][a-z]?)\s*(?:为|to|with)\s*([A-Z][a-z]?)", text, re.I)
    if replace_match:
        source = normalize_element(replace_match.group(1))
        target = normalize_element(replace_match.group(2))
        next_content = re.sub(rf"\b{re.escape(source)}\b", target, next_content)
        next_content = re.sub(rf"\b{re.escape(source)}(?=[0-9_\-.])", target, next_content)
        notes.append(f"元素替换草案：{source} -> {target}")

    scale_match = re.search(r"(?:scale|缩放|放大|缩小|扩大)\D*([0-9]+(?:\.[0-9]+)?)\s*(%)?", text, re.I)
    if scale_match:
        value = float(scale_match.group(1))
        if scale_match.group(2) or any(word in text for word in ("放大", "缩小", "扩大")):
            factor = 1 - value / 100 if "缩小" in text else 1 + value / 100
        else:
            factor = value
        next_content = scale_lattice(next_content, factor)
        notes.append(f"晶胞缩放草案：倍率 {format_number(factor)}")

    vacuum_match = re.search(r"(?:vacuum|真空)\D*([0-9]+(?:\.[0-9]+)?)", text, re.I)
    if vacuum_match:
        amount = float(vacuum_match.group(1))
        next_content = add_vacuum_c(next_content, amount)
        notes.append(f"c 方向真空层草案：增加 {format_number(amount)} A")

    if not notes:
        notes.append("当前草案支持：替换 Si 为 Ge、放大 2%、缩小 1%、scale 1.02、增加真空 15。")

    return next_content, "；".join(notes)


def recommend_parameters(parsed: ParsedStructure, template_name: str) -> str:
    notes = [f"模板：{template_name}", VASP_TEMPLATES[template_name]["description"]]
    if parsed.format == "cif":
        notes.append("当前结构来自 CIF，生成输入时会尝试转换为 POSCAR；提交前建议用 VESTA 检查转换结果。")
    if parsed.lattice and min(parsed.lattice.a, parsed.lattice.b, parsed.lattice.c) < 4.0:
        notes.append("晶胞长度较小，k 点密度可能需要高于默认值。")
    if any(symbol in {"Fe", "Co", "Ni", "Mn", "Cr"} for symbol, _ in parsed.elements):
        notes.append("检测到常见磁性元素，建议人工确认 ISPIN、MAGMOM、LDAU 设置。")
    if template_name == "Band":
        notes.append("能带模板的 KPOINTS 是占位路径，必须按晶体结构手动设置高对称路径。")
    if template_name == "DOS":
        notes.append("DOS 计算建议先完成 Static SCF 并保留 CHGCAR。")
    notes.append("POTCAR 不能自动拼接，程序只生成 POTCAR.required.txt。")
    return "\n".join(f"- {item}" for item in notes)


def scale_lattice(content: str, factor: float) -> str:
    if factor <= 0:
        return content
    fmt = detect_format(content)
    if fmt == "cif":
        return re.sub(
            r"^(\s*_cell_length_[abc]\s+)([-+]?\d*\.?\d+(?:\([^)]+\))?)",
            lambda match: f"{match.group(1)}{format_number(parse_cif_value(match.group(2)) * factor)}",
            content,
            flags=re.I | re.M,
        )
    if fmt == "poscar":
        lines = content.replace("\r", "").split("\n")
        if len(lines) > 1:
            lines[1] = format_number((parse_number(lines[1]) or 1.0) * factor)
        return "\n".join(lines)
    return content


def add_vacuum_c(content: str, amount: float) -> str:
    fmt = detect_format(content)
    if fmt == "cif":
        return re.sub(
            r"^(\s*_cell_length_c\s+)([-+]?\d*\.?\d+(?:\([^)]+\))?)",
            lambda match: f"{match.group(1)}{format_number(parse_cif_value(match.group(2)) + amount)}",
            content,
            count=1,
            flags=re.I | re.M,
        )
    if fmt == "poscar":
        lines = content.replace("\r", "").split("\n")
        if len(lines) > 4:
            vector = parse_number_list(lines[4])
            if len(vector) >= 3:
                vector[2] += amount
                lines[4] = " ".join(format_number(value) for value in vector[:3])
        return "\n".join(lines)
    return content


def parse_oszicar(path: Path) -> list[str]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "F=" in line or "E0=" in line:
            rows.append(line.strip())
    return rows[-20:]


def parse_outcar(path: Path) -> list[str]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if "free  energy   TOTEN" in line or "reached required accuracy" in line or "Voluntary context switches" in line:
            rows.append(line.strip())
    return rows[-30:]


def count_elements(atoms: list[AtomSite]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for atom in atoms:
        counts[atom.element] = counts.get(atom.element, 0) + 1
    return list(counts.items())


def read_cif_number(lines: list[str], key: str) -> float | None:
    for line in lines:
        parts = line.strip().split()
        if len(parts) >= 2 and parts[0].lower() == key.lower():
            value = parse_cif_value(parts[1])
            return value if value > 0 else None
    return None


def tokenize_cif_row(row: str) -> list[str]:
    tokens: list[str] = []
    pattern = re.compile(r"'([^']*)'|\"([^\"]*)\"|(\S+)")
    for match in pattern.finditer(row):
        tokens.append(match.group(1) or match.group(2) or match.group(3))
    return tokens


def normalize_element(value: str) -> str:
    match = re.search(r"[A-Z][a-z]?", str(value), re.I)
    if not match:
        return "X"
    item = match.group(0)
    return item[0].upper() + item[1:].lower()


def parse_number(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def parse_number_list(line: str) -> list[float]:
    values: list[float] = []
    for item in line.split():
        value = parse_number(item)
        if value is not None:
            values.append(value)
    return values


def parse_cif_value(value: str) -> float:
    cleaned = re.sub(r"\([^)]+\)", "", value)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def find_coordinate_start(lines: list[str], start: int) -> int:
    cursor = start
    if cursor < len(lines) and lines[cursor].lower().startswith("s"):
        cursor += 1
    if cursor < len(lines) and (lines[cursor].lower().startswith("d") or lines[cursor].lower().startswith("c")):
        cursor += 1
    return cursor


def vectors_to_lattice(vectors: list[list[float]], scale: float) -> Lattice | None:
    if len(vectors) < 3 or any(len(vector) < 3 for vector in vectors):
        return None
    a_vec, b_vec, c_vec = [[value * scale for value in vector[:3]] for vector in vectors]
    return Lattice(
        vector_length(a_vec),
        vector_length(b_vec),
        vector_length(c_vec),
        angle_between(b_vec, c_vec),
        angle_between(a_vec, c_vec),
        angle_between(a_vec, b_vec),
    )


def lattice_to_vectors(lattice: Lattice) -> list[list[float]]:
    alpha = math.radians(lattice.alpha)
    beta = math.radians(lattice.beta)
    gamma = math.radians(lattice.gamma)
    ax, ay, az = lattice.a, 0.0, 0.0
    bx, by, bz = lattice.b * math.cos(gamma), lattice.b * math.sin(gamma), 0.0
    cx = lattice.c * math.cos(beta)
    cy = lattice.c * (math.cos(alpha) - math.cos(beta) * math.cos(gamma)) / max(math.sin(gamma), 1e-12)
    cz = math.sqrt(max(lattice.c * lattice.c - cx * cx - cy * cy, 0.0))
    return [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]


def vector_length(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def angle_between(left: list[float], right: list[float]) -> float:
    length = vector_length(left) * vector_length(right)
    if not length:
        return 90.0
    dot = sum(left[index] * right[index] for index in range(3))
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / length))))


def format_number(value: float) -> str:
    if abs(value - round(value)) < 1e-12:
        return str(int(round(value)))
    return f"{value:.8f}".rstrip("0").rstrip(".")


class DFTAutomationWorkbench(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1320x820")
        self.minsize(1080, 680)

        self.project_name = tk.StringVar(value="dft_project")
        self.project_dir = tk.StringVar(value=str(Path.cwd() / "dft_runs"))
        self.vesta_path = tk.StringVar(value=self.find_default_vesta_path())
        self.vasp_command = tk.StringVar(value="vasp_std")
        self.template_name = tk.StringVar(value="Relax")
        self.status = tk.StringVar(value="准备就绪。")
        self.summary = tk.StringVar()
        self.material_input = tk.StringVar(value="Si")
        self.openai_api_key = tk.StringVar(value=os.environ.get("OPENAI_API_KEY", ""))
        self.openai_base_url = tk.StringVar(value=DEFAULT_OPENAI_BASE_URL)
        self.openai_model = tk.StringVar(value=DEFAULT_OPENAI_MODEL)
        self.uploaded_material_path = tk.StringVar(value="未上传文件")
        self.backend_base_url = tk.StringVar(value=os.environ.get("BACKEND_BASE_URL", "http://127.0.0.1:8000"))
        self.backend_api_token = tk.StringVar(value=os.environ.get("BACKEND_API_TOKEN", ""))
        self.backend_health_path = tk.StringVar(value=os.environ.get("BACKEND_HEALTH_PATH", "/health"))
        self.uploaded_material_content = ""
        self.uploaded_material_name = ""
        self.ai_potcar_required: list[str] = []
        self.last_ai_model = ""
        self.current_run_dir: Path | None = None
        self.process: subprocess.Popen[str] | None = None

        self.structure_checked = tk.BooleanVar(value=False)
        self.parameters_checked = tk.BooleanVar(value=False)
        self.potcar_checked = tk.BooleanVar(value=False)
        self.execution_checked = tk.BooleanVar(value=False)

        self.create_widgets()
        self.structure_text.insert("1.0", SAMPLE_POSCAR)
        self.load_template()
        self.refresh_summary()

    def create_widgets(self) -> None:
        root = ttk.Frame(self, padding=12)
        root.pack(fill=tk.BOTH, expand=True)

        project_bar = ttk.LabelFrame(root, text="项目")
        project_bar.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(project_bar, text="名称").pack(side=tk.LEFT, padx=(8, 4))
        ttk.Entry(project_bar, textvariable=self.project_name, width=24).pack(side=tk.LEFT)
        ttk.Label(project_bar, text="目录").pack(side=tk.LEFT, padx=(12, 4))
        ttk.Entry(project_bar, textvariable=self.project_dir).pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(project_bar, text="选择目录", command=self.choose_project_dir).pack(side=tk.LEFT, padx=6)
        ttk.Button(project_bar, text="打开目录", command=self.open_project_dir).pack(side=tk.LEFT, padx=(0, 8))

        self.notebook = ttk.Notebook(root)
        self.notebook.pack(fill=tk.BOTH, expand=True)

        self.create_ai_generation_tab(self.notebook)
        self.create_structure_tab(self.notebook)
        self.create_workflow_tab(self.notebook)
        self.create_backend_connection_tab(self.notebook)
        self.create_execution_tab(self.notebook)
        self.create_results_tab(self.notebook)
        self.notebook.bind("<<NotebookTabChanged>>", self.handle_tab_changed)

        ttk.Label(root, textvariable=self.status, foreground="#0a4750").pack(fill=tk.X, pady=(8, 0))

    def create_ai_generation_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="1 AI 生成任务")

        top = ttk.LabelFrame(tab, text="用户输入")
        top.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(top, text="OpenAI API Key").grid(row=0, column=0, sticky=tk.W, padx=8, pady=(8, 4))
        ttk.Entry(top, textvariable=self.openai_api_key, show="*", width=34).grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=(8, 4))
        ttk.Label(top, text="模型").grid(row=0, column=2, sticky=tk.W, padx=(0, 4), pady=(8, 4))
        ttk.Entry(top, textvariable=self.openai_model, width=18).grid(row=0, column=3, sticky=tk.W, padx=(0, 8), pady=(8, 4))
        ttk.Button(top, text="测试连接", command=self.test_openai_connection).grid(row=0, column=4, sticky=tk.W, padx=(0, 8), pady=(8, 4))

        ttk.Label(top, text="API Base URL").grid(row=1, column=0, sticky=tk.W, padx=8, pady=4)
        ttk.Entry(top, textvariable=self.openai_base_url).grid(row=1, column=1, columnspan=4, sticky="ew", padx=(0, 8), pady=4)

        ttk.Label(top, text="材料描述").grid(row=2, column=0, sticky=tk.W, padx=8, pady=4)
        ttk.Entry(top, textvariable=self.material_input, width=28).grid(row=2, column=1, sticky="ew", padx=(0, 8), pady=4)
        ttk.Button(top, text="上传材料/结构文件", command=self.choose_ai_material_file).grid(row=2, column=2, columnspan=2, sticky=tk.W, padx=(0, 8), pady=4)
        ttk.Label(top, textvariable=self.uploaded_material_path, foreground="#5d6976").grid(row=2, column=4, sticky="ew", padx=(0, 8), pady=4)

        ttk.Label(top, text="要求").grid(row=3, column=0, sticky=tk.NW, padx=8, pady=(4, 8))
        self.ai_requirement_text = tk.Text(top, height=5, wrap=tk.WORD, font=("Microsoft YaHei UI", 10))
        self.ai_requirement_text.grid(row=3, column=1, columnspan=4, sticky="ew", padx=(0, 8), pady=(4, 8))
        self.ai_requirement_text.insert("1.0", "生成用于几何优化的 POSCAR、INCAR、KPOINTS，并列出 POTCAR 所需元素顺序。")
        ttk.Button(top, text="连接 OpenAI 生成输入文件", command=self.generate_initial_ai_task).grid(
            row=4, column=1, padx=(0, 8), pady=(0, 8), sticky=tk.W
        )
        ttk.Button(top, text="载入到后续步骤", command=self.apply_ai_generation_to_workflow).grid(
            row=4, column=2, padx=(0, 8), pady=(0, 8), sticky=tk.W
        )
        top.columnconfigure(1, weight=1)
        top.columnconfigure(4, weight=1)

        pane = ttk.PanedWindow(tab, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True)

        generated_structure_frame = ttk.LabelFrame(pane, text="AI 生成的结构草案")
        self.ai_structure_text = self.create_text_editor(generated_structure_frame, height=20)
        pane.add(generated_structure_frame, weight=2)

        generated_notes_frame = ttk.LabelFrame(pane, text="AI 生成说明和后续人工检查")
        self.ai_generation_notes = self.create_text_editor(generated_notes_frame, height=20)
        pane.add(generated_notes_frame, weight=1)

    def create_structure_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="2 结构与 VESTA")

        toolbar = ttk.Frame(tab)
        toolbar.pack(fill=tk.X, pady=(0, 8))
        ttk.Button(toolbar, text="读取 CIF/POSCAR", command=self.load_structure_file).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="保存结构文本", command=self.save_structure_file).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="示例 POSCAR", command=self.load_sample).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="选择 VESTA.exe", command=self.choose_vesta).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="用 VESTA 打开", command=self.open_with_vesta).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(toolbar, text="刷新摘要", command=self.refresh_summary).pack(side=tk.LEFT, padx=(8, 0))

        pane = ttk.PanedWindow(tab, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True)

        editor_frame = ttk.Frame(pane)
        self.structure_text = self.create_text_editor(editor_frame, height=24)
        pane.add(editor_frame, weight=3)

        right = ttk.Frame(pane, padding=(12, 0, 0, 0))
        ttk.Label(right, text="结构摘要", font=("Microsoft YaHei UI", 12, "bold")).pack(anchor=tk.W)
        ttk.Label(right, textvariable=self.summary, justify=tk.LEFT, wraplength=390).pack(fill=tk.X, pady=(8, 12))
        ttk.Label(right, text="VESTA 路径").pack(anchor=tk.W)
        ttk.Entry(right, textvariable=self.vesta_path).pack(fill=tk.X, pady=(4, 12))
        ttk.Label(
            right,
            text="说明：VESTA 是本地桌面程序，会作为独立窗口打开，不能嵌入本应用内部。",
            foreground="#5d6976",
            wraplength=390,
        ).pack(anchor=tk.W)
        ttk.Separator(right).pack(fill=tk.X, pady=12)
        ttk.Checkbutton(
            right,
            text="结构已经检查，并确认 POSCAR/CIF 转换合理",
            variable=self.structure_checked,
            command=self.refresh_backend_preflight_if_ready,
        ).pack(anchor=tk.W)
        pane.add(right, weight=1)

    def create_workflow_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="3 模板与输入文件")

        toolbar = ttk.Frame(tab)
        toolbar.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(toolbar, text="计算模板").pack(side=tk.LEFT)
        combo = ttk.Combobox(toolbar, textvariable=self.template_name, values=list(VASP_TEMPLATES), state="readonly", width=18)
        combo.pack(side=tk.LEFT, padx=(6, 8))
        combo.bind("<<ComboboxSelected>>", lambda _event: self.load_template())
        ttk.Button(toolbar, text="载入模板", command=self.load_template).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="生成 VASP 输入目录", command=self.prepare_inputs).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Checkbutton(
            toolbar,
            text="INCAR/KPOINTS 已检查",
            variable=self.parameters_checked,
            command=self.refresh_backend_preflight_if_ready,
        ).pack(side=tk.LEFT, padx=(16, 0))
        ttk.Checkbutton(
            toolbar,
            text="POTCAR 顺序已确认",
            variable=self.potcar_checked,
            command=self.refresh_backend_preflight_if_ready,
        ).pack(side=tk.LEFT, padx=(8, 0))

        pane = ttk.PanedWindow(tab, orient=tk.HORIZONTAL)
        pane.pack(fill=tk.BOTH, expand=True)

        incar_frame = ttk.LabelFrame(pane, text="INCAR")
        self.incar_text = self.create_text_editor(incar_frame, height=22)
        pane.add(incar_frame, weight=1)

        kpoints_frame = ttk.LabelFrame(pane, text="KPOINTS")
        self.kpoints_text = self.create_text_editor(kpoints_frame, height=22)
        pane.add(kpoints_frame, weight=1)

        notes_frame = ttk.LabelFrame(pane, text="模板说明 / POTCAR")
        self.workflow_notes = self.create_text_editor(notes_frame, height=22)
        pane.add(notes_frame, weight=1)

    def create_backend_connection_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="4 后端连接")

        self.backend_tab = tab
        preflight = ttk.LabelFrame(tab, text="前置流程自动检查")
        preflight.pack(fill=tk.BOTH, expand=True, pady=(0, 8))
        self.backend_preflight_text = self.create_text_editor(preflight, height=12)

        settings = ttk.LabelFrame(tab, text="后端连接设置")
        settings.pack(fill=tk.X)
        ttk.Label(settings, text="后端地址").grid(row=0, column=0, sticky=tk.W, padx=8, pady=(8, 4))
        ttk.Entry(settings, textvariable=self.backend_base_url).grid(row=0, column=1, sticky="ew", padx=(0, 8), pady=(8, 4))
        ttk.Label(settings, text="健康检查路径").grid(row=1, column=0, sticky=tk.W, padx=8, pady=4)
        ttk.Entry(settings, textvariable=self.backend_health_path, width=18).grid(row=1, column=1, sticky=tk.W, padx=(0, 8), pady=4)
        ttk.Label(settings, text="Token").grid(row=2, column=0, sticky=tk.W, padx=8, pady=4)
        ttk.Entry(settings, textvariable=self.backend_api_token, show="*").grid(row=2, column=1, sticky="ew", padx=(0, 8), pady=4)
        ttk.Button(settings, text="重新检查流程", command=self.refresh_backend_preflight).grid(row=3, column=0, padx=8, pady=(4, 8), sticky=tk.W)
        ttk.Button(settings, text="测试后端连接", command=self.test_backend_connection).grid(row=3, column=1, padx=(0, 8), pady=(4, 8), sticky=tk.W)
        settings.columnconfigure(1, weight=1)

    def create_execution_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="5 执行与日志")

        command_bar = ttk.LabelFrame(tab, text="执行设置")
        command_bar.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(command_bar, text="VASP 命令").pack(side=tk.LEFT, padx=(8, 4))
        ttk.Entry(command_bar, textvariable=self.vasp_command, width=36).pack(side=tk.LEFT)
        ttk.Button(command_bar, text="Dry Run", command=self.dry_run).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(command_bar, text="开始执行", command=self.start_execution).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(command_bar, text="停止", command=self.stop_execution).pack(side=tk.LEFT, padx=(8, 8))
        ttk.Checkbutton(
            command_bar,
            text="运行目录、队列/命令和资源已确认",
            variable=self.execution_checked,
        ).pack(side=tk.LEFT, padx=(8, 8))

        log_frame = ttk.LabelFrame(tab, text="运行日志")
        log_frame.pack(fill=tk.BOTH, expand=True)
        self.log_text = self.create_text_editor(log_frame, height=24)

    def create_results_tab(self, notebook: ttk.Notebook) -> None:
        tab = ttk.Frame(notebook, padding=8)
        notebook.add(tab, text="6 结果解析")

        toolbar = ttk.Frame(tab)
        toolbar.pack(fill=tk.X, pady=(0, 8))
        ttk.Button(toolbar, text="解析当前运行目录", command=self.parse_current_results).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="选择目录解析", command=self.choose_results_dir).pack(side=tk.LEFT, padx=(8, 0))

        results_frame = ttk.LabelFrame(tab, text="OSZICAR / OUTCAR 摘要")
        results_frame.pack(fill=tk.BOTH, expand=True)
        self.results_text = self.create_text_editor(results_frame, height=24)

    def create_text_editor(self, parent: ttk.Frame, height: int) -> tk.Text:
        text = tk.Text(parent, wrap=tk.NONE, undo=True, height=height, font=("Consolas", 10))
        y_scroll = ttk.Scrollbar(parent, orient=tk.VERTICAL, command=text.yview)
        x_scroll = ttk.Scrollbar(parent, orient=tk.HORIZONTAL, command=text.xview)
        text.configure(yscrollcommand=y_scroll.set, xscrollcommand=x_scroll.set)
        text.grid(row=0, column=0, sticky="nsew")
        y_scroll.grid(row=0, column=1, sticky="ns")
        x_scroll.grid(row=1, column=0, sticky="ew")
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(0, weight=1)
        return text

    def handle_tab_changed(self, _event: tk.Event) -> None:
        selected = self.notebook.select()
        if selected and hasattr(self, "backend_tab") and selected == str(self.backend_tab):
            self.refresh_backend_preflight()

    def refresh_backend_preflight_if_ready(self) -> None:
        if hasattr(self, "backend_preflight_text"):
            self.refresh_backend_preflight()

    def collect_preflight_items(self) -> list[tuple[str, bool, str]]:
        structure = parse_structure(self.get_structure_content())
        has_material_source = bool(self.material_input.get().strip() or self.uploaded_material_content)
        has_valid_structure = structure.format != "unknown" and bool(structure.atoms)
        has_generated_structure = (
            bool(self.ai_structure_text.get("1.0", tk.END).strip()) if hasattr(self, "ai_structure_text") else False
        ) or has_valid_structure
        has_incar = bool(self.incar_text.get("1.0", tk.END).strip()) if hasattr(self, "incar_text") else False
        has_kpoints = bool(self.kpoints_text.get("1.0", tk.END).strip()) if hasattr(self, "kpoints_text") else False
        has_project = bool(self.project_name.get().strip() and self.project_dir.get().strip())

        return [
            ("第 1 步材料来源", has_material_source, "已输入材料描述或上传本地材料/结构文件"),
            ("第 1 步结构草案", has_generated_structure, "已生成 AI 草案或载入本地结构"),
            ("第 2 步结构解析", has_valid_structure, f"当前结构格式：{structure.format.upper()}，原子数：{len(structure.atoms)}"),
            ("第 2 步人工确认", self.structure_checked.get(), "结构已经检查，并确认 POSCAR/CIF 转换合理"),
            ("第 3 步 INCAR", has_incar, "INCAR 内容非空"),
            ("第 3 步 KPOINTS", has_kpoints, "KPOINTS 内容非空"),
            ("第 3 步参数确认", self.parameters_checked.get(), "INCAR/KPOINTS 参数已经检查"),
            ("第 3 步 POTCAR 顺序确认", self.potcar_checked.get(), "POTCAR 元素顺序已经确认"),
            ("项目设置", has_project, "项目名称和目录已填写"),
        ]

    def previous_workflow_complete(self) -> bool:
        return all(ok for _name, ok, _detail in self.collect_preflight_items())

    def refresh_backend_preflight(self) -> bool:
        items = self.collect_preflight_items()
        rows = ["进入后端连接前的流程检查", ""]
        for name, ok, detail in items:
            rows.append(f"{'OK' if ok else 'MISSING'}  {name} - {detail}")
        rows.extend(
            [
                "",
                "结论：前置流程已完整，可以配置或测试后端连接。"
                if all(ok for _name, ok, _detail in items)
                else "结论：前置流程尚未完整，请先回到对应步骤补齐或勾选确认项。",
            ]
        )
        self.replace_text(self.backend_preflight_text, "\n".join(rows))
        self.status.set("后端连接页已自动检查前置流程。")
        return all(ok for _name, ok, _detail in items)

    def build_backend_health_url(self) -> str:
        base_url = self.backend_base_url.get().strip().rstrip("/")
        if not base_url:
            return ""
        health_path = self.backend_health_path.get().strip() or "/health"
        if not health_path.startswith("/"):
            health_path = "/" + health_path
        return urllib.parse.urljoin(base_url + "/", health_path.lstrip("/"))

    def test_backend_connection(self) -> None:
        if not self.refresh_backend_preflight():
            proceed = messagebox.askyesno("前置流程未完整", "前面的流程尚未完整。是否仍然测试后端连接？")
            if not proceed:
                return
        url = self.build_backend_health_url()
        if not url:
            messagebox.showwarning("缺少后端地址", "请填写后端地址。")
            return
        self.status.set("正在测试后端连接...")
        thread = threading.Thread(target=self.run_backend_connection_test, args=(url,), daemon=True)
        thread.start()

    def run_backend_connection_test(self, url: str) -> None:
        headers = {"User-Agent": "dft-automation-workbench/1.0"}
        token = self.backend_api_token.get().strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, method="GET", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = response.read(4000).decode("utf-8", errors="replace")
                self.after(0, self.handle_backend_connection_success, response.status, body)
        except urllib.error.HTTPError as exc:
            detail = exc.read(4000).decode("utf-8", errors="replace")
            self.after(0, self.handle_backend_connection_error, f"HTTP {exc.code}: {detail or exc.reason}")
        except urllib.error.URLError as exc:
            self.after(0, self.handle_backend_connection_error, str(exc.reason))
        except Exception as exc:
            self.after(0, self.handle_backend_connection_error, str(exc))

    def handle_backend_connection_success(self, status_code: int, body: str) -> None:
        rows = self.backend_preflight_text.get("1.0", tk.END).rstrip().splitlines()
        rows.extend(["", f"后端连接成功：HTTP {status_code}", body[:1000] if body else "(空响应)"])
        self.replace_text(self.backend_preflight_text, "\n".join(rows))
        self.status.set("后端连接测试成功。")

    def handle_backend_connection_error(self, message: str) -> None:
        rows = self.backend_preflight_text.get("1.0", tk.END).rstrip().splitlines()
        rows.extend(["", f"后端连接失败：{message}"])
        self.replace_text(self.backend_preflight_text, "\n".join(rows))
        self.status.set("后端连接测试失败。")

    def choose_ai_material_file(self) -> None:
        path = filedialog.askopenfilename(
            title="上传材料/结构文件",
            filetypes=[
                ("Structure and text files", "*.cif *.vasp *.poscar *.txt POSCAR* CONTCAR*"),
                ("All files", "*.*"),
            ],
        )
        if not path:
            return
        file_path = Path(path)
        try:
            content = file_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            messagebox.showerror("读取文件失败", str(exc))
            return

        self.uploaded_material_content = content
        self.uploaded_material_name = file_path.name
        self.uploaded_material_path.set(f"{file_path.name} ({len(content)} 字符)")
        if not self.material_input.get().strip():
            self.material_input.set(file_path.stem)

        preview = content[:2000]
        if len(content) > len(preview):
            preview += "\n\n..."
        self.replace_text(
            self.ai_generation_notes,
            f"已上传本地文件：{file_path}\n\n文件预览：\n{preview}",
        )
        self.status.set(f"已上传材料/结构文件：{file_path.name}")

    def get_openai_settings(self) -> tuple[str, str, str] | None:
        api_key = self.openai_api_key.get().strip()
        base_url = self.openai_base_url.get().strip() or DEFAULT_OPENAI_BASE_URL
        model = self.openai_model.get().strip() or DEFAULT_OPENAI_MODEL
        if not api_key:
            messagebox.showwarning("缺少 OpenAI API Key", "请填写 OpenAI API Key，或设置环境变量 OPENAI_API_KEY。")
            return None
        return api_key, base_url, model

    def test_openai_connection(self) -> None:
        settings = self.get_openai_settings()
        if not settings:
            return
        api_key, base_url, model = settings
        self.status.set("正在测试 OpenAI 连接...")
        thread = threading.Thread(target=self.run_openai_connection_test, args=(api_key, base_url, model), daemon=True)
        thread.start()

    def run_openai_connection_test(self, api_key: str, base_url: str, model: str) -> None:
        payload: dict[str, object] = {
            "model": model,
            "instructions": "You are a connection test. Return the exact text OK.",
            "input": "Return OK.",
            "max_output_tokens": 20,
        }
        try:
            response_data = call_openai_responses(api_key, base_url, payload, timeout=30)
            text = extract_openai_text(response_data)
            if not text:
                raise RuntimeError("连接成功，但没有返回文本。")
            self.after(0, self.handle_openai_connection_success, model)
        except Exception as exc:
            self.after(0, self.handle_openai_error, str(exc))

    def handle_openai_connection_success(self, model: str) -> None:
        self.status.set(f"OpenAI 连接成功：{model}")
        messagebox.showinfo("OpenAI 连接成功", f"已成功连接模型：{model}")

    def handle_openai_error(self, message: str) -> None:
        self.status.set("OpenAI 请求失败。")
        messagebox.showerror("OpenAI 请求失败", message)

    def run_openai_generation_thread(
        self,
        api_key: str,
        base_url: str,
        model: str,
        material: str,
        requirements: str,
        uploaded_name: str,
        uploaded_content: str,
    ) -> None:
        try:
            result = request_openai_vasp_inputs(
                api_key,
                base_url,
                model,
                material,
                requirements,
                uploaded_name,
                uploaded_content,
            )
            self.after(0, self.apply_openai_generation_result, result, material, requirements, uploaded_name, model)
        except Exception as exc:
            self.after(0, self.handle_openai_error, str(exc))

    def apply_openai_generation_result(
        self,
        result: dict[str, object],
        material: str,
        requirements: str,
        uploaded_name: str,
        model: str,
    ) -> None:
        template_name = str(result.get("template") or infer_template_from_requirements(requirements))
        if template_name not in VASP_TEMPLATES:
            template_name = infer_template_from_requirements(requirements)

        poscar = str(result.get("poscar", "")).strip() + "\n"
        incar = str(result.get("incar", "")).strip() + "\n"
        kpoints = str(result.get("kpoints", "")).strip() + "\n"
        notes = [str(item) for item in result.get("notes", []) if str(item).strip()]
        warnings = [str(item) for item in result.get("warnings", []) if str(item).strip()]
        potcar_required = [str(item) for item in result.get("potcar_required", []) if str(item).strip()]

        parsed = parse_structure(poscar)
        warnings.extend(parsed.warnings)
        if parsed.format == "unknown":
            warnings.append("OpenAI 返回的 POSCAR 未能被本程序解析，请在继续前人工检查。")

        potcar_text = "\n".join(f"- {item}" for item in potcar_required) or "- 请按 POSCAR 元素顺序准备 POTCAR"
        notes_text = "\n".join(f"- {item}" for item in notes) or "- OpenAI 未返回额外说明。"
        warnings_text = "\n".join(f"- {item}" for item in warnings) or "- 无"
        source_text = uploaded_name or "未上传文件，使用材料描述直接生成"
        generation_notes = [
            "OpenAI 生成 VASP 输入文件草案",
            f"模型：{model}",
            f"材料描述：{material or '-'}",
            f"输入来源：{source_text}",
            f"用户要求：{requirements or '-'}",
            f"推荐模板：{template_name}",
            "",
            "POTCAR 所需顺序：",
            potcar_text,
            "",
            "说明：",
            notes_text,
            "",
            "警告：",
            warnings_text,
            "",
            "下一步：请检查 POSCAR 结构、INCAR/KPOINTS 参数，并手动准备 POTCAR。",
        ]

        self.ai_potcar_required = potcar_required
        self.last_ai_model = model
        self.template_name.set(template_name)
        self.replace_text(self.ai_structure_text, poscar)
        self.replace_text(self.ai_generation_notes, "\n".join(generation_notes))
        self.replace_text(self.incar_text, incar)
        self.replace_text(self.kpoints_text, kpoints)
        self.replace_text(self.workflow_notes, "\n".join(generation_notes))
        self.set_structure_content(poscar)
        self.status.set("OpenAI 已生成 POSCAR、INCAR、KPOINTS 和 POTCAR 顺序草案。")

    def get_structure_content(self) -> str:
        return self.structure_text.get("1.0", tk.END).rstrip()

    def set_structure_content(self, content: str) -> None:
        self.structure_text.delete("1.0", tk.END)
        self.structure_text.insert("1.0", content)
        self.refresh_summary()

    def get_ai_requirements(self) -> str:
        return self.ai_requirement_text.get("1.0", tk.END).strip()

    def generate_initial_ai_task(self) -> None:
        material = self.material_input.get().strip()
        requirements = self.get_ai_requirements()
        if not material and not self.uploaded_material_content:
            messagebox.showwarning("缺少材料", "请先输入材料描述，或上传 CIF/POSCAR/文本文件。")
            return
        settings = self.get_openai_settings()
        if not settings:
            return
        api_key, base_url, model = settings
        self.status.set("正在调用 OpenAI 生成 VASP 输入文件...")
        thread = threading.Thread(
            target=self.run_openai_generation_thread,
            args=(
                api_key,
                base_url,
                model,
                material,
                requirements,
                self.uploaded_material_name,
                self.uploaded_material_content,
            ),
            daemon=True,
        )
        thread.start()

    def apply_ai_generation_to_workflow(self) -> None:
        generated_structure = self.ai_structure_text.get("1.0", tk.END).strip()
        if not generated_structure:
            self.generate_initial_ai_task()
            return
        requirements = self.get_ai_requirements()
        template_name = self.template_name.get() if self.template_name.get() in VASP_TEMPLATES else infer_template_from_requirements(requirements)
        template = VASP_TEMPLATES[template_name]
        material = self.material_input.get().strip()

        self.template_name.set(template_name)
        self.set_structure_content(generated_structure)
        if not self.incar_text.get("1.0", tk.END).strip():
            self.replace_text(self.incar_text, tune_incar_for_requirements(template["incar"], material, requirements))
        if not self.kpoints_text.get("1.0", tk.END).strip():
            self.replace_text(self.kpoints_text, template["kpoints"])
        if not self.workflow_notes.get("1.0", tk.END).strip():
            self.replace_text(
                self.workflow_notes,
                "\n".join([template["description"], "", recommend_parameters(parse_structure(generated_structure), template_name)]),
            )
        self.status.set("AI 生成草案已载入后续人工调整步骤。")

    def load_template(self) -> None:
        template = VASP_TEMPLATES[self.template_name.get()]
        self.replace_text(self.incar_text, template["incar"])
        self.replace_text(self.kpoints_text, template["kpoints"])
        parsed = parse_structure(self.get_structure_content())
        notes = [
            template["description"],
            "",
            "POTCAR 说明：",
            "本程序不会自动拼接 POTCAR，因为 POTCAR 受 VASP 授权限制。",
            "生成输入目录时会写出 POTCAR.required.txt，用户需按元素顺序自行准备 POTCAR。",
            "",
            recommend_parameters(parsed, self.template_name.get()),
        ]
        self.replace_text(self.workflow_notes, "\n".join(notes))
        self.status.set(f"已载入模板：{self.template_name.get()}")

    def refresh_summary(self) -> None:
        parsed = parse_structure(self.get_structure_content())
        element_text = " ".join(f"{symbol}{count}" for symbol, count in parsed.elements) or "-"
        lattice_text = "未解析到完整晶胞"
        if parsed.lattice:
            lattice_text = (
                f"a={parsed.lattice.a:.4f}, b={parsed.lattice.b:.4f}, c={parsed.lattice.c:.4f}\n"
                f"alpha={parsed.lattice.alpha:.2f}, beta={parsed.lattice.beta:.2f}, gamma={parsed.lattice.gamma:.2f}"
            )
        warning_text = "\n".join(f"- {warning}" for warning in parsed.warnings) or "无"
        self.summary.set(
            f"标题：{parsed.title}\n"
            f"格式：{parsed.format.upper()}\n"
            f"元素：{element_text}\n"
            f"原子数：{len(parsed.atoms)}\n"
            f"晶胞：{lattice_text}\n"
            f"提示：\n{warning_text}"
        )
        self.status.set("结构摘要已更新。")

    def load_structure_file(self) -> None:
        path = filedialog.askopenfilename(
            title="选择 CIF 或 POSCAR",
            filetypes=[("Structure files", "*.cif *.vasp *.poscar POSCAR*"), ("All files", "*.*")],
        )
        if not path:
            return
        self.set_structure_content(Path(path).read_text(encoding="utf-8", errors="replace"))
        self.status.set(f"已读取：{path}")

    def save_structure_file(self) -> None:
        parsed = parse_structure(self.get_structure_content())
        default_name = "structure.cif" if parsed.format == "cif" else "POSCAR.vasp"
        path = filedialog.asksaveasfilename(title="保存结构", initialfile=default_name)
        if not path:
            return
        Path(path).write_text(self.get_structure_content(), encoding="utf-8")
        self.status.set(f"已保存：{path}")

    def load_sample(self) -> None:
        self.set_structure_content(SAMPLE_POSCAR)
        self.status.set("已载入示例 POSCAR。")

    def choose_project_dir(self) -> None:
        path = filedialog.askdirectory(title="选择项目目录")
        if path:
            self.project_dir.set(path)

    def open_project_dir(self) -> None:
        path = Path(self.project_dir.get())
        path.mkdir(parents=True, exist_ok=True)
        os.startfile(path)

    def choose_vesta(self) -> None:
        path = filedialog.askopenfilename(title="选择 VESTA.exe", filetypes=[("VESTA executable", "VESTA.exe"), ("EXE", "*.exe")])
        if path:
            self.vesta_path.set(path)
            self.status.set(f"已选择 VESTA：{path}")

    def open_with_vesta(self) -> None:
        content = self.get_structure_content()
        parsed = parse_structure(content)
        if parsed.format == "unknown":
            messagebox.showwarning("无法打开", "请先输入有效的 CIF 或 POSCAR 内容。")
            return
        vesta = self.resolve_vesta_path()
        if not vesta:
            return
        suffix = ".cif" if parsed.format == "cif" else ".vasp"
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, delete=False) as handle:
            handle.write(content)
            temp_path = handle.name
        subprocess.Popen([vesta, temp_path], close_fds=True)
        self.status.set(f"已用 VESTA 打开：{temp_path}")

    def resolve_vesta_path(self) -> str | None:
        vesta = self.vesta_path.get().strip()
        if vesta and Path(vesta).exists():
            return vesta
        self.choose_vesta()
        vesta = self.vesta_path.get().strip()
        if vesta and Path(vesta).exists():
            return vesta
        messagebox.showwarning("缺少 VESTA", "请先选择本地 VESTA.exe。")
        return None

    def input_approval_complete(self) -> bool:
        return all(
            [
                self.structure_checked.get(),
                self.parameters_checked.get(),
                self.potcar_checked.get(),
            ]
        )

    def execution_approval_complete(self) -> bool:
        return self.input_approval_complete() and self.execution_checked.get()

    def prepare_inputs(self) -> Path | None:
        if not self.input_approval_complete():
            proceed = messagebox.askyesno("确认未完成", "结构、参数或 POTCAR 顺序确认尚未全部完成。是否仍然生成输入目录？")
            if not proceed:
                return None

        poscar, warnings = export_poscar(self.get_structure_content())
        if not poscar:
            messagebox.showerror("无法生成 POSCAR", "\n".join(warnings))
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_project = re.sub(r"[^a-zA-Z0-9._-]+", "_", self.project_name.get().strip() or "dft_project")
        safe_template = re.sub(r"[^a-zA-Z0-9._-]+", "_", self.template_name.get())
        run_dir = Path(self.project_dir.get()) / safe_project / "runs" / f"{timestamp}_{safe_template}"
        run_dir.mkdir(parents=True, exist_ok=True)

        parsed = parse_structure(poscar)
        elements = [symbol for symbol, _count in parsed.elements]

        (run_dir / "POSCAR").write_text(poscar, encoding="utf-8")
        (run_dir / "INCAR").write_text(self.incar_text.get("1.0", tk.END).strip() + "\n", encoding="utf-8")
        (run_dir / "KPOINTS").write_text(self.kpoints_text.get("1.0", tk.END).strip() + "\n", encoding="utf-8")
        potcar_required = self.ai_potcar_required or elements
        (run_dir / "POTCAR.required.txt").write_text(
            "Prepare POTCAR manually in this exact order:\n" + "\n".join(potcar_required) + "\n",
            encoding="utf-8",
        )
        metadata = {
            "project": safe_project,
            "template": self.template_name.get(),
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "ai_model": self.last_ai_model,
            "elements": elements,
            "potcar_required": potcar_required,
            "warnings": warnings,
            "approval": {
                "structure_checked": self.structure_checked.get(),
                "parameters_checked": self.parameters_checked.get(),
                "potcar_checked": self.potcar_checked.get(),
                "execution_checked": self.execution_checked.get(),
            },
        }
        (run_dir / "RUN_METADATA.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        (run_dir / "run_vasp.ps1").write_text(f"{self.vasp_command.get()} *> vasp.log\n", encoding="utf-8")

        self.current_run_dir = run_dir
        self.log(f"已生成输入目录：{run_dir}")
        self.status.set(f"已生成输入目录：{run_dir}")
        return run_dir

    def dry_run(self) -> None:
        run_dir = self.current_run_dir or self.prepare_inputs()
        if not run_dir:
            return
        required = ["INCAR", "KPOINTS", "POSCAR", "POTCAR"]
        self.log("Dry Run 检查：")
        for name in required:
            path = run_dir / name
            self.log(f"  {name}: {'OK' if path.exists() else 'MISSING'}")
        self.log(f"  command: {self.vasp_command.get()}")
        self.log(f"  cwd: {run_dir}")

    def start_execution(self) -> None:
        if self.process and self.process.poll() is None:
            messagebox.showwarning("正在运行", "当前已有执行进程。")
            return
        if not self.execution_approval_complete():
            messagebox.showwarning("确认未完成", "请先完成结构、参数、POTCAR 和执行设置确认。")
            return
        run_dir = self.current_run_dir or self.prepare_inputs()
        if not run_dir:
            return
        if not (run_dir / "POTCAR").exists():
            messagebox.showwarning("缺少 POTCAR", "运行目录缺少 POTCAR。请先按 POTCAR.required.txt 准备 POTCAR。")
            return

        command = self.vasp_command.get().strip()
        if not command:
            messagebox.showwarning("缺少命令", "请填写 VASP 执行命令。")
            return

        self.log(f"开始执行：{command}")
        thread = threading.Thread(target=self.run_command_thread, args=(command, run_dir), daemon=True)
        thread.start()

    def run_command_thread(self, command: str, run_dir: Path) -> None:
        try:
            self.process = subprocess.Popen(
                command,
                cwd=run_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                shell=True,
            )
            assert self.process.stdout is not None
            for line in self.process.stdout:
                self.after(0, self.log, line.rstrip())
            code = self.process.wait()
            self.after(0, self.log, f"执行结束，退出码：{code}")
            self.after(0, self.status.set, f"执行结束，退出码：{code}")
        except Exception as exc:
            self.after(0, self.log, f"执行失败：{exc}")

    def stop_execution(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            self.log("已请求停止执行。")
            self.status.set("已请求停止执行。")

    def parse_current_results(self) -> None:
        if not self.current_run_dir:
            messagebox.showinfo("没有运行目录", "请先生成或选择运行目录。")
            return
        self.parse_results(self.current_run_dir)

    def choose_results_dir(self) -> None:
        path = filedialog.askdirectory(title="选择 VASP 运行目录")
        if path:
            self.current_run_dir = Path(path)
            self.parse_results(Path(path))

    def parse_results(self, run_dir: Path) -> None:
        rows = [f"运行目录：{run_dir}", ""]
        oszicar_rows = parse_oszicar(run_dir / "OSZICAR")
        outcar_rows = parse_outcar(run_dir / "OUTCAR")
        rows.append("OSZICAR:")
        rows.extend(oszicar_rows or ["未找到 OSZICAR 能量记录。"])
        rows.append("")
        rows.append("OUTCAR:")
        rows.extend(outcar_rows or ["未找到 OUTCAR 摘要记录。"])
        self.replace_text(self.results_text, "\n".join(rows))
        self.status.set("结果解析完成。")

    def log(self, message: str) -> None:
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)

    @staticmethod
    def replace_text(widget: tk.Text, content: str) -> None:
        widget.delete("1.0", tk.END)
        widget.insert("1.0", content)

    @staticmethod
    def find_default_vesta_path() -> str:
        env_path = os.environ.get("VESTA_PATH")
        if env_path and Path(env_path).exists():
            return env_path
        return next((path for path in COMMON_VESTA_PATHS if Path(path).exists()), "")


if __name__ == "__main__":
    app = DFTAutomationWorkbench()
    app.mainloop()
