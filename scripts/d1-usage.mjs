// Prints D1 rows written/read per database per day for the Cloudflare
// account, from Cloudflare's GraphQL analytics. Read-only.
const token = process.env.CLOUDFLARE_API_TOKEN;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const accounts = await (await fetch("https://api.cloudflare.com/client/v4/accounts", { headers })).json();
if (!accounts.success) {
  console.log("Could not list accounts:", JSON.stringify(accounts.errors));
  process.exit(1);
}
for (const account of accounts.result) {
  const dbs = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${account.id}/d1/database?per_page=100`, { headers })).json();
  const names = Object.fromEntries((dbs.result || []).map((db) => [db.uuid, db.name]));
  console.log(`\nAccount: ${account.name}`);
  console.log(`Databases: ${Object.values(names).join(", ") || "(none listed)"}`);

  const since = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const query = `query ($account: String!, $since: Date!) {
    viewer { accounts(filter: { accountTag: $account }) {
      d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $since }, orderBy: [date_ASC]) {
        sum { rowsWritten rowsRead writeQueries readQueries }
        dimensions { date databaseId }
      }
    } }
  }`;
  const result = await (await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers, body: JSON.stringify({ query, variables: { account: account.id, since } })
  })).json();
  if (result.errors) {
    console.log("Analytics query failed:", JSON.stringify(result.errors).slice(0, 500));
    continue;
  }
  const rows = result.data.viewer.accounts[0]?.d1AnalyticsAdaptiveGroups || [];
  const byDay = {};
  for (const row of rows) {
    const day = row.dimensions.date;
    byDay[day] ||= {};
    byDay[day][names[row.dimensions.databaseId] || row.dimensions.databaseId] = row.sum;
  }
  for (const [day, dbsOnDay] of Object.entries(byDay)) {
    const total = Object.values(dbsOnDay).reduce((sum, item) => sum + item.rowsWritten, 0);
    console.log(`${day}  total rows written: ${total.toLocaleString()}`);
    for (const [name, sum] of Object.entries(dbsOnDay)) {
      console.log(`    ${name.padEnd(28)} written ${String(sum.rowsWritten).padStart(9)}  read ${String(sum.rowsRead).padStart(11)}  write queries ${sum.writeQueries}`);
    }
  }
}
