// Local-first storage with optional sync to the `data` branch of the private
// GitHub repository. Everything works offline; sync pushes what changed.

const KEY = 'mygarmin.v2';
/** Files written only by the Garmin workflow: pulled, never pushed. */
export const READ_ONLY = (path) => path.startsWith('garmin/');
// Raw migration archives stay in the data branch only: they can be megabytes
// and would not fit the phone's local storage.
export const REMOTE_ONLY = (path) => path.startsWith('legacy/');
const CONFIG_KEY = 'mygarmin.github';

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function decodeBase64(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function newer(a, b) {
  return String(a?.updated_at ?? '') >= String(b?.updated_at ?? '') ? a : b;
}

/** Merge two versions of one data file. Never loses a logged session. */
export function mergeFile(path, local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  if (path.startsWith('log/')) {
    const sessions = { ...remote.sessions };
    for (const [id, r] of Object.entries(local.sessions ?? {})) sessions[id] = sessions[id] ? newer(r, sessions[id]) : r;
    return { ...remote, ...local, sessions, updated_at: newer(local, remote).updated_at };
  }
  return newer(local, remote);
}

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = { files: {}, shas: {}, dirty: [], lastSync: null };
    this.config = { owner: 'Ksarv', repo: 'mygarmin', branch: 'data', token: '' };
    this.listeners = new Set();
  }

  // ------------------------------------------------------------ local --
  load(seedFiles) {
    try {
      const saved = JSON.parse(this.storage.getItem(KEY) || 'null');
      if (saved?.files) this.data = { files: {}, shas: {}, dirty: [], lastSync: null, ...saved };
    } catch { /* corrupt storage: start from seed */ }
    for (const [path, content] of Object.entries(seedFiles)) {
      if (!this.data.files[path]) this.data.files[path] = content;
    }
    try {
      const cfg = JSON.parse(this.storage.getItem(CONFIG_KEY) || 'null');
      if (cfg) this.config = { ...this.config, ...cfg };
    } catch { /* ignore */ }
  }
  persist() {
    try { this.storage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { console.warn('storage', e); }
    for (const fn of this.listeners) fn();
  }
  saveConfig(cfg) {
    this.config = { ...this.config, ...cfg };
    try { this.storage.setItem(CONFIG_KEY, JSON.stringify(this.config)); } catch { /* ignore */ }
  }
  onChange(fn) { this.listeners.add(fn); }

  get(path) { return this.data.files[path] ?? null; }
  put(path, content) {
    this.data.files[path] = { ...content, updated_at: new Date().toISOString() };
    if (!this.data.dirty.includes(path)) this.data.dirty.push(path);
    this.persist();
  }
  list(prefix) {
    return Object.keys(this.data.files).filter((p) => p.startsWith(prefix)).sort();
  }

  get meta() { return this.get('meta.json'); }
  get profile() { return this.get('profile.json'); }
  plans() { return this.list('plans/').map((p) => this.get(p)); }
  plan(start) { return this.get(`plans/${start}.json`); }
  log(start) { return this.get(`log/${start}.json`) ?? { week_start: start, sessions: {} }; }

  setResult(start, sessionId, result) {
    const log = structuredClone(this.log(start));
    log.sessions[sessionId] = { ...result, updated_at: new Date().toISOString() };
    this.put(`log/${start}.json`, log);
  }
  clearResult(start, sessionId) {
    const log = structuredClone(this.log(start));
    delete log.sessions[sessionId];
    this.put(`log/${start}.json`, log);
  }
  setPlan(plan) { this.put(`plans/${plan.start}.json`, plan); }
  setProfile(profile) { this.put('profile.json', profile); }

  exportBundle() {
    return { format: 'mygarmin-export-v1', exported_at: new Date().toISOString(), files: this.data.files };
  }
  importFiles(files) {
    let n = 0;
    for (const [path, content] of Object.entries(files)) {
      const merged = mergeFile(path, this.data.files[path], content);
      if (JSON.stringify(merged) !== JSON.stringify(this.data.files[path])) {
        this.data.files[path] = merged;
        if (!this.data.dirty.includes(path)) this.data.dirty.push(path);
        n += 1;
      }
    }
    this.persist();
    return n;
  }

  // ------------------------------------------------------------- GitHub --
  get connected() { return !!this.config.token; }

  async api(path, options = {}) {
    const res = await fetch(`https://api.github.com/repos/${this.config.owner}/${this.config.repo}${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.config.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = new Error(explain(res.status, path));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async checkConnection() {
    const repo = await this.api('');
    const canPush = !!repo.permissions?.push;
    let branch = true;
    try { await this.api(`/branches/${encodeURIComponent(this.config.branch)}`); } catch (e) { if (e.status === 404) branch = false; else throw e; }
    return { private: repo.private, canPush, branch };
  }

  async readRemote(path, sha) {
    const blob = await this.api(`/git/blobs/${sha}`);
    return JSON.parse(decodeBase64(blob.content));
  }

  async writeRemote(path, content, message) {
    const body = { message, content: encodeBase64(JSON.stringify(content, null, 1) + '\n'), branch: this.config.branch };
    if (this.data.shas[path]) body.sha = this.data.shas[path];
    const res = await this.api(`/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'PUT', body: JSON.stringify(body) });
    this.data.shas[path] = res.content.sha;
  }

  /** Pull remote changes, merge, then push local changes. Returns a report. */
  async sync(messageFor = (p) => `Оновлення ${p}`) {
    if (!this.connected) throw new Error('Немає підключення до GitHub. Додай токен у «Налаштуваннях».');
    const report = { pulled: [], pushed: [], failed: [] };
    const tree = await this.api(`/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`);
    for (const entry of tree.tree) {
      if (entry.type !== 'blob' || !entry.path.endsWith('.json') || REMOTE_ONLY(entry.path)) continue;
      if (this.data.shas[entry.path] === entry.sha) continue;
      const remote = await this.readRemote(entry.path, entry.sha);
      const local = this.data.files[entry.path];
      const dirty = this.data.dirty.includes(entry.path);
      this.data.files[entry.path] = dirty ? mergeFile(entry.path, local, remote) : remote;
      this.data.shas[entry.path] = entry.sha;
      if (!dirty) report.pulled.push(entry.path);
    }
    const remotePaths = new Set(tree.tree.map((e) => e.path));
    for (const path of Object.keys(this.data.files)) {
      if (REMOTE_ONLY(path)) { delete this.data.files[path]; delete this.data.shas[path]; continue; }
      if (READ_ONLY(path)) continue;
      if (!remotePaths.has(path) && !this.data.dirty.includes(path)) this.data.dirty.push(path);
    }
    this.data.dirty = this.data.dirty.filter((p) => !READ_ONLY(p));
    for (const path of [...this.data.dirty]) {
      try {
        await this.writeRemote(path, this.data.files[path], messageFor(path));
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) { report.failed.push(`${path}: ${e.message}`); continue; }
        try { // someone changed it meanwhile: merge and retry once
          const fresh = await this.api(`/contents/${path}?ref=${encodeURIComponent(this.config.branch)}`);
          this.data.shas[path] = fresh.sha;
          this.data.files[path] = mergeFile(path, this.data.files[path], JSON.parse(decodeBase64(fresh.content)));
          await this.writeRemote(path, this.data.files[path], messageFor(path));
        } catch (e2) { report.failed.push(`${path}: ${e2.message}`); continue; }
      }
      this.data.dirty = this.data.dirty.filter((p) => p !== path);
      report.pushed.push(path);
    }
    this.data.lastSync = new Date().toISOString();
    this.persist();
    return report;
  }

  /** Read a file straight from the data branch (no local copy). */
  async remoteJson(path) {
    try {
      const res = await this.api(`/contents/${path}?ref=${encodeURIComponent(this.config.branch)}`);
      return { sha: res.sha, data: JSON.parse(decodeBase64(res.content)) };
    } catch (e) {
      if (e.status === 404) return { sha: null, data: null };
      throw e;
    }
  }
  /** Write one file straight to the data branch (used for the Garmin code). */
  async putRemoteJson(path, data, message) {
    const current = await this.remoteJson(path);
    const body = { message, content: encodeBase64(JSON.stringify(data, null, 1) + '\n'), branch: this.config.branch };
    if (current.sha) body.sha = current.sha;
    await this.api(`/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  async dispatch(workflow, inputs) {
    return this.api(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main', inputs }) });
  }
  async runs(workflow) {
    return this.api(`/actions/workflows/${workflow}/runs?per_page=5`);
  }
}

function explain(status, path) {
  if (status === 401) return 'GitHub не прийняв токен (401). Створи новий у «Налаштуваннях».';
  if (status === 403) return 'Токену бракує дозволів (403): потрібні Contents і Actions — Read and write.';
  if (status === 404) return path.includes('/branches/') || path.includes('/git/trees/')
    ? 'Гілку з даними не знайдено (404).'
    : 'Репозиторій недоступний цьому токену (404). Перевір, що вибрано mygarmin.';
  if (status === 409 || status === 422) return 'Файл змінився паралельно — об’єдную.';
  return `GitHub відповів ${status}.`;
}
