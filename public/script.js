(() => {
  const form = document.getElementById('upload-form');
  const grid = document.getElementById('grid');
  const widthInput = document.getElementById('width');
  const heightInput = document.getElementById('height');
  const fileInput = document.getElementById('image');
  const refreshBtn = document.getElementById('refresh');

  let currentId = null;
  let strategies = [];

  async function fetchStrategies() {
    const res = await fetch('/strategies');
    strategies = await res.json();
  }

  function makeImageUrl(id, strategy, w, h) {
    const ts = Date.now();
    return `/image/${encodeURIComponent(id)}/${encodeURIComponent(strategy)}?w=${encodeURIComponent(
      w
    )}&h=${encodeURIComponent(h)}&t=${ts}`;
  }

  function renderGrid() {
    const w = parseInt(widthInput.value, 10) || 400;
    const h = parseInt(heightInput.value, 10) || 300;
    if (!currentId) {
      grid.innerHTML = '';
      return;
    }
    const items = strategies
      .map(
        (s) => `
        <div class="card">
          <div class="label">${s.label}</div>
          <img loading="lazy" src="${makeImageUrl(currentId, s.key, w, h)}" alt="${s.label}">
        </div>
      `
      )
      .join('');
    grid.innerHTML = items;
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const data = new FormData();
    data.append('image', file);
    const res = await fetch('/upload', { method: 'POST', body: data });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || 'Upload failed');
      return;
    }
    currentId = json.id;
    refreshBtn.disabled = false;
    renderGrid();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  form.addEventListener('submit', handleUpload);
  refreshBtn.addEventListener('click', renderGrid);
  widthInput.addEventListener('change', renderGrid);
  heightInput.addEventListener('change', renderGrid);

  fetchStrategies();
})();


