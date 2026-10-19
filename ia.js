/* Wanderlust: asistente con IA fuera de Claude.
   Usa Gemini (Google AI Studio) con la clave de Laura, guardada en su Drive (wanderlust-datos.json → settings.geminiKey).
   Ofrece la misma interfaz que la IA de Claude (sample, sample.json, sample.limits), así el asistente, los restaurantes,
   los tips y "Proponer itinerario" funcionan igual. */
(() => {
  "use strict";
  const S = () => window.__wlStore;
  const KEY = () => S() && S().get("geminiKey");
  const MODEL = () => (S() && S().get("geminiModel")) || "gemini-flash-latest";
  const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
  const err = (code, msg) => Object.assign(new Error(msg || code), { code });

  async function b64(blob){
    const u = new Uint8Array(await blob.arrayBuffer()); let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const toContents = input => typeof input === "string"
    ? [{ role: "user", parts: [{ text: input }] }]
    : input.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
  async function call(method, body, key, model){
    const url = `${BASE}${encodeURIComponent(model || MODEL())}:${method}${method.startsWith("stream") ? "?alt=sse&" : "?"}key=${encodeURIComponent(key || KEY())}`;
    let r;
    try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch(e){ throw err("network", "Sin conexión con la IA"); }
    if (!r.ok){
      let m = ""; try { m = (await r.json()).error.message || ""; } catch(_){}
      throw err(r.status === 429 ? "rate_limited" : (r.status === 400 || r.status === 403) && /api key|permission|API_KEY/i.test(m) ? "not_granted" : "upstream", m);
    }
    return r;
  }
  const textOf = j => ((j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map(p => p.text || "").join("");

  async function sample(input, opts = {}){
    const contents = toContents(input);
    if (opts.images && opts.images.length){
      const last = contents[contents.length - 1];
      for (const b of opts.images) last.parts.push({ inline_data: { mime_type: b.type || "image/jpeg", data: await b64(b) } });
    }
    const body = { contents };
    if (opts.search) body.tools = [{ google_search: {} }];
    if (opts.onText){
      const r = await call("streamGenerateContent", body);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", text = "";
      for (;;){
        const { done, value } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf("\n")) >= 0){
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          try { const d = textOf(JSON.parse(line.slice(5))); if (d){ text += d; opts.onText({ text, delta: d }); } } catch(_){}
        }
      }
      return { text, truncated: false };
    }
    const j = await (await call("generateContent", body)).json();
    return { text: textOf(j), truncated: !!(j.candidates && j.candidates[0] && j.candidates[0].finishReason === "MAX_TOKENS") };
  }
  sample.json = async (input, opts = {}) => {
    const body = { contents: toContents(input) };
    if (opts.search) body.tools = [{ google_search: {} }]; else body.generationConfig = { responseMimeType: "application/json" };
    let text = textOf(await (await call("generateContent", body)).json()).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(text); } catch(_){}
    const m = text.match(/[\[{][\s\S]*[\]}]/); if (m){ try { return JSON.parse(m[0]); } catch(_){} }
    throw err("invalid_json");
  };
  sample.limits = async () => ({ images: true });
  window.__wlMakeSample = () => KEY() ? sample : null;
  window.__wlAI = sample;

  /* ---------- settings dialog ---------- */
  function dialog(){
    const old = document.querySelector(".wlprog.ai"); if (old) old.remove();
    const w = document.createElement("div"); w.className = "wlprog ai";
    const has = !!KEY();
    w.innerHTML = `<div class="box" style="background:var(--surf);color:var(--ink);border-radius:16px;padding:22px;max-width:440px;width:calc(100% - 32px);display:grid;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.2)">
      <h2 style="font-family:var(--disp);font-weight:400;font-size:24px;margin:0">Asistente con IA</h2>
      <p style="margin:0;color:var(--ink2);font-size:14px">Fuera de Claude, el asistente, el buscador de restaurantes, los tips, proponer itinerarios y leer los correos de reservas usan Gemini, la IA de Google. Tiene uso gratuito con una clave personal.</p>
      <ol style="margin:0;padding-left:18px;color:var(--ink2);font-size:14px;display:grid;gap:4px">
        <li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> con tu cuenta de Google.</li>
        <li>Pulsa «Create API key» y copia la clave.</li>
        <li>Pégala aquí y pulsa Guardar.</li></ol>
      <label style="display:grid;gap:4px;font-size:13px;color:var(--mute)">Clave de Gemini<input class="inp" id="wl-gk" type="password" autocomplete="off" placeholder="${has ? "Guardada · pega otra para cambiarla" : "AIza…"}" style="font-size:15px"></label>
      <p style="margin:0;font-size:12.5px;color:var(--mute)">Se guarda en tu Google Drive (carpeta Wanderlust), así sirve en el móvil y en el ordenador. No está en GitHub.</p>
      <p id="wl-gmsg" style="margin:0;font-size:13.5px" hidden></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="wlbtn" type="button" id="wl-gsave">Guardar</button>${has ? `<button class="wlbtn ghost" type="button" id="wl-gdel">Quitar la clave</button>` : ""}<button class="wlbtn ghost" type="button" id="wl-gclose">Cerrar</button></div></div>`;
    document.body.append(w);
    const msg = (t, ok) => { const m = w.querySelector("#wl-gmsg"); m.hidden = false; m.textContent = t; m.style.color = ok ? "var(--ok)" : "var(--crit)"; };
    w.querySelector("#wl-gclose").onclick = () => w.remove();
    w.onclick = e => { if (e.target === w) w.remove(); };
    const del = w.querySelector("#wl-gdel");
    if (del) del.onclick = async () => { await S().set("geminiKey", undefined); msg("Clave quitada. Recargando…", true); setTimeout(() => location.reload(), 900); };
    w.querySelector("#wl-gsave").onclick = async () => {
      const k = w.querySelector("#wl-gk").value.trim();
      if (!k){ msg("Pega la clave primero."); return; }
      msg("Comprobando la clave…", true);
      try {
        const r = await call("generateContent", { contents: [{ role: "user", parts: [{ text: "Responde solo: ok" }] }] }, k);
        await r.json(); await S().set("geminiKey", k);
        msg("Clave correcta y guardada. Recargando…", true); setTimeout(() => location.reload(), 900);
      } catch(e){ msg(e.code === "not_granted" ? "Esa clave no funciona. Cópiala de nuevo desde AI Studio." : e.code === "rate_limited" ? "La clave funciona, pero Google pide esperar un momento. Inténtalo en un minuto." : "No se ha podido comprobar: " + (e.message || "error")); }
    };
  }
  window.__wlMenu = window.__wlMenu || [];
  window.__wlMenu.push(["Asistente con IA…", dialog]);
  window.__wlAIDialog = dialog;
})();
