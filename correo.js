/* Wanderlust: reservas desde el correo.
   Lee los correos que llegan al Gmail de Wanderlust (reenviados desde Hotmail por una regla) y actualiza los viajes:
   reservas nuevas, cambios y cancelaciones de Booking, Rentalcars, aerolíneas, etc.
   Con la IA activada (Gemini) entiende cualquier formato; sin ella, aplica solo cancelaciones con referencia conocida
   y deja el resto en "Correos por revisar". */
(() => {
  "use strict";
  const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const GM = "https://gmail.googleapis.com/gmail/v1/users/me";
  const S = () => window.__wlStore;
  const LSK = "wl2.gmtok";
  const ls = { get(){ try { return JSON.parse(localStorage.getItem(LSK) || "null"); } catch(e){ return null; } }, set(v){ try { localStorage.setItem(LSK, JSON.stringify(v)); } catch(e){} } };
  let tok = ls.get(), client = null, running = false;
  const tokOk = () => tok && tok.exp > Date.now() + 30000;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "m" + Math.random().toString(36).slice(2, 9);
  const MONTHS = ["ene","feb","mar","abr","may","jun","jul","ago","sept","oct","nov","dic"], DOW = ["dom","lun","mar","mié","jue","vie","sáb"];

  function auth(){
    return new Promise((res, rej) => {
      const go = () => {
        if (!client) client = google.accounts.oauth2.initTokenClient({ client_id: S().clientId, scope: SCOPE, login_hint: S().hint,
          callback: r => { if (r && r.access_token){ tok = { t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }; ls.set(tok); res(); } else rej(new Error("auth")); },
          error_callback: e => rej(new Error((e && e.type) || "auth")) });
        client.requestAccessToken({ prompt: "" });
      };
      if (window.google && google.accounts && google.accounts.oauth2) go();
      else { const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.onload = go; s.onerror = () => rej(new Error("gis")); document.head.append(s); }
    });
  }
  async function gm(path){
    const r = await fetch(GM + path, { headers: { Authorization: "Bearer " + tok.t } });
    if (r.status === 401){ tok = null; ls.set(null); throw Object.assign(new Error("auth"), { code: "auth" }); }
    if (!r.ok) throw new Error("gmail " + r.status);
    return r.json();
  }
  const dec = s => { try { return decodeURIComponent(escape(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")))); } catch(e){ try { return atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); } catch(_){ return ""; } } };
  function bodyOf(payload){
    let text = "", html = "";
    const walk = p => { if (!p) return; if (p.mimeType === "text/plain" && p.body && p.body.data) text += dec(p.body.data) + "\n"; else if (p.mimeType === "text/html" && p.body && p.body.data) html += dec(p.body.data); (p.parts || []).forEach(walk); };
    walk(payload);
    if (!text && html){ const d = new DOMParser().parseFromString(html, "text/html"); d.querySelectorAll("style,script").forEach(n => n.remove()); text = (d.body && d.body.innerText) || d.body.textContent || ""; }
    let img = null; const m = html.match(/https:\/\/[a-z0-9.-]*bstatic\.com\/xdata\/images\/hotel\/[^"' )]+/i); if (m) img = m[0].replace(/&amp;/g, "&");
    return { text: text.replace(/\n{3,}/g, "\n\n").slice(0, 14000), img };
  }
  const hdr = (m, n) => ((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === n) || {};

  /* ---------- understanding one email ---------- */
  async function understand(msg){
    const ai = window.__wlMakeSample && window.__wlMakeSample();
    const subject = hdr(msg, "subject").value || "", from = hdr(msg, "from").value || "";
    const { text, img } = bodyOf(msg.payload);
    if (ai){
      const prompt = `Extrae los datos de este correo de una reserva de viaje (puede ser un reenvío). Hoy es ${new Date().toISOString().slice(0,10)}.
Responde solo con JSON: {"reserva":true|false,"tipo":"alojamiento|vuelo|coche|tren|barco|excursion|otro","accion":"nueva|cambio|cancelacion|recordatorio","titulo":"nombre del hotel o 'Origen (IATA) → Destino (IATA)' o modelo del coche o nombre de la actividad","ciudad":"","pais":"","inicio":"AAAA-MM-DD","fin":"AAAA-MM-DD","salida":"AAAA-MM-DDTHH:MM hora local de salida","llegada":"AAAA-MM-DDTHH:MM hora local de llegada","zonaSalida":"zona horaria IANA de salida","zonaLlegada":"zona IANA de llegada","aerolinea":"","vuelo":"","terminal":"terminal de salida si aparece","equipaje":"equipaje incluido en pocas palabras","referencia":"número de reserva o localizador","pin":"","precio":"importe total con moneda","cancelacionGratisHasta":"AAAA-MM-DDTHH:MM o vacío","url":"enlace para gestionar la reserva","valoracion":"nota de los huéspedes si aparece, p. ej. 9,0","opiniones":"número de opiniones si aparece","viajeros":"","resumen":"una frase en español con lo importante"}
Usa "" si un dato no aparece. "reserva" es false si el correo no trata de una reserva concreta (publicidad, encuestas...).
Asunto: ${subject}
De: ${from}
Correo:
${text}`;
      try { const j = await ai.json(prompt); if (j && typeof j === "object"){ j.img = img; j.subject = subject; return j; } } catch(e){ if (e && e.code === "rate_limited") throw e; }
    }
    /* without AI: only what is safe to recognise */
    const all = subject + "\n" + text;
    const ref = (all.match(/(?:n[uú]mero de (?:confirmaci[oó]n|reserva)|confirmation number|booking (?:number|reference)|localizador|reference|referencia|c[oó]digo de reserva)\s*[:#]?\s*([A-Z0-9][A-Z0-9.\-]{4,})/i) || [])[1] || "";
    const accion = /cancel/i.test(subject) ? "cancelacion" : /modific|cambi|change|updated/i.test(subject) ? "cambio" : /confirm/i.test(subject) ? "nueva" : "otro";
    return { reserva: !!(ref || /booking\.com|rentalcars|reserva|booking|vuelo|flight/i.test(all)), accion, referencia: ref, img, subject, resumen: subject, ruleOnly: true };
  }

  /* ---------- applying it to the trips ---------- */
  const fmtD = s => { const [y, m, d] = String(s).split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const nights = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  const norm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  function findByRef(trips, ref){
    const r = norm(ref); if (r.length < 5) return null;
    for (const [id, t] of Object.entries(trips)) for (const f of ["stays", "tickets", "excursions"])
      for (const x of t[f] || []) if (norm(x.ref).includes(r)) return { id, f, x };
    return null;
  }
  function tripFor(trips, date){
    if (!date) return null; const d = new Date(date);
    const hit = Object.entries(trips).filter(([, t]) => t.start && new Date(t.start) - 3 * 864e5 <= d && d <= new Date(t.end) - -2 * 864e5);
    return hit.length ? hit[0][0] : null;
  }
  function itemFrom(e){
    const kind = e.tipo === "vuelo" ? "vuelo" : e.tipo === "coche" ? "coche" : e.tipo === "tren" ? "tren" : e.tipo === "barco" ? "barco" : null;
    const field = e.tipo === "alojamiento" ? "stays" : kind ? "tickets" : "excursions";
    const x = { id: uid(), title: e.titulo || e.subject || "Reserva", status: "ok", src: "correo" };
    if (field === "stays"){
      if (e.inicio && e.fin){ const n = nights(e.inicio, e.fin); x.when = `${fmtD(e.inicio)} → ${fmtD(e.fin)} · ${n} ${n === 1 ? "noche" : "noches"}`; }
      x.detail = [e.ciudad, e.viajeros].filter(Boolean).join(". ");
      if (e.img) x.img = e.img; if (e.valoracion) x.rating = String(e.valoracion); if (e.opiniones) x.reviews = String(e.opiniones);
    } else if (kind){
      x.kind = kind;
      if (e.salida){ x.dep = e.salida; x.depTz = e.zonaSalida || "Europe/Madrid"; }
      if (e.llegada){ x.arr = e.llegada; x.arrTz = e.zonaLlegada || x.depTz; }
      const D = e.salida ? new Date(e.salida) : e.inicio ? new Date(e.inicio) : null;
      x.when = D ? `${DOW[D.getDay()]} ${D.getDate()} ${MONTHS[D.getMonth()]}${e.salida ? " · " + e.salida.slice(11, 16) + (e.llegada ? " → " + e.llegada.slice(11, 16) : "") : ""}` + (kind === "coche" && e.fin ? ` → ${fmtD(e.fin)}` : "") : "";
      x.detail = [e.aerolinea, e.vuelo].filter(Boolean).join(" ");
      if (e.aerolinea) x.airline = e.aerolinea; if (e.terminal) x.term = e.terminal; if (e.equipaje) x.bag = e.equipaje;
    } else { x.when = e.inicio ? fmtD(e.inicio) : ""; x.detail = e.ciudad || ""; }
    x.ref = [e.referencia, e.pin ? "PIN " + e.pin : ""].filter(Boolean).join(" · ");
    if (e.precio) x.price = e.precio; if (e.url) x.url = e.url;
    if (e.cancelacionGratisHasta) x.cancelBy = e.cancelacionGratisHasta;
    Object.keys(x).forEach(k => (x[k] === "" || x[k] == null) && delete x[k]);
    return { field, x };
  }
  async function apply(e, msgId){
    const trips = S().trips(); const link = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(S().hint)}#all/${msgId}`;
    const found = e.referencia ? findByRef(trips, e.referencia) : null;
    const note = (id, text) => S().updateTrip(id, t => { t.alerts = [...(t.alerts || []), { id: uid(), level: "info", text }]; });
    if (found && e.accion === "cancelacion"){
      await S().updateTrip(found.id, t => { const it = (t[found.f] || []).find(y => y.id === found.x.id); if (it) it.status = "cancel"; });
      await note(found.id, `Correo: se ha cancelado ${found.x.title}.`); return "cambio";
    }
    if (e.ruleOnly) return "revisar";
    if (found && (e.accion === "cambio" || e.accion === "nueva")){
      const { x } = itemFrom(e); delete x.id; delete x.status; delete x.src;
      await S().updateTrip(found.id, t => { const it = (t[found.f] || []).find(y => y.id === found.x.id); if (it) Object.assign(it, x); });
      if (e.accion === "cambio") await note(found.id, `Correo: actualizada ${found.x.title}${e.resumen ? ". " + e.resumen : ""}`);
      return "cambio";
    }
    if (e.accion !== "nueva" || !e.reserva) return e.reserva ? "revisar" : "ignorar";
    const tid = tripFor(trips, e.inicio || (e.salida || "").slice(0, 10));
    if (!tid) return "sinviaje";
    const { field, x } = itemFrom(e);
    x.files = []; if (!x.url) x.url = link;
    await S().updateTrip(tid, t => { t[field] = [...(t[field] || []), x]; });
    if (field === "stays" && (e.titulo || e.ciudad)) addToMap(tid, x, e);
    await note(tid, `Correo: nueva reserva añadida, ${x.title}.`);
    return "nueva";
  }
  async function addToMap(tid, x, e){
    try {
      const q = [e.titulo, e.ciudad, e.pais].filter(Boolean).join(", ");
      const j = await (await fetch("https://photon.komoot.io/api/?limit=1&q=" + encodeURIComponent(q))).json(); const f = j.features && j.features[0]; if (!f) return;
      await S().updateTrip(tid, t => { const st = (t.map && t.map.stops) || [];
        t.map = { ...(t.map || {}), stops: [...st, { id: "h-" + x.id, kind: "hotel", name: x.title, lat: +f.geometry.coordinates[1].toFixed(5), lng: +f.geometry.coordinates[0].toFixed(5), q, date: e.inicio, note: x.when || "", ref: "stays:" + x.id }] }; });
    } catch(_){}
  }

  /* ---------- the run ---------- */
  async function run(interactive){
    if (running) return; running = true;
    let pr = null;
    try {
      await S().ready;
      if (!tokOk()){ if (!interactive) return; await auth(); }
      pr = interactive ? S().progress("Revisando el correo de reservas") : null;
      const done = new Set(S().get("mailDone") || []);
      const since = S().get("mailSince") || "newer_than:120d";
      const list = await gm(`/messages?maxResults=60&q=${encodeURIComponent(since + " -in:sent -in:chats")}`);
      const ids = (list.messages || []).map(m => m.id).filter(id => !done.has(id)).reverse();
      const inbox = S().get("mailInbox") || [];
      const count = { nueva: 0, cambio: 0, revisar: 0, sinviaje: 0 };
      for (let i = 0; i < ids.length; i++){
        if (pr) pr.set(i, ids.length, `Leyendo correo ${i + 1} de ${ids.length}`);
        const msg = await gm(`/messages/${ids[i]}?format=full`);
        let r = "ignorar", e = null;
        try { e = await understand(msg); r = await apply(e, ids[i]); }
        catch(err){ if (err && err.code === "rate_limited"){ break; } r = "revisar"; }
        if (r === "revisar" || r === "sinviaje") inbox.push({ id: ids[i], subject: hdr(msg, "subject").value || "(sin asunto)", date: Number(msg.internalDate) || Date.now(), why: r, resumen: e && e.resumen || "" });
        if (count[r] != null) count[r]++;
        done.add(ids[i]);
      }
      await S().set("mailDone", [...done].slice(-800));
      await S().set("mailInbox", inbox.slice(-60));
      await S().set("mailLast", new Date().toISOString());
      const parts = [count.nueva && `${count.nueva} nuevas`, count.cambio && `${count.cambio} cambios`, (count.revisar + count.sinviaje) && `${count.revisar + count.sinviaje} por revisar`].filter(Boolean);
      if (interactive || parts.length) S().note(parts.length ? "Correo: " + parts.join(", ") : "No hay reservas nuevas en el correo");
    } catch(e){ if (interactive) S().note(e && e.code === "auth" ? "Vuelve a darle acceso al correo desde Cuenta" : "No se ha podido revisar el correo"); }
    finally { if (pr) pr.done(); running = false; paint(); }
  }

  /* ---------- "Correos por revisar" card on the home page ---------- */
  function paint(){
    const main = document.getElementById("main"); if (!main || !S()) return;
    const old = main.querySelector(".wlmail"); const inbox = S().get("mailInbox") || [];
    const onHome = !!main.querySelector(".hero, .grid");
    if (!inbox.length || !onHome){ if (old) old.remove(); return; }
    const sig = inbox.map(m => m.id).join(); if (old && old.dataset.sig === sig) return; if (old) old.remove();
    const c = document.createElement("section"); c.className = "card wlmail"; c.dataset.sig = sig;
    c.innerHTML = `<div class="sh"><h2>Correos de reservas por revisar</h2><span class="d">${inbox.length} · no los he podido añadir solos</span></div>
      ${inbox.slice().reverse().map(m => { const D = new Date(m.date); return `<div class="item"><span class="ico" aria-hidden="true">✉</span><div style="min-width:0"><h4>${esc(m.subject)}</h4><div class="w">${D.getDate()} ${MONTHS[D.getMonth()]} ${D.getFullYear()} · ${m.why === "sinviaje" ? "no encaja en ningún viaje: crea el viaje y vuelve a revisar" : "revísalo y añádelo a mano"}</div>${m.resumen && m.resumen !== m.subject ? `<p>${esc(m.resumen)}</p>` : ""}<div class="meta2"><a href="https://mail.google.com/mail/u/?authuser=${encodeURIComponent(S().hint)}#all/${esc(m.id)}" target="_blank" rel="noopener">Abrir el correo ↗</a></div></div><div class="side"><button class="iconbtn" type="button" data-mailx="${esc(m.id)}">Hecho</button></div></div>`; }).join("")}
      <div class="actions" style="margin-top:8px"><button class="btn ghost sm" type="button" data-mailretry>Volver a revisarlos</button></div>`;
    c.onclick = async ev => {
      const b = ev.target.closest("[data-mailx],[data-mailretry]"); if (!b) return;
      if (b.dataset.mailx){ await S().set("mailInbox", (S().get("mailInbox") || []).filter(m => m.id !== b.dataset.mailx)); paint(); }
      else { const ids = new Set((S().get("mailInbox") || []).map(m => m.id)); await S().set("mailDone", (S().get("mailDone") || []).filter(id => !ids.has(id))); await S().set("mailInbox", []); run(true); }
    };
    const hero = main.querySelector(".hero"); if (hero) hero.after(c); else main.prepend(c);
  }
  new MutationObserver(() => paint()).observe(document.documentElement, { childList: true, subtree: true });

  window.__wlMenu = window.__wlMenu || [];
  window.__wlMenu.push(["Revisar el correo de reservas", () => run(true)]);
  /* automatic check when the app opens, if access was already given and the last check is older than 2 hours */
  (async () => { try { await new Promise(r => setTimeout(r, 1500)); await S().ready; const last = S().get("mailLast"); if (tokOk() && (!last || Date.now() - new Date(last) > 2 * 3600e3)) run(false); } catch(_){} })();
  window.__wlMail = { run, understand, apply, itemFrom, bodyOf };
})();
