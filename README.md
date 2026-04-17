# 本地选站工具（Site Selection Tool）

基于 `FastAPI + DuckDB + React + Ant Design` 的本地选站分析工具，面向「工参 + 话务 + 选站」多表上传、条件组关联筛选、分布图分析与批量导出场景。

## 功能概览

- 上传工参/话务文件：`CSV / XLSX / Parquet`
- 选站数据在「选站数据分析」分页中上传或粘贴导入
- 选站页支持粘贴表格文本（Excel 复制内容，制表符分隔）直接导入
- 预览数据（最多 100 行）+ 列头筛选（按全表去重值）
- 条件组关联筛选（可选择条件作用于工参、话务或选站）
- 列分布图（分类 TopN、数值直方图、阈值三段）+ CDF
- 直方图支持按“每个字段标签独立”设置 `bins` 与步长
- 图表 Tooltip 同时展示数量与当前占比百分比
- 导出当前筛选结果（CSV）或按条件组批量导出（Excel/CSV）
- 支持中文字段名/内容；CSV 导出采用 `utf-8-sig`（便于 Excel 打开）

## 项目结构

```text
03_choose_station/
├─ backend/
│  ├─ app/main.py
│  ├─ data/                  # 运行时上传文件目录（自动创建）
│  ├─ exports/               # 导出文件目录（自动创建）
│  ├─ logs/                  # run_app 启动日志目录（自动创建）
│  └─ site_selection.duckdb  # DuckDB 数据库文件（自动创建）
├─ frontend/
│  ├─ public/index.html
│  ├─ src/App.js
│  ├─ src/DistributionChart.js
│  ├─ src/index.js
│  ├─ src/index.css
│  └─ package.json
├─ run_app.py
├─ build_exe.ps1
├─ requirements.txt
└─ README.md
```

## 运行方式

### 1) 开发模式（前后端分开）

1. 安装后端依赖：

```bash
pip install -r requirements.txt
```

2. 启动后端：

```bash
uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 --reload
```

3. 启动前端：

```bash
cd frontend
npm install
npm start
```

默认地址：

- 前端：`http://localhost:3000`
- 后端：`http://localhost:8000`

说明：

- 前端默认使用同源地址（`REACT_APP_API_URL` 为空）。
- 若开发环境需要指定后端地址，可在前端启动前设置 `REACT_APP_API_URL`。

### 2) 集成运行（推荐本地单机）

```bash
python run_app.py
```

行为说明：

- 自动从 `8000` 开始寻找可用端口并启动服务（默认监听 `127.0.0.1`）
- 自动打开浏览器
- 运行日志写入 `backend/logs/run_*.log`
- 若已构建前端（`frontend/build` 存在），后端会同端口托管前端页面

健康与调试接口：

- `GET /health`
- `GET /debug/runtime`
- `GET /api/debug/runtime`

## Windows 打包 EXE

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build_exe.ps1
```

该脚本会：

1. 安装后端依赖和 `pyinstaller`
2. 执行前端构建（`npm run build`）
3. 打包生成 `dist/SiteSelectionTool.exe`

运行 EXE 后，程序会自动选择可用端口并打开浏览器；运行目录下自动创建 `data/`、`exports/`、`site_selection.duckdb`。

## 前端操作流程

1. 上传工参文件和话务文件（可选：上传或粘贴导入选站文件）
2. 选择话务唯一 ID 与工参唯一 ID（默认优先识别 `cell_id`）
3. 在工参/话务标签页点击 `预览`，查看前 100 行
4. 通过列头筛选（全表去重值）后点击 `应用列筛选`
5. 在左侧配置一个或多个条件组（字段 + 操作符 + 值）
6. 选择「条件作用于话务 / 工参 / 选站」，执行 `关联筛选`（选站关联默认复用工参唯一 ID）
7. 在下方分布图查看普通分布或各条件组分布
8. 导出：
   - 单组结果：按组导出 CSV
   - 多组结果：一键批量导出（Excel）
   - 无关联结果时：可导出当前预览筛选后的整表 CSV

## API 说明（核心）

### 基础与运行状态

- `GET /health`
- `GET /debug/runtime`
- `GET /api/debug/runtime`

### 数据上传与预览

- `POST /upload`  
  表单字段：
  - `role`: `engineering` | `traffic` | `station`
  - `file`: `csv/xlsx/parquet`

- `POST /upload_pasted`
  - `role`: `engineering` | `traffic` | `station`
  - `content`: 粘贴的表格文本（支持制表符/逗号分隔）

- `POST /preview`  
  请求示例：

```json
{
  "role": "engineering",
  "limit": 100,
  "column_filters": [
    { "field": "province", "values": ["广东", "浙江"] }
  ]
}
```

- `POST /column_distinct`  
  获取某列全表去重值（用于前端列筛选下拉选项）。

- `POST /preview_result`
  - 按 `result_key` 预览关联筛选后的临时结果（支持 `traffic` / `engineering` / `station`）
  - 选站条件筛选后会用该接口直接展示筛选后的话务预览

### 条件筛选与关联

- `POST /filter`  
  单表条件筛选（支持排序、限制返回行数）。

- `POST /nl_filter`  
  多条件组关联筛选。支持：
  - `condition_groups`（推荐，结构化条件组）
  - `text`（自然语言表达式，作为兼容入口）
  - `condition_role`（`traffic` / `engineering` / `station`）
  - `traffic_id_field` / `engineering_id_field`
  - `station_id_field`
  - `traffic_column_filters` / `engineering_column_filters` / `station_column_filters`

- `POST /nl_filter_parse`  
  将自然语言条件解析为结构化条件组，并返回未匹配字段。

- `POST /field_max`  
  获取字段最大值（用于前端条件输入辅助）。

### 分布图相关

- `POST /api/distribution`（推荐）
- `POST /distribution`（同逻辑别名）

支持：

- 分类分布（TopN）
- 数值直方图（可配置 `bins`、`bin_width`）
- 阈值三段分布（`threshold_3bins`）
- 过滤前后对比（`full_count` vs `filtered_count`）

兼容接口（保留）：

- `POST /column_distribution`
- `POST /distribution_compare`
- `POST /engineering_chart`

### 导出

- `POST /export_filtered_preview`  
  导出当前工参/话务列筛选后的全量数据（`csv` 或 `excel`）。

- `POST /export`  
  按 `result_key` 导出单个条件组结果（`traffic` 或 `engineering`）。

- `POST /export_nl_batch`  
  批量导出多个条件组：
  - `excel`：每组一个工作表
  - `csv`：合并导出并附带「条件组名称」列

## 数据与性能约束

- 大表处理在 DuckDB 中完成，避免前端/后端一次性加载全量
- 上传按分块写盘，`xlsx` 会转为 `csv` 再注册 DuckDB 视图
- CSV/XLSX 导入时会自动探测前 6 行是否为无效说明行，并自动跳过后再识别表头
- 预览接口上限 100 行；常规筛选上限 1000 行
- 预览表格取消分页，滚动区填满容器高度
- 字段名、操作符有白名单校验，筛选值参数绑定
- 导出文件默认写入 `backend/exports/`

## 主要依赖

- 后端：`fastapi`、`uvicorn`、`duckdb`、`python-multipart`、`openpyxl`
- 前端：`react`、`antd`、`axios`、`recharts`

