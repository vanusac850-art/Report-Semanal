'use strict';

// ── Supabase config ────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://rmucbgujvmmtmftxtgxk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_c1jV7_vPvYm_UDoWzVsc7w_jbbbl0uW';
const BUCKET = 'arquivos';

async function sbFetch(path, options = {}) {
  const doFetch = async () => {
    const token = (typeof getAccessToken === 'function') ? getAccessToken() : SUPABASE_KEY;
    return await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  };
  if (typeof withAuthRetry === 'function') {
    return await withAuthRetry(doFetch);
  }
  return await doFetch();
}

// ── State ──────────────────────────────────────────────────────────────────
const SECTORS = ['Financeiro','Comercial','Marketing','Operações','RH','TI','Jurídico','Logística'];
let reports = [];
let selectedFile = null;

// ── Status logic ───────────────────────────────────────────────────────────
// Report status (per individual report):
// 'ontime'   → enviado no mesmo dia ou antes da data de referência
// 'late'     → enviado entre 1 e 10 dias após a data de referência
// 'critical' → enviado mais de 10 dias após a data de referência
//
// Sector status (derived from all reports of the sector):
// 'ontime'   → tem reports e o último foi no prazo
// 'late'     → tem reports e o último foi atrasado
// 'critical' → tem reports e o último foi crítico
// 'alert'    → ficou 7+ dias sem enviar nada após o último envio
// 'pending'  → nunca enviou nenhum report

function daysBetween(dateA, dateB) {
  // dateA and dateB as YYYY-MM-DD strings or Date objects
  const a = new Date(typeof dateA === 'string' ? dateA + (dateA.length === 10 ? 'T00:00:00' : '') : dateA);
  const b = new Date(typeof dateB === 'string' ? dateB + (dateB.length === 10 ? 'T00:00:00' : '') : dateB);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function getReportStatus(submittedAt, refDate) {
  const submittedDay = new Date(submittedAt).toLocaleDateString('en-CA');
  const refDay = refDate.slice(0, 10);
  const diff = daysBetween(refDay, submittedDay);
  if (diff <= 0)  return 'ontime';
  if (diff <= 10) return 'late';
  return 'critical';
}

function getSectorStatus(sectorReports) {
  if (!sectorReports.length) return 'nodata';
  const last = sectorReports[0]; // most recent
  const daysSinceLast = daysBetween(last.submittedAt, new Date());
  if (daysSinceLast >= 7) return 'alert';
  return last.status; // ontime / late / critical
}

function statusBadge(status) {
  const map = {
    ontime:   `<span class="badge badge-teal"><i class="ti ti-circle-check"></i> No prazo</span>`,
    late:     `<span class="badge badge-amber"><i class="ti ti-clock-exclamation"></i> Atrasado</span>`,
    critical: `<span class="badge badge-red"><i class="ti ti-alert-triangle"></i> Crítico</span>`,
    alert:    `<span class="badge badge-orange"><i class="ti ti-bell-exclamation"></i> Em alerta</span>`,
  };
  return map[status] || map.nodata;
}

function sectorStatusLabel(status, lastReport) {
  if (status === 'nodata') return `<i class="ti ti-circle-dashed" style="color:var(--text-3)"></i> Nunca enviou`;
  if (status === 'alert') {
    const days = lastReport ? daysBetween(lastReport.submittedAt, new Date()) : 0;
    return `<i class="ti ti-bell-exclamation" style="color:#F97316"></i> Em alerta · ${days}d sem enviar`;
  }
  const icons = { ontime: 'ti-circle-check', late: 'ti-clock-exclamation', critical: 'ti-alert-triangle' };
  const colors = { ontime: 'var(--teal)', late: 'var(--amber)', critical: 'var(--red)' };
  const labels = { ontime: 'No prazo', late: 'Atrasado', critical: 'Crítico' };
  return `<i class="ti ${icons[status]}" style="color:${colors[status]}"></i> ${labels[status]} · ${formatDate(lastReport?.data)}`;
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setWeekLabel();
  setDefaultDate();
  registerSW();
  initAuth(); // shows login or app; app calls loadReports via showApp -> navigate
  checkPendingDraft();
});

function registerSW() {
  // Unregister any existing service workers to prevent caching issues
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.unregister());
    });
    caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────
let reportsLoaded = false;

