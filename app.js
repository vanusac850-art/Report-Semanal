'use strict';

// ── Configurações ────────────────────────────────────────────────────────────
const CONFIG = {
  SUPABASE_URL: 'https://rmucbgujvmmtmftxtgxk.supabase.co',
  SUPABASE_KEY: 'sb_publishable_c1jV7_vPvYm_UDoWzVsc7w_jbbbl0uW',
  BUCKET: 'arquivos',
  SECTORS: ['Financeiro', 'Comercial', 'Marketing', 'Operações', 'RH', 'TI', 'Jurídico', 'Logística'],
  MAX_FILE_SIZE: 20 * 1024 * 1024, // 20MB
  ALLOWED_TYPES: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ALLOWED_EXTENSIONS: ['.pdf', '.doc', '.docx']
};

// ── Estado global ─────────────────────────────────────────────────────────────
const state = {
  reports: [],
  editingId: null,
  currentPage: 'dashboard',
  isLoading: false,
  filters: {
    search: '',
    sector: '',
    status: '',
    dateFrom: '',
    dateTo: ''
  }
};

// ── Supabase client ──────────────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const res = await fetch(`${CONFIG.SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(error || `HTTP ${res.status}`);
  }
  return res;
}

// ── Utilitários ──────────────────────────────────────────────────────────────
function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function getReportStatus(submittedAt, refDate) {
  if (!submittedAt || !refDate) return 'pending';
  const diff = daysBetween(refDate, submittedAt);
  if (diff <= 0) return 'ontime';
  if (diff <= 10) return 'late';
  return 'critical';
}

function getSectorStatus(sectorReports) {
  if (!sectorReports.length) return 'pending';
  const last = sectorReports[0];
  const daysSinceLast = daysBetween(last.submittedAt, new Date());
  if (daysSinceLast >= 7) return 'alert';
  return last.status;
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function formatDateInput(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Status badges ────────────────────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    ontime: `<span class="badge badge-teal"><i class="ti ti-circle-check"></i> No prazo</span>`,
    late: `<span class="badge badge-amber"><i class="ti ti-clock-exclamation"></i> Atrasado</span>`,
    critical: `<span class="badge badge-red"><i class="ti ti-alert-triangle"></i> Crítico</span>`,
    alert: `<span class="badge badge-orange"><i class="ti ti-bell-exclamation"></i> Em alerta</span>`,
    pending: `<span class="badge badge-gray"><i class="ti ti-circle-dashed"></i> Pendente</span>`
  };
  return map[status] || map.pending;
}

function getStatusColor(status) {
  const map = {
    ontime: '#1D9E75',
    late: '#EF9F27',
    critical: '#E24B4A',
    alert: '#F97316',
    pending: '#5c6474'
  };
  return map[status] || map.pending;
}

function getStatusLabel(status) {
  const map = {
    ontime: 'No prazo',
    late: 'Atrasado',
    critical: 'Crítico',
    alert: 'Em alerta',
    pending: 'Pendente'
  };
  return map[status] || map.pending;
}

function getStatusIcon(status) {
  const map = {
    ontime: 'ti-circle-check',
    late: 'ti-clock-exclamation',
    critical: 'ti-alert-triangle',
    alert: 'ti-bell-exclamation',
    pending: 'ti-circle-dashed'
  };
  return map[status] || map.pending;
}

// ── Inicialização ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setWeekLabel();
  setDefaultDate();
  loadReports();
  registerSW();
  setupEventListeners();
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function setupEventListeners() {
  // Fechar sidebar com ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebar();
  });

  // Atualizar ao mudar filtros
  document.getElementById('searchInput')?.addEventListener('input', renderReportsPage);
  document.getElementById('filterSetor')?.addEventListener('change', renderReportsPage);
  document.getElementById('filterStatus')?.addEventListener('change', renderReportsPage);
  document.getElementById('filterDateFrom')?.addEventListener('change', renderReportsPage);
  document.getElementById('filterDateTo')?.addEventListener('change', renderReportsPage);
}

