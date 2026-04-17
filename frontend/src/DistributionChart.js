import React, { useMemo } from "react";
import { Empty } from "antd";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function DistributionChart({ result }) {
  const chartData = useMemo(() => {
    if (!result || !Array.isArray(result.items)) return [];
    const isCompare =
      result.items.length > 0 &&
      Object.prototype.hasOwnProperty.call(result.items[0], "full_count") &&
      Object.prototype.hasOwnProperty.call(result.items[0], "filtered_count");
    const baseRows = result.items.map((it) => {
      const label = it.label == null ? "" : String(it.label);
      return {
        name: label.length > 22 ? `${label.slice(0, 22)}...` : label,
        fullLabel: label,
        count: it.count ?? 0,
        full_count: isCompare ? (it.full_count ?? 0) : undefined,
        filtered_count: isCompare ? (it.filtered_count ?? 0) : undefined,
      };
    });
    const filteredTotal = baseRows.reduce((s, r) => s + (isCompare ? (r.filtered_count || 0) : (r.count || 0)), 0);
    const fullTotal = isCompare ? baseRows.reduce((s, r) => s + (r.full_count || 0), 0) : 0;
    let acc = 0;
    return baseRows.map((r) => {
      const filteredBase = isCompare ? (r.filtered_count || 0) : (r.count || 0);
      acc += filteredBase;
      return {
        ...r,
        cdf: filteredTotal > 0 ? acc / filteredTotal : 0,
        filteredPercent: filteredTotal > 0 ? filteredBase / filteredTotal : 0,
        fullPercent: fullTotal > 0 ? (r.full_count || 0) / fullTotal : 0,
      };
    });
  }, [result]);

  if (!result || chartData.length === 0) {
    return <Empty description="点击预览表列名后显示分布图" />;
  }

  const isCompare =
    result &&
    result.items &&
    result.items.length > 0 &&
    Object.prototype.hasOwnProperty.call(result.items[0], "full_count") &&
    Object.prototype.hasOwnProperty.call(result.items[0], "filtered_count");

  const showCdf = true;

  const renderTooltip = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const row = payload[0]?.payload || {};
    const fmtPct = (v) => `${((v || 0) * 100).toFixed(2)}%`;
    return (
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, padding: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.fullLabel || row.name}</div>
        {isCompare ? (
          <>
            <div>全表分布：{row.full_count ?? 0} ({fmtPct(row.fullPercent)})</div>
            <div>条件组过滤后：{row.filtered_count ?? 0} ({fmtPct(row.filteredPercent)})</div>
          </>
        ) : (
          <div>数量：{row.count ?? 0} ({fmtPct(row.filteredPercent)})</div>
        )}
        <div>CDF：{fmtPct(row.cdf)}</div>
      </div>
    );
  };

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 8, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-24} textAnchor="end" height={58} interval={0} fontSize={12} />
          <YAxis />
          {showCdf && <YAxis yAxisId="cdf" orientation="right" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />}
          <Tooltip content={renderTooltip} />
          {isCompare ? (
            <>
              <Bar dataKey="full_count" name="全表分布" fill="#c9ccd3" />
              <Bar dataKey="filtered_count" name="条件组过滤后" fill="#1677ff" />
            </>
          ) : (
            <Bar dataKey="count" name="数量" fill="#1677ff" />
          )}
          {showCdf && <Line yAxisId="cdf" dataKey="cdf" name="CDF" stroke="#ff4d4f" strokeWidth={2} dot={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
