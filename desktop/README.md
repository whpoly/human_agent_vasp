# DFT Automation Workbench

本目录是项目主实现：Windows 桌面版自动化 DFT 工作台。

## 模块

1. AI 生成任务：填写 OpenAI API Key/模型，输入材料和计算要求，或上传本地 CIF/POSCAR/文本文件，生成结构与 VASP 输入文件草案。
2. 结构与 VESTA：基于 AI 结果读取、编辑 CIF/POSCAR，查看结构摘要，调用本地 VESTA。
3. 模板与输入文件：基于 AI 结果选择 Relax、Static SCF、DOS、Band，编辑 INCAR/KPOINTS，确认参数和 POTCAR 顺序，生成 VASP 运行目录。
4. 后端连接：自动检查前 3 步是否完整，配置后端地址、健康检查路径和 Token，并测试连接。
5. 执行与日志：填写 VASP 命令，在运行目录中启动本地计算并查看日志。
6. 结果解析：从 OSZICAR/OUTCAR 提取关键能量和收敛信息。

## 运行

```powershell
python dft_automation_workbench.py
```

需要使用带 `tkinter`/Tcl/Tk 的标准 Windows Python。建议从 python.org 安装 Python 3.11+，安装时保留 `tcl/tk and IDLE` 组件；不要使用 Microsoft Store 的 `python.exe` 占位符或精简 embedded Python。

可选环境变量：

```powershell
$env:OPENAI_API_KEY="sk-..."
$env:OPENAI_MODEL="gpt-5.5"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
```

## 打包

```powershell
.\build_exe.ps1
```

输出：

```text
dist\DFT-Automation-Workbench.exe
```

## 注意

- 程序不附带 VASP。
- 程序不自动拼接 POTCAR，只生成 `POTCAR.required.txt`。
- VESTA 是独立桌面程序，程序只负责把当前结构写成临时文件并调用 `VESTA.exe`。