// ── Navegação ────────────────────────────────────────────────────────────────
function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.remove('hidden');
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  
  const titles = {
    dashboard: 'Dashboard',
    upload: 'Enviar report',
    reports: 'Todos os reports'
  };
  document.getElementById('mobileTitle').textContent = titles[page] || page;
  
  if (window.innerWidth <= 680) closeSidebar();
  
  // Recarregar dados ao mudar de página
  if (page === 'dashboard') renderDashboard();
  if (page === 'reports') renderReportsPage();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ── CRUD com Supabase ────────────────────────────────────────────────────────
async function loadReports() {
  if (state.isLoading) return;
  state.isLoading = true;
  showLoading(true);
  
  try {
    const res = await sbFetch('/rest/v1/reports?select=*&order=submitted_at.desc', {
      headers: { 'Prefer': 'return=representation' }
    });
    const data = await res.json();
    
    // CORREÇÃO: Recalcular status para cada report
    state.reports = data.map(r => ({
      id: r.id,
      titulo: r.titulo || 'Sem título',
      responsavel: r.responsavel || 'Não informado',
      setor: r.setor || 'Não definido',
      data: r.data_referencia,
      fileName: r.file_name || 'arquivo',
      fileSize: r.file_size || '0 KB',
      fileType: r.file_type || 'pdf',
      status: getReportStatus(r.submitted_at, r.data_referencia),
      submittedAt: r.submitted_at,
      fileUrl: r.file_url,
      comentarios: r.comentarios || ''
    }));
    
    renderAll();
  } catch (e) {
    showToast('Erro ao carregar reports: ' + e.message);
  } finally {
    state.isLoading = false;
    showLoading(false);
  }
}

async function uploadFile(file) {
  const ext = file.name.split('.').pop();
  const path = `${Date.now()}_${generateId()}.${ext}`;
  
  const res = await fetch(`${CONFIG.SUPABASE_URL}/storage/v1/object/${CONFIG.BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      'apikey': CONFIG.SUPABASE_KEY,
      'Authorization': `Bearer ${CONFIG.SUPABASE_KEY}`,
      'Content-Type': file.type || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: file
  });
  
  if (!res.ok) throw new Error('Erro no upload: ' + await res.text());
  return `${CONFIG.SUPABASE_URL}/storage/v1/object/public/${CONFIG.BUCKET}/${path}`;
}

async function insertReport(record) {
  const res = await sbFetch('/rest/v1/reports', {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(record)
  });
  return await res.json();
}

async function updateReport(id, record) {
  const res = await sbFetch(`/rest/v1/reports?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(record)
  });
  return await res.json();
}

async function deleteReport(id) {
  const res = await sbFetch(`/rest/v1/reports?id=eq.${id}`, {
    method: 'DELETE'
  });
  return res.ok;
}

// ── Submit report ────────────────────────────────────────────────────────────
async function submitReport() {
  const resp = document.getElementById('fResponsavel').value.trim();
  const setor = document.getElementById('fSetor').value.trim();
  const data = document.getElementById('fData').value;
  const titulo = document.getElementById('fTitulo').value.trim();
  const comentarios = document.getElementById('fComentarios').value.trim();
  const file = document.getElementById('fFile').files[0];
  
  // Validações
  if (!resp || !setor || !data || !titulo) {
    showToast('Preencha todos os campos obrigatórios.');
    return;
  }
  
  if (!file && !state.editingId) {
    showToast('Anexe um arquivo.');
    return;
  }
  
  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> Enviando...';
  
  try {
    let fileUrl = '';
    let fileName = '';
    let fileSize = '';
    let fileType = '';
    
    if (file) {
      fileUrl = await uploadFile(file);
      fileName = file.name;
      fileSize = formatSize(file.size);
      fileType = file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
    }
    
    const now = new Date().toISOString();
    const record = {
      titulo,
      responsavel: resp,
      setor,
      data_referencia: data,
      file_name: fileName,
      file_size: fileSize,
      file_type: fileType,
      file_url: fileUrl,
      comentarios,
      on_time: getReportStatus(now, data) === 'ontime',
      submitted_at: now
    };
    
    if (state.editingId) {
      // Remover campos que não devem ser atualizados
      if (!file) {
        delete record.file_name;
        delete record.file_size;
        delete record.file_type;
        delete record.file_url;
      }
      await updateReport(state.editingId, record);
      showToast('Report atualizado com sucesso!');
      state.editingId = null;
      document.getElementById('btnSubmit').innerHTML = '<i class="ti ti-send"></i> Enviar report';
    } else {
      await insertReport(record);
      showToast('Report enviado com sucesso!');
    }
    
    // Limpar formulário
    document.getElementById('fResponsavel').value = '';
    document.getElementById('fSetor').value = '';
    setDefaultDate();
    document.getElementById('fTitulo').value = '';
    document.getElementById('fComentarios').value = '';
    document.getElementById('fFile').value = '';
    document.getElementById('filePreview').classList.remove('show');
    
    await loadReports();
    navigate('dashboard');
  } catch (e) {
    showToast('Erro: ' + e.message);
  } finally {
    btn.disabled = false;
    if (!state.editingId) {
      btn.innerHTML = '<i class="ti ti-send"></i> Enviar report';
    }
  }
}

