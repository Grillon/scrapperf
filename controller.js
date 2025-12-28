<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>UI Perf Controller</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 16px;
    }
    button {
      padding: 8px 12px;
      margin-right: 8px;
    }
    table {
      border-collapse: collapse;
      margin-top: 16px;
      width: 100%;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 6px 8px;
      text-align: left;
    }
    th {
      background: #f4f4f4;
    }
  </style>
</head>
<body>

<h2>UI Perf Controller</h2>

<button id="openApp">Open app</button>
<button id="run">Run scenario</button>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Date / heure</th>
      <th>Mesure (ms)</th>
    </tr>
  </thead>
  <tbody id="rows"></tbody>
</table>

<script>
  let appWin = null;
  let runIndex = 0;

  const rows = document.getElementById("rows");

  document.getElementById("openApp").onclick = () => {
    appWin = window.open(
      "https://ubiquitous-brigadeiros-7893ed.netlify.app/",   // ⬅️ mets l’URL réelle ici
      "appWin"
    );
  };

  document.getElementById("run").onclick = () => {
    if (!appWin || appWin.closed) {
      alert("App window not open");
      return;
    }

    runIndex = 0;

    appWin.postMessage({
      type: "RUN_SCENARIO",
      payload: {
        runs: 5
      }
    }, "*");
  };

  window.addEventListener("message", (event) => {
    if (!event.data || event.data.type !== "PERF_RESULT") return;

    const { run, ms, ts } = event.data.payload;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${run}</td>
      <td>${ts}</td>
      <td>${ms}</td>
    `;
    rows.appendChild(tr);
  });
</script>

</body>
</html>

