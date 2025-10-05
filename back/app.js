const express = require('express');
const cors = require('cors');
const { BetaAnalyticsDataClient } = require('@google-analytics/data');
const { google } = require('googleapis');
const key = require('./sowtex-main-abfa23071b0f.json');
const app = express();
const PORT = 3000;
app.use(cors());
app.use(express.json());

// --------------------- GA4 SETUP --------------------- //
const gaClient = new BetaAnalyticsDataClient({
  credentials: {
    client_email: key.client_email,
    private_key: key.private_key,
  },
});

const GA4_PROPERTIES = {
  'sowtex.com': '334939014',
  'textile sourcing meet': '455739629',
  'blog-detail': '468706084',
};

async function fetchGAData(propertyId, startDate, endDate) {
  const [response] = await gaClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    metrics: [
      { name: 'totalUsers' },
      { name: 'newUsers' },
      { name: 'eventCount' },
    ],
    dimensions: [{ name: 'deviceCategory' }],
  });

  let desktop = 0;
  let mobile = 0;

  for (let row of response.rows) {
    const device = row.dimensionValues[0].value;
    const totalUsers = parseInt(row.metricValues[0].value);
    if (device === 'desktop') desktop += totalUsers;
    if (device === 'mobile') mobile += totalUsers;
  }

  return {
    totalUsers: parseInt(response.rows[0].metricValues[0].value),
    newUsers: parseInt(response.rows[0].metricValues[1].value),
    eventCount: parseInt(response.rows[0].metricValues[2].value),
    desktopUsers: desktop,
    mobileUsers: mobile,
  };
}

// --------------------- Sheet Auth ------------------- //
const sheetsAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: key.client_email,
    private_key: key.private_key,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth: sheetsAuth });
const SPREADSHEET_ID = "1osrRJ7UbH6qo9HmRRKwfqnMppi0b7RE_gbE2WESp4sM";


// --------------------- GSC SETUP --------------------- //
const gscAuth = new google.auth.GoogleAuth({
  credentials: {
    client_email: key.client_email,
    private_key: key.private_key,
  },
  scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
});

const searchConsole = google.searchconsole({ version: 'v1', auth: gscAuth });

const GSC_PROPERTIES = {
  'sowtex.com': 'https://sowtex.com/',
};