// ── Editar report ────────────────────────────────────────────────────────────
function editReport(id) {
  const report = state.reports.find(r => r.id === id);
  if (!report) {
    showToast('Report não encontrado.');
    return;
  }
  
  state.editingId = id;
  document.getElementById('fResponsavel').value = report.responsavel;
  document.getElementById('fSetor').value = report.setor;
  document.getElementById('fData').value = formatDateInput(report.data);
  document.getElementById('fTitulo').value = report.titulo;
  document.getElementById('fComentarios').value = report.comentarios || '';
  
  // Mostrar preview do arquivo existente
  if (report.fileUrl) {
    const preview = document.getElementById('filePreview');
    document.getElementById('filePreviewName').textContent = report.fileName;
    document.getElementById('filePreviewSize').textContent = report.fileSize;
    const isPdf = report.fileType === 'pdf';
    document.getElementById('filePreviewIcon').innerHTML = `<i class="ti ${isPdf ? 'ti-file-type-pdf' : 'ti-file-type-doc'}"></i>`;
    preview.classList.add('show');
    document.getElementById('btnSubmit').innerHTML = '<i class="ti ti-pencil"></i> Atualizar report';
  }
  
  navigate('upload');
}

// ── Excluir report ────────────────────────────────────────────────────────────
async function deleteReportHandler(id) {
  if (!confirm('Tem certeza que deseja excluir este report?')) return;
  
  try {
    const success = await deleteReport(id);
    if (success) {
      showToast('Report excluído com sucesso!');
      await loadReports();
    } else {
      showToast('Erro ao excluir report.');
    }
  } catch (e) {
    showToast('Erro: ' + e.message);
  }
}

// ── File handling ────────────────────────────────────────────────────────────
function handleDrag(e, over) {
  e.preventDefault();
  document.getElementById('dropZone').classList.toggle('over', over);
}

function handleDrop(e) {
  e.preventDefault();
  handleDrag(e, false);
  const file = e.dataTransfer.files[0];
  if (file) selectFile(file);
}

function selectFile(file) {
  if (!file) return;
  
  const isValidType = CONFIG.ALLOWED_TYPES.includes(file.type) || 
                      CONFIG.ALLOWED_EXTENSIONS.some(ext => file.name.toLowerCase().endsWith(ext));
  
  if (!isValidType) {
    showToast('Formato inválido. Use PDF ou Word.');
    return;
  }
  
  if (file.size > CONFIG.MAX_FILE_SIZE) {
    showToast('Arquivo muito grande. Máx. 20 MB.');
    return;
  }
  
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  document.getElementById('filePreviewName').textContent = file.name;
  document.getElementById('filePreviewSize').textContent = formatSize(file.size);
  document.getElementById('filePreviewIcon').innerHTML = `<i class="ti ${isPdf ? 'ti-file-type-pdf' : 'ti-file-type-doc'}"></i>`;
  document.getElementById('filePreview').classList.add('show');
}

function removeFile() {
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fFile').value = '';
}

// ── Utilitários de UI ────────────────────────────────────────────────────────
function showLoading(show) {
  const btn = document.getElementById('btnSubmit');
  if (btn) btn.disabled = show;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 3500);
}

