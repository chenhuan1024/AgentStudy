# 本地选站工具（Site Selection Tool）

基于 `FastAPI + DuckDB + React + Ant Design` 的本地选站工具，支持：

- 工参表、话务表上传（CSV / Excel / Parquet）
- 按钮触发预览（前 100 行）
- 工参表前端 Excel 风格列筛选/排序
- 话务表自然语言条件筛选（多条件组）
- 基于 `cell_id` 关联回查工参表
- 结果导出（CSV / Excel / Parquet）

---

## 1. 项目目录结构

```text
03_choose_station/
├─ backend/
│  ├─ app/
│  │  ├─ __init__.py
│  │  └─ main.py
│  ├─ data/                 # 上传文件存储目录
│  ├─ exports/              # 导出文件输出目录
│  ├─ site_selection.duckdb # DuckDB 数据库文件（运行后生成）
│  └─ __init__.py
├─ frontend/
│  ├─ public/
│  │  └─ index.html
│  ├─ src/
│  │  ├─ App.js
│  │  ├─ index.css
│  │  └─ index.js
│  └─ package.json
├─ requirements.txt
└─ README.md
```

---

## 2. 后端启动（FastAPI）

### 2.1 安装依赖

```bash
pip install -r requirements.txt
```

### 2.2 启动服务

在项目根目录 `03_choose_station` 下执行：

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

健康检查：

```bash
GET http://localhost:8000/health
```

---

## 3. 前端启动（React + Ant Design）

### 3.1 安装依赖

```bash
cd frontend
npm install
```

### 3.2 启动前端

```bash
npm start
```

默认地址：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`

> 前端默认优先使用同源地址（空 `baseURL`）；开发模式若需显式指定后端地址，可在前端启动前设置环境变量：`REACT_APP_API_URL`

---

## 3.1 可执行文件打包（Windows）

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

打包完成后生成：

- `dist/SiteSelectionTool.exe`

本仓库当前已验证产物：

- `03_choose_station/dist/SiteSelectionTool.exe`

运行方式：

- 双击 `SiteSelectionTool.exe`
- 程序会自动选择空闲端口（默认优先 `8000`）并打开浏览器
- 运行目录下会自动生成 `data/`、`exports/`、`site_selection.duckdb`
- 可通过 `GET /debug/runtime` 查看当前实际端口、日志文件、数据库状态

---

## 4. 前端交互流程

1. 上传工参表
2. 上传话务表
3. 在右侧点击“预览”按钮查看前100行（可边操作边查看）
4. 话务表输入自然语言多组条件
5. 点击“执行筛选”
6. 查看多组结果（Tab 形式）
7. 点击“导出”

---

## 5. API 接口说明

### 5.1 `POST /upload`

- `multipart/form-data`
- 字段：
  - `role`: `engineering` | `traffic`
  - `file`: 文件（CSV / Excel / Parquet）

返回示例：

```json
{
  "message": "上传成功并已注册为 DuckDB VIEW",
  "role": "engineering",
  "table_name": "engineering_view",
  "columns": ["cell_id", "site_name", "lon", "lat"]
}
```

### 5.2 `POST /preview`

请求体：

```json
{
  "role": "engineering",
  "limit": 100
}
```

> 预览接口固定最多返回 100 行。

### 5.3 `POST /filter`

请求体：

```json
{
  "role": "engineering",
  "conditions": [
    { "field": "prb", "operator": ">", "value": 30 },
    { "field": "ni", "operator": ">", "value": -108 }
  ],
  "sort_field": "prb",
  "sort_order": "desc",
  "limit": 1000
}
```

### 5.4 `POST /nl_filter`

请求体：

```json
{
  "text": "PRB > 30 且 NI > -108; PRB > 50 且 NI > -107",
  "traffic_role": "traffic",
  "engineering_role": "engineering",
  "limit": 1000
}
```

规则：

- 条件组内：AND
- 条件组之间：独立输出
- 支持操作符：`> < >= <= =`
- 基于 `cell_id` 回查工参表

### 5.5 `POST /export`

请求体：

```json
{
  "result_key": "nl_xxx",
  "table_type": "traffic",
  "file_format": "csv"
}
```

支持格式：

- `csv`
- `excel`

### 5.6 `GET /debug/runtime`（新增）

返回运行时调试信息，用于定位端口漂移、日志位置、数据库连接状态。

返回示例：

```json
{
  "status": "ok",
  "pid": 12345,
  "runtime_seconds": 86,
  "runtime_port": "8001",
  "runtime_log": "D:/.../backend/logs/run_20260414_123456.log",
  "db_file": "D:/.../backend/site_selection.duckdb",
  "db_open_ok": true,
  "db_error": "",
  "uploaded_roles": {
    "engineering": { "table_name": "engineering_view", "path": "D:/.../data/engineering_xxx.csv" }
  }
}
```

---

## 6. 性能与约束说明

- 所有数据查询均通过 DuckDB SQL 执行
- 上传采用分块写盘，避免一次性读入内存
- 前端仅在按钮点击后触发查询，不做实时查询
- 非预览接口默认最大返回 `1000` 行
- SQL 字段名、操作符均经过白名单校验，值使用参数绑定

---

## 7. 备注

- Excel 上传当前支持 `xlsx`（会先流式转换为 CSV 再注册 DuckDB VIEW）。
- 导出的文件会写入：`backend/exports/`。

