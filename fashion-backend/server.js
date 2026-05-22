const express = require("express");
const fs = require("fs");
const app = express();
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

app.use(express.json());

// Serve static files from the parent directory
app.use(express.static(path.join(__dirname, "..")));

const csvPath = path.join(__dirname, "..", "myntra", "filtered_fashion_data.csv");

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function loadFashionData() {
  try {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parseCSV(csvText);
    if (rows.length <= 1) return [];

    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map((cols, index) => {
      const record = headers.reduce((acc, header, idx) => {
        acc[header] = cols[idx] ? cols[idx].trim() : "";
        return acc;
      }, {});

      return {
        id: record.p_id || `row${index + 1}`,
        img: record.img || "",
        colour: record.colour || "",
        occasion_clean: record.occasion_clean || "",
        description: record.description || "",
      };
    }).filter(item => item.img);
  } catch (err) {
    console.error("Failed to load CSV dataset:", err.message);
    return [];
  }
}

const fashionData = loadFashionData();
app.get("/api/images", (req, res) => {
  res.json({ success: true, data: fashionData });
});

// Route for the main swipe UI
app.get("/swipe", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "flair-swipe-ui.html"));
});

// Route for the analytics dashboard
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "flair-analytics-dashboard.html"));
});

app.get("/", (req, res) => {
  res.send("Server running");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});