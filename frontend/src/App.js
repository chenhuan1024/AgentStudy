import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Input,
  InputNumber,
  Layout,
  message,
  Modal,
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

const { Search, TextArea } = Input;
const { Text } = Typography;
const { Sider, Content } = Layout;

// 默认走同源（打包后由后端同端口托管），避免后端动态端口时出现 404/not found
const API_BASE = process.env.REACT_APP_API_URL || "";
const OP_OPTIONS = [">", "<", ">=", "<=", "="];
const WORKSPACE_HEIGHT = "calc(100vh - 150px)";
/** 预览表 body 最小高度（px），实际高度由预览区容器 ResizeObserver 决定 */
const PREVIEW_TABLE_SCROLL_MIN = 120;
const ROLE_LABEL_MAP = {
  engineering: "工参",
  traffic: "话务",
  station: "选站",
};

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
  };
}

function PreviewColumnFilterDropdown({
  role,
  columnKey,
  value,
  onDraftChange,
  distinctCache,
  setDistinctCache,
  confirm,
  loadDistinctValues,
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
        const values = loadDistinctValues
          ? await loadDistinctValues(columnKey)
          : (
              await api.post("/column_distinct", {
                role,
                field: columnKey,
                max_values: 50000,
              })
            ).data.values;
        if (cancelled) return;
        setDistinctCache((prev) => ({ ...prev, [columnKey]: values }));
        setOptions(
          (values || []).map((v) => ({
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
  }, [columnKey, distinctCache, setDistinctCache, role, loadDistinctValues]);

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
    station: { fileName: "", savedPath: "", columns: [] },
  });
  const [stationPasteText, setStationPasteText] = useState("");
  const [stationPasteModalOpen, setStationPasteModalOpen] = useState(false);
  const [uploadingPaste, setUploadingPaste] = useState(false);
  const [previewStationTrafficLoading, setPreviewStationTrafficLoading] = useState(false);
  const [stationTrafficViewKey, setStationTrafficViewKey] = useState("");
  const [stationNameField, setStationNameField] = useState();
  const [stationNameDistinctCount, setStationNameDistinctCount] = useState(null);
  const [stationNameCountLoading, setStationNameCountLoading] = useState(false);
  const [stationCellNameField, setStationCellNameField] = useState();
  const [stationCellDistinctCount, setStationCellDistinctCount] = useState(null);
  const [stationCellCountLoading, setStationCellCountLoading] = useState(false);

  const [trafficIdField, setTrafficIdField] = useState();
  const [engineeringIdField, setEngineeringIdField] = useState();

  const [previewLoading, setPreviewLoading] = useState({ engineering: false, traffic: false, station: false });
  const [engPreview, setEngPreview] = useState({ columns: [], rows: [] });
  const [trafficPreview, setTrafficPreview] = useState({ columns: [], rows: [] });
  const [stationPreview, setStationPreview] = useState({ columns: [], rows: [] });
  const [previewSourcePath, setPreviewSourcePath] = useState({ engineering: "", traffic: "", station: "" });
  const [previewDataRole, setPreviewDataRole] = useState({
    engineering: "engineering",
    traffic: "traffic",
    station: "station",
  });
  /** 原始表总行数（接口 total_row_count，不随列筛选变化） */
  const [engTotalRows, setEngTotalRows] = useState(null);
  const [trafficTotalRows, setTrafficTotalRows] = useState(null);
  const [stationTotalRows, setStationTotalRows] = useState(null);
  const [engFilteredRows, setEngFilteredRows] = useState(null);
  const [trafficFilteredRows, setTrafficFilteredRows] = useState(null);
  const [stationFilteredRows, setStationFilteredRows] = useState(null);

  const [engColumnSearch, setEngColumnSearch] = useState("");
  const [trafficColumnSearch, setTrafficColumnSearch] = useState("");
  const [stationColumnSearch, setStationColumnSearch] = useState("");

  const [engDraft, setEngDraft] = useState({});
  const [engApplied, setEngApplied] = useState({});
  const [engDistinctCache, setEngDistinctCache] = useState({});
  const [trafficDraft, setTrafficDraft] = useState({});
  const [trafficApplied, setTrafficApplied] = useState({});
  const [trafficDistinctCache, setTrafficDistinctCache] = useState({});
  const [stationDraft, setStationDraft] = useState({});
  const [stationApplied, setStationApplied] = useState({});
  const [stationDistinctCache, setStationDistinctCache] = useState({});

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
    station: emptyDistState(),
  });
  const [distPanelTab, setDistPanelTab] = useState({ engineering: "normal", traffic: "normal", station: "normal" });
  const [selectedChartFields, setSelectedChartFields] = useState({ engineering: [], traffic: [], station: [] });
  const [selectedChartResults, setSelectedChartResults] = useState({ engineering: {}, traffic: {}, station: {} });
  const [selectedChartLoading, setSelectedChartLoading] = useState({
    engineering: false,
    traffic: false,
    station: false,
  });
  const [distConfigByField, setDistConfigByField] = useState({});

  /** 上下分栏比例（上方预览占比） */
  const [splitTopRatio, setSplitTopRatio] = useState(0.56);
  const dragRef = useRef({ active: false, startY: 0, startRatio: 0.44 });
  const prevSelectedFieldsRef = useRef({ engineering: [], traffic: [], station: [] });
  const [previewScrollY, setPreviewScrollY] = useState(280);
  const engPreviewHostRef = useRef(null);
  const trafficPreviewHostRef = useRef(null);
  const stationPreviewHostRef = useRef(null);

  const clearLinkedResults = useCallback(() => {
    setLinkedGroupResults([]);
    setLinkFilterExecuted(false);
    setChartGroupIndex(0);
    setDistPanelTab({ engineering: "normal", traffic: "normal", station: "normal" });
    setSelectedChartResults({ engineering: {}, traffic: {}, station: {} });
    setStationTrafficViewKey("");
    setPreviewDataRole((prev) => ({ ...prev, station: "station" }));
    setStationNameDistinctCount(null);
    setStationCellDistinctCount(null);
  }, []);

  const chartConditionGroups = useMemo(
    () =>
      (conditionGroups || [])
        .map((g, i) => ({
          group_index: i + 1,
          group_name: g.name || `条件组${i + 1}`,
          conditions: normalizeConditions(g.conditions || []),
        }))
        .filter((g) => g.conditions.length > 0),
    [conditionGroups]
  );

  const uploadColumns = (role) => uploadInfo[role]?.columns || [];
  const conditionFieldColumns = useMemo(() => {
    if (conditionRole === "station") {
      return stationPreview.columns?.length ? stationPreview.columns : uploadColumns("traffic");
    }
    return uploadColumns(conditionRole);
  }, [conditionRole, stationPreview.columns, uploadInfo]);
  const distConfigKey = (role, panelKey, field) => `${role}::${panelKey || "normal"}::${field || "__empty__"}`;
  const getDistFieldConfig = useCallback(
    (role, panelKey, field) => {
      const key = distConfigKey(role, panelKey, field);
      return distConfigByField[key] || { bins: 12, binWidth: 10 };
    },
    [distConfigByField]
  );
  const setDistFieldConfig = useCallback((role, panelKey, field, patch) => {
    if (!field) return;
    const key = distConfigKey(role, panelKey, field);
    setDistConfigByField((prev) => ({ ...prev, [key]: { ...(prev[key] || { bins: 12, binWidth: 10 }), ...patch } }));
  }, []);

  const refreshStationNameDistinctCount = useCallback(
    async (field, viewKey, filters) => {
      if (!field || !viewKey) {
        setStationNameDistinctCount(null);
        return;
      }
      setStationNameCountLoading(true);
      try {
        const { data } = await api.post("/preview_station_traffic_distinct_count", {
          view_key: viewKey,
          field,
          column_filters: filtersToPayload(filters || {}),
        });
        setStationNameDistinctCount(data.distinct_count ?? 0);
      } catch {
        setStationNameDistinctCount(null);
      } finally {
        setStationNameCountLoading(false);
      }
    },
    []
  );

  const refreshStationCellDistinctCount = useCallback(
    async (field, viewKey, filters) => {
      if (!field || !viewKey) {
        setStationCellDistinctCount(null);
        return;
      }
      setStationCellCountLoading(true);
      try {
        const { data } = await api.post("/preview_station_traffic_distinct_count", {
          view_key: viewKey,
          field,
          column_filters: filtersToPayload(filters || {}),
        });
        setStationCellDistinctCount(data.distinct_count ?? 0);
      } catch {
        setStationCellDistinctCount(null);
      } finally {
        setStationCellCountLoading(false);
      }
    },
    []
  );

  const handleStationTrafficPreview = useCallback(async (opts = {}) => {
    const { overrideFilters } = opts;
    if (!uploadInfo.station?.savedPath) {
      message.warning("请先导入选站数据");
      return;
    }
    if (!uploadInfo.traffic?.savedPath) {
      message.warning("请先上传话务文件，再预览选站关联话务");
      return;
    }
    if (!trafficIdField) {
      message.warning("请先配置话务唯一 ID 字段");
      return;
    }
    if (!stationCellNameField && !engineeringIdField) {
      message.warning("请先配置小区名字段或工参唯一 ID 字段（用于选站 ID 关联）");
      return;
    }
    setPreviewStationTrafficLoading(true);
    try {
      const activeFilters = overrideFilters ?? stationApplied;
      const { data } = await api.post("/preview_station_traffic", {
        limit: 100,
        traffic_id_field: trafficIdField,
        station_id_field: stationCellNameField || engineeringIdField,
        traffic_column_filters: filtersToPayload(trafficApplied),
        station_column_filters: filtersToPayload(stationApplied),
        column_filters: filtersToPayload(activeFilters),
        view_key: stationTrafficViewKey || undefined,
      });
      setStationPreview({ columns: data.columns || [], rows: data.rows || [] });
      setStationTotalRows(data.total_row_count ?? null);
      setStationFilteredRows(data.matching_row_count ?? null);
      setStationTrafficViewKey(data.view_key || "");
      setPreviewSourcePath((prev) => ({
        ...prev,
        station: data.station_source_path || uploadInfo.station?.savedPath || "",
      }));
      setPreviewDataRole((prev) => ({ ...prev, station: data.view_name || "traffic" }));
      await refreshStationNameDistinctCount(stationNameField, data.view_key || stationTrafficViewKey, activeFilters);
      await refreshStationCellDistinctCount(stationCellNameField, data.view_key || stationTrafficViewKey, activeFilters);
      message.success("已刷新选站关联话务预览");
    } catch (error) {
      message.error(error?.response?.data?.detail || "预览选站话务失败");
    } finally {
      setPreviewStationTrafficLoading(false);
    }
  }, [
    uploadInfo.station?.savedPath,
    uploadInfo.traffic?.savedPath,
    trafficIdField,
    engineeringIdField,
    trafficApplied,
    stationApplied,
    stationTrafficViewKey,
    stationNameField,
    stationCellNameField,
    refreshStationNameDistinctCount,
    refreshStationCellDistinctCount,
  ]);

  const exportStationPasteText = useCallback(() => {
    const content = (stationPasteText || "").trim();
    if (!content) {
      message.warning("没有可导出的粘贴内容");
      return;
    }
    const blob = new Blob([content.endsWith("\n") ? content : `${content}\n`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `station_pasted_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [stationPasteText]);

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
      clearLinkedResults();
      const expectedSourcePath = data.source_path || savedPath;
      await handlePreview(role, undefined, { expectedSourcePath });
      if (role === "station" && uploadInfo.traffic?.savedPath && trafficIdField && (stationCellNameField || engineeringIdField)) {
        await handleStationTrafficPreview();
      }
      message.success(`${ROLE_LABEL_MAP[role] || role}上传成功`);
    } catch (error) {
      message.error(error?.response?.data?.detail || "上传失败");
    } finally {
      setUploadingRole("");
    }
  };

  const handleStationPasteUpload = async () => {
    const content = (stationPasteText || "").trim();
    if (!content) {
      message.warning("请先粘贴选站表格数据");
      return;
    }
    if (content.length > 2_000_000) {
      message.warning("粘贴数据过大，建议使用“上传选站文件”导入");
      return;
    }
    setUploadingPaste(true);
    try {
      const { data } = await api.post("/upload_pasted", {
        role: "station",
        content,
      });
      setUploadInfo((prev) => ({
        ...prev,
        station: {
          fileName: "粘贴导入",
          savedPath: data.saved_path || "",
          columns: data.columns || [],
        },
      }));
      clearLinkedResults();
      await handlePreview("station", undefined, { expectedSourcePath: data.source_path || data.saved_path || "" });
      message.success("选站数据粘贴导入成功");
      if (uploadInfo.traffic?.savedPath && trafficIdField && (stationCellNameField || engineeringIdField)) {
        await handleStationTrafficPreview();
      } else {
        message.info("已导入选站数据；如需查看关联话务，请先确认话务文件与 ID 配置后点击“预览选站话务”");
      }
      setStationPasteModalOpen(false);
    } catch (error) {
      message.error(error?.response?.data?.detail || "粘贴导入失败");
    } finally {
      setUploadingPaste(false);
    }
  };

  const handlePreview = async (role, overrideFilters, options = {}) => {
    const expectedSourcePath = options.expectedSourcePath || "";
    setPreviewLoading((prev) => ({ ...prev, [role]: true }));
    try {
      const filters =
        overrideFilters ?? (role === "engineering" ? engApplied : role === "traffic" ? trafficApplied : stationApplied);
      const { data } = await api.post("/preview", {
        role,
        limit: 100,
        column_filters: filtersToPayload(filters),
      });
      if (data?.role && data.role !== role) {
        message.error(`预览数据角色不匹配：期望 ${role}，实际 ${data.role}`);
        return;
      }
      if (expectedSourcePath && data?.source_path && expectedSourcePath !== data.source_path) {
        return;
      }
      const total = data.total_row_count ?? null;
      const filtered = data.matching_row_count ?? null;
      const sourcePath = data.source_path || "";
      if (role === "engineering") {
        setEngPreview({ columns: data.columns || [], rows: data.rows || [] });
        setEngTotalRows(total);
        setEngFilteredRows(filtered);
      } else if (role === "traffic") {
        setTrafficPreview({ columns: data.columns || [], rows: data.rows || [] });
        setTrafficTotalRows(total);
        setTrafficFilteredRows(filtered);
      } else {
        setStationPreview({ columns: data.columns || [], rows: data.rows || [] });
        setStationTotalRows(total);
        setStationFilteredRows(filtered);
        setStationTrafficViewKey("");
        setStationNameDistinctCount(null);
        setStationCellDistinctCount(null);
      }
      setPreviewSourcePath((prev) => ({ ...prev, [role]: sourcePath }));
      setPreviewDataRole((prev) => ({ ...prev, [role]: role }));
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
  const applyStationFilters = async () => {
    const next = { ...stationDraft };
    setStationApplied(next);
    if (stationTrafficViewKey) {
      await handleStationTrafficPreview({ overrideFilters: next });
    } else {
      await handlePreview("station", next);
    }
    await refreshChartsForRole("station");
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
    } else if (role === "traffic") {
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
    } else {
      setStationApplied((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setStationDraft((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      const next = { ...stationApplied };
      delete next[field];
      if (stationTrafficViewKey) {
        setTimeout(() => handleStationTrafficPreview({ overrideFilters: next }), 0);
      } else {
        setTimeout(() => handlePreview("station", next), 0);
      }
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
  const updateStationDraft = useMemo(() => updateDraftMap(setStationDraft), []);
  const loadStationDistinctValues = useCallback(
    async (columnKey) => {
      if (!stationTrafficViewKey) {
        const { data } = await api.post("/column_distinct", {
          role: "station",
          field: columnKey,
          max_values: 50000,
        });
        return data.values || [];
      }
      const { data } = await api.post("/preview_station_traffic_column_distinct", {
        view_key: stationTrafficViewKey,
        field: columnKey,
        max_values: 50000,
        column_filters: filtersToPayload(stationApplied),
      });
      return data.values || [];
    },
    [stationTrafficViewKey, stationApplied]
  );

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
    (
      role,
      cols,
      draftMap,
      distinctCache,
      setDistinctCache,
      onDraftChange,
      onPickColumn,
      pickedFields,
      activeField,
      queryRole,
      loadDistinctValues
    ) =>
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
            role={queryRole || role}
            columnKey={col}
            value={draftMap[col]}
            onDraftChange={onDraftChange}
            distinctCache={distinctCache}
            setDistinctCache={setDistinctCache}
            confirm={confirm}
            loadDistinctValues={loadDistinctValues}
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
  const stationVisibleCols = useMemo(
    () =>
      (stationPreview.columns || []).filter((c) =>
        String(c).toLowerCase().includes(stationColumnSearch.toLowerCase())
      ),
    [stationPreview.columns, stationColumnSearch]
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
        distState.engineering.field,
        "engineering",
        null
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
        distState.traffic.field,
        "traffic",
        null
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
  const stationColumns = useMemo(
    () =>
      makeColumns(
        "station",
        stationVisibleCols,
        stationDraft,
        stationDistinctCache,
        setStationDistinctCache,
        updateStationDraft,
        pickDistColumn,
        selectedChartFields.station,
        distState.station.field,
        previewDataRole.station,
        loadStationDistinctValues
      ),
    [
      makeColumns,
      stationVisibleCols,
      stationDraft,
      stationDistinctCache,
      updateStationDraft,
      pickDistColumn,
      selectedChartFields.station,
      distState.station.field,
      previewDataRole.station,
      loadStationDistinctValues,
    ]
  );

  const refreshFieldMax = async (field) => {
    if (!field) return undefined;
    try {
      const roleForMax = conditionRole === "station" ? "traffic" : conditionRole;
      const { data } = await api.post("/field_max", { role: roleForMax, field });
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
    const groupsPayloadRaw = conditionGroups.map((g) => cleanOneGroup(g.conditions)).filter((arr) => arr.length > 0);
    const isDefaultLinkMode = groupsPayloadRaw.length === 0;
    const runConditionRole = isDefaultLinkMode ? "traffic" : conditionRole;
    const groupsPayload = isDefaultLinkMode ? [[]] : groupsPayloadRaw;
    const groupNames = isDefaultLinkMode ? ["默认关联"] : conditionGroups.map((g) => g.name || "条件组");
    if (!trafficIdField) {
      message.warning("请先配置话务唯一 ID 字段");
      return;
    }
    if (!engineeringIdField) {
      message.warning("请先配置工参唯一 ID 字段");
      return;
    }
    if (runConditionRole === "station" && !stationCellNameField && !engineeringIdField) {
      message.warning("请先配置小区名字段或工参唯一 ID 字段");
      return;
    }
    if (runConditionRole === "station" && !stationTrafficViewKey) {
      message.warning("请先点击“预览选站话务”，再执行选站条件组筛选");
      return;
    }
    if (isDefaultLinkMode) {
      message.info("未配置条件，已按默认模式执行话务与工参关联筛选");
    }
    setRunLinkLoading(true);
    try {
      const { data } = await api.post("/nl_filter", {
        condition_groups: groupsPayload,
        group_names: groupNames,
        traffic_role: "traffic",
        engineering_role: "engineering",
        condition_role: runConditionRole,
        traffic_id_field: trafficIdField,
        engineering_id_field: engineeringIdField,
        station_id_field: stationCellNameField || engineeringIdField,
        traffic_column_filters: filtersToPayload(trafficApplied),
        engineering_column_filters: filtersToPayload(engApplied),
        station_column_filters: filtersToPayload(stationApplied),
        station_traffic_view_key: runConditionRole === "station" ? stationTrafficViewKey : undefined,
      });
      const groups = data.groups || [];
      setLinkedGroupResults(groups);
      setChartGroupIndex(0);
      setLinkFilterExecuted(true);
      setActiveTab(runConditionRole === "station" ? "traffic" : runConditionRole);
      message.success(`关联筛选完成：共 ${groups.length} 个条件组结果`);
      if (groups.length > 0) {
        const firstKey = groups[0].result_key;
        try {
          const engRes = await api.post("/preview_result", {
            result_key: firstKey,
            table_type: "engineering",
            limit: 100,
          });
          setEngPreview({ columns: engRes.data.columns || [], rows: engRes.data.rows || [] });
          setEngTotalRows(engRes.data.total_row_count ?? null);
          setEngFilteredRows(engRes.data.matching_row_count ?? null);
        } catch {}
        try {
          const trafficRes = await api.post("/preview_result", {
            result_key: firstKey,
            table_type: "traffic",
            limit: 100,
          });
          setTrafficPreview({ columns: trafficRes.data.columns || [], rows: trafficRes.data.rows || [] });
          setTrafficTotalRows(trafficRes.data.total_row_count ?? null);
          setTrafficFilteredRows(trafficRes.data.matching_row_count ?? null);
          if (stationTrafficViewKey) {
            setStationPreview({ columns: trafficRes.data.columns || [], rows: trafficRes.data.rows || [] });
            setStationTotalRows(trafficRes.data.total_row_count ?? null);
            setStationFilteredRows(trafficRes.data.matching_row_count ?? null);
            setPreviewDataRole((prev) => ({ ...prev, station: "traffic" }));
          }
        } catch {}
      } else {
        await handlePreview("engineering");
        await handlePreview("traffic");
        await handlePreview("station");
      }
      await refreshChartsForRole(runConditionRole, { groupsOverride: groups });
    } catch (error) {
      message.error(error?.response?.data?.detail || "执行关联筛选失败");
    } finally {
      setRunLinkLoading(false);
    }
  };

  useEffect(() => {
    if (chartConditionGroups.length && chartGroupIndex >= chartConditionGroups.length) {
      setChartGroupIndex(0);
    }
  }, [chartConditionGroups.length, chartGroupIndex, chartConditionGroups]);

  const panelFieldsForRole = useCallback(
    (role, panelKey) => {
      if (panelKey === "normal") return selectedChartFields[role] || [];
      if (role !== conditionRole) return [];
      const m = /^group-(\d+)$/.exec(panelKey || "");
      if (!m) return [];
      const idx = Number(m[1]);
      const conds = normalizeConditions(chartConditionGroups[idx]?.conditions || []);
      if (!conds.length) return [];
      return ["__group_summary__", ...conds.map((_, i) => `__cond_${i}__`)];
    },
    [selectedChartFields, chartConditionGroups, conditionRole]
  );

  const panelFieldLabel = useCallback(
    (panelKey, field) => {
      if (panelKey === "normal") return field;
      if (field === "__group_summary__") return "条件组汇总（筛选前/后）";
      const mPanel = /^group-(\d+)$/.exec(panelKey || "");
      const mCond = /^__cond_(\d+)__$/.exec(field || "");
      if (!mPanel || !mCond) return field;
      const groupIdx = Number(mPanel[1]);
      const condIdx = Number(mCond[1]);
      const conds = normalizeConditions(chartConditionGroups[groupIdx]?.conditions || []);
      const c = conds[condIdx];
      if (!c) return field;
      return `${c.field} ${c.operator} ${c.value}`;
    },
    [chartConditionGroups]
  );

  const toCountCompareResult = useCallback((beforeCount, afterCount) => {
    const before = Number.isFinite(Number(beforeCount)) ? Number(beforeCount) : 0;
    const after = Number.isFinite(Number(afterCount)) ? Number(afterCount) : 0;
    return {
      detected_type: "count_compare",
      mode: "count_compare",
      items: [
        { label: "筛选前", count: before },
        { label: "筛选后", count: after },
      ],
      note: "当前条件组图：仅展示筛选前后数量对比",
    };
  }, []);

  const refreshChartsForRole = useCallback(
    async (role, opts = {}) => {
      const { panelKeys, fields, groupsOverride } = opts;
      const cfg = distState[role];
      const dataRole = previewDataRole[role] || role;
      const applied = dataRole === "engineering" ? engApplied : dataRole === "traffic" ? trafficApplied : stationApplied;
      const previewFilters = filtersToPayload(applied);
      const groupsData = groupsOverride || chartConditionGroups;
      const includeGroupPanels = role === conditionRole;
      const keys = panelKeys || ["normal", ...(includeGroupPanels ? groupsData.map((_, i) => `group-${i}`) : [])];
      const out = {};
      setSelectedChartLoading((p) => ({ ...p, [role]: true }));
      try {
        for (const panelKey of keys) {
          const gm = /^group-(\d+)$/.exec(panelKey || "");
          const groupIdx = gm ? Number(gm[1]) : -1;
          const groupConds = groupIdx >= 0 ? normalizeConditions(groupsData[groupIdx]?.conditions || []) : [];
          const currentFields = fields || panelFieldsForRole(role, panelKey);
          if (!currentFields.length) continue;
          if (groupIdx >= 0) {
            try {
              const { data } = await api.post("/condition_chart_counts", {
                condition_role: role,
                conditions: groupConds,
                traffic_id_field: trafficIdField || "cell_id",
                engineering_id_field: engineeringIdField || "cell_id",
                station_id_field: stationCellNameField || engineeringIdField || "cell_id",
                traffic_column_filters: filtersToPayload(trafficApplied),
                engineering_column_filters: filtersToPayload(engApplied),
                station_column_filters: filtersToPayload(stationApplied),
                station_traffic_view_key: role === "station" ? stationTrafficViewKey || undefined : undefined,
              });
              const baseCount = data?.base_count ?? 0;
              out[`${panelKey}::__group_summary__`] = toCountCompareResult(baseCount, data?.group_filtered_count ?? 0);
              const oneConds = Array.isArray(data?.one_condition_counts) ? data.one_condition_counts : [];
              for (let i = 0; i < groupConds.length; i += 1) {
                const one = oneConds.find((x) => Number(x?.index) === i);
                out[`${panelKey}::__cond_${i}__`] = toCountCompareResult(baseCount, one?.filtered_count ?? 0);
              }
            } catch {
              for (const field of currentFields) {
                out[`${panelKey}::${field}`] = null;
              }
            }
            continue;
          }
          for (const field of currentFields) {
            try {
                const fieldCfg = getDistFieldConfig(role, panelKey, field);
                const { data } = await api.post("/api/distribution", {
                  table_name: dataRole,
                  column: field,
                  conditions: [],
                  preview_filters: previewFilters,
                  mode: "auto",
                  bins: fieldCfg.bins,
                  bin_width: fieldCfg.binWidth > 0 ? fieldCfg.binWidth : null,
                  x1: null,
                  x2: null,
                  compare_with_base: previewFilters.length > 0,
                });
                out[`${panelKey}::${field}`] = data;
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
    [
      distState,
      previewDataRole,
      engApplied,
      trafficApplied,
      stationApplied,
      chartConditionGroups,
      panelFieldsForRole,
      toCountCompareResult,
      distPanelTab,
      conditionRole,
      getDistFieldConfig,
      trafficIdField,
      engineeringIdField,
      stationCellNameField,
      stationTrafficViewKey,
    ]
  );

  useEffect(() => {
    for (const role of ["engineering", "traffic", "station"]) {
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
      if (role !== "station" && linkedGroupResults.length === 1) {
        await exportByResultKey(linkedGroupResults[0].result_key, role);
        return;
      }
      if (role !== "station" && linkedGroupResults.length > 1) {
        message.info("多个条件组时请使用下方「按组导出」按钮");
        return;
      }
      const applied = role === "engineering" ? engApplied : role === "traffic" ? trafficApplied : stationApplied;
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
    const el =
      activeTab === "engineering"
        ? engPreviewHostRef.current
        : activeTab === "traffic"
          ? trafficPreviewHostRef.current
          : stationPreviewHostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr?.height) return;
      setPreviewScrollY(Math.max(PREVIEW_TABLE_SCROLL_MIN, Math.floor(cr.height - 60)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab, splitTopRatio, engPreview.rows, trafficPreview.rows, stationPreview.rows]);

  const renderPreviewCard = (role, cfg) => (
    <Card
      hoverable
      title={`${ROLE_LABEL_MAP[role] || role}预览（最多100行）`}
      style={{ ...modernCardStyle, height: "100%" }}
      extra={
        <Space size={6}>
          {cfg.showPreviewButton !== false && (
            <Button size="small" loading={cfg.loading} onClick={cfg.onPreview}>
              {cfg.previewButtonText || "预览"}
            </Button>
          )}
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
      {cfg.importControls}
      {cfg.sourcePath ? (
        <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
          当前预览数据源：{cfg.sourcePath}
        </Text>
      ) : null}
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
            ) : role === "station" ? (
              <>
                选站行 <Text strong>{cfg.linkedStats.station_row_count ?? "—"}</Text>
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
          pagination={false}
        />
      </div>
    </Card>
  );

  const renderDistributionCard = (role) => {
    const d = distState[role];
    const panelKey = distPanelTab[role] || "normal";
    const cards = panelFieldsForRole(role, panelKey);
    const cardResults = selectedChartResults[role] || {};
    const activeField = cards.includes(d.field) ? d.field : cards[0];
    const activeFieldCfg = getDistFieldConfig(role, panelKey, activeField);
    const panelItems = [
      { key: "normal", label: "普通分布" },
      ...(role === conditionRole
        ? chartConditionGroups.map((g, i) => ({
            key: `group-${i}`,
            label: g.group_name || `条件组${g.group_index || i + 1}`,
          }))
        : []),
    ];

    return (
      <Card
        hoverable
        title="分布图"
        style={{ ...modernCardStyle, height: "100%" }}
        bodyStyle={{ height: "calc(100% - 56px)", display: "flex", flexDirection: "column", minHeight: 0 }}
      >
        <Space wrap style={{ marginBottom: 8 }}>
          {panelKey === "normal" ? (
            <>
              <Text type="secondary">当前列：{d.field || "未选择"}</Text>
              <Text type="secondary">识别类型：{d.detectedType || "—"}</Text>
              <span>
                步长{" "}
                <InputNumber
                  min={0}
                  placeholder="可选"
                  value={activeFieldCfg.binWidth}
                  onChange={async (v) => {
                    const nextWidth = v != null && v > 0 ? v : undefined;
                    setDistFieldConfig(role, panelKey, activeField, { binWidth: nextWidth });
                    if (activeField) {
                      await refreshChartsForRole(role, { panelKeys: [panelKey], fields: [activeField] });
                    }
                  }}
                />
              </span>
            </>
          ) : (
            <Text type="secondary">条件组图：展示筛选前/筛选后数量对比</Text>
          )}
          <Button
            size="small"
            onClick={() => {
              const panelKey = distPanelTab[role] || "normal";
              refreshChartsForRole(role, { panelKeys: [panelKey] });
            }}
          >
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
                  {panelFieldLabel(panelKey, field)}
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
                  <Card key={field} size="small" title={panelFieldLabel(panelKey, field)} style={{ flex: "0 0 520px" }}>
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
          onPreview: async () => {
            await handlePreview("engineering");
          },
          onApply: applyEngFilters,
          totalRows: engTotalRows,
          filteredRows: engFilteredRows,
          linkedStats: linkFilterExecuted ? linkedGroupResults[chartGroupIndex]?.stats : null,
          appliedFilters: engApplied,
          sourcePath: previewSourcePath.engineering,
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
          onPreview: async () => {
            await handlePreview("traffic");
          },
          onApply: applyTrafficFilters,
          totalRows: trafficTotalRows,
          filteredRows: trafficFilteredRows,
          linkedStats: linkFilterExecuted ? linkedGroupResults[chartGroupIndex]?.stats : null,
          appliedFilters: trafficApplied,
          sourcePath: previewSourcePath.traffic,
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

  const stationTab = (
    <div data-workspace-shell style={workspaceStyle}>
      <div style={{ flex: splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderPreviewCard("station", {
          loading: previewLoading.station,
          onPreview: async () => {
            await handlePreview("station");
          },
          onApply: applyStationFilters,
          totalRows: stationTotalRows,
          filteredRows: stationFilteredRows,
          linkedStats: linkFilterExecuted ? linkedGroupResults[chartGroupIndex]?.stats : null,
          appliedFilters: stationApplied,
          sourcePath: previewSourcePath.station,
          showPreviewButton: false,
          importControls: (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Select
                showSearch
                allowClear
                style={{ width: 260 }}
                placeholder="基站名字段"
                value={stationNameField}
                options={(stationPreview.columns || []).map((c) => ({ label: c, value: c }))}
                onChange={async (value) => {
                  setStationNameField(value);
                  await refreshStationNameDistinctCount(value, stationTrafficViewKey, stationApplied);
                }}
              />
              <Text style={{ color: "#cf1322" }}>
                {stationNameCountLoading ? "计算中..." : stationNameDistinctCount != null ? `${stationNameDistinctCount}站` : "—站"}
              </Text>
              <Text style={{ color: "#cf1322" }}>
                {stationCellCountLoading ? "计算中..." : stationCellDistinctCount != null ? `${stationCellDistinctCount}小区` : "—小区"}
              </Text>
              <Button
                style={{ marginLeft: "auto" }}
                loading={previewStationTrafficLoading || previewLoading.station}
                onClick={handleStationTrafficPreview}
              >
                预览选站话务
              </Button>
            </div>
          ),
          search: stationColumnSearch,
          setSearch: setStationColumnSearch,
          columns: stationColumns,
          rows: stationPreview.rows,
          tableHostRef: stationPreviewHostRef,
        })}
      </div>
      <div className="workspace-resize-handle" onMouseDown={onResizeStart} title="上下拖动调整预览区与图表区高度" />
      <div style={{ flex: 1 - splitTopRatio, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {renderDistributionCard("station")}
      </div>
    </div>
  );

  const stationPasteModal = (
    <Modal
      title="粘贴导入选站数据"
      open={stationPasteModalOpen}
      onCancel={() => setStationPasteModalOpen(false)}
      footer={
        <Space>
          <Button onClick={exportStationPasteText}>导出</Button>
          <Button onClick={() => setStationPasteModalOpen(false)}>取消</Button>
          <Button type="primary" loading={uploadingPaste} onClick={handleStationPasteUpload}>
            OK
          </Button>
        </Space>
      }
      width={860}
      destroyOnClose={false}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Text type="secondary">支持直接粘贴从 Excel 复制的表格（优先按制表符解析）</Text>
        <TextArea
          rows={12}
          value={stationPasteText}
          onChange={(e) => setStationPasteText(e.target.value)}
          placeholder="请在这里粘贴选站表格内容"
        />
      </Space>
    </Modal>
  );

  return (
    <Layout style={{ minHeight: "100vh", background: "#f3f5f8" }}>
      {stationPasteModal}
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                <Upload
                  showUploadList={false}
                  beforeUpload={(file) => {
                    handleUpload("station", file);
                    return false;
                  }}
                  maxCount={1}
                >
                  <Button icon={<UploadOutlined />} loading={uploadingRole === "station"}>
                    {collapsed ? "选站" : "上传选站文件"}
                  </Button>
                </Upload>
                {!collapsed && <Text type="secondary">或</Text>}
                <Button type="primary" onClick={() => setStationPasteModalOpen(true)}>
                  {collapsed ? "粘贴" : "粘贴选站数据"}
                </Button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {!collapsed && uploadInfo.station?.fileName ? (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    选站：{uploadInfo.station.fileName}
                    {uploadInfo.station.savedPath ? ` · ${uploadInfo.station.savedPath}` : ""}
                  </Text>
                ) : null}
                {!collapsed && (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    （粘贴数据过大时建议使用“上传选站文件”）
                  </Text>
                )}
              </div>
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
              <Select
                showSearch
                allowClear
                placeholder="小区名字段（预览选站话务优先）"
                value={stationCellNameField}
                options={uploadColumns("station").map((c) => ({ label: c, value: c }))}
                onChange={async (value) => {
                  setStationCellNameField(value);
                  await refreshStationCellDistinctCount(value, stationTrafficViewKey, stationApplied);
                }}
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
                    { label: "选站", value: "station" },
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
                        options={conditionFieldColumns.map((c) => ({ label: c, value: c }))}
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
                  if (chartConditionGroups.length > 0) {
                    setChartGroupIndex(0);
                    setDistPanelTab((p) => ({ ...p, [conditionRole]: "group-0" }));
                  }
                  const groupKeys = chartConditionGroups.map((_, i) => `group-${i}`);
                  refreshChartsForRole(conditionRole, {
                    panelKeys: groupKeys.length ? groupKeys : ["normal"],
                    groupsOverride: chartConditionGroups,
                  });
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
        <Content style={{ padding: 16, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          <Card
            hoverable
            style={{ ...modernCardStyle, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
            bodyStyle={{ paddingTop: 8, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <Tabs
              className="analysis-tabs"
              activeKey={activeTab}
              destroyInactiveTabPane
              onChange={(k) => {
                setActiveTab(k);
              }}
              items={[
                { key: "engineering", label: "工参数据分析", children: engineeringTab },
                { key: "traffic", label: "话务数据分析", children: trafficTab },
                { key: "station", label: "选站数据分析", children: stationTab },
              ]}
            />
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
}
