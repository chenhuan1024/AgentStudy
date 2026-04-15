import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Layout,
  message,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import { FilterFilled, UploadOutlined } from "@ant-design/icons";
import axios from "axios";
import DistributionChart from "./DistributionChart";

const { Search } = Input;
const { Text } = Typography;
const { Sider, Content } = Layout;

// 默认走同源（打包后由后端同端口托管），避免后端动态端口时出现 404/not found
const API_BASE = process.env.REACT_APP_API_URL || "";
const OP_OPTIONS = [">", "<", ">=", "<=", "="];
const WORKSPACE_HEIGHT = "calc(100vh - 180px)";
/** 预览表 body 最小高度（px），实际高度由预览区容器 ResizeObserver 决定 */
const PREVIEW_TABLE_SCROLL_MIN = 120;

const api = axios.create({
  baseURL: API_BASE,
  timeout: 120000,
});

const modernCardStyle = {
  borderRadius: 14,
  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
  overflow: "hidden",
};

function filtersToPayload(filterMap) {
  return Object.entries(filterMap || {})
    .filter(([, values]) => values && values.length > 0)
    .map(([field, values]) => ({ field, values }));
}

function emptyCondition() {
  return { field: undefined, operator: ">=", value: "", maxValue: undefined };
}

function emptyConditionGroup(id, label) {
  return { id, name: label, conditions: [emptyCondition()] };
}

function normalizeConditions(conds) {
  if (!Array.isArray(conds)) return [];
  return conds
    .filter((c) => c && c.field && c.operator != null && c.value !== undefined && c.value !== "")
    .map((c) => ({ field: c.field, operator: c.operator, value: c.value }));
}

function emptyDistState() {
  return {
    field: null,
    detectedType: null,
    result: null,
    bins: 12,
    binWidth: 10,
  };
}

function deriveThresholdForField(conditions, field) {
  const rows = (conditions || []).filter((c) => c?.field === field);
  let lower = null;
  let upper = null;
  for (const c of rows) {
    const v = Number(c.value);
    if (Number.isNaN(v)) continue;
    if (c.operator === ">" || c.operator === ">=" || c.operator === "=") {
      lower = lower == null ? v : Math.max(lower, v);
    }
    if (c.operator === "<" || c.operator === "<=" || c.operator === "=") {
      upper = upper == null ? v : Math.min(upper, v);
    }
  }
  if (lower == null && upper == null) return null;
  if (lower == null) lower = upper;
  if (upper == null) upper = lower;
  if (lower > upper) [lower, upper] = [upper, lower];
  return { x1: lower, x2: upper };
}