function setWeekLabel() {
  const now = new Date();
  const s = getWeekStart(now);
  const e = new Date(s);
  e.setDate(e.getDate() + 4);
  const fmt = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  document.getElementById('weekLabel').textContent = `${fmt(s)} – ${fmt(e)}`;
}

function setDefaultDate() {
  document.getElementById('fData').value = new Date().toISOString().split('T')[0];
}

// ── Renderização ─────────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderReportsPage();
}

function buildSectorStats() {
  return CONFIG.SECTORS.map(sector => {
    const sr = state.reports.filter(r => r.setor === sector);
    const sectorStatus = getSectorStatus(sr);
    const onTime = sr.filter(r => r.status === 'ontime').length;
    const late = sr.filter(r => r.status === 'late').length;
    const critical = sr.filter(r => r.status === 'critical').length;
    const total = sr.length;
    const pct = total > 0 ? Math.round((onTime / total) * 100) : 0;
    return { sector, sr, sectorStatus, onTime, late, critical, total, pct, lastReport: sr[0] || null };
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard() {
  const stats = buildSectorStats();
  
  // CORREÇÃO: Calcular KPIs corretamente
  const kpiOntime = stats.filter(s => s.sectorStatus === 'ontime').length;
  const kpiLate = stats.filter(s => s.sectorStatus === 'late').length;
  const kpiCritical = stats.filter(s => s.sectorStatus === 'critical').length;
  const kpiAlert = stats.filter(s => s.sectorStatus === 'alert').length;
  const kpiPending = stats.filter(s => s.sectorStatus === 'pending').length;
  const totalReports = state.reports.length;
  
  document.getElementById('kpiOnTime').textContent = kpiOntime;
  document.getElementById('kpiLate').textContent = kpiLate;
  document.getElementById('kpiCritical').textContent = kpiCritical;
  document.getElementById('kpiAlert').textContent = kpiAlert;
  document.getElementById('kpiPending').textContent = kpiPending;
  document.getElementById('kpiTotal').textContent = totalReports;
  document.getElementById('dashSub').textContent = totalReports === 0
    ? 'Nenhum report enviado ainda'
    : `${totalReports} report${totalReports !== 1 ? 's' : ''} no total`;
  
  renderOverviewGrid(stats);
  renderBarChart(stats);
  renderSectorPanels(stats);
  renderTimeline();
}

function renderOverviewGrid(stats) {
  const el = document.getElementById('overviewGrid');
  if (!el) return;
  
  el.innerHTML = stats.map(s => {
    const color = getStatusColor(s.sectorStatus);
    const icon = getStatusIcon(s.sectorStatus);
    const label = getStatusLabel(s.sectorStatus);
    const barOntime = s.total > 0 ? (s.onTime / s.total) * 100 : 0;
    const barLate = s.total > 0 ? (s.late / s.total) * 100 : 0;
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

function renderBarChart(stats) {
  const el = document.getElementById('barChart');
  if (!el) return;
  
  const sorted = [...stats].sort((a, b) => b.total - a.total);
  const max = sorted[0]?.total || 1;
  
  if (!sorted.some(s => s.total > 0)) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-chart-bar"></i><p>Nenhum report enviado ainda.</p></div>`;
    return;
  }
  
  el.innerHTML = sorted.map(s => {
    const pctOntime = (s.onTime / max) * 100;
    const pctLate = (s.late / max) * 100;
    const pctCritical = (s.critical / max) * 100;
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

const PANEL_CONFIG = [
  { key: 'ontime', label: 'No prazo', icon: 'ti-circle-check', color: '#1D9E75', dimColor: 'var(--teal-dim)' },
  { key: 'late', label: 'Atrasados', icon: 'ti-clock-exclamation', color: '#EF9F27', dimColor: 'var(--amber-dim)' },
  { key: 'critical', label: 'Críticos', icon: 'ti-alert-triangle', color: '#E24B4A', dimColor: 'var(--red-dim)' },
  { key: 'alert', label: 'Em alerta', icon: 'ti-bell-exclamation', color: '#F97316', dimColor: 'rgba(249,115,22,0.12)' },
  { key: 'pending', label: 'Pendentes', icon: 'ti-circle-dashed', color: '#5c6474', dimColor: 'rgba(255,255,255,0.05)' },
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
      const sub = cfg.key === 'pending' ? 'Nunca enviou'
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
  const slice = state.reports.slice(0, 8);
  if (!slice.length) {
    list.innerHTML = `<div class="empty-state"><i class="ti ti-inbox"></i><p>Nenhum report enviado ainda.</p></div>`;
    return;
  }
  list.innerHTML = slice.map(r => {
    const ftClass = r.fileType === 'pdf' ? 'ft-pdf' : 'ft-docx';
    const ftIcon = r.fileType === 'pdf' ? 'ti-file-type-pdf' : 'ti-file-type-doc';
    const date = new Date(r.submittedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const dl = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" style="color:var(--text-3);font-size:18px" title="Baixar"><i class="ti ti-download"></i></a>` : '';
    return `<div class="timeline-item">
      <div class="timeline-filetype ${ftClass}"><i class="ti ${ftIcon}"></i></div>
      <div class="timeline-info">
        <div class="timeline-title">${r.titulo}</div>
        <div class="timeline-meta">
          <span>${r.responsavel}</span>
          <span class="badge badge-gray">${r.setor}</span>
          <span>Ref: ${formatDate(r.data)}</span>
        </div>
      </div>
      <div class="timeline-right" style="display:flex;align-items:center;gap:8px">
        <div>${statusBadge(r.status)}<div class="timeline-date" style="margin-top:4px">${date}</div></div>
        ${dl}
      </div>
    </div>`;
  }).join('');
}

// ── Reports page com filtros ────────────────────────────────────────────────
function renderReportsPage() {
  const search = document.getElementById('searchInput')?.value?.toLowerCase() || '';
  const sector = document.getElementById('filterSetor')?.value || '';
  const status = document.getElementById('filterStatus')?.value || '';
  const dateFrom = document.getElementById('filterDateFrom')?.value || '';
  const dateTo = document.getElementById('filterDateTo')?.value || '';
  
  const filtered = state.reports.filter(r => {
    const matchSearch = !search || 
      (r.titulo + r.responsavel + r.setor).toLowerCase().includes(search);
    const matchSector = !sector || r.setor === sector;
    const matchStatus = !status || r.status === status;
    const matchDateFrom = !dateFrom || r.submittedAt >= dateFrom;
    const matchDateTo = !dateTo || r.submittedAt <= dateTo + 'T23:59:59';
    return matchSearch && matchSector && matchStatus && matchDateFrom && matchDateTo;
  });
  
  const tbody = document.getElementById('reportsTableBody');
  const empty = document.getElementById('reportsEmpty');
  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = filtered.map(r => {
    const date = new Date(r.submittedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    const dl = r.fileUrl ? `<a href="${r.fileUrl}" target="_blank" class="btn-download" title="Baixar"><i class="ti ti-download"></i></a>` : '—';
    const hasComment = r.comentarios ? `<i class="ti ti-message" title="${r.comentarios}"></i>` : '';
    return `<tr>
      <td class="cell-title">${r.titulo} ${hasComment}</td>
      <td>${r.responsavel}</td>
      <td><span class="badge badge-gray">${r.setor}</span></td>
      <td>${formatDate(r.data)}</td>
      <td>${date}</td>
      <td>${statusBadge(r.status)}</td>
      <td>
        <div class="table-actions">
          ${dl}
          <button class="btn-action" onclick="editReport('${r.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="btn-action btn-danger" onclick="deleteReportHandler('${r.id}')" title="Excluir"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Estilo adicional para os botões de ação
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .table-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .btn-action {
    width: 30px;
    height: 30px;
    border: none;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    transition: all 0.15s;
  }
  .btn-action:hover {
    background: var(--teal-dim);
    color: var(--teal-light);
    border-color: rgba(29,158,117,0.3);
  }
  .btn-action.btn-danger:hover {
    background: var(--red-dim);
    color: #f07171;
    border-color: rgba(226,75,74,0.3);
  }
`;
document.head.appendChild(style);
