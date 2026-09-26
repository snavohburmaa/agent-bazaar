/** Standalone HTML for the downloadable PDF report. */
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function md(src: string) {
  return esc(src)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>").replace(/^## (.*)$/gm, "<h2>$1</h2>").replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`).replace(/\n{2,}/g, "<br><br>");
}
export function reportHtml(R: any, o: { asset: string; registryUrl: string }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentBazaar report</title>
<style>
@page{size:A4;margin:18mm 16mm}
body{font:11.5pt/1.6 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#14211c}
h1{font-size:22pt;margin:0 0 4px}h2{font-size:15pt;margin:22px 0 6px;border-bottom:2px solid #0f5c4d;padding-bottom:3px}h3{font-size:12.5pt;margin:14px 0 4px}
.sub{color:#5d6b65;font-size:10pt;margin-bottom:14px}
.kpi{display:flex;gap:24px;margin:10px 0 18px}.kpi div{flex:1;border:1px solid #d3dbd6;border-radius:10px;padding:10px 14px}.kpi b{font-size:20pt;color:#0f5c4d;display:block}
table{border-collapse:collapse;width:100%;font-size:10pt;margin:6px 0 10px}th,td{border:1px solid #d3dbd6;padding:6px 8px;text-align:left;vertical-align:top}th{background:#dcece7}
a{color:#0f5c4d;word-break:break-all}.mono{font-family:Menlo,monospace;font-size:9pt}
ul{margin:4px 0 8px 20px}li{margin:3px 0}
</style></head><body>
<h1>AgentBazaar research report</h1>
<div class="sub">Question: ${esc(R.question)}<br>Network: Avalanche Fuji · Registry: <a href="${esc(o.registryUrl)}">${esc(o.registryUrl)}</a><br>Generated ${new Date().toISOString().replace("T", " ").slice(0, 16)} UTC · session ${esc(R.id)}</div>
<div class="kpi"><div>Total spent<b>${esc(R.spent)} ${esc(o.asset)}</b>across ${R.receipts.length} payments</div><div>Unspent budget<b>${esc(R.remaining)} ${esc(o.asset)}</b>of ${esc(R.budget)} ${esc(o.asset)} cap</div><div>Contributors<b style="font-size:13pt">${esc(R.contributors.join(", ") || "none")}</b></div></div>
${md(R.report)}
<h2>Payment receipts</h2>
<table><tr><th>Agent</th><th>Amount</th><th>Transaction</th></tr>${R.receipts.map((r: any) => `<tr><td>${esc(r.agent)}</td><td>${esc(r.amount)} ${esc(o.asset)}</td><td class="mono"><a href="${esc(r.url)}">${esc(r.txHash)}</a></td></tr>`).join("")}</table>
<h2>Ratings posted on chain</h2>
<table><tr><th>Agent</th><th>Score</th><th>Justification</th><th>Transaction</th></tr>${R.ratings.map((r: any) => `<tr><td>${esc(r.agent)}</td><td>${r.score}/5</td><td>${esc(r.justification)}</td><td class="mono"><a href="${esc(r.url)}">${esc(r.txHash)}</a></td></tr>`).join("")}</table>
</body></html>`;
}