async function fetchSearchConsoleData(siteUrl, startDate, endDate) {
  const request = {
    siteUrl,
    requestBody: { startDate, endDate, dimensions: ['device'], rowLimit: 10 },
  };

  const response = await searchConsole.searchanalytics.query(request);

  const results = {
    totalClicks: 0,
    totalImpressions: 0,
    averageCTR: 0,
    averagePosition: 0,
    lastDayImpressions: 0,
  };

  if (response.data.rows) {
    const rowCount = response.data.rows.length;
    response.data.rows.forEach((row) => {
      results.totalClicks += row.clicks;
      results.totalImpressions += row.impressions;
      results.averageCTR += row.ctr;
      results.averagePosition += row.position;
    });
    if (rowCount > 0) {
      results.averageCTR = (results.totalClicks / results.totalImpressions) * 100;
      results.averagePosition = results.averagePosition / rowCount;
    }
  }

  // Fetch daily impressions (last day only)
  const today = new Date();
  const threeDaysAgo = new Date(today.getTime() - (3 * 24 * 60 * 60 * 1000));
  const stdt = threeDaysAgo.toISOString().split('T')[0];
  const recentEndDate = new Date(today.getTime() - (1 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  const lastDayRequest = {
    siteUrl,
    requestBody: {
      startDate: stdt,           // Changed: Use 3 days ago instead of endDate
      endDate: recentEndDate,         // Changed: Use yesterday instead of today
      dimensions: ['date'],
      rowLimit: 10,                   // Changed: Increased from 1 to 10
      dataState: 'all'                // Added: Include fresh and final data
    },
  };

  try {
    const lastDayResponse = await searchConsole.searchanalytics.query(lastDayRequest);

    if (lastDayResponse.data.rows?.length) {
      // Get the most recent day with data
      const mostRecentRow = lastDayResponse.data.rows[lastDayResponse.data.rows.length - 1];
      results.lastDayImpressions = mostRecentRow.impressions;
      console.log(`Found data for ${mostRecentRow.keys[0]} with ${mostRecentRow.impressions} impressions`);
    } else {
      console.warn('No data rows returned for the date range:', startDate, 'to', recentEndDate);
      console.warn('This could indicate no impressions or data not yet available');
    }
  } catch (e) {
    console.error(`Failed to fetch last day impressions:`, e.message);
    console.error('Request details:', JSON.stringify(lastDayRequest.requestBody, null, 2));
  }


  return results;
}

// --------------------- ROUTES --------------------- //
function formatDate(dateString) {
  const date = new Date(dateString);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-indexed
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
app.post("/api/sheet/add", async (req, res) => {
  try {
    const { startDate, endDate, sites } = req.body;

    const SHEET_NAME = "ss";
    const headerRowNumber = 2; // Headers will be in row 2

    // Prepare headers dynamically
    const headers = ["Start Date", "End Date"];
    const row = [formatDate(startDate), formatDate(endDate)];

    for (const siteName of Object.keys(sites)) {
      const metrics = sites[siteName];

      if (siteName === "sowtex.com") {
        headers.push(
          "Total Users",
          "New Users",
          "Event Count",
          "Desktop Users",
          "Mobile Users",
          "Total Clicks",
          "Total Impressions",
          "Daily Impressions",
          "CTR",
          "Avg Position",

        );

        row.push(
          metrics.totalUsers ?? 0,
          metrics.newUsers ?? 0,
          metrics.eventCount ?? 0,
          metrics.desktopUsers ?? metrics.desktop ?? 0,
          metrics.mobileUsers ?? metrics.mobile ?? 0,
          metrics.totalClicks ?? 0,
          metrics.totalImpressions ?? 0,
          metrics.lastDayImpressions ?? 0,
          metrics.averageCTR+'%' ?? 0,
          metrics.averagePosition ?? 0,
        );
      } else {
        headers.push(
          "Total Users",
          "New Users",
          "Event Count",
          "Desktop Users",
          "Mobile Users"
        );

        row.push(
          metrics.totalUsers ?? 0,
          metrics.newUsers ?? 0,
          metrics.eventCount ?? 0,
          metrics.desktopUsers ?? metrics.desktop ?? 0,
          metrics.mobileUsers ?? metrics.mobile ?? 0
        );
      }
    }

    // Check if headers exist (row 2)
    const check = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!${headerRowNumber}:${headerRowNumber}`,
    });

    if (!check.data.values || check.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A${headerRowNumber}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [headers] },
      });
    }

    // Append the row starting after headers (row 3)
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: SHEET_NAME, // append will automatically go to next empty row
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    res.json({ success: true, message: "✅ All sites data saved starting from row 3" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});



// GA4 Route
app.get('/api/ga4/dashboard-both', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const results = {};
    for (const [siteName, propertyId] of Object.entries(GA4_PROPERTIES)) {
      results[siteName] = await fetchGAData(propertyId, startDate, endDate);
    }
    res.json({ startDate, endDate, data: results });
  } catch (error) {
    console.error('GA4 Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch GA4 data' });
  }
});

// GSC Route
app.get('/api/gsc/dashboard', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const results = {};
    for (const [siteName, siteUrl] of Object.entries(GSC_PROPERTIES)) {
      results[siteName] = await fetchSearchConsoleData(siteUrl, startDate, endDate);
    }
    res.json({ startDate, endDate, data: results });
  } catch (error) {
    console.error('GSC Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch GSC data' });
  }
});

// Unified Dashboard Route
app.get('/api/dashboard/all', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const gaResults = {};
    for (const [siteName, propertyId] of Object.entries(GA4_PROPERTIES)) {
      gaResults[siteName] = await fetchGAData(propertyId, startDate, endDate);
    }

    const gscResults = {};
    for (const [siteName, siteUrl] of Object.entries(GSC_PROPERTIES)) {
      gscResults[siteName] = await fetchSearchConsoleData(siteUrl, startDate, endDate);
    }

    res.json({ startDate, endDate, googleAnalytics: gaResults, searchConsole: gscResults });
  } catch (error) {
    console.error('Unified Dashboard Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch GA4 or GSC data' });
  }
});

// --------------------- SERVER START --------------------- //
app.listen(PORT, () => {
  console.log(`✅ Server is running at http://localhost:${PORT}`);
});
