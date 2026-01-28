import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  browserSessionPersistence,
} from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase.js";

const navItems = [
  "Dashboard",
  "Summary",
  "Insight",
  "Groups",
  "Expense",
  "Activity",
];

const defaultDashboardTiles = [
  { id: "expenseRange", label: "Spend by period", size: "medium", rangeKey: "7d" },
  {
    id: "categoryPie",
    label: "Spend by category",
    size: "small",
    monthKey: new Date().toISOString().slice(0, 7),
  },
  {
    id: "monthlyTable",
    label: "Monthly spend",
    size: "large",
    monthKey: new Date().toISOString().slice(0, 7),
  },
  { id: "totalExpenses", label: "Total expenses", size: "small", rangeKey: "7d" },
  { id: "groupTotals", label: "Group totals", size: "small", rangeKey: "7d" },
  { id: "insightsStats", label: "Insights", size: "small", rangeKey: "7d" },
  { id: "expenseOverview", label: "Expense overview", size: "medium", rangeKey: "7d" },
  { id: "monthlyTrend", label: "Monthly trend", size: "small", rangeKey: "7d" },
  { id: "recentExpenses", label: "Recent expenses", size: "small", rangeKey: "7d" },
  { id: "groupsList", label: "Groups", size: "small", rangeKey: "7d" },
  { id: "recentActivity", label: "Recent activity", size: "small", rangeKey: "7d" },
  { id: "topPayer", label: "Top payer", size: "small", rangeKey: "7d" },
];
const rangeOptions = [
  { value: "7d", label: "7 days" },
  { value: "1m", label: "1 month" },
  { value: "2m", label: "2 months" },
  { value: "3m", label: "3 months" },
  { value: "4m", label: "4 months" },
  { value: "5m", label: "5 months" },
  { value: "6m", label: "6 months" },
  { value: "1y", label: "1 year" },
];

const currencyOptions = ["EUR", "USD", "GBP", "INR", "CAD", "AUD"];
const expenseCategoryOptions = [
  "Clothes",
  "Food",
  "Groceries",
  "Alcohol",
  "Transport",
  "Recurring Spend",
  "Miscellaneous",
];
const groupTypes = [
  "Trip",
  "Groceries",
  "Home/Household",
  "Roommates",
  "Event/Party",
  "Office/Team",
  "Vacation",
  "Couple",
  "Friends",
  "Family",
];
const pieColors = [
  "#2e7d32",
  "#e53935",
  "#d81b60",
  "#8e24aa",
  "#f9a825",
  "#64b5f6",
  "#0d47a1",
];
const categoryColorMap = {
  Groceries: "#2e7d32",
  Alcohol: "#e53935",
  Transport: "#f48fb1",
  "Recurring Spend": "#8e24aa",
  Miscellaneous: "#f9a825",
  Clothes: "#64b5f6",
  Food: "#0d47a1",
};

function getCategoryColor(label, index) {
  if (categoryColorMap[label]) return categoryColorMap[label];
  return pieColors[index % pieColors.length];
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

function itemCurrency(expenses, category) {
  const set = new Set(
    expenses
      .filter((item) => (item.category || "Other") === category)
      .map((item) => item.currency || "EUR")
  );
  return set.size === 1 ? [...set][0] : "MIXED";
}

function overallCurrency(expenses) {
  const set = new Set(expenses.map((item) => item.currency || "EUR"));
  return set.size === 1 ? [...set][0] : "MIXED";
}

function normalizeDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const setMidday = (date) => {
    if (date.getHours() === 0 && date.getMinutes() === 0) {
      date.setHours(12, 0, 0, 0);
    }
    return date;
  };
  if (typeof value === "number") {
    const numeric = new Date(value);
    return Number.isNaN(numeric.getTime()) ? null : setMidday(numeric);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymdMatch) {
      const [, y, m, d] = ymdMatch;
      return setMidday(new Date(Number(y), Number(m) - 1, Number(d)));
    }
    const ymMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
    if (ymMatch) {
      const [, y, m] = ymMatch;
      return setMidday(new Date(Number(y), Number(m) - 1, 1));
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : setMidday(parsed);
}

function expenseLatestTime(expense) {
  const updated =
    expense?.updatedAt instanceof Date
      ? expense.updatedAt
      : normalizeDate(expense?.updatedAt);
  const created =
    expense?.createdAt instanceof Date
      ? expense.createdAt
      : normalizeDate(expense?.createdAt);
  if (updated) return updated.getTime();
  if (created) return created.getTime();
  return 0;
}

function sortExpensesByLatest(expenses) {
  return [...expenses].sort((a, b) => expenseLatestTime(b) - expenseLatestTime(a));
}

function toDateInputValue(value) {
  const date = normalizeDate(value);
  if (!date) return "";
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 10);
}

