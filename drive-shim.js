/* Wanderlust: puente con Google Drive.
   Sustituye el almacenamiento de Claude (db, assets) por una carpeta "Wanderlust" en el Drive del usuario.
   Datos: Wanderlust/wanderlust-datos.json  ·  Adjuntos: Wanderlust/Adjuntos/  */
(() => {
  "use strict";
  const CLIENT_ID = "1001663742263-c8898sk2hg3pnrd967un6ed4sednge6a.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const HINT = "perezdelemalaura@gmail.com";
  const API = "https://www.googleapis.com/drive/v3";
  const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
  const DATA_NAME = "wanderlust-datos.json";
  const NS = k => k.replace(/^wl\./, "wl2.");
  const LS = { get(k){ try { return localStorage.getItem(NS(k)); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem(NS(k),v); } catch(e){} }, del(k){ try { localStorage.removeItem(NS(k)); } catch(e){} } };

  let token = null, tokenExp = 0, tokenClient = null, pendingAuth = [];
  let folderId = LS.get("wl.folder"), filesFolderId = LS.get("wl.files"), dataId = LS.get("wl.data");
  let state = { trips: {}, weather: {}, settings: {} }, version = null, ready = false;
  const listeners = { trips: [], weather: [] };
  let queue = Promise.resolve();

  /* ---------- token ---------- */
  const saved = (() => { try { return JSON.parse(LS.get("wl.tok") || "null"); } catch(e){ return null; } })();
  if (saved && saved.exp > Date.now() + 60000){ token = saved.t; tokenExp = saved.exp; }
  const tokenOk = () => token && tokenExp > Date.now() + 30000;

  function loadGis(){
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error("gis")); document.head.append(s);
    });
  }
  async function initClient(){
    await loadGis();
    if (tokenClient) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, login_hint: HINT,
      callback: r => {
        if (r && r.access_token){
          token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
          LS.set("wl.tok", JSON.stringify({ t: token, exp: tokenExp }));
          hideBanner(); const p = pendingAuth; pendingAuth = []; p.forEach(f => f.res());
        } else { const p = pendingAuth; pendingAuth = []; p.forEach(f => f.rej(new Error("auth"))); }
      },
      error_callback: e => { const p = pendingAuth; pendingAuth = []; p.forEach(f => f.rej(new Error((e && e.type) || "auth"))); }
    });
  }
  /* Must be called from a click (browsers block the Google popup otherwise). */
  function signIn(){
    return new Promise(async (res, rej) => {
      try { await initClient(); } catch(e){ return rej(e); }
      pendingAuth.push({ res, rej });
      tokenClient.requestAccessToken({ prompt: LS.get("wl.consented") ? "" : "select_account consent" });
    }).then(() => LS.set("wl.consented", "1"));
  }
  function waitForToken(){
    if (tokenOk()) return Promise.resolve();
    showBanner();
    return new Promise((res, rej) => pendingAuth.push({ res, rej }));
  }

  /* ---------- Drive REST ---------- */
  async function api(url, opts = {}, retry = true){
    await waitForToken();
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: "Bearer " + token } });
    if (r.status === 401 && retry){ token = null; LS.del("wl.tok"); return api(url, opts, false); }
    if (!r.ok){
      const e = new Error("drive " + r.status); e.status = r.status;
      try { const b = await r.json(); e.reason = b.error && b.error.errors && b.error.errors[0] && b.error.errors[0].reason; } catch(_){}
      if (e.reason === "storageQuotaExceeded") quotaWarn();
      throw e;
    }
    return r;
  }
  const j = r => r.json();
  const q = s => encodeURIComponent(s);

  async function findOne(query){
    const r = await api(`${API}/files?q=${q(query + " and trashed=false")}&fields=files(id,name,version)&spaces=drive&pageSize=10`).then(j);
    return r.files && r.files[0] || null;
  }
  async function createFolder(name, parent){
    const r = await api(`${API}/files?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : undefined }) }).then(j);
    return r.id;
  }
  async function stillThere(id){
    if (!id) return false;
    try { const r = await api(`${API}/files/${id}?fields=id,trashed`).then(j); return !r.trashed; } catch(e){ return false; }
  }
  async function ensureLayout(){
    if (!(await stillThere(folderId))){
      const f = await findOne(`name='Wanderlust' and mimeType='application/vnd.google-apps.folder' and 'root' in parents`);
      folderId = f ? f.id : await createFolder("Wanderlust"); LS.set("wl.folder", folderId); filesFolderId = null; dataId = null;
    }
    if (!(await stillThere(filesFolderId))){
      const f = await findOne(`name='Adjuntos' and mimeType='application/vnd.google-apps.folder' and '${folderId}' in parents`);
      filesFolderId = f ? f.id : await createFolder("Adjuntos", folderId); LS.set("wl.files", filesFolderId);
    }
    if (!(await stillThere(dataId))){
      const f = await findOne(`name='${DATA_NAME}' and '${folderId}' in parents`);
      if (f) dataId = f.id;
      else {
        const meta = { name: DATA_NAME, mimeType: "application/json", parents: [folderId] };
        dataId = (await multipart(meta, new Blob([JSON.stringify({ trips: {}, weather: {} })], { type: "application/json" }), "POST")).id;
      }
      LS.set("wl.data", dataId);
    }
  }
  async function multipart(meta, blob, method, fileId){
    const fd = new FormData();
    fd.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    fd.append("file", blob);
    const url = fileId ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,version` : `${UPLOAD}/files?uploadType=multipart&fields=id,version`;
    return api(url, { method, body: fd }).then(j);
  }
  async function remoteVersion(){ return (await api(`${API}/files/${dataId}?fields=version`).then(j)).version; }
  async function readRemote(){
    const v = await remoteVersion();
    const txt = await api(`${API}/files/${dataId}?alt=media`).then(r => r.text());
    let d = {}; try { d = JSON.parse(txt || "{}"); } catch(e){ d = {}; }
    state = { trips: d.trips || {}, weather: d.weather || {}, settings: d.settings || {} }; version = v;
  }
  async function writeRemote(){
    const blob = new Blob([JSON.stringify({ app: "Wanderlust", saved: new Date().toISOString(), trips: state.trips, weather: state.weather, settings: state.settings || {} })], { type: "application/json" });
    const r = await api(`${UPLOAD}/files/${dataId}?uploadType=media&fields=id,version`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: blob }).then(j);
    version = r.version;
  }
  /* Apply a change on top of the latest copy in Drive (another device may have saved in between). */
  function mutate(fn){
    const run = queue.then(async () => {
      const v = await remoteVersion();
      if (v !== version) await readRemote();
      fn(state);
      await writeRemote();
      emit();
    });
    queue = run.catch(() => {});
    return run;
  }

  /* ---------- snapshots ---------- */
  const snap = name => ({ docs: Object.keys(state[name] || {}).map(id => ({ id, data: () => clone(state[name][id]) })) });
  const clone = o => JSON.parse(JSON.stringify(o));
  function emit(){ for (const name of Object.keys(listeners)) listeners[name].forEach(l => { try { l.cb(snap(name)); } catch(e){ console.error(e); } }); }
  async function poll(){
    if (!ready || document.hidden || !tokenOk()) return;
    try { const v = await remoteVersion(); if (v !== version){ await queue; await readRemote(); emit(); } } catch(e){}
  }
  setInterval(poll, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });

  const split = path => { const i = path.indexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; };
  const db = {
    collection(name){
      if (!state[name]) state[name] = {};
      if (!listeners[name]) listeners[name] = [];
      return { onSnapshot(cb, err){ const l = { cb, err }; listeners[name].push(l); if (ready) cb(snap(name)); return () => { listeners[name] = listeners[name].filter(x => x !== l); }; } };
    },
    doc(path){
      const [col, id] = split(path);
      return {
        set: data => mutate(s => { (s[col] = s[col] || {})[id] = clone(data); }),
        update: patch => mutate(s => { s[col] = s[col] || {}; if (!s[col][id]) throw Object.assign(new Error("not_found"), { code: "not_found" }); Object.assign(s[col][id], clone(patch)); }),
        delete: () => mutate(s => { if (s[col]) delete s[col][id]; }),
        get: async () => ({ id, exists: !!(state[col] && state[col][id]), data: () => clone((state[col] || {})[id]) })
      };
    }
  };
  const assets = {
    async upload(file){
      if (file.size > 25 * 1024 * 1024) throw Object.assign(new Error("too_large"), { code: "too_large" });
      const r = await multipart({ name: file.name || "archivo", parents: [filesFolderId] }, file, "POST");
      return { id: r.id };
    }
  };

  /* ---------- images and links to Drive files ---------- */
  const imgCache = {};
  window.__wlBlob = id => /^[0-9a-f]{32}$/.test(id) ? "#" : "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
  async function fillImg(img){
    const id = img.dataset.dimg; if (!id || img.dataset.done) return; img.dataset.done = "1";
    try {
      if (!imgCache[id]) imgCache[id] = api(`${API}/files/${id}?alt=media`).then(r => r.blob()).then(b => URL.createObjectURL(b));
      img.src = await imgCache[id];
    } catch(e){ img.style.display = "none"; }
  }
  new MutationObserver(() => document.querySelectorAll("img[data-dimg]:not([data-done])").forEach(fillImg))
    .observe(document.documentElement, { childList: true, subtree: true });

  function quotaWarn(){
    const msg = "Tu Google Drive está lleno. Libera espacio en one.google.com/storage para poder guardar en Wanderlust.";
    if (!ready) return;
    try { note(msg); } catch(_){}
  }

  /* ---------- sign-in banner + account menu ---------- */
  const css = document.createElement("style");
  css.textContent = `
  .wlgate{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:var(--hero);padding:24px}
  .wlgate .box{background:var(--surf);color:var(--ink);border-radius:16px;padding:28px 26px;max-width:380px;width:100%;display:grid;gap:14px;text-align:center;box-shadow:0 10px 40px rgba(60,10,40,.18)}
  .wlgate h2{font-family:var(--disp);font-weight:400;font-size:30px;letter-spacing:-.02em}
  .wlgate h2 .a{color:var(--sea)}.wlgate h2 .b{color:var(--green)}
  .wlgate p{margin:0;color:var(--ink2);font-size:14px}
  .wlbtn{border:0;border-radius:999px;background:var(--grad);color:#fff;font-weight:600;padding:12px 20px;font-size:15px;display:inline-flex;gap:10px;align-items:center;justify-content:center}
  .wlbtn.ghost{background:none;border:1px solid var(--line);color:var(--ink)}
  .wlbanner{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:70;display:flex;gap:10px;align-items:center;background:var(--surf);border:1px solid var(--line);border-radius:999px;padding:8px 8px 8px 16px;box-shadow:0 6px 24px rgba(0,0,0,.14);font-size:13.5px;max-width:calc(100% - 32px)}
  .wlbanner .wlbtn{padding:8px 14px;font-size:13px}
  .wlacct{border:1px solid var(--line);background:var(--surf);border-radius:999px;width:34px;height:34px;display:grid;place-items:center;color:var(--ink2);flex:none}
  .wlacct:hover{border-color:var(--sea)}
  .wlmenu{position:fixed;right:16px;top:calc(64px + env(safe-area-inset-top,0px));z-index:65;background:var(--surf);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14);padding:6px;display:grid;min-width:230px}
  .wlmenu button,.wlmenu label{background:none;border:0;text-align:left;padding:10px 12px;border-radius:8px;font-size:14px;cursor:pointer}
  .wlmenu button:hover,.wlmenu label:hover{background:var(--soft)}
  .wlmenu small{color:var(--mute);padding:6px 12px 4px;font-size:11.5px}
  .wlprog{position:fixed;inset:0;z-index:80;display:grid;place-items:center;background:rgba(0,0,0,.35)}
  .wlprog .box{background:var(--surf);border-radius:14px;padding:22px 24px;min-width:260px;display:grid;gap:10px;text-align:center}
  .wlprog .bar{height:6px;border-radius:3px;background:var(--line2);overflow:hidden}.wlprog .bar span{display:block;height:100%;background:var(--grad);width:0}
  `;
  document.head.append(css);

  let gate = null, banner = null;
  function showGate(msg){
    if (gate) return;
    gate = document.createElement("div"); gate.className = "wlgate";
    gate.innerHTML = `<div class="box"><h2><span class="a">Wander</span><span class="b">lust</span></h2>
      <p>${msg || "Tus viajes se guardan en tu Google Drive. Entra con tu cuenta de Google para verlos."}</p>
      <button class="wlbtn" type="button" id="wlin">Entrar con Google</button>
      <p style="font-size:12px" id="wlerr"></p></div>`;
    document.body.append(gate);
    gate.querySelector("#wlin").onclick = () => signIn().then(start).catch(e => {
      gate.querySelector("#wlerr").textContent = "No se ha podido entrar. Si se ha bloqueado la ventana de Google, permite las ventanas emergentes e inténtalo otra vez.";
    });
  }
  function showBanner(){
    if (!ready){ showGate(); return; }
    if (banner) return;
    banner = document.createElement("div"); banner.className = "wlbanner";
    banner.innerHTML = `<span>La sesión con Google ha caducado</span><button class="wlbtn" type="button">Continuar</button>`;
    banner.querySelector("button").onclick = () => signIn().catch(() => {});
    document.body.append(banner);
  }
  function hideBanner(){ if (banner){ banner.remove(); banner = null; } }

  function progress(title){
    const el = document.createElement("div"); el.className = "wlprog";
    el.innerHTML = `<div class="box"><b>${title}</b><div class="bar"><span></span></div><small class="muted"></small></div>`;
    document.body.append(el);
    return { set(i, n, txt){ el.querySelector(".bar span").style.width = Math.round(100 * i / Math.max(n, 1)) + "%"; el.querySelector("small").textContent = txt || ""; }, done(){ el.remove(); } };
  }
  function note(msg){
    let el = document.querySelector(".toast"); if (!el){ el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
    el.textContent = msg; el.hidden = false; clearTimeout(note.t); note.t = setTimeout(() => el.hidden = true, 3200);
  }

  /* Export: a copy of the data file (attachments stay in Drive). */
  function exportCopy(){
    const blob = new Blob([JSON.stringify({ app: "Wanderlust", exported: new Date().toISOString(), trips: state.trips }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `wanderlust-copia-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /* Import: a copy made by Claude or by "Exportar". Attachments embedded as base64 are uploaded to Drive and relinked. */
  async function importCopy(file){
    let d; try { d = JSON.parse(await file.text()); } catch(e){ note("Ese archivo no es una copia de Wanderlust"); return; }
    const trips = d.trips || {}; const files = d.files || {}; const patch = d.patch || {};
    const n = Object.keys(trips).length, np = Object.keys(patch).length;
    if (!n && !np){ note("La copia no tiene viajes"); return; }
    if (!n){ /* partial update: merge fields into existing trips, attachments untouched */
      try { await mutate(s => { for (const id of Object.keys(patch)){ if (s.trips[id]) Object.assign(s.trips[id], patch[id]); } });
        note(np === 1 ? "Viaje actualizado" : `${np} viajes actualizados`); }
      catch(e){ console.error(e); note("No se ha podido terminar la importación. Inténtalo de nuevo."); }
      return; }
    const ids = Object.keys(files); const map = {};
    const pr = progress(`Importando ${n} viajes`);
    try {
      for (let i = 0; i < ids.length; i++){
        const f = files[ids[i]]; pr.set(i, ids.length, `Subiendo documentos a tu Drive (${i + 1} de ${ids.length})`);
        const bin = Uint8Array.from(atob(f.b64), c => c.charCodeAt(0));
        const r = await multipart({ name: f.name, parents: [filesFolderId] }, new Blob([bin], { type: f.type }), "POST");
        map[ids[i]] = r.id;
      }
      const relink = o => { if (Array.isArray(o)) o.forEach(relink); else if (o && typeof o === "object") for (const k of Object.keys(o)){ if ((k === "asset" || k === "cover") && typeof o[k] === "string" && map[o[k]]) o[k] = map[o[k]]; else relink(o[k]); } };
      relink(trips);
      pr.set(1, 1, "Guardando viajes…");
      await mutate(s => { Object.assign(s.trips, trips); });
      note(`${n} viajes importados${ids.length ? ` con ${ids.length} documentos` : ""}`);
    } catch(e){ console.error(e); note("No se ha podido terminar la importación. Inténtalo de nuevo."); }
    finally { pr.done(); }
  }

  function mountAccount(){
    const bar = document.querySelector(".bar1"); if (!bar || bar.querySelector(".wlacct")) return;
    const b = document.createElement("button"); b.className = "wlacct"; b.type = "button"; b.setAttribute("aria-label", "Cuenta y copias");
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.8 4.2-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/></svg>`;
    bar.append(b);
    let menu = null;
    const close = () => { if (menu){ menu.remove(); menu = null; } };
    b.onclick = e => {
      e.stopPropagation(); if (menu) return close();
      menu = document.createElement("div"); menu.className = "wlmenu";
      menu.innerHTML = `<small>Guardado en tu Google Drive, carpeta Wanderlust</small>
        <button type="button" data-a="drive">Abrir la carpeta en Drive</button>
        <button type="button" data-a="export">Descargar copia de seguridad</button>
        <label>Importar copia…<input type="file" accept="application/json,.json" hidden></label>
        ${(window.__wlMenu || []).map((m, i) => `<button type="button" data-x="${i}">${m[0]}</button>`).join("")}
        <button type="button" data-a="out">Cerrar sesión</button>`;
      document.body.append(menu);
      menu.onclick = ev => ev.stopPropagation();
      menu.querySelector("[data-a=drive]").onclick = () => { window.open("https://drive.google.com/drive/folders/" + folderId, "_blank", "noopener"); close(); };
      menu.querySelector("[data-a=export]").onclick = () => { exportCopy(); close(); };
      menu.querySelectorAll("[data-x]").forEach(b2 => b2.onclick = () => { close(); try { window.__wlMenu[+b2.dataset.x][1](); } catch(e){ console.error(e); } });
      menu.querySelector("input").onchange = ev => { const f = ev.target.files[0]; close(); if (f) importCopy(f); };
      menu.querySelector("[data-a=out]").onclick = () => {
        try { if (token && window.google) google.accounts.oauth2.revoke(token, () => {}); } catch(e){}
        ["wl.tok", "wl.consented"].forEach(LS.del); location.reload();
      };
    };
    document.addEventListener("click", close);
  }
  function emptyHint(){
    if (Object.keys(state.trips).length) return;
    const main = document.getElementById("main"); if (!main || main.querySelector(".wlempty")) return;
    const c = document.createElement("section"); c.className = "card wlempty";
    c.innerHTML = `<div class="sh"><h2>Tu Drive todavía no tiene viajes</h2></div>
      <p class="muted" style="margin:0 0 12px">Si tienes una copia de Wanderlust (un archivo .json), impórtala y aparecerán todos tus viajes con sus documentos.</p>
      <label class="wlbtn" style="cursor:pointer">Importar copia<input type="file" accept="application/json,.json" hidden></label>`;
    c.querySelector("input").onchange = ev => { const f = ev.target.files[0]; if (f) importCopy(f); };
    main.prepend(c);
  }
  new MutationObserver(() => { if (ready) emptyHint(); }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- start ---------- */
  let started = null, resolveReady;
  const readyP = new Promise(r => resolveReady = r);
  async function start(){
    if (started) return started;
    started = (async () => {
      if (gate){ gate.querySelector(".box").innerHTML = `<p><span class="spin"></span> Abriendo tu Drive…</p>`; }
      await ensureLayout(); await readRemote();
      ready = true; if (gate){ gate.remove(); gate = null; }
      mountAccount(); resolveReady(); emit();
    })().catch(e => { started = null; console.error(e); if (gate){ gate.remove(); gate = null; }
      showGate(e && e.reason === "storageQuotaExceeded"
        ? "Tu Google Drive está lleno y no se puede guardar nada. Libera espacio en one.google.com/storage, o entra con otra cuenta de Google."
        : "No se ha podido abrir tu Drive. Vuelve a entrar con Google."); });
    return started;
  }
  if (tokenOk()) start(); else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => showGate()); else showGate();
  initClient().catch(() => {});

  const user = { can: () => true };
  /* settings kept in the Drive data file (synced across devices), plus helpers for the add-on modules */
  window.__wlMenu = window.__wlMenu || [];
  window.__wlStore = {
    ready: readyP,
    get: k => (state.settings || {})[k],
    set: (k, v) => mutate(s => { s.settings = s.settings || {}; if (v === undefined) delete s.settings[k]; else s.settings[k] = v; }),
    trips: () => state.trips,
    updateTrip: (id, fn) => mutate(s => { if (s.trips[id]) fn(s.trips[id]); }),
    note: m => note(m), progress: m => progress(m), clientId: CLIENT_ID, hint: HINT,
    uploadBlob: async (blob, name) => (await multipart({ name: name || "archivo", parents: [filesFolderId] }, blob, "POST")).id
  };
  window.claude = {
    use(name){
      if (name === "db") return readyP.then(() => db);
      if (name === "assets") return readyP.then(() => assets);
      if (name === "user") return Promise.resolve(user);
      if (name === "sample") return readyP.then(() => (window.__wlMakeSample && window.__wlMakeSample()) || null);
      return Promise.reject(Object.assign(new Error("unavailable"), { code: "unavailable" }));
    }
  };
})();