function navigate(page) {
  // Colaboradores only have access to the upload page
  if (currentRole !== 'gestor' && page !== 'upload') {
    page = 'upload';
  }
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.remove('hidden');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  const titles = { dashboard: 'Dashboard', upload: 'Enviar report', reports: 'Todos os reports' };
  document.getElementById('mobileTitle').textContent = titles[page];

  // Load reports lazily on first relevant navigation
  if (!reportsLoaded && (page === 'dashboard' || page === 'reports')) {
    reportsLoaded = true;
    loadReports();
  } else {
    if (page === 'dashboard') renderDashboard();
    if (page === 'reports') renderReportsPage();
  }
  if (window.innerWidth <= 680) closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ── Supabase ────────────────────────────────────────────────────────────────
async function loadReports() {
  showLoading(true);
  try {
    const res = await sbFetch('/rest/v1/reports?select=*&order=submitted_at.desc', {
      headers: { 'Prefer': 'return=representation' }
    });
    if (!res.ok) {
      const errText = await res.text();
      if (errText.includes('JWT') || errText.includes('expired')) {
        throw new Error('Sua sessão expirou. Por favor, saia e faça login novamente.');
      }
      throw new Error(errText);
    }
    const data = await res.json();
    reports = data.map(r => ({
      id: r.id,
      titulo: r.titulo,
      responsavel: r.responsavel,
      setor: r.setor,
      data: r.data_referencia,
      fileName: r.file_name,
      fileSize: r.file_size,
      fileType: r.file_type,
      status: getReportStatus(r.submitted_at, r.data_referencia),
      submittedAt: r.submitted_at,
      fileUrl: r.file_url,
      submittedByEmail: r.submitted_by_email
    }));
    renderAll();
  } catch(e) {
    showToast('Erro ao carregar reports: ' + e.message);
  } finally {
    showLoading(false);
  }
}

function showLoading(show) {
  const btn = document.getElementById('btnSubmit');
  if (btn) btn.disabled = show;
}

// ── Retry helper ──────────────────────────────────────────────────────────────
// Retries a function up to `attempts` times with increasing delay between tries.
// Calls onRetry(attemptNumber) before each retry so the UI can show progress.
async function withRetry(fn, attempts = 3, onRetry = null) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < attempts) {
        if (onRetry) onRetry(i);
        await new Promise(r => setTimeout(r, i * 1200)); // 1.2s, 2.4s, ...
      }
    }
  }
  throw lastError;
}

async function uploadFile(file, onRetry) {
  const ext = file.name.split('.').pop();
  const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  await withRetry(async () => {
    const token = (typeof getAccessToken === 'function') ? getAccessToken() : SUPABASE_KEY;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true'
      },
      body: file
    });
    if (!res.ok) throw new Error('Falha no upload do arquivo: ' + await res.text());
  }, 3, onRetry);

  const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

  // Verify the file actually landed in storage (catches silent failures)
  await withRetry(async () => {
    const check = await fetch(fileUrl, { method: 'HEAD' });
    if (!check.ok) throw new Error('Arquivo não confirmado no servidor após o upload.');
  }, 2);

  return fileUrl;
}

