import React, { useMemo } from "react";
import { Empty } from "antd";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function DistributionChart({ result }) {
  const chartData = useMemo(() => {
    if (!result || !Array.isArray(result.items)) return [];
    const baseRows = result.items.map((it) => ({
      name: it.label && it.label.length > 22 ? `${it.label.slice(0, 22)}...` : it.label,
      fullLabel: it.label,
      count: it.count ?? 0,
      full_count: it.full_count ?? 0,
      filtered_count: it.filtered_count ?? 0,
    }));
    const denom = baseRows.reduce((s, r) => s + (r.filtered_count || r.count || 0), 0);
    let acc = 0;
    return baseRows.map((r) => {
      acc += r.filtered_count || r.count || 0;
      return { ...r, cdf: denom > 0 ? acc / denom : 0 };
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

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ResponsiveContainer>
        <ComposedChart data={chartData} margin={{ top: 6, right: 10, left: 8, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-24} textAnchor="end" height={58} interval={0} fontSize={12} />
          <YAxis />
          {showCdf && <YAxis yAxisId="cdf" orientation="right" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />}
          <Tooltip labelFormatter={(_, p) => (p && p.payload ? p.payload.fullLabel : "")} />
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
