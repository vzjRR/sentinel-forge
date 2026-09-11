/**
 * The stylesheet, as a string.
 *
 * Sentinel Forge has no third-party runtime dependencies and no network access,
 * so there is no CSS framework, no web font and no CDN. The stylesheet is
 * embedded in every page it styles: a dashboard that renders unstyled because
 * an asset request failed would be a worse tool than one with plain markup.
 *
 * The visual language is an engineering instrument, not a marketing page:
 * dense tables, monospaced identifiers, severity encoded by colour *and* by
 * text so it survives a colour-blind reader and a black-and-white printout.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

export const STYLESHEET = `
:root {
  --bg: #0f1115;
  --bg-raised: #161a21;
  --bg-sunken: #0b0d11;
  --border: #262c36;
  --border-strong: #38414f;
  --text: #dfe5ee;
  --text-dim: #98a3b3;
  --text-faint: #6b7686;
  --accent: #4c8dff;
  --critical: #ff5c5c;
  --high: #ff9640;
  --medium: #ffd166;
  --low: #7cc4fa;
  --info: #8f9bab;
  --ok: #4ec9a0;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

@media (prefers-color-scheme: light) {
  :root {
    --bg: #f7f8fa;
    --bg-raised: #ffffff;
    --bg-sunken: #eceef2;
    --border: #d8dce3;
    --border-strong: #b6bcc7;
    --text: #171a1f;
    --text-dim: #545c69;
    --text-faint: #7b8492;
    --accent: #1f5fd0;
    --critical: #c0202b;
    --high: #a85700;
    --medium: #7a5c00;
    --low: #1a5f89;
    --info: #5c6673;
    --ok: #146b4f;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

code, .mono, pre { font-family: var(--mono); font-size: 12.5px; }

.layout { display: flex; min-height: 100vh; align-items: stretch; }

.sidebar {
  width: 220px;
  flex: 0 0 220px;
  background: var(--bg-sunken);
  border-right: 1px solid var(--border);
  padding: 18px 0;
}

.brand { padding: 0 18px 14px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
.brand strong { display: block; font-size: 15px; letter-spacing: 0.2px; }
.brand span { display: block; color: var(--text-faint); font-size: 11.5px; }

.nav a {
  display: block;
  padding: 7px 18px;
  color: var(--text-dim);
  border-left: 2px solid transparent;
}
.nav a:hover { background: var(--bg-raised); color: var(--text); text-decoration: none; }
.nav a[aria-current="page"] { color: var(--text); border-left-color: var(--accent); background: var(--bg-raised); }

.main { flex: 1 1 auto; min-width: 0; padding: 24px 28px 64px; }

h1 { font-size: 20px; margin: 0 0 4px; font-weight: 600; }
h2 { font-size: 15px; margin: 28px 0 10px; font-weight: 600; }
h3 { font-size: 13.5px; margin: 18px 0 8px; font-weight: 600; color: var(--text-dim); }
.subtitle { color: var(--text-faint); margin: 0 0 20px; font-size: 12.5px; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }

.card {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 14px 16px;
}
.card .label { color: var(--text-faint); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.6px; }
.card .value { font-size: 22px; font-weight: 600; margin-top: 2px; }
.card .note { color: var(--text-faint); font-size: 11.5px; margin-top: 2px; }

table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-faint); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
tbody tr:hover { background: var(--bg-raised); }
td.num, th.num { text-align: right; font-family: var(--mono); }

.badge {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  border: 1px solid currentColor;
}
.badge.CRITICAL { color: var(--critical); }
.badge.HIGH { color: var(--high); }
.badge.MEDIUM { color: var(--medium); }
.badge.LOW { color: var(--low); }
.badge.INFO { color: var(--info); }
.badge.OK { color: var(--ok); }

.finding { border: 1px solid var(--border); border-radius: 6px; margin: 10px 0; background: var(--bg-raised); }
.finding > header { padding: 10px 14px; border-bottom: 1px solid var(--border); display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.finding > header .title { font-weight: 600; }
.finding > header .rule { font-family: var(--mono); font-size: 11.5px; color: var(--text-faint); }
.finding .body { padding: 10px 14px; }
.finding .where { font-family: var(--mono); font-size: 11.5px; color: var(--text-dim); }
.finding .recommendation { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border); }

.evidence { margin: 8px 0 0; padding: 0; list-style: none; }
.evidence li { padding: 6px 0 0; border-top: 1px solid var(--border); margin-top: 6px; }
.evidence .kind { font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.5px; }
pre.excerpt {
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px 10px;
  overflow-x: auto;
  margin: 6px 0 0;
  white-space: pre;
}

.meter { background: var(--bg-sunken); border: 1px solid var(--border); border-radius: 3px; height: 8px; overflow: hidden; }
.meter > span { display: block; height: 100%; background: var(--accent); }
.meter.critical > span { background: var(--critical); }
.meter.high > span { background: var(--high); }
.meter.medium > span { background: var(--medium); }
.meter.ok > span { background: var(--ok); }

.note, .unavailable {
  color: var(--text-faint);
  font-style: italic;
}

.limitations {
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-strong);
  border-radius: 4px;
  background: var(--bg-raised);
  padding: 10px 14px;
  margin: 18px 0 0;
  font-size: 12.5px;
  color: var(--text-dim);
}
.limitations h2 { margin: 0 0 6px; font-size: 12.5px; color: var(--text); }
.limitations ul { margin: 0; padding-left: 18px; }

footer.page {
  margin-top: 36px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 11.5px;
}

.empty { padding: 18px; border: 1px dashed var(--border); border-radius: 6px; color: var(--text-faint); text-align: center; }

@media (max-width: 760px) {
  .layout { display: block; }
  .sidebar { width: auto; border-right: none; border-bottom: 1px solid var(--border); }
  .nav { display: flex; flex-wrap: wrap; }
  .nav a { border-left: none; border-bottom: 2px solid transparent; }
  .nav a[aria-current="page"] { border-left-color: transparent; border-bottom-color: var(--accent); }
  .main { padding: 16px; }
}

@media print {
  .sidebar { display: none; }
  body { background: #fff; color: #000; }
}
`;