async function insertReport(record, onRetry) {
  return await withRetry(async () => {
    const res = await sbFetch('/rest/v1/reports', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(record)
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  }, 3, onRetry);
}

async function deleteReport(id, titulo) {
  if (!confirm(`Apagar o report "${titulo}"?\n\nEssa ação não pode ser desfeita.`)) return;
  try {
    const res = await sbFetch(`/rest/v1/reports?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    reports = reports.filter(r => r.id !== id);
    renderAll();
    showToast('Report apagado com sucesso.');
  } catch(e) {
    showToast('Erro ao apagar: ' + e.message);
  }
}

// ── Utils ───────────────────────────────────────────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0,0,0,0);
  return d;
}
function formatDate(iso) {
  if (!iso) return '—';
  const [y,m,d] = iso.slice(0,10).split('-');
  return `${d}/${m}/${y}`;
}
function formatSize(b) {
  return b > 1048576 ? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';
}
function setWeekLabel() {
  const now = new Date();
  const s = getWeekStart(now);
  const e = new Date(s); e.setDate(e.getDate() + 4);
  const fmt = d => d.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'});
  document.getElementById('weekLabel').textContent = `${fmt(s)} – ${fmt(e)}`;
}
function setDefaultDate() {
  document.getElementById('fData').value = new Date().toISOString().split('T')[0];
}

// ── File handling ────────────────────────────────────────────────────────────
function handleDrag(e, over) {
  e.preventDefault();
  document.getElementById('dropZone').classList.toggle('over', over);
}
function handleDrop(e) {
  e.preventDefault();
  handleDrag(e, false);
  const f = e.dataTransfer.files[0];
  if (f) selectFile(f);
}
function selectFile(f) {
  if (!f) return;
  const valid = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!valid.includes(f.type) && !f.name.match(/\.(pdf|doc|docx)$/i)) {
    showToast('Formato inválido. Use PDF ou Word.'); return;
  }
  if (f.size > 20 * 1024 * 1024) { showToast('Arquivo muito grande. Máx. 20 MB.'); return; }
  if (f.size === 0) { showToast('O arquivo está vazio ou corrompido. Selecione outro.'); return; }
  selectedFile = f;
  const isPdf = f.name.toLowerCase().endsWith('.pdf');
  document.getElementById('filePreviewName').textContent = f.name;
  document.getElementById('filePreviewSize').textContent = formatSize(f.size);
  document.getElementById('filePreviewIcon').innerHTML = `<i class="ti ${isPdf ? 'ti-file-type-pdf' : 'ti-file-type-doc'}"></i>`;
  document.getElementById('filePreview').classList.add('show');
}
function removeFile() {
  selectedFile = null;
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fFile').value = '';
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submitReport() {
  const resp  = document.getElementById('fResponsavel').value.trim();
  const setor = document.getElementById('fSetor').value.trim();
  const data  = document.getElementById('fData').value;
  const titulo = document.getElementById('fTitulo').value.trim();

  if (!resp || !setor || !data || !titulo || !selectedFile) {
    showToast('Preencha todos os campos e anexe um arquivo.'); return;
  }

  // Basic connectivity check before starting
  if (!navigator.onLine) {
    showToast('Sem conexão com a internet. Verifique sua rede e tente novamente.');
    return;
  }

  const btn = document.getElementById('btnSubmit');
  const setBtnText = (txt) => { btn.innerHTML = `<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> ${txt}`; };
  btn.disabled = true;
  setBtnText('Enviando arquivo...');

  // Save a draft in localStorage in case the tab closes mid-upload —
  // lets us warn the user on next visit that a submission may not have completed.
  const draftKey = 'reports_pending_draft';
  localStorage.setItem(draftKey, JSON.stringify({ titulo, setor, resp, data, fileName: selectedFile.name, startedAt: Date.now() }));

  const beforeUnloadHandler = (e) => {
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);

  try {
    const fileUrl = await uploadFile(selectedFile, (attempt) => {
      setBtnText(`Tentando novamente (${attempt}/3)...`);
    });

    setBtnText('Salvando registro...');
    const now = new Date();
    await insertReport({
      titulo, responsavel: resp, setor,
      data_referencia: data,
      file_name: selectedFile.name,
      file_size: formatSize(selectedFile.size),
      file_type: selectedFile.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx',
      file_url: fileUrl,
      on_time: getReportStatus(now.toISOString(), data) === 'ontime',
      submitted_at: now.toISOString(),
      submitted_by_email: currentUser?.email || null
    }, (attempt) => {
      setBtnText(`Tentando novamente (${attempt}/3)...`);
    });

    // Success: clear draft, reset form
    localStorage.removeItem(draftKey);
    document.getElementById('fResponsavel').value = '';
    document.getElementById('fSetor').value = '';
    setDefaultDate();
    document.getElementById('fTitulo').value = '';
    removeFile();
    showToast('✓ Report salvo com sucesso no servidor!');
    reportsLoaded = false; // force fresh reload next time dashboard/reports is opened
    await loadReports();
    navigate('dashboard');
  } catch(e) {
    showToast('❌ Não foi possível enviar após várias tentativas: ' + e.message);
  } finally {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-send"></i> Enviar report';
  }
}

// Warn the user on load if a previous submission may have been interrupted
function checkPendingDraft() {
  try {
    const raw = localStorage.getItem('reports_pending_draft');
    if (!raw) return;
    const draft = JSON.parse(raw);
    const minutesAgo = Math.round((Date.now() - draft.startedAt) / 60000);
    showToast(`⚠️ Um envio anterior ("${draft.titulo}") pode não ter sido concluído há ${minutesAgo} min. Verifique em "Todos os reports" e reenvie se necessário.`);
    localStorage.removeItem('reports_pending_draft');
  } catch {}
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderReportsPage();
}

function buildSectorStats() {
  return SECTORS.map(sector => {
    const sr = reports.filter(r => r.setor === sector);
    const sectorStatus = getSectorStatus(sr);
    const onTime   = sr.filter(r => r.status === 'ontime').length;
    const late     = sr.filter(r => r.status === 'late').length;
    const critical = sr.filter(r => r.status === 'critical').length;
    const total    = sr.length;
    const pct      = total > 0 ? Math.round((onTime / total) * 100) : 0;
    return { sector, sr, sectorStatus, onTime, late, critical, total, pct, lastReport: sr[0] || null };
  });
}

function renderDashboard() {
  const stats = buildSectorStats();

  const kpiOntime   = reports.filter(r => r.status === 'ontime').length;
  const kpiLate     = reports.filter(r => r.status === 'late').length;
  const kpiCritical = reports.filter(r => r.status === 'critical').length;
  const kpiAlert    = stats.filter(s => s.sectorStatus === 'alert').length;
  const totalReports = reports.length;

  document.getElementById('kpiOnTime').textContent  = kpiOntime;
  document.getElementById('kpiLate').textContent    = kpiLate;
  document.getElementById('kpiCritical').textContent = kpiCritical;
  document.getElementById('kpiAlert').textContent   = kpiAlert;
  document.getElementById('kpiTotal').textContent   = totalReports;
  document.getElementById('dashSub').textContent    = totalReports === 0
    ? 'Nenhum report enviado ainda'
    : `${totalReports} report${totalReports !== 1 ? 's' : ''} no total`;

  renderOverviewGrid(stats);
  renderBarChart(stats);
  renderSectorPanels(stats);
  renderTimeline();
}

// ── Bar chart ──────────────────────────────────────────────────────────────────
function renderBarChart(stats) {
  const el = document.getElementById('barChart');
  if (!el) return;

  // Sort descending by total reports
  const sorted = [...stats].sort((a, b) => b.total - a.total);
  const max = sorted[0]?.total || 1;

  if (!sorted.some(s => s.total > 0)) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-chart-bar"></i><p>Nenhum report enviado ainda.</p></div>`;
    return;
  }

  el.innerHTML = sorted.map(s => {
    const pctOntime   = (s.onTime   / max) * 100;
    const pctLate     = (s.late     / max) * 100;
    const pctCritical = (s.critical / max) * 100;
    const totalWidth  = (s.total    / max) * 100;

    // tooltip
    const tip = `${s.onTime} no prazo · ${s.late} atrasado · ${s.critical} crítico · ${s.total} total`;

    return `<div class="bc-row">
      <div class="bc-label">${s.sector}</div>
      <div class="bc-track" title="${tip}">
        <div class="bc-bars">
          <div class="bc-seg" style="width:${pctOntime}%;background:#1D9E75" title="${s.onTime} no prazo"></div>
          <div class="bc-seg" style="width:${pctLate}%;background:#EF9F27" title="${s.late} atrasado"></div>
          <div class="bc-seg" style="width:${pctCritical}%;background:#E24B4A" title="${s.critical} crítico"></div>
        </div>
        <span class="bc-total">${s.total}</span>
      </div>
    </div>`;
  }).join('');
}

// ── Overview grid ─────────────────────────────────────────────────────────────
function renderOverviewGrid(stats) {
  const el = document.getElementById('overviewGrid');
  if (!el) return;

  const statusColor = { ontime: '#1D9E75', late: '#EF9F27', critical: '#E24B4A', alert: '#F97316', nodata: '#3c4455' };
  const statusLabel = { ontime: 'No prazo', late: 'Atrasado', critical: 'Crítico', alert: 'Em alerta', nodata: 'Sem envios' };
  const statusIcon  = { ontime: 'ti-circle-check', late: 'ti-clock-exclamation', critical: 'ti-alert-triangle', alert: 'ti-bell-exclamation', nodata: 'ti-circle-dashed' };

  el.innerHTML = stats.map(s => {
    const color = statusColor[s.sectorStatus];
    const icon  = statusIcon[s.sectorStatus];
    const label = statusLabel[s.sectorStatus];
    const pct   = s.total > 0 ? s.pct : null;
    const barOntime   = s.total > 0 ? (s.onTime / s.total) * 100 : 0;
    const barLate     = s.total > 0 ? (s.late / s.total) * 100 : 0;
    const barCritical = s.total > 0 ? (s.critical / s.total) * 100 : 0;

    return `<div class="ov-card" style="--status-color:${color}">
      <div class="ov-top">
        <span class="ov-name">${s.sector}</span>
        <span class="ov-badge" style="color:${color};border-color:${color}22;background:${color}18">
          <i class="ti ${icon}" style="font-size:11px"></i> ${label}
        </span>
      </div>
      ${s.total > 0 ? `
      <div class="ov-bar-wrap" title="${s.onTime} no prazo · ${s.late} atrasado · ${s.critical} crítico">
        <div class="ov-bar">
          <div class="ov-bar-seg" style="width:${barOntime}%;background:#1D9E75"></div>
          <div class="ov-bar-seg" style="width:${barLate}%;background:#EF9F27"></div>
          <div class="ov-bar-seg" style="width:${barCritical}%;background:#E24B4A"></div>
        </div>
      </div>
      <div class="ov-stats">
        <span><span class="ov-num" style="color:#5DCAA5">${s.onTime}</span> prazo</span>
        <span><span class="ov-num" style="color:#EF9F27">${s.late}</span> atraso</span>
        <span><span class="ov-num" style="color:#f07171">${s.critical}</span> crítico</span>
        <span class="ov-total">${s.total} total</span>
      </div>` : `<div class="ov-empty">Nenhum report enviado</div>`}
    </div>`;
  }).join('');
}

// ── Sector panels ─────────────────────────────────────────────────────────────
const PANEL_CONFIG = [
  { key: 'ontime',   label: 'No prazo',  icon: 'ti-circle-check',    color: '#1D9E75', dimColor: 'var(--teal-dim)',    border: 'rgba(29,158,117,0.4)' },
  { key: 'late',     label: 'Atrasados', icon: 'ti-clock-exclamation',color: '#EF9F27', dimColor: 'var(--amber-dim)',   border: 'rgba(239,159,39,0.4)' },
  { key: 'critical', label: 'Críticos',  icon: 'ti-alert-triangle',  color: '#E24B4A', dimColor: 'var(--red-dim)',     border: 'rgba(226,75,74,0.4)' },
  { key: 'alert',    label: 'Em alerta', icon: 'ti-bell-exclamation', color: '#F97316', dimColor: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.4)' },
];

function renderSectorPanels(stats) {
  PANEL_CONFIG.forEach(cfg => {
    const el = document.getElementById(`panel-${cfg.key}`);
    if (!el) return;
    const sectors = stats.filter(s => s.sectorStatus === cfg.key);
    if (!sectors.length) {
      el.innerHTML = `<div class="panel-empty"><i class="ti ti-check" style="color:${cfg.color}"></i> Nenhum setor nesta categoria</div>`;
      return;
    }
    el.innerHTML = sectors.map(s => {
      const r = 18, circ = 2 * Math.PI * r, dash = (s.pct / 100) * circ;
      const dl = s.lastReport?.fileUrl
        ? `<a href="${s.lastReport.fileUrl}" target="_blank" class="panel-dl" title="Baixar último arquivo"><i class="ti ti-download"></i></a>`
        : '';
      const daysSince = s.lastReport ? daysBetween(s.lastReport.submittedAt, new Date()) : null;
      const sub = cfg.key === 'nodata' ? 'Nunca enviou'
        : cfg.key === 'alert' ? `${daysSince}d sem enviar`
        : `Ref: ${formatDate(s.lastReport?.data)}`;
      return `<div class="panel-row">
        <svg width="44" height="44" viewBox="0 0 44 44" style="flex-shrink:0" aria-hidden="true">
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3.5"/>
          <circle cx="22" cy="22" r="${r}" fill="none" stroke="${cfg.color}" stroke-width="3.5"
            stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}"
            stroke-dashoffset="${(circ/4).toFixed(1)}" stroke-linecap="round"/>
          <text x="22" y="26" text-anchor="middle" font-size="9.5" font-weight="600"
            fill="${cfg.color}" font-family="Inter,sans-serif">${s.total > 0 ? s.pct+'%' : '—'}</text>
        </svg>
        <div class="panel-info">
          <span class="panel-name">${s.sector}</span>
          <span class="panel-sub">${sub}</span>
          <div class="panel-stats">
            <span style="color:var(--teal-light)">${s.onTime} ✓</span>
            <span style="color:var(--amber)">${s.late} ⏱</span>
            <span style="color:#f07171">${s.critical} ⚠</span>
            <span style="color:var(--text-3)">${s.total} total</span>
          </div>
        </div>
        ${dl}
      </div>`;
    }).join('');
  });
}

function renderTimeline() {
  const list = document.getElementById('timelineList');
  const slice = reports.slice(0, 8);
  if (!slice.length) {
    list.innerHTML = `<div class="empty-state"><i class="ti ti-inbox"></i><p>Nenhum report enviado ainda.</p></div>`;
    return;
  }
  list.innerHTML = slice.map(r => {
    const ftClass = r.fileType === 'pdf' ? 'ft-pdf' : 'ft-docx';
    const ftIcon  = r.fileType === 'pdf' ? 'ti-file-type-pdf' : 'ti-file-type-doc';
    const date = new Date(r.submittedAt).toLocaleDateString('pt-BR', {day:'2-digit', month:'short'});
    const dl = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" style="color:var(--text-3);font-size:18px" title="Baixar"><i class="ti ti-download"></i></a>` : '';
    const del = `<button class="btn-delete" onclick="deleteReport('${r.id}', '${r.titulo.replace(/'/g,"\\'")}')"><i class="ti ti-trash"></i></button>`;
    return `<div class="timeline-item">
      <div class="timeline-filetype ${ftClass}"><i class="ti ${ftIcon}"></i></div>
      <div class="timeline-info">
        <div class="timeline-title">${r.titulo}</div>
        <div class="timeline-meta">
          <span>${r.responsavel}</span>
          <span class="badge badge-gray">${r.setor}</span>
          <span>Ref: ${formatDate(r.data)}</span>
          ${r.submittedByEmail ? `<span class="timeline-email"><i class="ti ti-mail" style="font-size:11px"></i> ${r.submittedByEmail}</span>` : ''}
        </div>
      </div>
      <div class="timeline-right" style="display:flex;align-items:center;gap:8px">
        <div>${statusBadge(r.status)}<div class="timeline-date" style="margin-top:4px">${date}</div></div>
        ${dl}${del}
      </div>
    </div>`;
  }).join('');
}

// ── Reports page ───────────────────────────────────────────────────────────────
function renderReportsPage() {
  const q  = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const sf = document.getElementById('filterSetor')?.value || '';
  const ss = document.getElementById('filterStatus')?.value || '';
  const filtered = reports.filter(r => {
    const matchQ  = !q  || (r.titulo + r.responsavel + r.setor + (r.submittedByEmail || '')).toLowerCase().includes(q);
    const matchS  = !sf || r.setor === sf;
    const matchSt = !ss || r.status === ss;
    return matchQ && matchS && matchSt;
  });
  const tbody = document.getElementById('reportsTableBody');
  const empty = document.getElementById('reportsEmpty');
  if (!filtered.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = filtered.map(r => {
    const date = new Date(r.submittedAt).toLocaleDateString('pt-BR', {day:'2-digit', month:'short', year:'numeric'});
    const dl = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" class="btn-download" title="Baixar"><i class="ti ti-download"></i></a>` : '—';
    const del = `<button class="btn-delete" onclick="deleteReport('${r.id}', '${r.titulo.replace(/'/g,"\\'")}')"><i class="ti ti-trash"></i></button>`;
    return `<tr>
      <td class="cell-title">${r.titulo}</td>
      <td>${r.responsavel}${r.submittedByEmail ? `<div class="cell-email">${r.submittedByEmail}</div>` : ''}</td>
      <td><span class="badge badge-gray">${r.setor}</span></td>
      <td>${formatDate(r.data)}</td>
      <td>${date}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="display:flex;gap:6px;align-items:center">${dl}${del}</td>
    </tr>`;
  }).join('');
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  const duration = msg.length > 80 ? 7000 : 3500;
  clearTimeout(t._hideTimer);
  t._hideTimer = setTimeout(() => t.classList.remove('show'), duration);
}

const style = document.createElement('style');
style.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);
