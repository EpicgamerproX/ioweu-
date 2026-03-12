const env = window.__EXPENSE_TRACKER_ENV__ || {};

export const APP_CONFIG = {
  appName: env.APP_NAME || "Group Expense Tracker",
  supabaseUrl: env.SUPABASE_URL || "",
  supabaseAnonKey: env.SUPABASE_ANON_KEY || "",
  defaultCurrency: env.DEFAULT_CURRENCY || "INR",
  sessionStorageKey: "expense-tracker-session",
  comparisonItems: [
    { label: "filter coffees", price: 180 },
    { label: "late-night pizzas", price: 420 },
    { label: "movie tickets", price: 320 },
    { label: "cab rides", price: 260 },
    { label: "paperback books", price: 499 }
  ]
};

export function validateConfig() {
  if (!APP_CONFIG.supabaseUrl || !APP_CONFIG.supabaseAnonKey) {
    throw new Error("Missing Supabase configuration. Fill window.__EXPENSE_TRACKER_ENV__ or update .env-backed deployment config.");
  }
}
