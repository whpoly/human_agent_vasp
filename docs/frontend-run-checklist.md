# Frontend 运行与首任务排障清单（SCF）

这份清单用于从零启动前后端，并尽快跑通第一个 SCF 任务。

## 1. 环境检查

在终端确认以下命令都可用：

```powershell
python --version
node --version
npm --version
```

要求：

1. Python 可用。
2. Node.js 20+。
3. npm 可用。

## 2. 启动后端

在项目根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
uvicorn app.main:app --reload --app-dir backend
```

检查点：

1. 终端看到 `Uvicorn running on http://127.0.0.1:8000`。
2. 浏览器打开 `http://127.0.0.1:8000/docs` 可访问。

## 3. 启动前端

新开终端，在项目根目录执行：

```powershell
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

检查点：

1. 打开 `http://localhost:3000` 可访问。
2. `frontend/.env.local` 中存在：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
```

## 4. 连接远程计算资源（先测通）

进入 `Settings: Compute Resources`：

1. 填写 `host / port / username / auth`。
2. 保存连接。
3. 点击测试连接。

如果失败：

1. 先在本机终端手工 SSH 验证同一组账号。
2. 通过后再回到前端继续。

## 5. 创建 SCF 会话

在首页创建 session：

1. `calculation_type` 选 `SCF`。
2. `goal` 写清楚（例如 “SCF energy only”）。
3. 创建后进入会话页。

## 6. 上传 POSCAR

在 `Assistant` 页：

1. 上传文件或粘贴 `POSCAR` 内容。
2. 点击 `Save POSCAR`。

若保存失败：

1. 检查 POSCAR 是否完整（元素、数量、坐标段齐全）。

## 7. 跑推荐与审批

按顺序执行：

1. 点击 `Recommend SCF parameters`。
2. 修改参数后点击 `Approve this step`。
3. 点击 `Recommend resource parameters`。
4. 修改资源参数后点击 `Approve this step`。

说明：

1. 至少要完成 `INCAR` 步骤审批，才能提交执行。

## 8. 提交 SCF 任务

提交前确认：

1. 已选择远程资源。
2. `launch command` 正确（例如 `mpirun -np 16 vasp_std`）。
3. 该命令在远程机可执行。

然后点击 `Submit SCF task`。

## 9. 在任务历史看关键结果

进入 `Task History`，重点看：

1. `status`
2. `converged`
3. `energy(eV)`
4. `max_force(eV/Ang)`
5. `error`（失败时）

## 10. 失败时最快定位顺序

1. 连接页测试是否通过。
2. `launch command` 能否在远程机手工执行。
3. 远程工作目录是否有写权限。
4. POSCAR 是否可被 ASE 读取。
5. `Task History` 中 `error` 字段内容是什么。

