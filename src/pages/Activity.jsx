import { useEffect, useState } from "react";
import { all } from "@/lib/db";
import { exportRowsCsv } from "@/lib/csv";

export default function Activity() {
  const [list, setList] = useState([]);
  useEffect(() => { all("activity").then((a) => setList(a.sort((x, y) => y.createdAt.localeCompare(x.createdAt)))); }, []);
  return (
    <div className="space-y-4" data-testid="activity-page">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Activity Log</h1>
        <button data-testid="export-activity" onClick={() => exportRowsCsv("activity-log.csv", list)} className="border rounded-lg px-3 py-2.5 text-sm bg-white">Export CSV</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="th"><tr><th className="text-left p-3">Date / Time</th><th className="text-left p-3">Action</th><th className="text-left p-3">Detail</th><th className="text-left p-3">User</th><th className="text-left p-3 hidden sm:table-cell">Device</th></tr></thead>
          <tbody data-testid="activity-table">
            {list.slice(0, 200).map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-3 text-xs text-slate-500 whitespace-nowrap">{new Date(a.createdAt).toLocaleString("en-IN")}</td>
                <td className="p-3"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{a.action}</span></td>
                <td className="p-3">{a.detail}</td><td className="p-3">{a.user}</td>
                <td className="p-3 hidden sm:table-cell font-mono text-xs text-slate-400">{a.device}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={5} className="p-8 text-center text-slate-400">No activity yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