function PreviewColumnFilterDropdown({
  role,
  columnKey,
  value,
  onDraftChange,
  distinctCache,
  setDistinctCache,
  confirm,
}) {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (distinctCache[columnKey]) {
        const vals = distinctCache[columnKey];
        setOptions(vals.map((v) => ({ label: v === null || v === "" ? "(空)" : String(v), value: v })));
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.post("/column_distinct", {
          role,
          field: columnKey,
          max_values: 50000,
        });
        if (cancelled) return;
        setDistinctCache((prev) => ({ ...prev, [columnKey]: data.values }));
        setOptions(
          (data.values || []).map((v) => ({
            label: v === null || v === "" ? "(空)" : String(v),
            value: v,
          }))
        );
      } catch (e) {
        if (!cancelled) message.error(e?.response?.data?.detail || "加载去重值失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [columnKey, distinctCache, setDistinctCache, role]);

  return (
    <div style={{ padding: 8, width: 320 }}>
      <Spin spinning={loading}>
        <Select
          mode="multiple"
          allowClear
          showSearch
          style={{ width: "100%" }}
          placeholder="勾选取值（全表去重）"
          value={value || []}
          onChange={(vals) => onDraftChange(columnKey, vals)}
          options={options}
          optionFilterProp="label"
          maxTagCount="responsive"
        />
      </Spin>
      <Space style={{ marginTop: 8 }}>
        <Button
          size="small"
          onClick={() => {
            onDraftChange(columnKey, []);
            confirm();
          }}
        >
          清除本列
        </Button>
      </Space>
    </div>
  );
}

export default function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("engineering");

  const [uploadingRole, setUploadingRole] = useState("");
  const [uploadInfo, setUploadInfo] = useState({
    engineering: { fileName: "", savedPath: "", columns: [] },
    traffic: { fileName: "", savedPath: "", columns: [] },
  });

  const [trafficIdField, setTrafficIdField] = useState();
  const [engineeringIdField, setEngineeringIdField] = useState();

  const [previewLoading, setPreviewLoading] = useState({ engineering: false, traffic: false });
  const [engPreview, setEngPreview] = useState({ columns: [], rows: [] });
  const [trafficPreview, setTrafficPreview] = useState({ columns: [], rows: [] });
  /** 原始表总行数（接口 total_row_count，不随列筛选变化） */
  const [engTotalRows, setEngTotalRows] = useState(null);
  const [trafficTotalRows, setTrafficTotalRows] = useState(null);
  const [engFilteredRows, setEngFilteredRows] = useState(null);
  const [trafficFilteredRows, setTrafficFilteredRows] = useState(null);

  const [engColumnSearch, setEngColumnSearch] = useState("");
  const [trafficColumnSearch, setTrafficColumnSearch] = useState("");

  const [engDraft, setEngDraft] = useState({});
  const [engApplied, setEngApplied] = useState({});
  const [engDistinctCache, setEngDistinctCache] = useState({});
  const [trafficDraft, setTrafficDraft] = useState({});
  const [trafficApplied, setTrafficApplied] = useState({});
  const [trafficDistinctCache, setTrafficDistinctCache] = useState({});

  const [conditionGroups, setConditionGroups] = useState(() => [emptyConditionGroup("g0", "条件组 1")]);
  const [conditionRole, setConditionRole] = useState("traffic");
  const [runLinkLoading, setRunLinkLoading] = useState(false);
  const [linkFilterExecuted, setLinkFilterExecuted] = useState(false);
  /** 后端返回的每组结果（含 result_key、条件） */
  const [linkedGroupResults, setLinkedGroupResults] = useState([]);
  /** 用于图表与分布：当前选中的条件组索引 */
  const [chartGroupIndex, setChartGroupIndex] = useState(0);

  /** 工参 / 话务分布图状态隔离 */
  const [distState, setDistState] = useState({
    engineering: emptyDistState(),
    traffic: emptyDistState(),
  });
  const [distPanelTab, setDistPanelTab] = useState({ engineering: "normal", traffic: "normal" });
  const [selectedChartFields, setSelectedChartFields] = useState({ engineering: [], traffic: [] });
  const [selectedChartResults, setSelectedChartResults] = useState({ engineering: {}, traffic: {} });
  const [selectedChartLoading, setSelectedChartLoading] = useState({ engineering: false, traffic: false });

  /** 上下分栏比例（上方预览占比） */
  const [splitTopRatio, setSplitTopRatio] = useState(0.56);
  const dragRef = useRef({ active: false, startY: 0, startRatio: 0.44 });
  const prevSelectedFieldsRef = useRef({ engineering: [], traffic: [] });
  const [previewScrollY, setPreviewScrollY] = useState(280);
  const engPreviewHostRef = useRef(null);
  const trafficPreviewHostRef = useRef(null);

  const uploadColumns = (role) => uploadInfo[role]?.columns || [];

  const handleUpload = async (role, file) => {
    setUploadingRole(role);
    try {
      const formData = new FormData();
      formData.append("role", role);
      formData.append("file", file);
      const { data } = await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const displayName = data.original_filename || file.name || "";
      const savedPath = data.saved_path || "";
      setUploadInfo((prev) => ({
        ...prev,
        [role]: { fileName: displayName, savedPath, columns: data.columns || [] },
      }));
      if (role === "traffic") {
        setTrafficIdField((data.columns || []).find((c) => c.toLowerCase() === "cell_id") || data.columns?.[0]);
      }
      if (role === "engineering") {
        setEngineeringIdField((data.columns || []).find((c) => c.toLowerCase() === "cell_id") || data.columns?.[0]);
      }
      await handlePreview(role);
      message.success(`${role === "engineering" ? "工参" : "话务"}上传成功`);
    } catch (error) {
      message.error(error?.response?.data?.detail || "上传失败");
    } finally {
      setUploadingRole("");
    }
  };

  const handlePreview = async (role, overrideFilters) => {
    setPreviewLoading((prev) => ({ ...prev, [role]: true }));
    try {
      const filters = overrideFilters ?? (role === "engineering" ? engApplied : trafficApplied);
      const { data } = await api.post("/preview", {
        role,
        limit: 100,
        column_filters: filtersToPayload(filters),
      });
      const total = data.total_row_count ?? null;
      const filtered = data.matching_row_count ?? null;
      if (role === "engineering") {
        setEngPreview({ columns: data.columns || [], rows: data.rows || [] });
        setEngTotalRows(total);
        setEngFilteredRows(filtered);
      } else {
        setTrafficPreview({ columns: data.columns || [], rows: data.rows || [] });
        setTrafficTotalRows(total);
        setTrafficFilteredRows(filtered);
      }
    } catch (error) {
      message.error(error?.response?.data?.detail || "预览失败");
    } finally {
      setPreviewLoading((prev) => ({ ...prev, [role]: false }));
    }
  };

  const applyEngFilters = async () => {
    const next = { ...engDraft };
    setEngApplied(next);
    await handlePreview("engineering", next);
    await refreshChartsForRole("engineering");
  };
  const applyTrafficFilters = async () => {
    const next = { ...trafficDraft };
    setTrafficApplied(next);
    await handlePreview("traffic", next);
    await refreshChartsForRole("traffic");
  };

  const removeAppliedFilter = async (role, field) => {
    if (role === "engineering") {
      setEngApplied((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setEngDraft((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      const next = { ...engApplied };
      delete next[field];
      setTimeout(() => handlePreview("engineering", next), 0);
    } else {
      setTrafficApplied((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setTrafficDraft((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      const next = { ...trafficApplied };
      delete next[field];
      setTimeout(() => handlePreview("traffic", next), 0);
    }
  };

  const updateDraftMap = (setter) => (field, values) => {
    setter((prev) => {
      const m = { ...prev };
      if (!values || values.length === 0) delete m[field];
      else m[field] = values;
      return m;
    });
  };
  const updateEngDraft = useMemo(() => updateDraftMap(setEngDraft), []);
  const updateTrafficDraft = useMemo(() => updateDraftMap(setTrafficDraft), []);

  const pickDistColumn = useCallback((role, col) => {
    setDistState((prev) => ({
      ...prev,
      [role]: { ...prev[role], field: col },
    }));
    setSelectedChartFields((prev) => {
      if (prev[role]?.includes(col)) return prev;
      return { ...prev, [role]: [...(prev[role] || []), col] };
    });
  }, []);

  const makeColumns = useCallback(
    (role, cols, draftMap, distinctCache, setDistinctCache, onDraftChange, onPickColumn, pickedFields, activeField) =>
      cols.map((col) => ({
        title: (
          <span
            style={{
              cursor: "pointer",
              color: pickedFields?.includes(col) ? "#1677ff" : undefined,
              fontWeight: activeField === col ? 700 : 400,
            }}
            onClick={() => {
              onPickColumn(role, col);
            }}
          >
            {col}
          </span>
        ),
        dataIndex: col,
        key: col,
        ellipsis: true,
        filteredValue: draftMap[col] || null,
        filterIcon: <FilterFilled />,
        filterDropdown: ({ confirm }) => (
          <PreviewColumnFilterDropdown
            role={role}
            columnKey={col}
            value={draftMap[col]}
            onDraftChange={onDraftChange}
            distinctCache={distinctCache}
            setDistinctCache={setDistinctCache}
            confirm={confirm}
          />
        ),
      })),
    []
  );

  const engVisibleCols = useMemo(
    () => (engPreview.columns || []).filter((c) => String(c).toLowerCase().includes(engColumnSearch.toLowerCase())),
    [engPreview.columns, engColumnSearch]
  );
  const trafficVisibleCols = useMemo(
    () =>
      (trafficPreview.columns || []).filter((c) =>
        String(c).toLowerCase().includes(trafficColumnSearch.toLowerCase())
      ),
    [trafficPreview.columns, trafficColumnSearch]
  );

  const engColumns = useMemo(
    () =>
      makeColumns(
        "engineering",
        engVisibleCols,
        engDraft,
        engDistinctCache,
        setEngDistinctCache,
        updateEngDraft,
        pickDistColumn,
        selectedChartFields.engineering,
        distState.engineering.field
      ),
    [
      makeColumns,
      engVisibleCols,
      engDraft,
      engDistinctCache,
      updateEngDraft,
      pickDistColumn,
      selectedChartFields.engineering,
      distState.engineering.field,
    ]
  );
  const trafficColumns = useMemo(
    () =>
      makeColumns(
        "traffic",
        trafficVisibleCols,
        trafficDraft,
        trafficDistinctCache,
        setTrafficDistinctCache,
        updateTrafficDraft,
        pickDistColumn,
        selectedChartFields.traffic,
        distState.traffic.field
      ),
    [
      makeColumns,
      trafficVisibleCols,
      trafficDraft,
      trafficDistinctCache,
      updateTrafficDraft,
      pickDistColumn,
      selectedChartFields.traffic,
      distState.traffic.field,
    ]
  );

  const refreshFieldMax = async (field) => {
    if (!field) return undefined;
    try {
      const { data } = await api.post("/field_max", { role: conditionRole, field });
      return data.max_value;
    } catch {
      return undefined;
    }
  };

  const addConditionGroup = () => {
    setConditionGroups((prev) => [
      ...prev,
      emptyConditionGroup(`g${Date.now()}`, `条件组 ${prev.length + 1}`),
    ]);
  };

  const addCondition = (groupIdx) => {
    setConditionGroups((prev) =>
      prev.map((g, i) => (i === groupIdx ? { ...g, conditions: [...g.conditions, emptyCondition()] } : g))
    );
  };

  const removeCondition = (groupIdx, condIdx) => {
    setConditionGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIdx) return g;
        const next = g.conditions.filter((_, j) => j !== condIdx);
        return { ...g, conditions: next.length ? next : [emptyCondition()] };
      })
    );
  };

  const updateCondition = (groupIdx, condIdx, patch) => {
    setConditionGroups((prev) =>
      prev.map((g, i) => {
        if (i !== groupIdx) return g;
        const conditions = g.conditions.map((c, j) => (j === condIdx ? { ...c, ...patch } : c));
        return { ...g, conditions };
      })
    );
  };

  const removeConditionGroup = (groupIdx) => {
    setConditionGroups((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== groupIdx)));
  };

  const cleanOneGroup = (conds) =>
    conds
      .filter((c) => c.field && String(c.value ?? "").trim() !== "")
      .map((c) => {
        const raw = String(c.value).trim();
        const num = Number(raw);
        return { field: c.field, operator: c.operator, value: Number.isNaN(num) ? raw : num };
      });

  const runLinkedFilter = async () => {
    if (!trafficIdField || !engineeringIdField) {
      message.warning("请先配置唯一 ID 字段");
      return;
    }
    const groupsPayload = conditionGroups.map((g) => cleanOneGroup(g.conditions)).filter((arr) => arr.length > 0);
    if (!groupsPayload.length) {
      message.warning("请至少在一个条件组中填写有效条件");
      return;
    }
    setRunLinkLoading(true);
    try {
      const { data } = await api.post("/nl_filter", {
        condition_groups: groupsPayload,
        group_names: conditionGroups.map((g) => g.name || "条件组"),
        traffic_role: "traffic",
        engineering_role: "engineering",
        condition_role: conditionRole,
        traffic_id_field: trafficIdField,
        engineering_id_field: engineeringIdField,
        traffic_column_filters: filtersToPayload(trafficApplied),
        engineering_column_filters: filtersToPayload(engApplied),
      });
      const groups = data.groups || [];
      setLinkedGroupResults(groups);
      setChartGroupIndex(0);
      setLinkFilterExecuted(true);
      setActiveTab(conditionRole);
      message.success(`关联筛选完成：共 ${groups.length} 个条件组结果`);
      await handlePreview("engineering");
      await handlePreview("traffic");
      await refreshChartsForRole(conditionRole, { groupsOverride: groups });
    } catch (error) {
      message.error(error?.response?.data?.detail || "执行关联筛选失败");
    } finally {
      setRunLinkLoading(false);
    }
  };

  useEffect(() => {
    if (linkedGroupResults.length && chartGroupIndex >= linkedGroupResults.length) {
      setChartGroupIndex(0);
    }
  }, [linkedGroupResults.length, chartGroupIndex, linkedGroupResults]);

  const panelFieldsForRole = useCallback(
    (role, panelKey) => {
      if (panelKey === "normal") return selectedChartFields[role] || [];
      const m = /^group-(\d+)$/.exec(panelKey || "");
      if (!m) return [];
      const idx = Number(m[1]);
      const conds = normalizeConditions(linkedGroupResults[idx]?.conditions || []);
      return [...new Set(conds.map((c) => c.field).filter(Boolean))];
    },
    [selectedChartFields, linkedGroupResults]
  );

  const refreshChartsForRole = useCallback(
    async (role, opts = {}) => {
      const { panelKeys, fields, groupsOverride } = opts;
      const cfg = distState[role];
      const applied = role === "engineering" ? engApplied : trafficApplied;
      const previewFilters = filtersToPayload(applied);
      const groupsData = groupsOverride || linkedGroupResults;
      const keys = panelKeys || ["normal", ...groupsData.map((_, i) => `group-${i}`)];
      const out = {};
      setSelectedChartLoading((p) => ({ ...p, [role]: true }));
      try {
        for (const panelKey of keys) {
          const gm = /^group-(\d+)$/.exec(panelKey || "");
          const groupIdx = gm ? Number(gm[1]) : -1;
          const groupConds =
            groupIdx >= 0 ? normalizeConditions(groupsData[groupIdx]?.conditions || []) : [];
          const currentFields =
            fields ||
            (groupIdx >= 0
              ? [...new Set(groupConds.map((c) => c.field).filter(Boolean))]
              : panelFieldsForRole(role, panelKey));
          if (!currentFields.length) continue;
          for (const field of currentFields) {
            try {
              if (groupIdx >= 0) {
                const threshold = deriveThresholdForField(groupConds, field);
                if (!threshold) {
                  out[`${panelKey}::${field}`] = null;
                  continue;
                }
                const { data } = await api.post("/api/distribution", {
                  table_name: role,
                  column: field,
                  conditions: groupConds,
                  preview_filters: previewFilters,
                  mode: "threshold_3bins",
                  bins: cfg.bins,
                  x1: threshold.x1,
                  x2: threshold.x2,
                  compare_with_base: true,
                });
                out[`${panelKey}::${field}`] = data;
              } else {
                const { data } = await api.post("/api/distribution", {
                  table_name: role,
                  column: field,
                  conditions: [],
                  preview_filters: previewFilters,
                  mode: "auto",
                  bins: cfg.bins,
                  bin_width: cfg.binWidth > 0 ? cfg.binWidth : null,
                  x1: null,
                  x2: null,
                  compare_with_base: previewFilters.length > 0,
                });
                out[`${panelKey}::${field}`] = data;
              }
            } catch {
              out[`${panelKey}::${field}`] = null;
            }
          }
        }
        setSelectedChartResults((p) => ({ ...p, [role]: { ...(p[role] || {}), ...out } }));
        const panelKey = distPanelTab[role] || "normal";
        const current = cfg.field && out[`${panelKey}::${cfg.field}`];
        if (current) {
          setDistState((p) => ({
            ...p,
            [role]: { ...p[role], detectedType: current.detected_type, result: current },
          }));
        }
      } finally {
        setSelectedChartLoading((p) => ({ ...p, [role]: false }));
      }
    },
    [distState, engApplied, trafficApplied, linkedGroupResults, panelFieldsForRole, distPanelTab]
  );

  useEffect(() => {
    for (const role of ["engineering", "traffic"]) {
      const prev = new Set(prevSelectedFieldsRef.current[role] || []);
      const curr = selectedChartFields[role] || [];
      const added = curr.filter((f) => !prev.has(f));
      if (added.length > 0) {
        refreshChartsForRole(role, { panelKeys: ["normal"], fields: added });
      }
      prevSelectedFieldsRef.current[role] = [...curr];
    }
  }, [selectedChartFields, refreshChartsForRole]);

  const exportByResultKey = async (resultKey, role) => {
    try {
      const { data } = await api.post("/export", {
        result_key: resultKey,
        table_type: role,
        file_format: "csv",
      });
      message.success(`导出成功: ${data.file_name}`);
    } catch (error) {
      message.error(error?.response?.data?.detail || "导出失败");
    }
  };

  const exportCurrentCsv = async (role) => {
    try {
      if (linkedGroupResults.length === 1) {
        await exportByResultKey(linkedGroupResults[0].result_key, role);
        return;
      }
      if (linkedGroupResults.length > 1) {
        message.info("多个条件组时请使用下方「按组导出」按钮");
        return;
      }
      const applied = role === "engineering" ? engApplied : trafficApplied;
      const { data } = await api.post("/export_filtered_preview", {
        role,
        column_filters: filtersToPayload(applied),
        file_format: "csv",
      });
      message.success(`导出成功: ${data.file_name}`);
    } catch (error) {
      message.error(error?.response?.data?.detail || "导出失败");
    }
  };

  const exportAllLinked = async (role) => {
    if (!linkedGroupResults.length) {
      message.info("请先执行关联筛选");
      return;
    }
    try {
      const groups = linkedGroupResults.map((g) => ({
        result_key: g.result_key,
        group_name: g.group_name || `条件组${g.group_index || ""}`,
      }));
      const { data } = await api.post("/export_nl_batch", {
        groups,
        table_type: role,
        file_format: "excel",
      });
      message.success(`批量导出成功: ${data.file_name}`);
    } catch (error) {
      message.error(error?.response?.data?.detail || "批量导出失败");
    }
  };

  const onResizeStart = (e) => {
    e.preventDefault();
    const el = e.currentTarget.closest("[data-workspace-shell]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { active: true, startY: e.clientY, startRatio: splitTopRatio, height: rect.height };
    const onMove = (ev) => {
      if (!dragRef.current.active) return;
      const { startY, startRatio, height } = dragRef.current;
      const dy = ev.clientY - startY;
      const next = Math.min(0.78, Math.max(0.22, startRatio + dy / height));
      setSplitTopRatio(next);
    };
    const onUp = () => {
      dragRef.current.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const el = activeTab === "engineering" ? engPreviewHostRef.current : trafficPreviewHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr?.height) return;
      setPreviewScrollY(Math.max(PREVIEW_TABLE_SCROLL_MIN, Math.floor(cr.height - 90)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab, splitTopRatio, engPreview.rows, trafficPreview.rows]);

  const renderPreviewCard = (role, cfg) => (
    <Card
      hoverable
      title={`${role === "engineering" ? "工参" : "话务"}预览（最多100行）`}
      style={{ ...modernCardStyle, height: "100%" }}
      extra={
        <Space size={6}>
          <Button size="small" loading={cfg.loading} onClick={cfg.onPreview}>
            预览
          </Button>
          <Button size="small" type="primary" loading={cfg.loading} onClick={cfg.onApply}>
            应用列筛选
          </Button>
          <Button size="small" onClick={() => exportCurrentCsv(role)}>
            导出 CSV
          </Button>
        </Space>
      }
      bodyStyle={{ height: "calc(100% - 56px)", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {Object.keys(cfg.appliedFilters || {}).length > 0 && (
        <Space wrap style={{ marginBottom: 8 }}>
          <Text type="secondary">已应用筛选：</Text>
          {Object.entries(cfg.appliedFilters).map(([field, vals]) => (
            <Tag key={field} closable onClose={(e) => {
              e.preventDefault();
              removeAppliedFilter(role, field);
            }}>
              {field}({Array.isArray(vals) ? vals.length : 0})
            </Tag>
          ))}
        </Space>
      )}
      <Space wrap style={{ marginBottom: 8 }}>
        <Text type="secondary">
          Total（原始表行数）: <Text strong>{cfg.totalRows ?? "—"}</Text>
        </Text>
        <Text type="secondary">
          筛选后行数: <Text strong>{cfg.filteredRows ?? "—"}</Text>
        </Text>
        {cfg.linkedStats && (
          <Text type="secondary">
            · 当前条件组关联后{" "}
            {role === "engineering" ? (
              <>
                工参行 <Text strong>{cfg.linkedStats.engineering_row_count ?? "—"}</Text>
              </>
            ) : (
              <>
                话务行 <Text strong>{cfg.linkedStats.traffic_row_count ?? "—"}</Text>
              </>
            )}
          </Text>
        )}
      </Space>
      <Search
        allowClear
        value={cfg.search}
        onChange={(e) => cfg.setSearch(e.target.value)}
        placeholder="搜索字段名"
        style={{ marginBottom: 8 }}
      />
      <div ref={cfg.tableHostRef} className="preview-table-host" style={{ flex: 1, minHeight: 0 }}>
        <Table
          size="small"
          rowKey={(_, idx) => `${role}-${idx}`}
          columns={cfg.columns}
          dataSource={cfg.rows}
          scroll={{ x: "max-content", y: previewScrollY }}
          pagination={{ pageSize: 20, position: ["topRight"] }}
        />
      </div>
    </Card>
  );

  const renderDistributionCard = (role) => {
    const d = distState[role];
    const panelKey = distPanelTab[role] || "normal";
    const cards = panelFieldsForRole(role, panelKey);
    const cardResults = selectedChartResults[role] || {};
    const panelItems = [
      { key: "normal", label: "普通分布" },
      ...linkedGroupResults.map((g, i) => ({
        key: `group-${i}`,
        label: g.group_name || `条件组${g.group_index || i + 1}`,
      })),
    ];

    return (
      <Card
        hoverable
        title="分布图"
        style={{ ...modernCardStyle, height: "100%" }}
        bodyStyle={{ height: "calc(100% - 56px)", display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Space wrap style={{ marginBottom: 8 }}>
          <Text type="secondary">当前列：{d.field || "未选择"}</Text>
          <Text type="secondary">识别类型：{d.detectedType || "—"}</Text>
          <span>
            bins{" "}
            <InputNumber
              min={3}
              max={200}
              value={d.bins}
              onChange={(v) =>
                setDistState((p) => ({
                  ...p,
                  [role]: { ...p[role], bins: v || 12 },
                }))
              }
            />
          </span>
          <span>
            步长{" "}
            <InputNumber
              min={0}
              placeholder="可选"
              value={d.binWidth}
              onChange={(v) =>
                setDistState((p) => ({
                  ...p,
                  [role]: { ...p[role], binWidth: v != null && v > 0 ? v : undefined },
                }))
              }
            />
          </span>
          <Button size="small" onClick={() => refreshChartsForRole(role)}>
            刷新
          </Button>
        </Space>
        {d.result?.note && (
          <Text type="warning" style={{ display: "block", marginBottom: 8 }}>
            {d.result.note}
          </Text>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <div style={{ height: "100%", overflow: "auto" }}>
            <Tabs
              activeKey={panelKey}
              onChange={(k) => {
                setDistPanelTab((prev) => ({ ...prev, [role]: k }));
                const m = /^group-(\d+)$/.exec(k);
                if (m) setChartGroupIndex(Number(m[1]));
              }}
              items={panelItems}
              style={{ marginBottom: 8 }}
            />
            <Space wrap style={{ marginBottom: 8 }}>
              <Text type="secondary">已选列：</Text>
              {cards.map((field) => (
                <Tag
                  key={field}
                  closable={panelKey === "normal"}
                  color={field === d.field ? "blue" : "default"}
                  onClick={() =>
                    setDistState((p) => ({
                      ...p,
                      [role]: { ...p[role], field },
                    }))
                  }
                  onClose={(e) => {
                    e.preventDefault();
                    if (panelKey !== "normal") return;
                    setSelectedChartFields((prev) => ({
                      ...prev,
                      [role]: (prev[role] || []).filter((f) => f !== field),
                    }));
                  }}
                >
                  {field}
                </Tag>
              ))}
            </Space>
            {selectedChartLoading[role] ? (
              <Spin />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexWrap: "nowrap",
                  gap: 12,
                  overflowX: "auto",
                  overflowY: "hidden",
                  paddingRight: 4,
                  paddingBottom: 6,
                }}
              >
                {cards.map((field) => (
                  <Card key={field} size="small" title={field} style={{ flex: "0 0 520px" }}>
                    <div style={{ height: 380 }}>
                      <DistributionChart result={cardResults[`${panelKey}::${field}`]} />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  };

  const workspaceStyle = {
    height: WORKSPACE_HEIGHT,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  };

  const engineeringTab = (
    <div data-workspace-shell style={workspaceStyle}>
      <div style={{ flex: splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderPreviewCard("engineering", {
          loading: previewLoading.engineering,
          onPreview: () => handlePreview("engineering"),
          onApply: applyEngFilters,
          totalRows: engTotalRows,
          filteredRows: engFilteredRows,
          linkedStats: linkFilterExecuted ? linkedGroupResults[chartGroupIndex]?.stats : null,
          appliedFilters: engApplied,
          search: engColumnSearch,
          setSearch: setEngColumnSearch,
          columns: engColumns,
          rows: engPreview.rows,
          tableHostRef: engPreviewHostRef,
        })}
      </div>
      <div className="workspace-resize-handle" onMouseDown={onResizeStart} title="上下拖动调整预览区与图表区高度" />
      <div style={{ flex: 1 - splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderDistributionCard("engineering")}
      </div>
    </div>
  );

  const trafficTab = (
    <div data-workspace-shell style={workspaceStyle}>
      <div style={{ flex: splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderPreviewCard("traffic", {
          loading: previewLoading.traffic,
          onPreview: () => handlePreview("traffic"),
          onApply: applyTrafficFilters,
          totalRows: trafficTotalRows,
          filteredRows: trafficFilteredRows,
          linkedStats: linkFilterExecuted ? linkedGroupResults[chartGroupIndex]?.stats : null,
          appliedFilters: trafficApplied,
          search: trafficColumnSearch,
          setSearch: setTrafficColumnSearch,
          columns: trafficColumns,
          rows: trafficPreview.rows,
          tableHostRef: trafficPreviewHostRef,
        })}
      </div>
      <div className="workspace-resize-handle" onMouseDown={onResizeStart} title="上下拖动调整预览区与图表区高度" />
      <div style={{ flex: 1 - splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderDistributionCard("traffic")}
      </div>
    </div>
  );

  return (
    <Layout style={{ minHeight: "100vh", background: "#f3f5f8" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={540}
        collapsedWidth={72}
        theme="light"
        style={{ padding: 12, borderRight: "1px solid #eee", overflow: "auto" }}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Card hoverable title={collapsed ? "上传" : "文件上传"} style={modernCardStyle}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  handleUpload("engineering", file);
                  return false;
                }}
                maxCount={1}
              >
                <Button block icon={<UploadOutlined />} loading={uploadingRole === "engineering"}>
                  {collapsed ? "工参" : "上传工参文件"}
                </Button>
              </Upload>
              {!collapsed && uploadInfo.engineering?.fileName ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  工参：{uploadInfo.engineering.fileName}
                  {uploadInfo.engineering.savedPath ? ` · ${uploadInfo.engineering.savedPath}` : ""}
                </Text>
              ) : null}
              <Upload
                showUploadList={false}
                beforeUpload={(file) => {
                  handleUpload("traffic", file);
                  return false;
                }}
                maxCount={1}
              >
                <Button block icon={<UploadOutlined />} loading={uploadingRole === "traffic"}>
                  {collapsed ? "话务" : "上传话务文件"}
                </Button>
              </Upload>
              {!collapsed && uploadInfo.traffic?.fileName ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  话务：{uploadInfo.traffic.fileName}
                  {uploadInfo.traffic.savedPath ? ` · ${uploadInfo.traffic.savedPath}` : ""}
                </Text>
              ) : null}
            </Space>
          </Card>

          <Card hoverable title={collapsed ? "ID" : "ID 匹配配置"} style={modernCardStyle}>
            <Space direction="vertical" style={{ width: "100%" }}>
              <Select
                showSearch
                placeholder="话务唯一 ID"
                value={trafficIdField}
                options={uploadColumns("traffic").map((c) => ({ label: c, value: c }))}
                onChange={setTrafficIdField}
                style={{ width: "100%" }}
              />
              <Select
                showSearch
                placeholder="工参唯一 ID"
                value={engineeringIdField}
                options={uploadColumns("engineering").map((c) => ({ label: c, value: c }))}
                onChange={setEngineeringIdField}
                style={{ width: "100%" }}
              />
            </Space>
          </Card>

          <Card
            hoverable
            title={collapsed ? "条件" : "条件组筛选"}
            style={modernCardStyle}
            extra={
              <Space size={4}>
                <Button size="small" onClick={addConditionGroup}>
                  新增条件组
                </Button>
              </Space>
            }
          >
            <Space direction="vertical" style={{ width: "100%" }} size="middle">
              <Space wrap>
                <Text type="secondary">条件作用于：</Text>
                <Select
                  size="small"
                  style={{ width: 120 }}
                  value={conditionRole}
                  onChange={setConditionRole}
                  options={[
                    { label: "话务", value: "traffic" },
                    { label: "工参", value: "engineering" },
                  ]}
                />
              </Space>
              {conditionGroups.map((grp, gi) => (
                <Card
                  key={grp.id}
                  size="small"
                  title={
                    <Input
                      size="small"
                      value={grp.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setConditionGroups((prev) => prev.map((g, i) => (i === gi ? { ...g, name: v } : g)));
                      }}
                      style={{ maxWidth: 160 }}
                    />
                  }
                  extra={
                    <Space>
                      <Button size="small" onClick={() => addCondition(gi)}>
                        新增条件
                      </Button>
                      {conditionGroups.length > 1 && (
                        <Button size="small" danger onClick={() => removeConditionGroup(gi)}>
                          删除组
                        </Button>
                      )}
                    </Space>
                  }
                >
                  {grp.conditions.map((cond, ci) => (
                    <div
                      key={`${grp.id}-${ci}`}
                      style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
                    >
                      <Select
                        showSearch
                        style={{ width: 180 }}
                        placeholder="字段"
                        value={cond.field}
                        options={uploadColumns(conditionRole).map((c) => ({ label: c, value: c }))}
                        onChange={async (value) => {
                          updateCondition(gi, ci, { field: value, maxValue: undefined });
                          const mv = await refreshFieldMax(value);
                          updateCondition(gi, ci, { maxValue: mv });
                        }}
                      />
                      <Select
                        style={{ width: 84 }}
                        value={cond.operator}
                        options={OP_OPTIONS.map((op) => ({ label: op, value: op }))}
                        onChange={(v) => updateCondition(gi, ci, { operator: v })}
                      />
                      <Input
                        style={{ flex: 1, minWidth: 140 }}
                        value={cond.value}
                        placeholder={cond.field ? `值(<=${cond.maxValue ?? "-"})` : "值"}
                        onChange={(e) => updateCondition(gi, ci, { value: e.target.value })}
                      />
                      <Button size="small" danger style={{ marginLeft: "auto" }} onClick={() => removeCondition(gi, ci)}>
                        删
                      </Button>
                    </div>
                  ))}
                </Card>
              ))}
              <Button type="primary" loading={runLinkLoading} onClick={runLinkedFilter} block>
                执行关联筛选
              </Button>
              <Button
                onClick={() => {
                  setActiveTab(conditionRole);
                  if (linkedGroupResults.length > 0) {
                    setChartGroupIndex(0);
                    setDistPanelTab((p) => ({ ...p, [conditionRole]: "group-0" }));
                  }
                  refreshChartsForRole(conditionRole);
                }}
                block
              >
                刷新图表
              </Button>
              {linkFilterExecuted && <Tag color="blue">已完成关联筛选</Tag>}
              {linkedGroupResults.length > 0 && (
                <Card size="small" title="按组导出（关联结果）">
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space wrap>
                      <Button size="small" type="primary" onClick={() => exportAllLinked("traffic")}>
                        一键导出全部话务
                      </Button>
                      <Button size="small" onClick={() => exportAllLinked("engineering")}>
                        一键导出全部工参
                      </Button>
                    </Space>
                    {linkedGroupResults.map((g) => (
                      <Space key={g.result_key} wrap>
                        <Text ellipsis style={{ maxWidth: 120 }}>
                          {g.group_name}
                        </Text>
                        <Button size="small" onClick={() => exportByResultKey(g.result_key, "traffic")}>
                          话务 CSV
                        </Button>
                        <Button size="small" onClick={() => exportByResultKey(g.result_key, "engineering")}>
                          工参 CSV
                        </Button>
                      </Space>
                    ))}
                  </Space>
                </Card>
              )}
            </Space>
          </Card>
        </Space>
      </Sider>

      <Layout>
        <Content style={{ padding: 16, overflow: "auto" }}>
          <Card hoverable style={modernCardStyle} bodyStyle={{ paddingTop: 8 }}>
            <Tabs
              activeKey={activeTab}
              onChange={(k) => {
                setActiveTab(k);
              }}
              items={[
                { key: "engineering", label: "工参数据分析", children: engineeringTab },
                { key: "traffic", label: "话务数据分析", children: trafficTab },
              ]}
            />
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
}
