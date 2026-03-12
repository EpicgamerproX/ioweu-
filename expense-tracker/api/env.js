module.exports = (req, res) => {
  const publicEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY || "INR",
    APP_NAME: process.env.APP_NAME || "Group Expense Tracker"
  };

  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).send(
    `window.__EXPENSE_TRACKER_ENV__ = ${JSON.stringify(publicEnv)};`
  );
};
