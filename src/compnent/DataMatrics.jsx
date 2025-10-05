import React, { useState } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

const Dashboard = () => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);

  const presets = [
    { label: 'Last 7 Days', days: 7 },
    { label: 'Last 28 Days', days: 28 },
    { label: 'Last 1 Month', days: 30 },
    { label: 'Last 3 Months', days: 90 },
  ];

  const fetchData = async (start, end) => {
    try {
      setLoading(true);
      const res = await axios.get('http://localhost:3000/api/dashboard/all', {
        params: { startDate: start, endDate: end },
      });
      setMetrics(res.data);
    } catch (err) {
      alert('Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = (days) => {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(); 
    start.setDate(end.getDate() - days);
    const toStr = (d) => d.toISOString().split('T')[0];
    setStartDate(toStr(start));
    setEndDate(toStr(end));
    fetchData(toStr(start), toStr(end));
  };

  const handleAddToSheet = async () => {
    if (!metrics) return;

    try { 
      const payload = {
        startDate: metrics.startDate,
        endDate: metrics.endDate,
        sites: {} // { siteName: { GA + GSC metrics } }
      };

      for (const site of Object.keys(metrics.googleAnalytics)) {
        const ga = metrics.googleAnalytics[site];
        const gsc = metrics.searchConsole?.[site] || {};
        payload.sites[site] = { ...ga, ...gsc };
        console.log(ga, gsc)
      }



      await axios.post("http://localhost:3000/api/sheet/add", payload);

      alert("✅ Data pushed to Google Sheet in one row per date!");
    } catch (err) {
      console.error(err);
      alert("❌ Failed to push data to Google Sheet");
    }
  };


  const handleDownloadExcel = () => {
    if (!metrics) return;

    const headers = [
      "Website",
      "From Date",
      "To Date",
      "Total Users",
      "New Users",
      "Event Count",
      "Desktop Users",
      "Mobile Users",
      "GSC Clicks",
      "GSC Impressions",
      "GSC CTR (%)", // 👈 updated
      "GSC Avg. Position",
      "GSC Daily Impressions" // 👈 new
    ];

    const allSites = new Set([
      ...Object.keys(metrics.googleAnalytics || {}),
      ...Object.keys(metrics.searchConsole || {})
    ]);

    const data = Array.from(allSites).map((site) => {
      const ga = metrics.googleAnalytics?.[site] || {};
      const gsc = metrics.searchConsole?.[site] || {};
      return [
        site,
        metrics.startDate,
        metrics.endDate,
        ga.totalUsers ?? '-',
        ga.newUsers ?? '-',
        ga.eventCount ?? '-',
        ga.desktopUsers ?? '-',
        ga.mobileUsers ?? '-',
        gsc.totalClicks ?? '-',
        gsc.totalImpressions ?? '-',
        gsc.averageCTR?.toFixed(2) ?? '-', // 👈 percentage
        gsc.averagePosition?.toFixed(2) ?? '-',
        gsc.lastDayImpressions ?? '-', // 👈 new
      ];
    });

    const sheetData = [headers, ...data];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dashboard Report");

    const blob = new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], {
      type: "application/octet-stream",
    });

    saveAs(blob, `analytics_${metrics.startDate}_to_${metrics.endDate}.xlsx`);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h1 className="text-2xl font-bold mb-6 text-center">📊 Combined Analytics Dashboard</h1>

      {/* Date Picker */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-center mb-6">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <button
          onClick={() => fetchData(startDate, endDate)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Get Analysis
        </button>
      </div>

      {/* Presets */}
      <div className="flex justify-center gap-3 mb-6 flex-wrap">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => handlePresetClick(p.days)}
            className="bg-gray-300 hover:bg-gray-400 px-3 py-1 rounded"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && <p className="text-center text-gray-600">Loading...</p>}

      {/* Analytics Data */}
      {metrics && (
        <>
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {Array.from(new Set([
              ...Object.keys(metrics.googleAnalytics || {}),
              ...Object.keys(metrics.searchConsole || {}),
            ])).map((site) => {
              const ga = metrics.googleAnalytics?.[site] || {};
              const gsc = metrics.searchConsole?.[site] || {};
              return (
                <div key={site} className="bg-white rounded p-4 shadow">
                  <h2 className="text-lg font-semibold text-center mb-4">{site}</h2>

                  {/* GA4 Section */}
                  <h3 className="text-md font-semibold mt-4 mb-2 text-blue-600">Google Analytics (GA4)</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <MetricCard title="Total Users" value={ga.totalUsers} />
                    <MetricCard title="New Users" value={ga.newUsers} />
                    <MetricCard title="Event Count" value={ga.eventCount} />
                    <MetricCard title="Desktop Users" value={ga.desktopUsers} />
                    <MetricCard title="Mobile Users" value={ga.mobileUsers} />
                  </div>

                  {/* GSC Section only for sowtex.com */}
                  {site === 'sowtex.com' && (
                    <>
                      <h3 className="text-md font-semibold mt-6 mb-2 text-green-600">Google Search Console</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <MetricCard title="GSC Clicks" value={gsc.totalClicks} />
                        <MetricCard title="GSC Impressions" value={gsc.totalImpressions} />
                        <MetricCard title="GSC CTR (%)" value={gsc.averageCTR?.toFixed(2)} />
                        <MetricCard title="GSC Avg. Position" value={gsc.averagePosition?.toFixed(2)} />
                        <MetricCard title="GSC Daily Impressions" value={gsc.lastDayImpressions} />
                      </div>
                    </>
                  )}
                </div>

              );
            })}
          </div>

          {/* Download */}
          <div className="flex justify-center">
            <button
              onClick={handleDownloadExcel}
              className="bg-yellow-500 text-white px-4 py-2 rounded hover:bg-yellow-600"
            >
              Download Excel (GA4 + GSC)
            </button>
            <button
              onClick={handleAddToSheet}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Push Data to Google Sheet
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const MetricCard = ({ title, value }) => (
  <div className="bg-gray-100 p-3 rounded shadow text-center">
    <p className="text-sm text-gray-600">{title}</p>
    <p className="text-xl font-bold">{value ?? '-'}</p>
  </div>
);

export default Dashboard;
