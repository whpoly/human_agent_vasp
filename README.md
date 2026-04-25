# 自动化 DFT 工作台

这是一个面向 VASP 计算的本地桌面项目，不再走网页前端路线。新的工作模式是：用户先输入材料和计算要求，AI 生成结构与 VASP 输入文件草案；随后用户再用 VESTA、模板页和审批页主动调整。

后续开发请优先阅读：

- [docs/00_READ_FIRST_PROJECT_SUMMARY.md](docs/00_READ_FIRST_PROJECT_SUMMARY.md)

## 当前实现

- `desktop/dft_automation_workbench.py`：主程序，Tkinter 桌面应用。
- `desktop/build_exe.ps1`：Windows exe 打包脚本。
- `desktop/dist/DFT-Automation-Workbench.exe`：打包后的可执行文件。

## 已有功能

- AI 任务生成：输入材料和计算要求，生成初始 POSCAR、推荐模板、INCAR/KPOINTS 草案。
- 读取、粘贴和编辑 CIF/POSCAR。
- 解析结构摘要：格式、标题、元素、原子数、晶胞。
- 调用本地 `VESTA.exe` 打开当前结构。
- 选择 VASP 工作流模板：Relax、Static SCF、DOS、Band。
- 生成 `INCAR`、`KPOINTS`、`POSCAR`、`POTCAR.required.txt`、`RUN_METADATA.json`、`run_vasp.ps1`。
- 对 CIF 尝试转换为 POSCAR。
- 人工审批检查：结构、参数、POTCAR、执行设置。
- 本地执行入口：通过用户填写的 VASP 命令启动运行。
- 结果解析入口：读取 `OSZICAR` 和 `OUTCAR` 摘要。
- AI 草案能力：材料公式到初始结构/输入文件、元素替换、晶胞缩放、增加 c 方向真空层、参数建议文本。

## 直接运行

```powershell
cd desktop
python dft_automation_workbench.py
```

如果系统没有 `python`，可以直接运行已打包的 exe：

```text
desktop\dist\DFT-Automation-Workbench.exe
```

## 重新打包 exe

```powershell
cd desktop
.\build_exe.ps1
```

如果本机没有 Python，脚本会尝试使用 Codex 自带 Python；如果需要指定 Python，可设置：

```powershell
$env:PYTHON="C:\Path\To\python.exe"
.\build_exe.ps1
```

## VESTA

程序会尝试自动查找常见 VESTA 安装路径，也可以在界面中点击“选择 VESTA.exe”。VESTA 会作为本地独立窗口打开，不会嵌入应用内部。

可选环境变量：

```powershell
$env:VESTA_PATH="C:\Program Files\VESTA-win64\VESTA.exe"
```

## VASP 执行

程序不会自带 VASP，也不会自动生成 POTCAR。生成运行目录后，请按 `POTCAR.required.txt` 的元素顺序自行准备 `POTCAR`，再在“执行与日志”页填写本机可用的 VASP 命令，例如：

```text
vasp_std
mpiexec -n 16 vasp_std
```