function parseCsv(text) {
  const sanitized = String(text || "").replace(/\u0000/g, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < sanitized.length; i += 1) {
    const char = sanitized[i];
    if (inQuotes) {
      if (char === "\"") {
        if (sanitized[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === "," || char === ";" || char === "\t") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((item) => item.some((value) => value.trim() !== ""));
}

function buildImportedExpenses(csvText, groupList, currentUserId) {
  let rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  if (rows.every((row) => row.length <= 1)) {
    rows = rows
      .map((row) =>
        String(row[0] || "")
          .split(/\s{2,}/)
          .filter((cell) => cell !== "")
      )
      .filter((row) => row.length);
  }
  const normalizeHeader = (value) =>
    String(value || "")
      .replace(/\uFEFF/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  const categoryHeaders = expenseCategoryOptions.map((item) =>
    normalizeHeader(item)
  );
  let headerIndex = rows.findIndex((row) => {
    const normalized = row.map(normalizeHeader);
    return (
      normalized.includes("date") &&
      (normalized.includes("month") ||
        normalized.includes("total spend") ||
        normalized.some((cell) => categoryHeaders.includes(cell)))
    );
  });
  if (
    headerIndex < 0 &&
    normalizeHeader(rows[0][0] || "").includes("monthly spend analysis") &&
    rows.length > 1
  ) {
    headerIndex = 1;
  }
  if (headerIndex < 0) headerIndex = 0;
  const headers = rows[headerIndex].map(normalizeHeader);
  const dataRows = rows.slice(headerIndex + 1);
  const indexFor = (aliases) =>
    headers.findIndex((header) =>
      aliases.some((alias) => header === alias || header.includes(alias))
    );
  const amountIndex = indexFor(["amount", "total", "value", "cost"]);
  const categoryIndex = indexFor(["category", "type"]);
  const currencyIndex = indexFor(["currency", "cur"]);
  const dateIndex = indexFor(["date", "createdat", "created_at", "time"]);
  const monthIndex = indexFor(["month"]);
  const yearIndex = indexFor(["year", "yr"]);
  const groupIndex = indexFor([
    "group",
    "group name",
    "group_name",
    "groupname",
  ]);
  const noteIndex = indexFor(["note", "notes", "description"]);
  const payerIndex = indexFor([
    "paidby",
    "paid_by",
    "paid by",
    "payer",
    "member",
    "name",
  ]);

  const groupByName = new Map(
    groupList.map((group) => [group.name.toLowerCase(), group])
  );
  const importStamp = Date.now();
  const parseAmount = (value) => {
    const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
    if (!cleaned) return Number.NaN;
    const amount = Number(cleaned);
    return Number.isNaN(amount) ? Number.NaN : amount;
  };
  const extractYear = (value) => {
    const match = String(value || "").match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : null;
  };

  const categoryIndexMap = expenseCategoryOptions
    .map((cat) => ({
      category: cat,
      header: normalizeHeader(cat),
    }))
    .map((entry) => {
      const index = headers.indexOf(entry.header);
      if (index < 0) return null;
      const next = headers[index + 1] || "";
      const amountIndexForCategory = next === "" ? index + 1 : index;
      return {
        ...entry,
        index,
        amountIndex:
          amountIndexForCategory >= headers.length ? index : amountIndexForCategory,
      };
    })
    .filter(Boolean);
  const hasPivotFormat = dateIndex >= 0 && categoryIndexMap.length > 0;

  if (hasPivotFormat) {
    const detectedYear =
      rows
        .map((row) =>
          row.reduce((found, cell) => found || extractYear(cell), null)
        )
        .find((value) => value) || null;
    let activeYear = detectedYear || new Date().getFullYear();
    let activeMonth = "";
    let activeDate = null;
    return dataRows.reduce((acc, row, rowIndex) => {
      const monthCell = monthIndex >= 0 ? row[monthIndex] : "";
      const yearCell = yearIndex >= 0 ? row[yearIndex] : "";
      const yearFromCell = extractYear(yearCell);
      if (yearFromCell) activeYear = yearFromCell;
      const dateCell = dateIndex >= 0 ? row[dateIndex] : "";
      const monthValue = normalizeHeader(monthCell);
      if (monthValue && monthValue.startsWith("total")) return acc;
      if (normalizeHeader(dateCell).startsWith("total")) return acc;
      if (monthValue) {
        activeMonth = String(monthCell || "").trim();
        const monthYear = extractYear(activeMonth);
        if (monthYear) activeYear = monthYear;
      }
      const hasDateInfo = String(dateCell || "").trim() !== "";
      if (!hasDateInfo && !monthCell) {
        const hasAnyAmount = categoryIndexMap.some((entry) =>
          row[entry.amountIndex] || row[entry.index]
        );
        if (!hasAnyAmount || !activeDate) return acc;
      }

      let createdAt = hasDateInfo ? normalizeDate(dateCell) : null;
      if (!createdAt && hasDateInfo) {
        const dayMatch = String(dateCell).match(/\d{1,2}/);
        const monthName = String(activeMonth || "")
          .replace(/\b(19|20)\d{2}\b/, "")
          .trim();
        if (dayMatch && monthName) {
          createdAt = normalizeDate(
            `${monthName} ${dayMatch[0]}, ${activeYear}`
          );
        }
      }
      if (!createdAt) createdAt = activeDate || normalizeDate(`${activeMonth || "January"} 1, ${activeYear}`);
      if (hasDateInfo) activeDate = createdAt;

      const baseId = `import-${importStamp}-${rowIndex}`;
      categoryIndexMap.forEach((entry, index) => {
        const labelValue = row[entry.index] || "";
        const amountValue = row[entry.amountIndex] || "";
        const amountCandidate =
          entry.amountIndex !== entry.index
            ? parseAmount(amountValue)
            : parseAmount(labelValue);
        const fallbackAmount =
          entry.amountIndex !== entry.index ? parseAmount(labelValue) : Number.NaN;
        const amount =
          !Number.isNaN(amountCandidate) && amountCandidate !== 0
            ? amountCandidate
            : fallbackAmount;
        if (Number.isNaN(amount) || amount === 0) return;
        const labelAmount = parseAmount(labelValue);
        const noteValue =
          Number.isNaN(labelAmount) && String(labelValue || "").trim()
            ? String(labelValue).trim()
            : "";
        acc.push({
          id: `${baseId}-${index}`,
          amount,
          category: entry.category,
          currency: "EUR",
          createdAt,
          groupId: "",
          note: noteValue,
          paidByName: "",
          createdBy: currentUserId || "",
        });
      });
      return acc;
    }, []);
  }

  return dataRows.reduce((acc, row, idx) => {
    const amount = parseAmount(amountIndex >= 0 ? row[amountIndex] : "");
    if (Number.isNaN(amount)) return acc;
    const rawDate = dateIndex >= 0 ? row[dateIndex] : "";
    const createdAt = normalizeDate(rawDate) || new Date();
    const rawGroup = groupIndex >= 0 ? row[groupIndex] : "";
    const group = rawGroup
      ? groupByName.get(String(rawGroup).trim().toLowerCase())
      : null;
    const currency =
      (currencyIndex >= 0 ? row[currencyIndex] : "") ||
      group?.currency ||
      "EUR";
    const category =
      (categoryIndex >= 0 ? row[categoryIndex] : "") || "Miscellaneous";
    const note = noteIndex >= 0 ? row[noteIndex] : "";
    const paidByName = payerIndex >= 0 ? row[payerIndex] : "";
    acc.push({
      id: `import-${importStamp}-${idx}`,
      amount,
      category: String(category).trim() || "Miscellaneous",
      currency: String(currency).trim() || "EUR",
      createdAt,
      groupId: group?.id || "",
      note: String(note || "").trim(),
      paidByName: String(paidByName || "").trim(),
      createdBy: currentUserId || "",
    });
    return acc;
  }, []);
}

function serializeImportedExpenses(expenses) {
  return expenses.map((item) => ({
    id: item.id,
    amount: Number(item.amount || 0),
    category: item.category || "Miscellaneous",
    currency: item.currency || "GBP",
    createdAt: item.createdAt ? item.createdAt.toISOString() : null,
    groupId: item.groupId || "",
    note: item.note || "",
    paidByName: item.paidByName || "",
    createdBy: item.createdBy || "",
  }));
}

function hydrateImportedExpenses(items) {
  return items
    .map((item) => ({
      ...item,
      createdAt: normalizeDate(item.createdAt),
    }))
    .filter((item) => item.createdAt);
}

function serializeImportedCsvFiles(files) {
  return files.map((file) => ({
    id: file.id,
    name: file.name || "import.csv",
    text: file.text || "",
    rowCount: Number(file.rowCount || 0),
    currency: file.currency || "GBP",
    importedAt: file.importedAt ? file.importedAt.toISOString() : null,
  }));
}

function hydrateImportedCsvFiles(files) {
  return files
    .map((file) => ({
      ...file,
      currency: file.currency || "GBP",
      importedAt: normalizeDate(file.importedAt),
    }))
    .filter((file) => file.importedAt);
}

function buildMonthlyTable(expenses, categories, monthKey, currentUserId) {
  const monthDate = monthKey ? new Date(`${monthKey}-01`) : new Date();
  const monthLabel = monthDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const rows = new Map();
  const totals = new Map(categories.map((cat) => [cat, 0]));
  let totalSpend = 0;

  const scopedExpenses = currentUserId
    ? expenses.filter((item) => item.createdBy === currentUserId)
    : expenses;

  scopedExpenses.forEach((item) => {
    if (!item.createdAt) return;
    const created = item.createdAt;
    if (
      created.getFullYear() !== monthDate.getFullYear() ||
      created.getMonth() !== monthDate.getMonth()
    ) {
      return;
    }
    const rowMonthLabel = created.toLocaleDateString("en-US", { month: "long" });
    const dateLabel = `${created.getDate()} - ${created.toLocaleDateString(
      "en-US",
      { weekday: "long" }
    )}`;
    const key = `${created.getFullYear()}-${created.getMonth()}-${created.getDate()}`;
    if (!rows.has(key)) {
      rows.set(key, {
        month: rowMonthLabel,
        date: dateLabel,
        ts: created.getTime(),
        categories: new Map(categories.map((cat) => [cat, 0])),
        total: 0,
      });
    }
    const row = rows.get(key);
    const category = categories.includes(item.category)
      ? item.category
      : "Miscellaneous";
    row.categories.set(
      category,
      (row.categories.get(category) || 0) + Number(item.amount || 0)
    );
    row.total += Number(item.amount || 0);
    totals.set(category, (totals.get(category) || 0) + Number(item.amount || 0));
    totalSpend += Number(item.amount || 0);
  });

  const sortedRows = Array.from(rows.values()).sort((a, b) => a.ts - b.ts);

  return {
    monthLabel,
    rows: sortedRows,
    totals,
    totalSpend,
  };
}

function buildRangeData(expenses, rangeKey, currentUserId, categories = []) {
  const now = new Date();
  const buckets = new Map();
  const addBucket = (label) => {
    if (!buckets.has(label)) buckets.set(label, 0);
  };
  const bucketLabel = (date, mode) => {
    if (mode === "day") {
      return `${date.getMonth() + 1}/${date.getDate()}`;
    }
    if (mode === "week") {
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      return `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  const mode =
    rangeKey === "7d"
      ? "day"
      : rangeKey === "1m" || rangeKey === "2m"
      ? "week"
      : "month";
  const backDays =
    rangeKey === "7d"
      ? 6
      : rangeKey === "1m"
      ? 29
      : rangeKey === "2m"
      ? 59
      : rangeKey === "3m"
      ? 89
      : rangeKey === "4m"
      ? 119
      : rangeKey === "5m"
      ? 149
      : rangeKey === "6m"
      ? 179
      : 364;
  const start = new Date(now);
  start.setDate(now.getDate() - backDays);

  for (
    let i = 0;
    i <= backDays;
    i += mode === "day" ? 1 : mode === "week" ? 7 : 30
  ) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    addBucket(bucketLabel(d, mode));
  }

  const scopedExpenses = currentUserId
    ? expenses.filter((item) => item.createdBy === currentUserId)
    : expenses;
  scopedExpenses.forEach((item) => {
    if (!item.createdAt) return;
    if (item.createdAt < start || item.createdAt > now) return;
    const label = bucketLabel(item.createdAt, mode);
    buckets.set(label, (buckets.get(label) || 0) + Number(item.amount || 0));
  });

  const bucketMap = new Map();
  buckets.forEach((amount, label) => {
    bucketMap.set(label, {
      label,
      amount,
      values: new Map(categories.map((cat) => [cat, 0])),
    });
  });

  scopedExpenses.forEach((item) => {
    if (!item.createdAt) return;
    if (item.createdAt < start || item.createdAt > now) return;
    const label = bucketLabel(item.createdAt, mode);
    const category = categories.includes(item.category)
      ? item.category
      : "Miscellaneous";
    const bucket = bucketMap.get(label);
    if (!bucket) return;
    bucket.values.set(
      category,
      (bucket.values.get(category) || 0) + Number(item.amount || 0)
    );
  });

  return Array.from(bucketMap.values());
}

function filterExpensesByRange(expenses, rangeKey, currentUserId) {
  const now = new Date();
  const backDays =
    rangeKey === "7d"
      ? 6
      : rangeKey === "1m"
      ? 29
      : rangeKey === "2m"
      ? 59
      : rangeKey === "3m"
      ? 89
      : rangeKey === "4m"
      ? 119
      : rangeKey === "5m"
      ? 149
      : rangeKey === "6m"
      ? 179
      : 364;
  const start = new Date(now);
  start.setDate(now.getDate() - backDays);
  const scopedExpenses = currentUserId
    ? expenses.filter((item) => item.createdBy === currentUserId)
    : expenses;
  return scopedExpenses.filter((item) => {
    if (!item.createdAt) return false;
    return item.createdAt >= start && item.createdAt <= now;
  });
}

function filterExpensesByMonthKey(expenses, monthKey, currentUserId) {
  const scopedExpenses = currentUserId
    ? expenses.filter((item) => item.createdBy === currentUserId)
    : expenses;
  if (!monthKey) return scopedExpenses;
  const match = String(monthKey).match(/^(\d{4})-(\d{2})$/);
  if (!match) return scopedExpenses;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return scopedExpenses.filter(
    (item) =>
      item.createdAt &&
      item.createdAt.getFullYear() === year &&
      item.createdAt.getMonth() === monthIndex
  );
}

function calculateGroupBalances(group, expenses) {
  if (!group) return [];
  const groupExpenses = expenses.filter((expense) => expense.groupId === group.id);
  const members = group?.members?.length
    ? group.members
    : group?.membersCount
    ? Array.from({ length: group.membersCount }).map((_, index) => ({
        uid: `member-${index}`,
        name: `Member ${index + 1}`,
      }))
    : [];
  if (!members.length) return [];
  const balances = new Map(
    members.map((member) => [
      member.uid,
      {
        uid: member.uid,
        name: member.name || member.email || "Member",
        total: 0,
      },
    ])
  );

  groupExpenses.forEach((expense) => {
    const payerId = expense.paidByUid || expense.createdBy;
    const amount = Number(expense.amount || 0);
    if (!amount) return;
    const share = amount / members.length;
    members.forEach((member) => {
      const entry = balances.get(member.uid);
      if (!entry) return;
      entry.total -= share;
    });
    if (payerId) {
      const entry =
        balances.get(payerId) || {
          uid: payerId,
          name: expense.paidByName || "Payer",
          total: 0,
        };
      entry.total += amount;
      balances.set(payerId, entry);
    }
  });

  return Array.from(balances.values());
}

function calculateOverallBalances(groupList, expenses) {
  const combined = new Map();
  groupList.forEach((group) => {
    calculateGroupBalances(group, expenses).forEach((entry) => {
      const key = entry.uid || entry.name;
      const next =
        combined.get(key) || {
          uid: entry.uid,
          name: entry.name,
          total: 0,
        };
      next.total += entry.total;
      combined.set(key, next);
    });
  });
  return Array.from(combined.values());
}

function formatCurrency(value, currency = "EUR") {
  if (currency === "MIXED") {
    return `Mixed ${Number(value || 0).toLocaleString()}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(value || 0));
  } catch (err) {
    return `${currency} ${Number(value || 0).toLocaleString()}`;
  }
}

function BarChart({ data, maxValue, horizontal = false, xAxis = false }) {
  return (
    <div
      className={`chart-bars ${horizontal ? "chart-bars--horizontal" : ""} ${
        xAxis ? "chart-bars--xaxis" : ""
      }`}
    >
      {data.map((item, index) => (
        <div className="chart-bar" key={item.id || item.label || index}>
          <div
            className="chart-bar__fill"
            style={
              horizontal
                ? { width: `${Math.round((item.amount / maxValue) * 100)}%` }
                : { height: `${Math.round((item.amount / maxValue) * 100)}%` }
            }
          />
          <span>{item.label || item.category || "Expense"}</span>
        </div>
      ))}
    </div>
  );
}

function StackedBarChart({ data, categories }) {
  if (!data.length) return <p className="empty">No data yet.</p>;
  const totals = data.map((item) =>
    categories.reduce((sum, cat) => sum + (item.values.get(cat) || 0), 0)
  );
  const max = Math.max(...totals, 1);
  return (
    <div className="stacked-chart">
      <div className="stacked-chart__bars">
        {data.map((item, index) => (
          <div className="stacked-chart__bar" key={item.label || index}>
            <div className="stacked-chart__stack">
              {categories.map((cat, idx) => {
                const value = item.values.get(cat) || 0;
                const height = (value / max) * 100;
                return value ? (
                  <span
                    key={cat}
                    className="stacked-chart__segment"
                    style={{
                      height: `${height}%`,
                      background: getCategoryColor(cat, idx),
                    }}
                    title={`${cat}: ${value}`}
                  />
                ) : null;
              })}
            </div>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="stacked-chart__legend">
        {categories.map((cat, idx) => (
          <div key={cat}>
            <span
              className="pie__dot"
              style={{ background: getCategoryColor(cat, idx) }}
            />
            {cat}
          </div>
        ))}
      </div>
    </div>
  );
}

function Donut({ value, total }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="donut">
      <div
        className="donut__track"
        style={{
          background: `conic-gradient(var(--accent) ${percent * 3.6}deg, var(--surface-2) 0deg)`,
        }}
      />
      <div className="donut__center">
        <strong>{percent}%</strong>
        <span>settled</span>
      </div>
    </div>
  );
}

function LineChart({ data }) {
  if (!data.length) return <p className="empty">No trend data yet.</p>;
  const values = data.map((point) => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const width = 260;
  const height = 90;
  const step = width / (data.length - 1 || 1);
  const points = data
    .map((point, index) => {
      const x = index * step;
      const y = height - ((point.value - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
      <div className="line-chart__labels">
        <span>{data[0].label}</span>
        <span>{data[data.length - 1].label}</span>
      </div>
    </div>
  );
}

function PieChart({ data }) {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  let cumulative = 0;
  const segments = data
    .map((item) => {
      const start = (cumulative / total) * 360;
      cumulative += item.value;
      const end = (cumulative / total) * 360;
      return `${item.color} ${start}deg ${end}deg`;
    })
    .join(", ");

  return (
    <div className="pie">
      <div
        className="pie__chart"
        style={{ background: `conic-gradient(${segments})` }}
      />
      <div className="pie__legend">
        {data.map((item) => (
          <div key={item.label} className="pie__item">
            <div className="pie__label">
              <span className="pie__dot" style={{ background: item.color }} />
              <span>{item.label}</span>
            </div>
            <strong>{formatCurrency(item.value, item.currency)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function getAuthErrorMessage(error) {
  if (!error || !error.code) return "Unable to sign in. Try again.";
  switch (error.code) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Email or password is incorrect.";
    case "auth/email-already-in-use":
      return "That email is already in use. Try logging in.";
    case "auth/weak-password":
      return "Password should be at least 6 characters.";
    case "auth/user-not-found":
      return "No account found for this email.";
    case "auth/wrong-password":
      return "Email or password is incorrect.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function LoginPage({ darkMode, onToggleTheme }) {
  const [mode, setMode] = useState("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        if (!fullName.trim()) {
          setError("Please enter your full name.");
          setBusy(false);
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setBusy(false);
          return;
        }
        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );
        if (credential.user) {
          await updateProfile(credential.user, {
            displayName: fullName.trim(),
          });
        }
      }
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <header className="auth__topbar">
        <div className="logo">
          <div className="logo__mark">FS</div>
          <div>
            <p>Fair Share</p>
            <span>Expense Suite</span>
          </div>
        </div>
        <button className="toggle" onClick={onToggleTheme}>
          {darkMode ? "Light mode" : "Dark mode"}
        </button>
      </header>

      <div className="auth__panel">
        <div className="auth__intro">
          <div className="auth__hero" aria-hidden="true">
            <div className="auth__hero-image" />
          </div>
          <h1>Split smarter, travel lighter</h1>
          <p>Track group spending, settle fast, and keep everyone aligned.</p>
        </div>

        <form className="auth__form" onSubmit={submit}>
          <div className="auth__tabs">
            <button
              type="button"
              className={mode === "signin" ? "is-active" : ""}
              onClick={() => setMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "is-active" : ""}
              onClick={() => setMode("signup")}
            >
              Create account
            </button>
          </div>

          {mode === "signup" && (
            <label>
              Full name
              <input
                type="text"
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
            />
          </label>
          {mode === "signup" && (
            <label>
              Confirm password
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your password"
              />
            </label>
          )}

          {error && <div className="auth__error">{error}</div>}

          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={handleGoogle}
            disabled={busy}
          >
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}

function DashboardView({
  groupTotal,
  groupList,
  expenses,
  totalExpenses,
  summaryCurrency,
  onNavigate,
  onSelectGroup,
  onSelectExpense,
  onAddExpense,
  currentUserId,
  monthlyTable,
  monthOptions,
  tiles,
  onTileRangeChange,
  onTileMonthChange,
  onReorderTiles,
  onResizeTile,
}) {
  const hasGroups = groupList.length > 0;
  const hasExpenses = expenses.length > 0;
  const latestExpenses = [...expenses].slice(0, 3);
  const groupChartData = [...groupList]
    .sort((a, b) => b.total - a.total)
    .slice(0, 4)
    .map((group) => ({
      id: group.id,
      label: group.name,
      amount: group.total,
    }));
  const categoryTotals = expenses.reduce((acc, item) => {
    const key = item.category || "Miscellaneous";
    acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
    return acc;
  }, new Map());
  const topCategories = Array.from(categoryTotals.entries())
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const categoryData = Array.from(categoryTotals.entries())
    .map(([label, amount], index) => ({
      label,
      value: amount,
      currency: summaryCurrency,
      color: pieColors[index % pieColors.length],
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const averageExpense = totalExpenses / (expenses.length || 1);
  const payerTotals = expenses.reduce((acc, item) => {
    const key = item.paidByName || "Member";
    acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
    return acc;
  }, new Map());
  const topPayer = Array.from(payerTotals.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const trendBuckets = expenses.reduce((acc, item) => {
    if (!item.createdAt) return acc;
    const key = `${item.createdAt.getFullYear()}-${String(
      item.createdAt.getMonth() + 1
    ).padStart(2, "0")}`;
    acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
    return acc;
  }, new Map());
  const trendData = Array.from(trendBuckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([label, value]) => ({ label, value }));

  const [draggedTile, setDraggedTile] = useState(null);
  const getTileExpenses = (tile) => {
    if (tile.id === "categoryPie" && tile.monthKey) {
      return filterExpensesByMonthKey(expenses, tile.monthKey, currentUserId);
    }
    return filterExpensesByRange(expenses, tile.rangeKey || "7d", currentUserId);
  };
  const getRangeData = (tile) =>
    buildRangeData(
      expenses,
      tile.rangeKey || "7d",
      currentUserId,
      expenseCategoryOptions
    );
  const safeMonthlyTable =
    monthlyTable || { monthLabel: "", rows: [], totals: new Map(), totalSpend: 0 };
  const handleDragStart = (event, tileId) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tileId);
    const dragImage = event.currentTarget.closest(".dashboard-tile");
    if (dragImage && event.dataTransfer.setDragImage) {
      event.dataTransfer.setDragImage(dragImage, 20, 20);
    }
    setDraggedTile(tileId);
  };

  const handleDrop = (event, targetId) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedTile;
    if (!sourceId || sourceId === targetId) return;
    onReorderTiles(sourceId, targetId);
    setDraggedTile(null);
  };

  const handleDragEnd = () => {
    setDraggedTile(null);
  };

  const renderTileContent = (tile) => {
    if (!tile) return null;
    switch (tile.id) {
      case "groupTotals": {
        const tileExpenses = getTileExpenses(tile);
        const totals = new Map();
        tileExpenses.forEach((expense) => {
          if (!expense.groupId) return;
          totals.set(
            expense.groupId,
            (totals.get(expense.groupId) || 0) + Number(expense.amount || 0)
          );
        });
        const chartData = groupList
          .map((group) => ({
            id: group.id,
            label: group.name,
            amount: totals.get(group.id) || 0,
          }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 4);
        const focusGroup = groupList.find(
          (group) => group.id === chartData[0]?.id
        );
        const focusBalances = calculateGroupBalances(focusGroup, tileExpenses)
          .filter((entry) => entry.total !== 0)
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
          .slice(0, 4);
        return (
          <>
            <p className="muted">All active groups combined</p>
            <div className="stat">
              <strong>{formatCurrency(groupTotal, summaryCurrency)}</strong>
              <span>across {groupList.length} groups</span>
            </div>
            {hasExpenses ? (
              <>
                <BarChart
                  data={chartData}
                  maxValue={chartData[0]?.amount || 1}
                />
                {focusGroup && (
                  <div className="list list--compact">
                    <div className="list__item">
                      <div>
                        <strong>Settlements</strong>
                        <span>{focusGroup.name}</span>
                      </div>
                      <span className="muted small">
                        Top {focusBalances.length} members
                      </span>
                    </div>
                    {focusBalances.length ? (
                      focusBalances.map((entry) => (
                        <div className="list__item" key={entry.uid}>
                          <div>
                            <strong>{entry.name}</strong>
                            <span>{entry.total >= 0 ? "Gets back" : "Owes"}</span>
                          </div>
                          <p className={entry.total >= 0 ? "positive" : "negative"}>
                            {formatCurrency(
                              Math.abs(entry.total),
                              focusGroup.currency || summaryCurrency
                            )}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="empty">Add members and expenses to see who owes who.</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="empty">No expenses yet.</p>
            )}
          </>
        );
      }
      case "totalExpenses": {
        const tileExpenses = getTileExpenses(tile);
        const tileTotal = tileExpenses.reduce(
          (sum, item) => sum + Number(item.amount || 0),
          0
        );
        const tileCategoryTotals = tileExpenses.reduce((acc, item) => {
          const key = item.category || "Miscellaneous";
          acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
          return acc;
        }, new Map());
        const tileTopCategories = Array.from(tileCategoryTotals.entries())
          .map(([label, amount]) => ({ label, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 3);
        return (
          <>
            <strong>{formatCurrency(tileTotal, summaryCurrency)}</strong>
            <p className="muted">Across all groups</p>
            {tileTopCategories.length ? (
              <div className="metric-list">
                {tileTopCategories.map((item) => (
                  <div key={item.label}>
                    <span>{item.label}</span>
                    <strong>{formatCurrency(item.amount, summaryCurrency)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">No categories yet.</p>
            )}
          </>
        );
      }
      case "recentExpenses": {
        const tileExpenses = getTileExpenses(tile);
        const tileLatest = [...tileExpenses].slice(0, 3);
        return hasExpenses ? (
          <div className="metric-list">
            {tileLatest.map((item) => (
              <div key={item.id}>
                {item.groupId ? (
                  <button
                    className="text-btn"
                    type="button"
                      onClick={() => onSelectExpense(item)}
                    >
                      {item.category || "Expense"}
                    </button>
                  ) : (
                    <span>{item.category || "Expense"}</span>
                )}
                <strong>{formatCurrency(item.amount, summaryCurrency)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No expenses yet.</p>
        );
      }
      case "groupsList": {
        const tileExpenses = getTileExpenses(tile);
        const totals = new Map();
        tileExpenses.forEach((expense) => {
          if (!expense.groupId) return;
          totals.set(
            expense.groupId,
            (totals.get(expense.groupId) || 0) + Number(expense.amount || 0)
          );
        });
        return (
          <>
            <div className="card__header">
              <h3>Groups</h3>
              <button className="ghost" onClick={() => onNavigate("Groups")}>
                View all
              </button>
            </div>
            {hasGroups ? (
              <div className="list">
                {groupList.map((group) => (
                  <div className="list__item" key={group.id}>
                    <div>
                      <button
                        className="text-btn"
                        type="button"
                        onClick={() => onSelectGroup(group.id)}
                      >
                        {group.name}
                      </button>
                      <span>{group.membersCount} members</span>
                    </div>
                    <p>{formatCurrency(totals.get(group.id) || 0, summaryCurrency)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">Create your first group to get started.</p>
            )}
          </>
        );
      }
      case "recentActivity":
        return (
          <>
            <div className="card__header">
              <h3>Recent activity</h3>
              <button className="ghost" onClick={() => onNavigate("Activity")}>
                View all
              </button>
            </div>
            <p className="empty">No activity yet.</p>
          </>
        );
      case "insightsStats": {
        const tileExpenses = getTileExpenses(tile);
        const balances = calculateOverallBalances(groupList, tileExpenses)
          .filter((entry) => entry.total !== 0)
          .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
          .slice(0, 4);
        return (
          <>
            <div className="card__header">
              <h3>Insights</h3>
              <button className="ghost" onClick={() => onNavigate("Insight")}>
                View all
              </button>
            </div>
            {balances.length ? (
              <div className="list list--compact">
                {balances.map((entry) => (
                  <div className="list__item" key={entry.uid || entry.name}>
                    <div>
                      <strong>{entry.name}</strong>
                      <span>{entry.total >= 0 ? "Needs to receive" : "Needs to pay"}</span>
                    </div>
                    <p className={entry.total >= 0 ? "positive" : "negative"}>
                      {formatCurrency(Math.abs(entry.total), summaryCurrency)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">Add members and expenses to see who owes who.</p>
            )}
          </>
        );
      }
      case "expenseOverview": {
        const tileExpenses = getTileExpenses(tile);
        return (
          <>
            <div className="card__header">
              <h3>Expense overview</h3>
              <button className="ghost" onClick={onAddExpense}>
                Add expense
              </button>
            </div>
            {hasExpenses ? (
              <div className="expense-grid">
                {tileExpenses.slice(0, 4).map((item) => (
                  <div className="expense-tile" key={item.id}>
                    {item.groupId ? (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => onSelectExpense(item)}
                    >
                      {item.category || "Expense"}
                    </button>
                  ) : (
                    <p>{item.category || "Expense"}</p>
                    )}
                    <strong>{formatCurrency(item.amount, summaryCurrency)}</strong>
                    <span className="positive">Logged</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty">Add an expense to see breakdowns.</p>
            )}
          </>
        );
      }
      case "categoryPie": {
        const tileExpenses = getTileExpenses(tile);
        const isEmpty = tileExpenses.length === 0;
        const controls = (
          <div className="tile-controls tile-controls--stacked">
            <select
              className="select select--compact"
              value={tile.monthKey || new Date().toISOString().slice(0, 7)}
              onChange={(event) => onTileMonthChange(tile.id, event.target.value)}
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              className="select select--compact"
              value={tile.size}
              onChange={(event) => onResizeTile(tile.id, event.target.value)}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>
        );
        const totals = tileExpenses.reduce((acc, item) => {
          const key = item.category || "Miscellaneous";
          acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
          return acc;
        }, new Map());
        const data = Array.from(totals.entries())
          .map(([label, amount], index) => ({
            label,
            value: amount,
            currency: summaryCurrency,
            color: getCategoryColor(label, index),
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);
        return (
          <div className="card__body card__body--spaced">
            {controls}
            {data.length && !isEmpty ? (
              <PieChart data={data} />
            ) : (
              <p className="empty">No category data yet.</p>
            )}
          </div>
        );
      }
      case "monthlyTrend": {
        const tileExpenses = getTileExpenses(tile);
        const buckets = tileExpenses.reduce((acc, item) => {
          if (!item.createdAt) return acc;
          const key = `${item.createdAt.getFullYear()}-${String(
            item.createdAt.getMonth() + 1
          ).padStart(2, "0")}`;
          acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
          return acc;
        }, new Map());
        const data = Array.from(buckets.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(-6)
          .map(([label, value]) => ({ label, value }));
        return <LineChart data={data} />;
      }
      case "topPayer": {
        const tileExpenses = getTileExpenses(tile);
        const totals = tileExpenses.reduce((acc, item) => {
          const key = item.paidByName || "Member";
          acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
          return acc;
        }, new Map());
        const top = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0];
        return topPayer ? (
          <div className="metric-list">
            <div>
              <span>{top?.[0]}</span>
              <strong>{formatCurrency(top?.[1] || 0, summaryCurrency)}</strong>
            </div>
          </div>
        ) : (
          <p className="empty">No expenses yet.</p>
        );
      }
      case "expenseRange": {
        const rangeData = getRangeData(tile);
        return (
          <>
            <div className="range-toolbar">
              <span className="muted">Total spend</span>
              <div className="range-actions">
              </div>
            </div>
            {rangeData.length ? (
              <StackedBarChart
                data={rangeData}
                categories={expenseCategoryOptions}
              />
            ) : (
              <p className="empty">No expenses in this period.</p>
            )}
          </>
        );
      }
      case "monthlyTable":
        return (
          <>
            <div className="table-header">
              <span className="muted">Monthly spend analysis</span>
              <strong>{safeMonthlyTable.monthLabel}</strong>
            </div>
            {safeMonthlyTable.rows.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Date</th>
                      {expenseCategoryOptions.map((cat) => (
                        <th key={cat}>{cat}</th>
                      ))}
                      <th>Total Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {safeMonthlyTable.rows.map((row) => (
                      <tr key={row.date}>
                        <td>{row.month}</td>
                        <td>{row.date}</td>
                        {expenseCategoryOptions.map((cat) => (
                          <td key={cat}>
                            {row.categories.get(cat)
                              ? formatCurrency(row.categories.get(cat), summaryCurrency)
                              : "-"}
                          </td>
                        ))}
                        <td>{formatCurrency(row.total, summaryCurrency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Total</td>
                      {expenseCategoryOptions.map((cat) => (
                        <td key={cat}>
                          {safeMonthlyTable.totals.get(cat)
                            ? formatCurrency(
                                safeMonthlyTable.totals.get(cat),
                                summaryCurrency
                              )
                            : "-"}
                        </td>
                      ))}
                      <td>
                        {formatCurrency(safeMonthlyTable.totalSpend, summaryCurrency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <p className="empty">No expenses for this month yet.</p>
            )}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <section className="dashboard-grid">
        {tiles.filter(Boolean).map((tile) => (
          <article
            key={tile.id}
            className={`card dashboard-tile tile--${tile.size} ${
              draggedTile === tile.id ? "is-dragging" : ""
            }`}
            draggable
            onDragStart={(event) => {
              const blocked = event.target.closest(
                "button, select, input, textarea"
              );
              if (blocked) {
                event.preventDefault();
                return;
              }
              handleDragStart(event, tile.id);
            }}
            onDragEnd={handleDragEnd}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDrop(event, tile.id)}
          >
            <div
              className="card__header dashboard-tile__header"
            >
              <h3>{tile.label}</h3>
              {tile.id !== "categoryPie" && (
                <div className="tile-controls">
                  {tile.id === "monthlyTable" ? (
                    <select
                      className="select select--compact"
                      value={tile.monthKey || new Date().toISOString().slice(0, 7)}
                      onChange={(event) =>
                        onTileMonthChange(tile.id, event.target.value)
                      }
                    >
                      {monthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="select select--compact"
                      value={tile.rangeKey || "7d"}
                      onChange={(event) =>
                        onTileRangeChange(tile.id, event.target.value)
                      }
                    >
                      {rangeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <select
                    className="select select--compact"
                    value={tile.size}
                    onChange={(event) => onResizeTile(tile.id, event.target.value)}
                  >
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
              )}
            </div>
            {renderTileContent(tile)}
          </article>
        ))}
      </section>
    </>
  );
}

function GroupsView({
  groupList,
  onCreateGroup,
  groupActionError,
  pendingInviteCount,
  importedCsvFiles,
  onLoadCsv,
  onDeleteCsv,
  onUpdateCsvCurrency,
  activeCsvId,
}) {
  const hasGroups = groupList.length > 0;
  const groupCurrencies = Array.from(
    new Set(groupList.map((group) => group.currency || "EUR"))
  );
  const groupCurrency =
    groupCurrencies.length === 1 ? groupCurrencies[0] : "MIXED";
  const openBalances = groupList.reduce(
    (sum, group) => sum + Number(group.total || 0),
    0
  );
  return (
    <section className="grid">
      <article className="card card--wide">
        <div className="card__header">
          <h3>Group list</h3>
          <button className="primary" onClick={onCreateGroup}>
            Create group
          </button>
        </div>
        {groupActionError && (
          <div className="auth__error">{groupActionError}</div>
        )}
        {hasGroups ? (
          <div className="list">
              {groupList.map((group) => (
                <div className="list__item" key={group.id}>
                  <div>
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => group.onSelect()}
                    >
                      {group.name}
                    </button>
                    <div className="list__meta">
                      <span>{group.membersCount} members</span>
                      <span>{group.type}</span>
                      <span>{group.inviteCount} invites</span>
                    </div>
                  </div>
                <div className="list__actions">
                  <p>{formatCurrency(group.total, group.currency)}</p>
                  <button className="ghost" onClick={() => group.onEdit()}>
                    Edit
                  </button>
                  <button className="ghost" onClick={() => group.onInvite()}>
                    Invite
                  </button>
                  <button
                    className="danger"
                    onClick={() => group.onDelete()}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No groups yet. Create one to start.</p>
        )}
      </article>
      <article className="card">
        <h3>Quick actions</h3>
        <div className="metric-list">
          <div>
            <span>Pending invites</span>
            <strong>{pendingInviteCount}</strong>
          </div>
          <div>
            <span>Shared trips</span>
            <strong>{groupList.filter((group) => group.type === "Trip").length}</strong>
          </div>
          <div>
            <span>Open balances</span>
            <strong>{formatCurrency(openBalances, groupCurrency)}</strong>
          </div>
        </div>
      </article>
      <article className="card">
        <div className="card__header">
          <h3>Imported CSV files</h3>
        </div>
        {importedCsvFiles.length ? (
          <div className="list">
            {importedCsvFiles.map((file) => (
              <div
                className={`list__item ${file.id === activeCsvId ? "is-active" : ""}`}
                key={file.id}
              >
                <div>
                  <strong>{file.name || "import.csv"}</strong>
                  <div className="list__meta">
                    <span>
                      {file.importedAt
                        ? file.importedAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })
                        : "Unknown date"}
                    </span>
                    <span>{file.rowCount || 0} rows</span>
                    {file.id === activeCsvId && <span className="badge">Loaded</span>}
                  </div>
                </div>
                <div className="list__actions">
                  <select
                    className="select select--compact"
                    value={file.currency || "GBP"}
                    onChange={(event) =>
                      onUpdateCsvCurrency(file, event.target.value)
                    }
                  >
                    {currencyOptions.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                  <button className="ghost" onClick={() => onLoadCsv(file)}>
                    Load
                  </button>
                  <button className="danger" onClick={() => onDeleteCsv(file)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No CSV files saved yet.</p>
        )}
      </article>
    </section>
  );
}

function InsightView({
  groupList,
  expenses,
  selectedGroupId,
  onSelectGroup,
  currencyOverride,
}) {
  const isAll = selectedGroupId === "all";
  const filteredExpenses = isAll
    ? expenses
    : expenses.filter((item) => item.groupId === selectedGroupId);
  const totalExpenses = filteredExpenses.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );
  const categoryTotals = filteredExpenses.reduce((acc, item) => {
    const key = item.category || "Other";
    acc.set(key, (acc.get(key) || 0) + Number(item.amount || 0));
    return acc;
  }, new Map(expenseCategoryOptions.map((category) => [category, 0])));
  const categoryData = Array.from(categoryTotals.entries())
    .map(([label, amount], index) => ({
      label,
      amount,
      value: amount,
      currency: currencyOverride || itemCurrency(filteredExpenses, label),
      color: getCategoryColor(label, index),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const groupTotals = groupList.map((group) => ({
    label: group.name,
    amount: group.total,
    value: group.total,
    currency: currencyOverride || group.currency,
  }));

  const topGroups = [...groupTotals]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  const topCategories = [...categoryData].slice(0, 4);

  const settledValue = Math.min(
    totalExpenses,
    filteredExpenses.filter((item) => item.amount > 0).length * 0.6
  );

  return (
    <section className="grid">
      <article className="card card--wide">
        <div className="card__header">
          <h3>Insights</h3>
          <select
            className="select"
            value={selectedGroupId}
            onChange={(event) => onSelectGroup(event.target.value)}
          >
            <option value="all">All groups</option>
            {groupList.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        {categoryData.length ? (
          <PieChart data={categoryData} />
        ) : (
          <p className="empty">Add expenses to see category split.</p>
        )}
      </article>
      <article className="card">
        <h3>Settlement progress</h3>
        <Donut value={settledValue} total={totalExpenses || 1} />
        <p className="muted">Based on activity in this period.</p>
      </article>
      <article className="card">
        <h3>{isAll ? "Top groups" : "Top categories"}</h3>
        {isAll ? (
          topGroups.length ? (
            <BarChart data={topGroups} maxValue={topGroups[0].amount || 1} />
          ) : (
            <p className="empty">Create groups to compare totals.</p>
          )
        ) : topCategories.length ? (
          <BarChart data={topCategories} maxValue={topCategories[0].amount || 1} />
        ) : (
          <p className="empty">Add expenses to compare categories.</p>
        )}
      </article>
    </section>
  );
}

function ExpenseView({ expenses, onAddExpense, expenseActionError, onSelectGroup }) {
  const splitCounts = expenses.reduce(
    (acc, item) => {
      const key = item.splitType || "equal";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    { equal: 0, exact: 0, weighted: 0 }
  );
  const totalSplits =
    splitCounts.equal + splitCounts.exact + splitCounts.weighted || 1;
  const toPercent = (count) => Math.round((count / totalSplits) * 100);
  return (
    <section className="grid">
      <article className="card card--wide">
        <div className="card__header">
          <h3>Recent expenses</h3>
          <button className="primary" onClick={onAddExpense}>
            Add expense
          </button>
        </div>
        {expenseActionError && (
          <div className="auth__error">{expenseActionError}</div>
        )}
        {expenses.length ? (
          <div className="list">
            {expenses.map((item) => (
              <div className="list__item" key={item.id}>
                <div>
                  {item.groupId ? (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => onSelectGroup(item.groupId)}
                    >
                      {item.category || "Expense"}
                    </button>
                  ) : (
                    <strong>{item.category || "Expense"}</strong>
                  )}
                  <span>{item.note || "No note"}</span>
                </div>
                <div className="list__actions">
                  <p>{formatCurrency(item.amount, item.currency)}</p>
                  <button className="ghost" onClick={() => item.onEdit()}>
                    Edit
                  </button>
                  <button className="danger" onClick={() => item.onDelete()}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No expenses yet.</p>
        )}
      </article>
      <article className="card">
        <h3>Split types</h3>
        <div className="metric-list">
          <div>
            <span>Equal split</span>
            <strong>{toPercent(splitCounts.equal)}%</strong>
          </div>
          <div>
            <span>Exact amounts</span>
            <strong>{toPercent(splitCounts.exact)}%</strong>
          </div>
          <div>
            <span>Weighted</span>
            <strong>{toPercent(splitCounts.weighted)}%</strong>
          </div>
        </div>
      </article>
    </section>
  );
}

function ActivityView({
  activityItems,
  notes,
  noteText,
  onNoteTextChange,
  onAddNote,
  onToggleNoteMenu,
  onEditNote,
  onDeleteNote,
  onClearFeed,
}) {
  return (
    <section className="grid">
      <article className="card card--wide">
        <div className="card__header">
          <h3>Activity feed</h3>
          <button className="ghost" onClick={onClearFeed}>
            Clear feed
          </button>
        </div>
        {activityItems.length ? (
          <div className="list">
            {activityItems.map((item) => (
              <div className="list__item" key={item.id}>
                <div>
                  <strong>{item.groupName || "Group activity"}</strong>
                  <span>{item.message}</span>
                </div>
                <span className="muted">{item.type}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No activity yet.</p>
        )}
      </article>
      <article className="card">
        <div className="card__header">
          <h3>Notes</h3>
        </div>
        <form className="note-form" onSubmit={onAddNote}>
          <input
            type="text"
            value={noteText}
            onChange={(event) => onNoteTextChange(event.target.value)}
            placeholder="Add a note"
          />
          <button className="primary" type="submit">
            Add
          </button>
        </form>
        {notes.length ? (
          <div className="note-list">
            {notes.map((note) => (
              <div className="note-item" key={note.id}>
                <div>
                  <strong>{note.text}</strong>
                </div>
                <div className="note-actions">
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => onToggleNoteMenu(note.id)}
                    aria-label="Edit note"
                  >
                    ...
                  </button>
                  {note.showActions && (
                    <div className="note-menu">
                      <button
                        className="ghost"
                        type="button"
                        onClick={() => onEditNote(note)}
                      >
                        Edit
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => onDeleteNote(note)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No notes yet.</p>
        )}
      </article>
    </section>
  );
}

function SummaryView({
  groupList,
  expenses,
  selectedGroupId,
  onSelectGroup,
  onAddExpense,
  onEditExpense,
  onDeleteExpense,
}) {
  const selectedGroup =
    groupList.find((group) => group.id === selectedGroupId) || groupList[0];
  const activeGroupId = selectedGroup ? selectedGroup.id : "";
  const groupExpenses = expenses.filter(
    (expense) => expense.groupId === activeGroupId
  );
  const groupTotal = groupExpenses.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );
  const groupCurrency =
    selectedGroup?.currency ||
    (groupExpenses[0]?.currency ? groupExpenses[0].currency : "EUR");
  const groupMembers = selectedGroup?.members?.length
    ? selectedGroup.members
    : selectedGroup?.membersCount
    ? Array.from({ length: selectedGroup.membersCount }).map((_, index) => ({
        uid: `member-${index}`,
        name: `Member ${index + 1}`,
      }))
    : [];
  const balances = groupMembers.reduce((acc, member) => {
    acc.set(member.uid, {
      uid: member.uid,
      name: member.name || member.email || "Member",
      total: 0,
    });
    return acc;
  }, new Map());

  groupExpenses.forEach((expense) => {
    const payerId = expense.paidByUid || expense.createdBy;
    const amount = Number(expense.amount || 0);
    if (!groupMembers.length || !amount) return;
    const share = amount / groupMembers.length;
    groupMembers.forEach((member) => {
      const entry = balances.get(member.uid);
      if (!entry) return;
      entry.total -= share;
    });
    if (balances.has(payerId)) {
      balances.get(payerId).total += amount;
    } else if (payerId) {
      balances.set(payerId, {
        uid: payerId,
        name: expense.paidByName || "Payer",
        total: amount,
      });
    }
  });

  const balanceList = Array.from(balances.values());
  return (
    <section className="summary-layout">
      <article className="card summary-main">
        <div className="card__header">
          <h3>Expense history</h3>
          <div className="summary-actions">
            <select
              className="select"
              value={activeGroupId}
              onChange={(event) => onSelectGroup(event.target.value)}
            >
              {groupList.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <button className="primary" onClick={onAddExpense}>
              Add expense
            </button>
          </div>
        </div>
        {groupExpenses.length ? (
          <div className="list summary-list">
            {groupExpenses.map((item) => (
              <div className="list__item" key={item.id}>
                <div>
                  <strong>{item.category || "Expense"}</strong>
                  <span>{item.note || "No note"}</span>
                </div>
                <div className="list__actions">
                  <p>{formatCurrency(item.amount, item.currency)}</p>
                  <button className="ghost" onClick={() => onEditExpense(item)}>
                    Edit
                  </button>
                  <button
                    className="danger"
                    onClick={() => onDeleteExpense(item)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No expenses for this group yet.</p>
        )}
      </article>
      <div className="summary-side">
        <article className="card">
          <h3>Group summary</h3>
          {selectedGroup ? (
            <div className="metric-list">
              <div>
                <span>Total spent</span>
                <strong>{formatCurrency(groupTotal, groupCurrency)}</strong>
              </div>
              <div>
                <span>Members</span>
                <strong>{selectedGroup.membersCount}</strong>
              </div>
              <div>
                <span>Expenses</span>
                <strong>{groupExpenses.length}</strong>
              </div>
            </div>
          ) : (
            <p className="empty">Create a group to see summary stats.</p>
          )}
        </article>
        <article className="card">
          <h3>Who owes who</h3>
          {balanceList.length ? (
            <div className="list">
              {balanceList.map((entry) => (
                <div className="list__item" key={entry.uid}>
                  <div>
                    <strong>{entry.name}</strong>
                    <span>{entry.total >= 0 ? "Gets back" : "Owes"}</span>
                  </div>
                  <p className={entry.total >= 0 ? "positive" : "negative"}>
                    {formatCurrency(Math.abs(entry.total), groupCurrency)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">Add members and expenses to see balances.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function SettingsView({
  profile,
  onProfileChange,
  onSaveProfile,
  profileBusy,
  profileError,
  onOpenPasswordModal,
}) {
  return (
    <section className="grid">
      <article className="card card--wide">
        <div className="card__header">
          <h3>Profile settings</h3>
          <button className="ghost" onClick={onOpenPasswordModal}>
            Change password
          </button>
        </div>
        <form className="modal__form" onSubmit={onSaveProfile}>
          <label>
            Full name
            <input
              type="text"
              value={profile.fullName}
              onChange={(event) =>
                onProfileChange({ fullName: event.target.value })
              }
              placeholder="Your name"
            />
          </label>
          <label>
            Email
            <input type="email" value={profile.email} readOnly />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={profile.phone}
              onChange={(event) => onProfileChange({ phone: event.target.value })}
              placeholder="+91 00000 00000"
            />
          </label>
          <label>
            Address
            <input
              type="text"
              value={profile.address}
              onChange={(event) =>
                onProfileChange({ address: event.target.value })
              }
              placeholder="Street, City"
            />
          </label>
          {profileError && <div className="auth__error">{profileError}</div>}
          <div className="modal__actions">
            <button className="primary" type="submit" disabled={profileBusy}>
              {profileBusy ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState(null);
  const [groupList, setGroupList] = useState([]);
  const [expenseList, setExpenseList] = useState([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState(4);
  const [newGroupCurrency, setNewGroupCurrency] = useState("EUR");
  const [newGroupType, setNewGroupType] = useState(groupTypes[0]);
  const [groupError, setGroupError] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupActionError, setGroupActionError] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [expenseBusy, setExpenseBusy] = useState(false);
  const [expenseActionError, setExpenseActionError] = useState("");
  const [expenseGroupId, setExpenseGroupId] = useState("");
  const [expenseCategory, setExpenseCategory] = useState(
    expenseCategoryOptions[0]
  );
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseNote, setExpenseNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(toDateInputValue(new Date()));
  const [expenseCurrency, setExpenseCurrency] = useState("EUR");
  const [expensePaidBy, setExpensePaidBy] = useState("");
  const [expenseSplitType, setExpenseSplitType] = useState("equal");
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [editingGroupId, setEditingGroupId] = useState("");
  const [inviteGroupId, setInviteGroupId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [receivedInvites, setReceivedInvites] = useState([]);
  const [sentInvites, setSentInvites] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const notifRef = useRef(null);
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const inactivityTimerRef = useRef(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [insightGroupId, setInsightGroupId] = useState("all");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [profile, setProfile] = useState({
    fullName: "",
    phone: "",
    address: "",
    email: "",
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNext, setPasswordNext] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [activityItems, setActivityItems] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [dashboardTiles, setDashboardTiles] = useState(defaultDashboardTiles);
  const [importedExpenses, setImportedExpenses] = useState([]);
  const [importedCsvFiles, setImportedCsvFiles] = useState([]);
  const [importCurrencyOverride, setImportCurrencyOverride] = useState("");
  const [activeCsvId, setActiveCsvId] = useState("");
  const [importError, setImportError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const importFileRef = useRef(null);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    setPersistence(auth, browserSessionPersistence).catch(() => {});
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const resetInactivityTimer = () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(() => {
        signOut(auth);
      }, SESSION_TIMEOUT_MS);
    };

    const handleActivity = () => resetInactivityTimer();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resetInactivityTimer();
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity);
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    resetInactivityTimer();

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [user]);

  useEffect(() => {
    setShowUserMenu(false);
    setShowNotifications(false);
  }, [user]);

  useEffect(() => {
    setIsNavOpen(false);
  }, [activeNav]);

  useEffect(() => {
    if (isSearchExpanded) {
      setShowSearchResults(true);
      searchInputRef.current?.focus();
    } else {
      setShowSearchResults(false);
      searchInputRef.current?.blur();
    }
  }, [isSearchExpanded]);

  useEffect(() => {
    if (!user || !preferencesLoaded) return;
    const prefs = {
      darkMode,
      dashboardTiles,
      selectedGroupId,
      insightGroupId,
      importedExpenses: serializeImportedExpenses(importedExpenses),
      importedCsvFiles: serializeImportedCsvFiles(importedCsvFiles),
    };
    setDoc(
      doc(db, "users", user.uid),
      { preferences: prefs, updatedAt: serverTimestamp() },
      { merge: true }
    ).catch(() => {});
  }, [
    user,
    preferencesLoaded,
    darkMode,
    dashboardTiles,
    selectedGroupId,
    insightGroupId,
    importedExpenses,
    importedCsvFiles,
  ]);

  useEffect(() => {
    if (!showUserMenu) return;
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserMenu]);

  useEffect(() => {
    if (!showSearchResults) return;
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSearchResults]);

  useEffect(() => {
    if (!showNotifications) return;
    const handleClickOutside = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotifications]);

  useEffect(() => {
    if (!user) return;
    const groupsRef = collection(db, "groups");
    const createdQuery = query(groupsRef, where("createdBy", "==", user.uid));
    const memberQuery = query(
      groupsRef,
      where("memberUids", "array-contains", user.uid)
    );
    let createdGroups = [];
    let memberGroups = [];

        const mapGroupDoc = (docSnap) => {
          const data = docSnap.data();
          const membersCount = Array.isArray(data.members)
            ? data.members.length
            : Number(data.membersCount || data.members || 0);
          return {
            id: docSnap.id,
            name: data.name || "Untitled group",
            membersCount,
            membersTarget: Number(data.membersTarget || data.members || membersCount || 0),
            members: Array.isArray(data.members) ? data.members : [],
            total: data.total || 0,
            currency: data.currency || "EUR",
            type: data.type || groupTypes[0],
          };
        };

    const mergeGroups = () => {
      const merged = new Map();
      [...createdGroups, ...memberGroups].forEach((group) => {
        merged.set(group.id, group);
      });
      setGroupList(Array.from(merged.values()));
    };

    const unsubCreated = onSnapshot(
      createdQuery,
      (snapshot) => {
        createdGroups = snapshot.docs.map(mapGroupDoc);
        mergeGroups();
      },
      () => {
        createdGroups = [];
        mergeGroups();
      }
    );
    const unsubMember = onSnapshot(
      memberQuery,
      (snapshot) => {
        memberGroups = snapshot.docs.map(mapGroupDoc);
        mergeGroups();
      },
      () => {
        memberGroups = [];
        mergeGroups();
      }
    );
    return () => {
      unsubCreated();
      unsubMember();
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!groupList.length) {
      setExpenseList([]);
      return;
    }
    const expensesRef = collection(db, "expenses");
    const groupIds = groupList.map((group) => group.id);
    const buildExpense = (docSnap) => {
      const data = docSnap.data();
      const createdAt = normalizeDate(data.createdAt);
      const updatedAt = normalizeDate(data.updatedAt);
      return {
        id: docSnap.id,
        groupId: data.groupId || "",
        category: data.category || "",
        amount: data.amount || 0,
        note: data.note || "",
        currency: data.currency || "EUR",
        paidByUid: data.paidByUid || "",
        paidByName: data.paidByName || "",
        createdBy: data.createdBy || "",
        splitType: data.splitType || "equal",
        createdAt: createdAt || updatedAt || new Date(),
        updatedAt,
      };
    };

    const groupIdChunks = [];
    for (let i = 0; i < groupIds.length; i += 10) {
      groupIdChunks.push(groupIds.slice(i, i + 10));
    }

    let allExpenses = [];
    const mergeExpenses = () => {
      const merged = new Map();
      allExpenses.forEach((item) => merged.set(item.id, item));
      setExpenseList(sortExpensesByLatest(Array.from(merged.values())));
    };

    const unsubscribers = groupIdChunks.map((chunk, index) => {
      const q = query(expensesRef, where("groupId", "in", chunk));
      return onSnapshot(
        q,
        (snapshot) => {
          const chunkExpenses = snapshot.docs.map(buildExpense);
          allExpenses = [
            ...allExpenses.filter(
              (item) => !chunk.includes(item.groupId)
            ),
            ...chunkExpenses,
          ];
          mergeExpenses();
        },
        () => {
          allExpenses = allExpenses.filter(
            (item) => !chunk.includes(item.groupId)
          );
          mergeExpenses();
        }
      );
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
  }, [user, groupList]);

  useEffect(() => {
    if (!user) {
      setProfile({ fullName: "", phone: "", address: "", email: "" });
      setPreferencesLoaded(false);
      return;
    }
    const profileRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      profileRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : {};
        setProfile({
          fullName:
            data.fullName ||
            user.displayName ||
            (user.email ? user.email.split("@")[0] : ""),
          phone: data.phone || "",
          address: data.address || "",
          email: user.email || data.email || "",
        });
        if (!preferencesLoaded) {
          const prefs = data.preferences || {};
          if (typeof prefs.darkMode === "boolean") {
            setDarkMode(prefs.darkMode);
          }
          if (Array.isArray(prefs.dashboardTiles) && prefs.dashboardTiles.length) {
            const sanitized = prefs.dashboardTiles.filter(
              (tile) => tile && tile.id && tile.size && tile.label
            );
            const merged = defaultDashboardTiles.map((tile) => {
              const saved = sanitized.find((item) => item.id === tile.id);
              return saved ? { ...tile, ...saved } : tile;
            });
            setDashboardTiles(merged);
          }
          if (prefs.selectedGroupId) {
            setSelectedGroupId(prefs.selectedGroupId);
          }
          if (prefs.insightGroupId) {
            setInsightGroupId(prefs.insightGroupId);
          }
          if (Array.isArray(prefs.importedExpenses)) {
            setImportedExpenses(hydrateImportedExpenses(prefs.importedExpenses));
          }
          if (Array.isArray(prefs.importedCsvFiles)) {
            setImportedCsvFiles(hydrateImportedCsvFiles(prefs.importedCsvFiles));
          }
          setPreferencesLoaded(true);
        }
      },
      () => {
        setProfile({
          fullName:
            user.displayName || (user.email ? user.email.split("@")[0] : ""),
          phone: "",
          address: "",
          email: user.email || "",
        });
        if (!preferencesLoaded) {
          setPreferencesLoaded(true);
        }
      }
    );
    return () => unsubscribe();
  }, [user, preferencesLoaded]);

  useEffect(() => {
    if (!user || !user.email) {
      setReceivedInvites([]);
      return;
    }
    const invitesRef = collection(db, "invites");
    const q = query(
      invitesRef,
      where("toEmail", "==", user.email),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextInvites = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            groupId: data.groupId || "",
            groupName: data.groupName || "Group invite",
            fromName: data.fromName || "",
            fromEmail: data.fromEmail || "",
          };
        });
        setReceivedInvites(nextInvites);
      },
      () => {
        setReceivedInvites([]);
      }
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const invitesRef = collection(db, "invites");
    const q = query(
      invitesRef,
      where("fromUid", "==", user.uid),
      where("status", "==", "pending")
    );
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextInvites = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            groupId: data.groupId || "",
          };
        });
        setSentInvites(nextInvites);
      },
      () => {
        setSentInvites([]);
      }
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setActivityItems([]);
      return;
    }
    const activityRef = collection(db, "activity");
    const q = query(activityRef, where("memberUids", "array-contains", user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextItems = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              type: data.type || "update",
              message: data.message || "Activity update",
              groupId: data.groupId || "",
              groupName: data.groupName || "",
              createdAt: data.createdAt || null,
            };
          })
          .sort((a, b) => {
            const aTime = a.createdAt?.seconds || 0;
            const bTime = b.createdAt?.seconds || 0;
            return bTime - aTime;
          })
          .slice(0, 20);
        setActivityItems(nextItems);
      },
      () => {
        setActivityItems([]);
      }
    );
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    const notesRef = collection(db, "notes");
    const q = query(notesRef, where("userId", "==", user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextNotes = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            text: data.text || "",
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
            showActions: false,
          };
        });
        setNotes(nextNotes);
      },
      () => {
        setNotes([]);
      }
    );
    return () => unsubscribe();
  }, [user]);

  const groupTotals = useMemo(() => {
    const totals = new Map();
    expenseList.forEach((expense) => {
      if (!expense.groupId) return;
      const next =
        (totals.get(expense.groupId) || 0) + Number(expense.amount || 0);
      totals.set(expense.groupId, next);
    });
    return totals;
  }, [expenseList]);

  const groupLookup = useMemo(() => {
    return new Map(groupList.map((group) => [group.id, group]));
  }, [groupList]);

  const filteredGroupList = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return groupList;
    return groupList.filter((group) => {
      const inName = group.name.toLowerCase().includes(needle);
      const inType = (group.type || "").toLowerCase().includes(needle);
      const inMembers =
        group.members?.some((member) =>
          `${member.name || ""} ${member.email || ""}`
            .toLowerCase()
            .includes(needle)
        ) || false;
      return inName || inType || inMembers;
    });
  }, [groupList, searchTerm]);

  const groupListWithTotals = useMemo(() => {
    return filteredGroupList.map((group) => ({
      ...group,
      total: groupTotals.get(group.id) || 0,
    }));
  }, [filteredGroupList, groupTotals]);

  useEffect(() => {
    if (!groupListWithTotals.length) {
      setSelectedGroupId("");
      return;
    }
    setSelectedGroupId((prev) => prev || groupListWithTotals[0].id);
  }, [groupListWithTotals]);

  useEffect(() => {
    if (!groupListWithTotals.length) {
      setInsightGroupId("all");
      return;
    }
    if (
      insightGroupId !== "all" &&
      !groupListWithTotals.some((group) => group.id === insightGroupId)
    ) {
      setInsightGroupId("all");
    }
  }, [groupListWithTotals, insightGroupId]);

  const sentInviteCounts = useMemo(() => {
    const counts = new Map();
    sentInvites.forEach((invite) => {
      counts.set(invite.groupId, (counts.get(invite.groupId) || 0) + 1);
    });
    return counts;
  }, [sentInvites]);

  const groupTotal = useMemo(
    () => groupListWithTotals.reduce((sum, group) => sum + group.total, 0),
    [groupListWithTotals]
  );

  const filteredExpenses = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return expenseList;
    return expenseList.filter((item) => {
      const inCategory = (item.category || "").toLowerCase().includes(needle);
      const inNote = (item.note || "").toLowerCase().includes(needle);
      const inPayer = (item.paidByName || "").toLowerCase().includes(needle);
      const inAmount = String(item.amount || "").includes(needle);
      const group = item.groupId ? groupLookup.get(item.groupId) : null;
      const inGroup =
        (group?.name || "").toLowerCase().includes(needle) ||
        (group?.type || "").toLowerCase().includes(needle) ||
        (group?.members || []).some((member) =>
          `${member.name || ""} ${member.email || ""}`
            .toLowerCase()
            .includes(needle)
        );
      return inCategory || inNote || inPayer || inAmount || inGroup;
    });
  }, [expenseList, groupLookup, searchTerm]);

  const dashboardExpenses = useMemo(
    () => [...filteredExpenses, ...importedExpenses],
    [filteredExpenses, importedExpenses]
  );

  const dashboardGroupTotals = useMemo(() => {
    const totals = new Map();
    dashboardExpenses.forEach((expense) => {
      if (!expense.groupId) return;
      const next =
        (totals.get(expense.groupId) || 0) + Number(expense.amount || 0);
      totals.set(expense.groupId, next);
    });
    return totals;
  }, [dashboardExpenses]);

  const dashboardGroupListWithTotals = useMemo(
    () =>
      groupList.map((group) => ({
        ...group,
        total: dashboardGroupTotals.get(group.id) || 0,
      })),
    [groupList, dashboardGroupTotals]
  );

  const dashboardGroupTotal = useMemo(
    () =>
      dashboardGroupListWithTotals.reduce((sum, group) => sum + group.total, 0),
    [dashboardGroupListWithTotals]
  );

  const filteredActivityItems = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return activityItems;
    return activityItems.filter((item) => {
      const inMessage = (item.message || "").toLowerCase().includes(needle);
      const inGroup = (item.groupName || "").toLowerCase().includes(needle);
      const inType = (item.type || "").toLowerCase().includes(needle);
      return inMessage || inGroup || inType;
    });
  }, [activityItems, searchTerm]);

  const filteredNotes = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) =>
      (note.text || "").toLowerCase().includes(needle)
    );
  }, [notes, searchTerm]);

  const searchResults = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return { groups: [], expenses: [] };
    const groups = groupList
      .filter((group) => group.name.toLowerCase().includes(needle))
      .slice(0, 5);
    const expenses = expenseList
      .filter((item) => {
        const inCategory = (item.category || "").toLowerCase().includes(needle);
        const inNote = (item.note || "").toLowerCase().includes(needle);
        return inCategory || inNote;
      })
      .slice(0, 5);
    return { groups, expenses };
  }, [groupList, expenseList, searchQuery]);

  const totalExpenses = useMemo(
    () => filteredExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [filteredExpenses]
  );

  const dashboardTotalExpenses = useMemo(
    () =>
      dashboardExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [dashboardExpenses]
  );

  const monthlyTable = useMemo(
    () => {
      const monthlyTile = dashboardTiles.find(
        (tile) => tile.id === "monthlyTable"
      );
      return buildMonthlyTable(
        filteredExpenses,
        expenseCategoryOptions,
        monthlyTile?.monthKey,
        user?.uid
      );
    },
    [filteredExpenses, dashboardTiles, user]
  );

  const dashboardMonthlyTable = useMemo(
    () => {
      const monthlyTile = dashboardTiles.find(
        (tile) => tile.id === "monthlyTable"
      );
      return buildMonthlyTable(
        dashboardExpenses,
        expenseCategoryOptions,
        monthlyTile?.monthKey,
        user?.uid
      );
    },
    [dashboardExpenses, dashboardTiles, user]
  );

  const dashboardMonthOptions = useMemo(() => {
    const monthSet = new Set(
      dashboardExpenses
        .map((item) => normalizeDate(item.createdAt))
        .filter(Boolean)
        .map((date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`)
    );
    if (!monthSet.size) {
      monthSet.add(new Date().toISOString().slice(0, 7));
    }
    return Array.from(monthSet)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => {
        const date = new Date(`${value}-01`);
        const label = Number.isNaN(date.getTime())
          ? value
          : date.toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            });
        return { value, label };
      });
  }, [dashboardExpenses]);

  const summaryCurrency = useMemo(() => {
    if (importCurrencyOverride) return importCurrencyOverride;
    return overallCurrency(filteredExpenses);
  }, [filteredExpenses, importCurrencyOverride]);

  const dashboardSummaryCurrency = useMemo(() => {
    if (importCurrencyOverride) return importCurrencyOverride;
    return overallCurrency(dashboardExpenses);
  }, [dashboardExpenses, importCurrencyOverride]);

  const pageTitle = {
    Dashboard: "Track group expenses and settle balances in minutes.",
    Groups: "Create groups, invite members, and manage trips.",
    Insight: "See trends and patterns across your splits.",
    Expense: "Add expenses and manage how they are shared.",
    Activity: "Review recent changes and member actions.",
    Summary: "Quick totals and settlement status.",
    Settings: "Manage your profile and security preferences.",
  }[activeNav];

  const logActivity = async ({
    type,
    message,
    groupId = "",
    groupName = "",
    memberUids = [],
  }) => {
    if (!user) return;
    try {
      await addDoc(collection(db, "activity"), {
        type,
        message,
        groupId,
        groupName,
        memberUids: memberUids.length ? memberUids : [user.uid],
        actorUid: user.uid,
        actorName:
          user.displayName || (user.email ? user.email.split("@")[0] : "Member"),
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      // Silently ignore activity logging failures.
    }
  };

  const resetGroupForm = () => {
    setEditingGroupId("");
    setNewGroupName("");
    setNewGroupMembers(4);
    setNewGroupCurrency("EUR");
    setNewGroupType(groupTypes[0]);
    setGroupError("");
  };

  const handleSaveGroup = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!newGroupName.trim()) {
      setGroupError("Please enter a group name.");
      return;
    }
    setGroupError("");
    setGroupActionError("");
    setGroupBusy(true);
    try {
      if (editingGroupId) {
        await updateDoc(doc(db, "groups", editingGroupId), {
          name: newGroupName.trim(),
          membersTarget: Number(newGroupMembers) || 0,
          currency: newGroupCurrency,
          type: newGroupType,
          updatedAt: serverTimestamp(),
        });
        const existingGroup = groupListWithTotals.find(
          (group) => group.id === editingGroupId
        );
        const memberUids = existingGroup?.members?.map((member) => member.uid) || [
          user.uid,
        ];
        await logActivity({
          type: "group",
          message: `Updated group details`,
          groupId: editingGroupId,
          groupName: newGroupName.trim(),
          memberUids,
        });
      } else {
        const memberName =
          user.displayName || (user.email ? user.email.split("@")[0] : "Member");
        const docRef = await addDoc(collection(db, "groups"), {
          name: newGroupName.trim(),
          membersTarget: Number(newGroupMembers) || 0,
          membersCount: 1,
          members: [
            {
              uid: user.uid,
              name: memberName,
              email: user.email || "",
            },
          ],
          memberUids: [user.uid],
          total: 0,
          currency: newGroupCurrency,
          type: newGroupType,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
        });
        await logActivity({
          type: "group",
          message: `Created group`,
          groupId: docRef.id,
          groupName: newGroupName.trim(),
          memberUids: [user.uid],
        });
      }
      resetGroupForm();
      setShowGroupModal(false);
    } catch (err) {
      setGroupError("Unable to save group. Try again.");
    } finally {
      setGroupBusy(false);
    }
  };

  const handleEditGroup = (group) => {
    setEditingGroupId(group.id);
    setNewGroupName(group.name || "");
    setNewGroupMembers(group.membersTarget || group.membersCount || 0);
    setNewGroupCurrency(group.currency || "EUR");
    setNewGroupType(group.type || groupTypes[0]);
    setGroupError("");
    setShowGroupModal(true);
  };

  const resetExpenseForm = () => {
    setEditingExpenseId("");
    setExpenseGroupId("");
    setExpenseCategory(expenseCategoryOptions[0]);
    setExpenseAmount("");
    setExpenseNote("");
    setExpenseDate(toDateInputValue(new Date()));
    setExpenseCurrency("EUR");
    setExpensePaidBy("");
    setExpenseSplitType("equal");
    setExpenseError("");
  };

  const handleCreateExpense = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!expenseAmount || Number(expenseAmount) <= 0) {
      setExpenseError("Enter a valid amount.");
      return;
    }
    if (!expenseCategory.trim()) {
      setExpenseError("Enter a category.");
      return;
    }
    const selectedDate = normalizeDate(expenseDate);
    if (!selectedDate) {
      setExpenseError("Choose a date.");
      return;
    }
    const payerId = expensePaidBy || user.uid;
    const payerName =
      groupListWithTotals
        .find((group) => group.id === expenseGroupId)
        ?.members.find((member) => member.uid === payerId)?.name ||
      user.displayName ||
      (user.email ? user.email.split("@")[0] : "Member");
    setExpenseError("");
    setExpenseBusy(true);
    try {
      if (editingExpenseId) {
        await updateDoc(doc(db, "expenses", editingExpenseId), {
          groupId: expenseGroupId || "",
          category: expenseCategory.trim(),
          amount: Number(expenseAmount),
          note: expenseNote.trim(),
          currency: expenseCurrency,
          paidByUid: payerId,
          paidByName: payerName,
          splitType: expenseSplitType,
          createdAt: Timestamp.fromDate(selectedDate),
          updatedAt: serverTimestamp(),
        });
        const group = groupListWithTotals.find(
          (item) => item.id === expenseGroupId
        );
        const memberUids =
          group?.members?.map((member) => member.uid) || [user.uid];
        await logActivity({
          type: "expense",
          message: `Updated expense "${expenseCategory.trim()}"`,
          groupId: expenseGroupId,
          groupName: group?.name || "",
          memberUids,
        });
      } else {
        await addDoc(collection(db, "expenses"), {
          groupId: expenseGroupId || "",
          category: expenseCategory.trim(),
        amount: Number(expenseAmount),
        note: expenseNote.trim(),
        currency: expenseCurrency,
        paidByUid: payerId,
        paidByName: payerName,
        splitType: expenseSplitType,
        createdBy: user.uid,
        createdAt: Timestamp.fromDate(selectedDate),
        updatedAt: serverTimestamp(),
      });
        const group = groupListWithTotals.find(
          (item) => item.id === expenseGroupId
        );
        const memberUids =
          group?.members?.map((member) => member.uid) || [user.uid];
        await logActivity({
          type: "expense",
          message: `Added expense "${expenseCategory.trim()}"`,
          groupId: expenseGroupId,
          groupName: group?.name || "",
          memberUids,
        });
      }
      resetExpenseForm();
      setShowExpenseModal(false);
    } catch (err) {
      setExpenseError("Unable to save expense. Try again.");
    } finally {
      setExpenseBusy(false);
    }
  };

  const handleEditExpense = (expense) => {
    setEditingExpenseId(expense.id);
    setExpenseGroupId(expense.groupId || "");
    setExpenseCategory(expense.category || "");
    setExpenseAmount(expense.amount ? String(expense.amount) : "");
    setExpenseNote(expense.note || "");
    setExpenseDate(
      toDateInputValue(expense.createdAt || expense.updatedAt || new Date())
    );
    setExpenseCurrency(expense.currency || "EUR");
    setExpensePaidBy(expense.paidByUid || expense.createdBy || "");
    setExpenseSplitType(expense.splitType || "equal");
    setExpenseError("");
    setShowExpenseModal(true);
  };

  const handleDeleteGroup = async (group) => {
    if (!user) return;
    setGroupActionError("");
    try {
      await deleteDoc(doc(db, "groups", group.id));
      const memberUids = group.members?.map((member) => member.uid) || [
        user.uid,
      ];
      await logActivity({
        type: "group",
        message: `Deleted group`,
        groupId: group.id,
        groupName: group.name,
        memberUids,
      });
    } catch (err) {
      setGroupActionError("Unable to delete group. Try again.");
    }
  };

  const handleDeleteExpense = async (expense) => {
    if (!user) return;
    setExpenseActionError("");
    try {
      await deleteDoc(doc(db, "expenses", expense.id));
      const group = groupListWithTotals.find(
        (item) => item.id === expense.groupId
      );
      const memberUids =
        group?.members?.map((member) => member.uid) || [user.uid];
      await logActivity({
        type: "expense",
        message: `Deleted expense "${expense.category || "Expense"}"`,
        groupId: expense.groupId,
        groupName: group?.name || "",
        memberUids,
      });
    } catch (err) {
      setExpenseActionError("Unable to delete expense. Try again.");
    }
  };

  const handleInviteMember = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!inviteGroupId) {
      setInviteError("Choose a group to invite to.");
      return;
    }
    if (!inviteEmail.trim()) {
      setInviteError("Enter an email to invite.");
      return;
    }
    setInviteError("");
    setInviteBusy(true);
    try {
      const group = groupListWithTotals.find(
        (item) => item.id === inviteGroupId
      );
      await addDoc(collection(db, "invites"), {
        groupId: inviteGroupId,
        groupName: group?.name || "Group invite",
        toEmail: inviteEmail.trim(),
        fromUid: user.uid,
        fromEmail: user.email || "",
        fromName: user.displayName || user.email?.split("@")[0] || "Member",
        status: "pending",
        createdAt: serverTimestamp(),
      });
      await logActivity({
        type: "invite",
        message: `Invited ${inviteEmail.trim()}`,
        groupId: inviteGroupId,
        groupName: group?.name || "",
        memberUids: group?.members?.map((member) => member.uid) || [user.uid],
      });
      setInviteEmail("");
      setShowInviteModal(false);
    } catch (err) {
      setInviteError("Unable to send invite. Try again.");
    } finally {
      setInviteBusy(false);
    }
  };

  const handleAcceptInvite = async (invite) => {
    if (!user) return;
    const memberName =
      user.displayName || (user.email ? user.email.split("@")[0] : "Member");
    try {
      await updateDoc(doc(db, "groups", invite.groupId), {
        members: arrayUnion({
          uid: user.uid,
          name: memberName,
          email: user.email || "",
        }),
        memberUids: arrayUnion(user.uid),
        membersCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "invites", invite.id), {
        status: "accepted",
        toUid: user.uid,
        respondedAt: serverTimestamp(),
      });
      const group = groupListWithTotals.find(
        (item) => item.id === invite.groupId
      );
      const existingMembers =
        group?.members?.map((member) => member.uid) || [];
      const memberUids = Array.from(new Set([...existingMembers, user.uid]));
      await logActivity({
        type: "invite",
        message: `Accepted invite`,
        groupId: invite.groupId,
        groupName: invite.groupName || group?.name || "",
        memberUids,
      });
      setShowNotifications(false);
    } catch (err) {
      setGroupActionError("Unable to accept invite. Try again.");
    }
  };

  const handleRejectInvite = async (invite) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "invites", invite.id), {
        status: "rejected",
        toUid: user.uid,
        respondedAt: serverTimestamp(),
      });
      const group = groupListWithTotals.find(
        (item) => item.id === invite.groupId
      );
      const memberUids =
        group?.members?.map((member) => member.uid) || [user.uid];
      await logActivity({
        type: "invite",
        message: `Rejected invite`,
        groupId: invite.groupId,
        groupName: invite.groupName || group?.name || "",
        memberUids,
      });
      setShowNotifications(false);
    } catch (err) {
      setGroupActionError("Unable to reject invite. Try again.");
    }
  };

  const handleClearNotifications = async () => {
    if (!user) return;
    try {
      const invitesPromise = Promise.all(
        receivedInvites.map((invite) =>
          updateDoc(doc(db, "invites", invite.id), {
            status: "cleared",
            toUid: user.uid,
            respondedAt: serverTimestamp(),
          })
        )
      );
      const activityPromise = (async () => {
        const activityRef = collection(db, "activity");
        const q = query(
          activityRef,
          where("memberUids", "array-contains", user.uid)
        );
        const snapshot = await getDocs(q);
        await Promise.all(
          snapshot.docs.map((docSnap) => deleteDoc(doc(db, "activity", docSnap.id)))
        );
      })();
      await Promise.all([invitesPromise, activityPromise]);
      setShowNotifications(false);
    } catch (err) {
      setGroupActionError("Unable to clear notifications. Try again.");
    }
  };

  const handleClearFeed = async () => {
    if (!user) return;
    try {
      const activityRef = collection(db, "activity");
      const q = query(activityRef, where("memberUids", "array-contains", user.uid));
      const snapshot = await getDocs(q);
      await Promise.all(
        snapshot.docs.map((docSnap) => deleteDoc(doc(db, "activity", docSnap.id)))
      );
    } catch (err) {
      setGroupActionError("Unable to clear the activity feed. Try again.");
    }
  };

  const handleProfileChange = (updates) => {
    setProfile((prev) => ({ ...prev, ...updates }));
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!profile.fullName.trim()) {
      setProfileError("Please enter your full name.");
      return;
    }
    setProfileError("");
    setProfileBusy(true);
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          fullName: profile.fullName.trim(),
          phone: profile.phone.trim(),
          address: profile.address.trim(),
          email: user.email || profile.email || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await updateProfile(user, { displayName: profile.fullName.trim() });
      await logActivity({
        type: "profile",
        message: "Updated profile settings",
        memberUids: [user.uid],
      });
    } catch (err) {
      setProfileError("Unable to save profile. Try again.");
    } finally {
      setProfileBusy(false);
    }
  };

  const handleUpdatePassword = async (event) => {
    event.preventDefault();
    if (!user || !user.email) return;
    if (!passwordCurrent || !passwordNext || !passwordConfirm) {
      setPasswordError("Please fill out all password fields.");
      return;
    }
    if (passwordNext !== passwordConfirm) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordError("");
    setPasswordBusy(true);
    try {
      const credential = EmailAuthProvider.credential(
        user.email,
        passwordCurrent
      );
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passwordNext);
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      setShowPasswordModal(false);
      await logActivity({
        type: "profile",
        message: "Updated account password",
        memberUids: [user.uid],
      });
    } catch (err) {
      setPasswordError("Unable to update password. Try again.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleAddNote = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!noteText.trim()) return;
    try {
      await addDoc(collection(db, "notes"), {
        text: noteText.trim(),
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
      setNoteText("");
    } catch (err) {
      setGroupActionError("Unable to save note. Try again.");
    }
  };

  const handleToggleNoteMenu = (noteId) => {
    setNotes((prev) =>
      prev.map((note) =>
        note.id === noteId
          ? { ...note, showActions: !note.showActions }
          : { ...note, showActions: false }
      )
    );
  };

  const handleEditNote = (note) => {
    setNotes((prev) => prev.map((item) => ({ ...item, showActions: false })));
    setEditingNote(note);
    setNoteDraft(note.text || "");
    setShowNoteModal(true);
  };

  const handleSaveNote = async (event) => {
    event.preventDefault();
    if (!user) return;
    if (!editingNote || !noteDraft.trim()) return;
    try {
      await updateDoc(doc(db, "notes", editingNote.id), {
        text: noteDraft.trim(),
        updatedAt: serverTimestamp(),
      });
      setShowNoteModal(false);
      setEditingNote(null);
      setNoteDraft("");
    } catch (err) {
      setGroupActionError("Unable to update note. Try again.");
    }
  };

  const handleDeleteNote = async (note) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, "notes", note.id));
    } catch (err) {
      setGroupActionError("Unable to delete note. Try again.");
    }
  };

  const handleSelectGroup = (groupId) => {
    if (!groupId) return;
    setSelectedGroupId(groupId);
    setActiveNav("Summary");
  };

  const handleSelectExpense = () => {
    setActiveNav("Expense");
  };

  const handleTileRangeChange = (tileId, nextRange) => {
    setDashboardTiles((prev) =>
      prev.map((tile) =>
        tile.id === tileId ? { ...tile, rangeKey: nextRange } : tile
      )
    );
  };

  const handleTileMonthChange = (tileId, nextMonth) => {
    setDashboardTiles((prev) =>
      prev.map((tile) =>
        tile.id === tileId ? { ...tile, monthKey: nextMonth } : tile
      )
    );
  };

  const handleImportCsvClick = () => {
    setImportError("");
    if (importFileRef.current) {
      importFileRef.current.click();
    }
  };

  const applyImportedExpenses = (imported, currencyOverride) => {
    const override =
      currencyOverride && currencyOverride !== "MIXED"
        ? currencyOverride
        : "";
    const normalized = override
      ? imported.map((item) => ({ ...item, currency: override }))
      : imported;
    setImportedExpenses(normalized);
    setImportCurrencyOverride(override);
    const latestDate = imported.reduce((latest, item) => {
      if (!item.createdAt) return latest;
      const current = item.createdAt instanceof Date ? item.createdAt : null;
      if (!current) return latest;
      return !latest || current > latest ? current : latest;
    }, null);
    const latestMonthKey = latestDate
      ? latestDate.toISOString().slice(0, 7)
      : new Date().toISOString().slice(0, 7);
    setDashboardTiles((prev) =>
      prev.map((tile) => {
        if (tile.id === "monthlyTable") {
          return { ...tile, monthKey: latestMonthKey };
        }
        if (tile.id === "categoryPie") {
          return { ...tile, monthKey: latestMonthKey };
        }
        if (tile.rangeKey) {
          return { ...tile, rangeKey: "1y" };
        }
        return tile;
      })
    );
  };

  const rememberImportedCsv = (text, fileName, rowCount) => {
    const name = fileName || "import.csv";
    const entry = {
      id: `csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      text,
      rowCount: Number(rowCount || 0),
      currency: "GBP",
      importedAt: new Date(),
    };
    setImportedCsvFiles((prev) => [entry, ...prev]);
    setActiveCsvId(entry.id);
  };

  const handleClearImportedData = () => {
    setImportedExpenses([]);
    setImportCurrencyOverride("");
    setActiveCsvId("");
    setImportError("");
    const defaultMonthKey = new Date().toISOString().slice(0, 7);
    setDashboardTiles((prev) =>
      prev.map((tile) => {
        if (tile.id === "monthlyTable") {
          return { ...tile, monthKey: defaultMonthKey };
        }
        if (tile.rangeKey) {
          return { ...tile, rangeKey: "7d" };
        }
        return tile;
      })
    );
  };

  const handleImportCsvFile = (event) => {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (!user) {
      setImportError("Sign in to import CSV data.");
      return;
    }
    setImportError("");
    const parseText = (text) => {
      const normalized = String(text || "");
      if (
        normalized.startsWith("PK") &&
        normalized.includes("[Content_Types].xml")
      ) {
        setImportError(
          "This looks like an .xlsx file. Please export as CSV or TSV and try again."
        );
        return;
      }
      const imported = buildImportedExpenses(text, groupList, user.uid);
      if (!imported.length) {
        setImportError("No valid rows found in the CSV file.");
        return;
      }
      applyImportedExpenses(imported, "GBP");
      rememberImportedCsv(text, file.name, imported.length);
    };
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      if (text.includes("\u0000")) {
        const utf16Reader = new FileReader();
        utf16Reader.onload = () => parseText(String(utf16Reader.result || ""));
        utf16Reader.onerror = () =>
      setImportError("Unable to read the CSV file.");
        utf16Reader.readAsText(file, "utf-16le");
        return;
      }
      parseText(text);
    };
    reader.onerror = () => {
      setImportError("Unable to read the CSV file.");
    };
    reader.readAsText(file);
  };

  const handleLoadStoredCsv = (csvFile) => {
    if (!csvFile || !csvFile.text) return;
    if (!user) {
      setImportError("Sign in to import CSV data.");
      return;
    }
    setImportError("");
    const imported = buildImportedExpenses(csvFile.text, groupList, user.uid);
    if (!imported.length) {
      setImportError("No valid rows found in the CSV file.");
      return;
    }
    applyImportedExpenses(imported, csvFile.currency);
    setActiveCsvId(csvFile.id);
  };

  const handleDeleteStoredCsv = (csvFile) => {
    if (!csvFile) return;
    setImportedCsvFiles((prev) => prev.filter((file) => file.id !== csvFile.id));
    setActiveCsvId((prev) => (prev === csvFile.id ? "" : prev));
  };

  const handleUpdateStoredCsvCurrency = (csvFile, nextCurrency) => {
    if (!csvFile) return;
    setImportedCsvFiles((prev) =>
      prev.map((file) =>
        file.id === csvFile.id ? { ...file, currency: nextCurrency } : file
      )
    );
  };

  const handleExportDashboardCsv = (monthlyTable) => {
    if (!monthlyTable.rows.length) return;
    const rows = [
      [
        "Month",
        "Date",
        ...expenseCategoryOptions,
        "Total Spend",
      ],
      ...monthlyTable.rows.map((row) => [
        row.month,
        row.date,
        ...expenseCategoryOptions.map((cat) => row.categories.get(cat) || 0),
        row.total,
      ]),
      [
        "Total",
        "",
        ...expenseCategoryOptions.map((cat) => monthlyTable.totals.get(cat) || 0),
        monthlyTable.totalSpend,
      ],
    ];
    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "monthly-spend-analysis.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReorderTiles = (sourceId, targetId) => {
    setDashboardTiles((prev) => {
      const next = [...prev];
      const sourceIndex = next.findIndex((tile) => tile.id === sourceId);
      const targetIndex = next.findIndex((tile) => tile.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1) return prev;
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const handleResizeTile = (tileId, size) => {
    setDashboardTiles((prev) =>
      prev.map((tile) =>
        tile.id === tileId ? { ...tile, size } : tile
      )
    );
  };

  const openInviteModal = (groupId) => {
    const nextGroupId = groupId || groupList[0]?.id || "";
    setInviteGroupId(nextGroupId);
    setInviteEmail("");
    setInviteError("");
    setShowInviteModal(true);
  };

  const openNewExpenseModal = () => {
    resetExpenseForm();
    setShowExpenseModal(true);
  };

  const openNewGroupModal = () => {
    resetGroupForm();
    setShowGroupModal(true);
  };

  const openPasswordModal = () => {
    setPasswordCurrent("");
    setPasswordNext("");
    setPasswordConfirm("");
    setPasswordError("");
    setShowPasswordModal(true);
  };

  const openConfirmDialog = (config) => {
    setConfirmDialog(config);
  };

  const closeConfirmDialog = () => {
    setConfirmDialog(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmDialog || !confirmDialog.onConfirm) return;
    try {
      await confirmDialog.onConfirm();
    } finally {
      closeConfirmDialog();
    }
  };

  if (!user) {
    return (
      <LoginPage
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode((prev) => !prev)}
      />
    );
  }

  const userLabel =
    user.displayName || (user.email ? user.email.split("@")[0] : "Member");

  return (
    <div className="app">
      <aside className={`sidebar ${isNavOpen ? "is-open" : ""}`}>
        <div className="logo">
          <div className="logo__mark">FS</div>
          <div>
            <p>Fair Share</p>
            <span>Expense Suite</span>
          </div>
        </div>
        <nav className="nav">
          {navItems.map((item) => (
            <button
              key={item}
              className={`nav__item ${activeNav === item ? "is-active" : ""}`}
              onClick={() => {
                setActiveNav(item);
                setIsNavOpen(false);
              }}
            >
              <span className="nav__dot" />
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar__profile">
          <div className="sidebar__user">
            <div className="user-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-7 2-7 4.5V20h14v-1.5c0-2.5-3-4.5-7-4.5z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div>
              <strong>{userLabel}</strong>
              <span>Logged in</span>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() => setActiveNav("Settings")}
          >
            Settings
          </button>
        </div>
      </aside>
      <div
        className={`sidebar-overlay ${isNavOpen ? "is-visible" : ""}`}
        onClick={() => setIsNavOpen(false)}
        aria-hidden="true"
      />

      <main className="main">
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="nav-toggle"
              onClick={() => setIsNavOpen((prev) => !prev)}
              aria-label={isNavOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={isNavOpen}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
          <div className="topbar__right">
            <button
              type="button"
              className="search-toggle"
              onClick={() => setIsSearchExpanded((prev) => !prev)}
              aria-label="Toggle search"
              aria-expanded={isSearchExpanded}
            >
              <span className="sr-only">Toggle search</span>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M15.5 14h-.79l-.28-.27a6 6 0 1 0-.71.71l.27.28v.79l5 4.99L20.49 19zM10 14a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"
                  fill="currentColor"
                />
              </svg>
            </button>
            <form
              className={`search ${isSearchExpanded ? "is-expanded" : ""}`}
              ref={searchRef}
              onSubmit={(event) => {
                event.preventDefault();
                setSearchTerm(searchQuery);
                if (searchResults.groups.length) {
                  handleSelectGroup(searchResults.groups[0].id);
                } else if (searchResults.expenses.length) {
                  const expense = searchResults.expenses[0];
                  if (expense.groupId) {
                    handleSelectGroup(expense.groupId);
                  }
                }
                setShowSearchResults(false);
              }}
            >
              <input
                ref={searchInputRef}
                placeholder="Search for anything"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => {
                  setShowSearchResults(true);
                  setIsSearchExpanded(true);
                }}
              />
              {showSearchResults && searchQuery.trim() && (
                <div className="search__results">
                  {searchResults.groups.length ? (
                    <div className="search__section">
                      <span>Groups</span>
                      {searchResults.groups.map((group) => (
                        <button
                          key={group.id}
                          className="search__item"
                          type="button"
                          onClick={() => {
                            setSearchTerm(searchQuery);
                            handleSelectGroup(group.id);
                            setShowSearchResults(false);
                          }}
                        >
                          {group.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {searchResults.expenses.length ? (
                    <div className="search__section">
                      <span>Expenses</span>
                      {searchResults.expenses.map((expense) => (
                        <button
                          key={expense.id}
                          className="search__item"
                          type="button"
                          onClick={() => {
                            setSearchTerm(searchQuery);
                            setActiveNav("Expense");
                            setShowSearchResults(false);
                          }}
                        >
                          {expense.category || "Expense"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {!searchResults.groups.length &&
                    !searchResults.expenses.length && (
                      <div className="search__empty">No results found.</div>
                    )}
                </div>
              )}
            </form>
            <div className="notif" ref={notifRef}>
              <button
                className="icon-btn notif__btn"
                onClick={() => setShowNotifications((prev) => !prev)}
                aria-label="Notifications"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path
                    d="M12 3a5 5 0 0 0-5 5v2.6c0 .6-.2 1.2-.6 1.7L5 14.4V17h14v-2.6l-1.4-2.1c-.4-.5-.6-1.1-.6-1.7V8a5 5 0 0 0-5-5z"
                    fill="currentColor"
                  />
                  <path
                    d="M9.5 18a2.5 2.5 0 0 0 5 0"
                    fill="currentColor"
                  />
                </svg>
                {receivedInvites.length > 0 && (
                  <span className="notif__badge">{receivedInvites.length}</span>
                )}
              </button>
              {showNotifications && (
                <div className="notif__menu">
                  <div className="notif__header">
                    <span>Invites</span>
                    <div className="notif__meta">
                      <button
                        className="ghost"
                        onClick={() => {
                          setActiveNav("Activity");
                          setShowNotifications(false);
                        }}
                      >
                        See all
                      </button>
                      <button
                        className="ghost"
                        onClick={handleClearNotifications}
                        disabled={!receivedInvites.length}
                      >
                        Clear all
                      </button>
                    </div>
                  </div>
                  {receivedInvites.length ? (
                    <div className="notif__list">
                      {receivedInvites.map((invite) => (
                        <div className="notif__item" key={invite.id}>
                          <div>
                            <strong>{invite.groupName}</strong>
                            <span>
                              From{" "}
                              {invite.fromName ||
                                invite.fromEmail ||
                                "member"}
                            </span>
                          </div>
                          <div className="notif__actions">
                            <button
                              className="ghost"
                              onClick={() => handleAcceptInvite(invite)}
                            >
                              Accept
                            </button>
                            <button
                              className="danger"
                              onClick={() => handleRejectInvite(invite)}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="notif__empty">No pending invites.</div>
                  )}
                </div>
              )}
            </div>
            <div className="user-menu" ref={userMenuRef}>
              <button
                className="avatar"
                onClick={() => setShowUserMenu((prev) => !prev)}
                aria-label="User menu"
              >
                {userLabel.slice(0, 2).toUpperCase()}
              </button>
              {showUserMenu && (
                <div className="user-menu__panel">
                  <button
                    className="user-menu__item"
                    onClick={() => {
                      setActiveNav("Summary");
                      setShowUserMenu(false);
                    }}
                  >
                    Help
                  </button>
                  <button
                    className="user-menu__item"
                    onClick={() => {
                      setActiveNav("Settings");
                      setShowUserMenu(false);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    className="user-menu__item"
                    onClick={() => {
                      setDarkMode((prev) => !prev);
                    }}
                  >
                    {darkMode ? "Light mode" : "Dark mode"}
                  </button>
                  <button
                    className="user-menu__item danger"
                    onClick={() => signOut(auth)}
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div
          className={`search-backdrop ${isSearchExpanded ? "is-visible" : ""}`}
          onClick={() => setIsSearchExpanded(false)}
          aria-hidden="true"
        />

        <section className="page-title">
          <div>
            <h1>{activeNav}</h1>
            <p>{pageTitle}</p>
          </div>
          <div className="page-actions">
            <button
              className="ghost"
              onClick={
                activeNav === "Groups" ? openNewExpenseModal : openNewGroupModal
              }
            >
              {activeNav === "Groups" ? "Add expense" : "Create group"}
            </button>
            {activeNav === "Dashboard" && (
              <>
                <button className="ghost" onClick={handleImportCsvClick}>
                  Import CSV
                </button>
                <button className="ghost" onClick={handleClearImportedData}>
                  Clear CSV data
                </button>
              </>
            )}
            <button
              className="secondary"
              onClick={() =>
                handleExportDashboardCsv(
                  activeNav === "Dashboard" ? dashboardMonthlyTable : monthlyTable
                )
              }
              disabled={
                !(
                  activeNav === "Dashboard"
                    ? dashboardMonthlyTable.rows.length
                    : monthlyTable.rows.length
                )
              }
            >
              Export CSV
            </button>
            <button className="primary" onClick={() => openInviteModal()}>
              Invite members
            </button>
          </div>
        </section>

        {activeNav === "Dashboard" && (
          <>
            <input
              ref={importFileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsvFile}
              style={{ display: "none" }}
            />
            {importError && <div className="auth__error">{importError}</div>}
          </>
        )}

        {activeNav === "Dashboard" && (
          <DashboardView
            groupTotal={dashboardGroupTotal}
            groupList={dashboardGroupListWithTotals}
            expenses={dashboardExpenses}
            totalExpenses={dashboardTotalExpenses}
            summaryCurrency={dashboardSummaryCurrency}
            onNavigate={setActiveNav}
            onSelectGroup={handleSelectGroup}
            onSelectExpense={handleSelectExpense}
            onAddExpense={openNewExpenseModal}
            currentUserId={user.uid}
            monthlyTable={dashboardMonthlyTable}
            monthOptions={dashboardMonthOptions}
            tiles={dashboardTiles}
            onTileRangeChange={handleTileRangeChange}
            onTileMonthChange={handleTileMonthChange}
            onReorderTiles={handleReorderTiles}
            onResizeTile={handleResizeTile}
          />
        )}
        {activeNav === "Groups" && (
          <GroupsView
            groupList={groupListWithTotals.map((group) => ({
              ...group,
              onSelect: () => handleSelectGroup(group.id),
              inviteCount: sentInviteCounts.get(group.id) || 0,
              onEdit: () => handleEditGroup(group),
              onInvite: () => openInviteModal(group.id),
              onDelete: () =>
                openConfirmDialog({
                  title: "Delete group",
                  message: `Delete "${group.name}"? This cannot be undone.`,
                  confirmLabel: "Delete group",
                  onConfirm: () => handleDeleteGroup(group),
                }),
            }))}
            onCreateGroup={openNewGroupModal}
            groupActionError={groupActionError}
            pendingInviteCount={sentInvites.length}
            importedCsvFiles={importedCsvFiles}
            onLoadCsv={handleLoadStoredCsv}
            onDeleteCsv={(file) =>
              openConfirmDialog({
                title: "Delete CSV file",
                message: `Delete "${file.name || "import.csv"}"?`,
                confirmLabel: "Delete file",
                onConfirm: () => handleDeleteStoredCsv(file),
              })
            }
            onUpdateCsvCurrency={handleUpdateStoredCsvCurrency}
            activeCsvId={activeCsvId}
          />
        )}
        {activeNav === "Insight" && (
          <InsightView
            groupList={dashboardGroupListWithTotals}
            expenses={dashboardExpenses}
            selectedGroupId={insightGroupId}
            onSelectGroup={setInsightGroupId}
            currencyOverride={importCurrencyOverride}
          />
        )}
        {activeNav === "Expense" && (
          <ExpenseView
            expenses={filteredExpenses.map((expense) => ({
              ...expense,
              onEdit: () => handleEditExpense(expense),
              onDelete: () =>
                openConfirmDialog({
                  title: "Delete expense",
                  message: `Delete "${expense.category || "Expense"}"? This cannot be undone.`,
                  confirmLabel: "Delete expense",
                  onConfirm: () => handleDeleteExpense(expense),
                }),
            }))}
            onAddExpense={openNewExpenseModal}
            expenseActionError={expenseActionError}
            onSelectGroup={handleSelectGroup}
          />
        )}
        {activeNav === "Activity" && (
          <ActivityView
            activityItems={filteredActivityItems}
            notes={filteredNotes}
            noteText={noteText}
            onNoteTextChange={setNoteText}
            onAddNote={handleAddNote}
            onToggleNoteMenu={handleToggleNoteMenu}
            onEditNote={handleEditNote}
            onDeleteNote={handleDeleteNote}
            onClearFeed={handleClearFeed}
          />
        )}
        {activeNav === "Summary" && (
          <SummaryView
            groupList={groupListWithTotals}
            expenses={filteredExpenses}
            selectedGroupId={selectedGroupId}
            onSelectGroup={setSelectedGroupId}
            onAddExpense={openNewExpenseModal}
            onEditExpense={handleEditExpense}
            onDeleteExpense={(expense) =>
              openConfirmDialog({
                title: "Delete expense",
                message: `Delete "${expense.category || "Expense"}"? This cannot be undone.`,
                confirmLabel: "Delete expense",
                onConfirm: () => handleDeleteExpense(expense),
              })
            }
          />
        )}
        {activeNav === "Settings" && (
          <SettingsView
            profile={profile}
            onProfileChange={handleProfileChange}
            onSaveProfile={handleSaveProfile}
            profileBusy={profileBusy}
            profileError={profileError}
            onOpenPasswordModal={openPasswordModal}
          />
        )}
      </main>

      {showGroupModal && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>{editingGroupId ? "Edit group" : "Create group"}</h3>
              <button
                className="ghost"
                onClick={() => {
                  resetGroupForm();
                  setShowGroupModal(false);
                }}
              >
                Close
              </button>
            </div>
            <form className="modal__form" onSubmit={handleSaveGroup}>
              <label>
                Group name
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="Goa Escape"
                />
              </label>
              <label>
                Members
                <input
                  type="number"
                  min="1"
                  value={newGroupMembers}
                  onChange={(event) => setNewGroupMembers(event.target.value)}
                />
              </label>
              <label>
                Currency
                <select
                  value={newGroupCurrency}
                  onChange={(event) => setNewGroupCurrency(event.target.value)}
                >
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Group type
                <select
                  value={newGroupType}
                  onChange={(event) => setNewGroupType(event.target.value)}
                >
                  {groupTypes.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              {groupError && <div className="auth__error">{groupError}</div>}
              <div className="modal__actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    resetGroupForm();
                    setShowGroupModal(false);
                  }}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={groupBusy}>
                  {groupBusy
                    ? editingGroupId
                      ? "Updating..."
                      : "Creating..."
                    : editingGroupId
                    ? "Update"
                    : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExpenseModal && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>{editingExpenseId ? "Edit expense" : "Add expense"}</h3>
              <button
                className="ghost"
                onClick={() => {
                  resetExpenseForm();
                  setShowExpenseModal(false);
                }}
              >
                Close
              </button>
            </div>
            <form className="modal__form" onSubmit={handleCreateExpense}>
              <label>
                Group
                <select
                  value={expenseGroupId}
                  onChange={(event) => {
                    const nextGroupId = event.target.value;
                    setExpenseGroupId(nextGroupId);
                    const selectedGroup = groupList.find(
                      (group) => group.id === nextGroupId
                    );
                    if (selectedGroup && selectedGroup.currency) {
                      setExpenseCurrency(selectedGroup.currency);
                    }
                  }}
                >
                  <option value="">No group</option>
                  {groupList.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Paid by
                <select
                  value={expensePaidBy || user.uid}
                  onChange={(event) => setExpensePaidBy(event.target.value)}
                  disabled={!expenseGroupId}
                >
                  <option value={user.uid}>You</option>
                  {groupList
                    .find((group) => group.id === expenseGroupId)
                    ?.members.map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {member.name || member.email || member.uid}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Split type
                <select
                  value={expenseSplitType}
                  onChange={(event) => setExpenseSplitType(event.target.value)}
                >
                  <option value="equal">Equal split</option>
                  <option value="exact">Exact amounts</option>
                  <option value="weighted">Weighted</option>
                </select>
              </label>
              <label>
                Currency
                <select
                  value={expenseCurrency}
                  onChange={(event) => setExpenseCurrency(event.target.value)}
                >
                  {currencyOptions.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={expenseCategory}
                  onChange={(event) => setExpenseCategory(event.target.value)}
                >
                  {expenseCategoryOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseAmount}
                  onChange={(event) => setExpenseAmount(event.target.value)}
                  placeholder="120"
                />
              </label>
              <label>
                Date
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </label>
              <label>
                Note
                <input
                  type="text"
                  value={expenseNote}
                  onChange={(event) => setExpenseNote(event.target.value)}
                  placeholder="Dinner split"
                />
              </label>
              {expenseError && <div className="auth__error">{expenseError}</div>}
              <div className="modal__actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    resetExpenseForm();
                    setShowExpenseModal(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={expenseBusy}
                >
                  {expenseBusy
                    ? editingExpenseId
                      ? "Updating..."
                      : "Saving..."
                    : editingExpenseId
                    ? "Update"
                    : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>Invite member</h3>
              <button
                className="ghost"
                onClick={() => setShowInviteModal(false)}
              >
                Close
              </button>
            </div>
            <form className="modal__form" onSubmit={handleInviteMember}>
              <label>
                Group
                <select
                  value={inviteGroupId}
                  onChange={(event) => setInviteGroupId(event.target.value)}
                >
                  <option value="">Choose a group</option>
                  {groupList.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="friend@example.com"
                />
              </label>
              {inviteError && <div className="auth__error">{inviteError}</div>}
              <div className="modal__actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={inviteBusy}>
                  {inviteBusy ? "Sending..." : "Send invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>{confirmDialog.title}</h3>
              <button className="ghost" onClick={closeConfirmDialog}>
                Close
              </button>
            </div>
            <p className="modal__body">{confirmDialog.message}</p>
            <div className="modal__actions">
              <button className="ghost" type="button" onClick={closeConfirmDialog}>
                Cancel
              </button>
              <button className="danger" type="button" onClick={handleConfirmAction}>
                {confirmDialog.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>Change password</h3>
              <button
                className="ghost"
                onClick={() => setShowPasswordModal(false)}
              >
                Close
              </button>
            </div>
            <form className="modal__form" onSubmit={handleUpdatePassword}>
              <label>
                Current password
                <input
                  type="password"
                  value={passwordCurrent}
                  onChange={(event) => setPasswordCurrent(event.target.value)}
                  placeholder="Enter current password"
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  value={passwordNext}
                  onChange={(event) => setPasswordNext(event.target.value)}
                  placeholder="Enter new password"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  placeholder="Re-enter new password"
                />
              </label>
              {passwordError && (
                <div className="auth__error">{passwordError}</div>
              )}
              <div className="modal__actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={passwordBusy}>
                  {passwordBusy ? "Updating..." : "Update password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNoteModal && (
        <div className="modal">
          <div className="modal__content">
            <div className="modal__header">
              <h3>Edit note</h3>
              <button
                className="ghost"
                onClick={() => {
                  setShowNoteModal(false);
                  setEditingNote(null);
                  setNoteDraft("");
                }}
              >
                Close
              </button>
            </div>
            <form className="modal__form" onSubmit={handleSaveNote}>
              <label>
                Note
                <input
                  type="text"
                  value={noteDraft}
                  onChange={(event) => setNoteDraft(event.target.value)}
                  placeholder="Update note"
                />
              </label>
              <div className="modal__actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setShowNoteModal(false);
                    setEditingNote(null);
                    setNoteDraft("");
                  }}
                >
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
