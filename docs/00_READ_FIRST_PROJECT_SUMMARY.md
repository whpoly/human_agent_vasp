# 项目优先阅读总结

本项目现在定位为本地桌面端的自动化 DFT 工作台。项目不再实现网页前端，核心交互通过 Windows exe 完成。新的主流程是 AI-first：用户先输入材料和计算要求，AI 生成结构与 VASP 输入文件草案；后续 VESTA、模板和审批都是对 AI 结果的主动调整。

## 1. 产品目标

构建一个 human-in-the-loop 的自动化 DFT 工具，帮助用户从“材料 + 计算要求”开始，逐步生成结构、生成输入文件、人工调整、审批、执行、监控和解析结果。

核心原则：

- AI/自动化负责生成第一版结构和输入文件草案，减少重复劳动。
- 用户必须在关键节点审批。
- VESTA 用于结构查看和精修，不取代 DFT 工作流。
- POTCAR 和 VASP 执行环境必须由用户自行提供。
- 所有输入文件和执行记录都写入可追溯的运行目录。

## 2. 当前目录

- `desktop/dft_automation_workbench.py`：主程序。
- `desktop/build_exe.ps1`：打包 exe 的脚本。
- `desktop/dist/DFT-Automation-Workbench.exe`：当前已打包的桌面程序。
- `desktop/requirements.txt`：打包依赖。
- `docs/00_READ_FIRST_PROJECT_SUMMARY.md`：本文档。

已删除网页前端路线，不再维护 `frontend/`。

## 3. 当前已实现流程

### AI 生成任务

- 输入材料公式或材料名称。
- 输入计算目标和要求。
- 自动生成初始 POSCAR 草案。
- 自动选择 Relax、Static SCF、DOS、Band 模板。
- 自动填充 INCAR/KPOINTS 草案。
- 生成后续人工检查说明。

### 结构与 VESTA

- 基于 AI 生成结果粘贴、读取、保存 CIF/POSCAR。
- 自动识别 CIF/POSCAR。
- 解析标题、元素、原子数、晶胞参数。
- 对 CIF 尝试转换为 POSCAR。
- 选择本地 `VESTA.exe`。
- 调用 VESTA 打开当前结构。

### 模板与输入文件

- 基于 AI 生成结果继续支持模板：Relax、Static SCF、DOS、Band。
- 自动载入 INCAR/KPOINTS 模板。
- 允许用户手动修改 INCAR/KPOINTS。
- 生成运行目录：
  - `POSCAR`
  - `INCAR`
  - `KPOINTS`
  - `POTCAR.required.txt`
  - `RUN_METADATA.json`
  - `run_vasp.ps1`

### AI 草案与审批

- 结构修改草案：元素替换、晶胞缩放、增加 c 方向真空层。
- 参数建议：基于模板、结构格式、元素和晶胞给出规则化提示。
- 执行前确认项：
  - 结构已检查。
  - 参数已检查。
  - POTCAR 已由用户准备。
  - 运行命令和目录已确认。

### 执行与日志

- 用户填写 VASP 命令，例如 `vasp_std` 或 `mpiexec -n 16 vasp_std`。
- 程序在生成的运行目录中启动命令。
- 实时写入日志窗口。
- 支持停止当前进程。

### 结果解析

- 从 `OSZICAR` 抽取最近能量记录。
- 从 `OUTCAR` 抽取 TOTEN、收敛提示等摘要。
- 支持解析当前运行目录或手动选择目录。

## 4. 用户操作流程

1. 打开桌面程序。
2. 在“AI 生成任务”页输入材料和计算要求。
3. 让 AI 生成结构和输入文件草案。
4. 在“结构与 VESTA”页检查结构摘要。
5. 用 VESTA 打开结构并人工检查或精修。
6. 在“模板与输入文件”页修改 INCAR/KPOINTS。
7. 在“AI 调整与审批”页查看建议并勾选人工审批项。
8. 生成 VASP 输入目录。
9. 按 `POTCAR.required.txt` 准备 POTCAR。
10. 填写 VASP 执行命令。
11. Dry Run 检查。
12. 启动执行。
13. 解析 OSZICAR/OUTCAR。

## 5. 后续设计顺序

1. 接入真实 AI 模型，让 AI 从材料和要求生成可解释、可回滚的结构与输入文件。
2. 完善结构解析和 CIF/POSCAR 转换，必要时引入 pymatgen 或 ASE。
3. 增加结构和参数 diff 视图。
4. 增加任务队列和多任务运行管理。
5. 增加远程 SSH/集群提交。
6. 增加更完整的结果解析：力、应力、带隙、DOS、Band。
7. 增加项目数据库或本地 SQLite 索引。
8. 增加报告导出。
9. 增加自动测试和打包发布流程。

## 6. 当前边界

- 不附带 VASP。
- 不附带 POTCAR。
- 不保证 CIF 转 POSCAR 覆盖所有复杂对称操作。
- 当前 AI 是规则化草案，不是真实模型调用；后续应替换为真实模型接口。
- 当前执行默认是本地命令，远程集群提交尚未实现。
