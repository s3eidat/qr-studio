/* QR Studio — QR matrix from qrcode.js (Kazuhiko Arase, MIT); drawing, payloads and export are ours. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"]; // Arabic, emoji, accents

  var FIELDS = {
    url: [{ k: "url", label: "Website address", ph: "example.com/page", type: "url" }],
    text: [{ k: "text", label: "Text", ph: "Anything you like", area: true }],
    wifi: [
      { k: "ssid", label: "Network name (SSID)", ph: "Home Wi-Fi" },
      { k: "pass", label: "Password", ph: "Wi-Fi password" },
      { k: "sec", label: "Security", opts: [["WPA", "WPA / WPA2 / WPA3"], ["WEP", "WEP"], ["nopass", "None (open)"]] },
      { k: "hidden", label: "Hidden network", check: true }
    ],
    vcard: [
      { k: "first", label: "First name", ph: "Sara", half: true }, { k: "last", label: "Last name", ph: "Haddad", half: true },
      { k: "tel", label: "Phone", ph: "+962 7 9000 0000", type: "tel", half: true }, { k: "email", label: "Email", ph: "sara@example.com", type: "email", half: true },
      { k: "org", label: "Company", ph: "Company", half: true }, { k: "title", label: "Job title", ph: "Designer", half: true },
      { k: "web", label: "Website", ph: "example.com" }, { k: "adr", label: "Address", ph: "Street, City, Country" }
    ],
    email: [
      { k: "to", label: "To", ph: "hello@example.com", type: "email" },
      { k: "subject", label: "Subject", ph: "Hello" },
      { k: "body", label: "Message", ph: "Message", area: true }
    ],
    sms: [{ k: "num", label: "Phone number", ph: "+962790000000", type: "tel" }, { k: "msg", label: "Message", ph: "Message", area: true }],
    tel: [{ k: "num", label: "Phone number", ph: "+962790000000", type: "tel" }],
    geo: [
      { k: "lat", label: "Latitude", ph: "31.9539", half: true, type: "number" },
      { k: "lng", label: "Longitude", ph: "35.9106", half: true, type: "number" },
      { k: "q", label: "Label (optional)", ph: "Our office" }
    ]
  };

  var saved = S3.store("qrs.style") || {};
  var st = {
    type: "url", values: {},
    fg: saved.fg || "#0d0f12", bg: saved.bg || "#ffffff", shape: saved.shape || "square",
    ecl: saved.ecl || "M", margin: saved.margin == null ? 4 : saved.margin, size: saved.size || "1024",
    logo: null, qr: null, payload: ""
  };
  Object.keys(FIELDS).forEach(function (t) { st.values[t] = {}; });

  // ---------- payloads ----------
  function wifiEsc(s) { return String(s).replace(/([\\;,:"])/g, "\\$1"); }
  function vEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1"); }
  function withScheme(u) { u = u.trim(); return !u || /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^(mailto|tel|sms|geo):/i.test(u) ? u : "https://" + u; }
  function payload(type, v) {
    var t = function (k) { return (v[k] || "").trim(); };
    switch (type) {
      case "url": return withScheme(v.url || "");
      case "text": return v.text || "";
      case "wifi":
        if (!t("ssid")) return "";
        var sec = v.sec || "WPA";
        return "WIFI:T:" + sec + ";S:" + wifiEsc(v.ssid) + ";" + (sec !== "nopass" ? "P:" + wifiEsc(v.pass || "") + ";" : "") + (v.hidden ? "H:true;" : "") + ";";
      case "vcard":
        if (!t("first") && !t("last") && !t("tel") && !t("email") && !t("org")) return "";
        var L = ["BEGIN:VCARD", "VERSION:3.0", "N:" + vEsc(t("last")) + ";" + vEsc(t("first")) + ";;;", "FN:" + vEsc((t("first") + " " + t("last")).trim() || t("org"))];
        if (t("org")) L.push("ORG:" + vEsc(t("org")));
        if (t("title")) L.push("TITLE:" + vEsc(t("title")));
        if (t("tel")) L.push("TEL;TYPE=CELL:" + t("tel"));
        if (t("email")) L.push("EMAIL:" + t("email"));
        if (t("web")) L.push("URL:" + withScheme(t("web")));
        if (t("adr")) L.push("ADR:;;" + vEsc(t("adr")) + ";;;;");
        L.push("END:VCARD");
        return L.join("\r\n");
      case "email":
        if (!t("to")) return "";
        var q = [];
        if (t("subject")) q.push("subject=" + encodeURIComponent(t("subject")));
        if (v.body) q.push("body=" + encodeURIComponent(v.body));
        return "mailto:" + t("to") + (q.length ? "?" + q.join("&") : "");
      case "sms": return t("num") ? "SMSTO:" + t("num").replace(/[^\d+]/g, "") + ":" + (v.msg || "") : "";
      case "tel": return t("num") ? "tel:" + t("num").replace(/[^\d+*#]/g, "") : "";
      case "geo":
        var la = parseFloat(v.lat), lo = parseFloat(v.lng);
        if (!isFinite(la) || !isFinite(lo)) return "";
        if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { error: "Latitude must be −90…90 and longitude −180…180" };
        return "geo:" + la + "," + lo + (t("q") ? "?q=" + encodeURIComponent(t("q")) : "");
    }
    return "";
  }

  // ---------- QR matrix ----------
  function makeQR(text, ecl) {
    var qr = qrcode(0, ecl); // 0 = smallest version that fits
    qr.addData(text, "Byte");
    qr.make();
    return qr;
  }

  // ---------- drawing (shared geometry for canvas + SVG) ----------
  function isFinder(r, c, n) { return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7); }
  function logoBox(n) { var s = Math.round(n * 0.22); if ((n - s) % 2) s++; return { a: (n - s) / 2, b: (n + s) / 2 }; }
  function covered(r, c, box) { return box && r >= box.a - 0.5 && r < box.b + 0.5 && c >= box.a - 0.5 && c < box.b + 0.5; }
  function rrect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(ctx, qr, px, o) {
    var n = qr.getModuleCount(), N = n + 2 * o.margin, cell = px / N, off = o.margin;
    var box = o.logo ? logoBox(n) : null, round = o.shape !== "square";
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = o.fg; ctx.beginPath();
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || covered(r, c, box) || (round && isFinder(r, c, n))) continue;
      if (o.shape === "square") {
        var x0 = Math.round((c + off) * cell), y0 = Math.round((r + off) * cell);
        ctx.rect(x0, y0, Math.round((c + off + 1) * cell) - x0, Math.round((r + off + 1) * cell) - y0);
      } else if (o.shape === "dots") {
        ctx.moveTo((c + off + 1) * cell, (r + off + 0.5) * cell);
        ctx.arc((c + off + 0.5) * cell, (r + off + 0.5) * cell, cell * 0.5, 0, Math.PI * 2);
      } else rrect(ctx, (c + off) * cell, (r + off) * cell, cell, cell, cell * 0.3);
    }
    ctx.fill();
    if (round) [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var x = (p[1] + off) * cell, y = (p[0] + off) * cell;
      ctx.beginPath(); rrect(ctx, x, y, 7 * cell, 7 * cell, 2.2 * cell); rrect(ctx, x + cell, y + cell, 5 * cell, 5 * cell, 1.5 * cell); ctx.fill("evenodd");
      ctx.beginPath(); rrect(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, 1 * cell); ctx.fill();
    });
    if (box && o.logo) {
      var bx = (box.a + off) * cell, bs = (box.b - box.a) * cell, im = o.logo, pad = cell * 0.4;
      ctx.fillStyle = o.bg; ctx.beginPath(); rrect(ctx, bx - pad, bx - pad, bs + 2 * pad, bs + 2 * pad, cell); ctx.fill();
      var k = Math.min(bs / im.width, bs / im.height), w = im.width * k, h = im.height * k;
      ctx.drawImage(im, bx + (bs - w) / 2, bx + (bs - h) / 2, w, h);
    }
  }

  function svg(qr, px, o) {
    var n = qr.getModuleCount(), N = n + 2 * o.margin, off = o.margin, box = o.logo ? logoBox(n) : null;
    var round = o.shape !== "square", d = "", dots = "";
    function rr(x, y, w, r) { return "M" + (x + r) + " " + y + "h" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + r + " " + r + "v" + (w - 2 * r) + "a" + r + " " + r + " 0 0 1 " + -r + " " + r + "h" + (2 * r - w) + "a" + r + " " + r + " 0 0 1 " + -r + " " + -r + "v" + (2 * r - w) + "a" + r + " " + r + " 0 0 1 " + r + " " + -r + "z"; }
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || covered(r, c, box) || (round && isFinder(r, c, n))) continue;
      if (o.shape === "square") d += "M" + (c + off) + " " + (r + off) + "h1v1h-1z";
      else if (o.shape === "dots") dots += '<circle cx="' + (c + off + 0.5) + '" cy="' + (r + off + 0.5) + '" r="0.5"/>';
      else d += rr(c + off, r + off, 1, 0.3);
    }
    var finders = "";
    if (round) [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (p) {
      var x = p[1] + off, y = p[0] + off;
      finders += '<path fill-rule="evenodd" d="' + rr(x, y, 7, 2.2) + rr(x + 1, y + 1, 5, 1.5) + '"/><path d="' + rr(x + 2, y + 2, 3, 1) + '"/>';
    });
    var logo = "";
    if (box && o.logo) {
      var bs = box.b - box.a, pad = 0.4;
      logo = '<rect x="' + (box.a + off - pad) + '" y="' + (box.a + off - pad) + '" width="' + (bs + 2 * pad) + '" height="' + (bs + 2 * pad) + '" rx="1" fill="' + o.bg + '"/>' +
        '<image x="' + (box.a + off) + '" y="' + (box.a + off) + '" width="' + bs + '" height="' + bs + '" preserveAspectRatio="xMidYMid meet" href="' + S3.esc(o.logoUrl) + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + N + " " + N + '"' + (o.shape === "square" ? ' shape-rendering="crispEdges"' : "") + ">" +
      '<rect width="' + N + '" height="' + N + '" fill="' + o.bg + '"/><g fill="' + o.fg + '">' + (d ? '<path d="' + d + '"/>' : "") + dots + finders + "</g>" + logo + "</svg>";
  }

  // ---------- contrast (WCAG relative luminance) ----------
  function lum(hex) {
    var v = [1, 3, 5].map(function (i) { var x = parseInt(hex.substr(i, 2), 16) / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // ---------- UI ----------
  var cv = $("#cv"), status = $("#status"), info = $("#info"), warn = $("#warn"), fieldsEl = $("#fields");

  function seg(el, value, onPick) {
    $$("button", el).forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === value));
      b.addEventListener("click", function () {
        if (b.disabled) return;
        $$("button", el).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        onPick(b.dataset.v);
      });
    });
  }

  function buildFields() {
    var v = st.values[st.type], wrap = S3.h("div", { "class": "qs-fields" });
    FIELDS[st.type].forEach(function (f) {
      var el;
      if (f.check) {
        el = S3.h("input", { type: "checkbox", "data-k": f.k });
        el.checked = !!v[f.k];
        wrap.appendChild(S3.h("label", { "class": "check full" }, [el, " " + f.label]));
        return;
      }
      if (f.opts) {
        el = S3.h("select", { "class": "select", "data-k": f.k }, f.opts.map(function (o) { return S3.h("option", { value: o[0], text: o[1] }); }));
        el.value = v[f.k] || f.opts[0][0];
      } else if (f.area) el = S3.h("textarea", { "class": "textarea prose", "data-k": f.k, placeholder: f.ph, dir: "auto", rows: 4 });
      else el = S3.h("input", { "class": "input", "data-k": f.k, placeholder: f.ph, type: f.type === "number" ? "text" : f.type || "text", inputmode: f.type === "number" ? "decimal" : null, dir: f.type ? null : "auto", autocomplete: "off", spellcheck: "false" });
      if (!f.opts) el.value = v[f.k] || "";
      wrap.appendChild(S3.h("label", { "class": "field" + (f.half ? "" : " full") }, [f.label, el]));
    });
    fieldsEl.innerHTML = "";
    fieldsEl.appendChild(wrap);
    if (st.type === "wifi") $("[data-k=pass]", wrap).disabled = v.sec === "nopass";
    if (st.type === "wifi") fieldsEl.appendChild(S3.h("p", { "class": "faint", text: "Phones join by scanning. The password is inside the code, so share it only with guests you trust." }));
    if (st.type === "geo") fieldsEl.appendChild(S3.h("p", { "class": "faint", text: "Tip: in a maps app, long-press a spot to copy its coordinates." }));
  }
  fieldsEl.addEventListener("input", function (e) {
    var k = e.target.dataset.k; if (!k) return;
    st.values[st.type][k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "sec") $("[data-k=pass]", fieldsEl).disabled = e.target.value === "nopass";
    queue();
  });

  function opts() { return { fg: st.fg, bg: st.bg, shape: st.shape, margin: st.margin, logo: st.logo && st.logo.img, logoUrl: st.logo && st.logo.url }; }
  function ecl() { return st.logo ? "H" : st.ecl; }

  function render() {
    var p = payload(st.type, st.values[st.type]), ctx = cv.getContext("2d");
    st.qr = null; st.payload = "";
    $("#payload").textContent = "";
    if (p && p.error) { setStatus("bad", p.error); blank(ctx); return; }
    if (!p) { setStatus("", "Waiting for content"); blank(ctx); info.textContent = "Fill in the fields to see your code."; return; }
    try { st.qr = makeQR(p, ecl()); }
    catch (e) { setStatus("bad", "Too much data for one QR code"); blank(ctx); info.textContent = "Shorten the text or lower error correction."; return; }
    st.payload = p;
    draw(ctx, st.qr, cv.width, opts());
    var n = st.qr.getModuleCount(), bytes = qrcode.stringToBytes(p).length;
    info.textContent = "Version " + (n - 17) / 4 + " · " + n + "×" + n + " modules · " + bytes + " bytes · level " + ecl();
    $("#payload").textContent = p;
    var cr = contrast(st.fg, st.bg), inverted = lum(st.fg) > lum(st.bg);
    if (cr < 3) setStatus("bad", "Low contrast " + cr.toFixed(1) + ":1");
    else setStatus("ok", "Ready to scan");
    var w = [];
    if (cr < 3) w.push("Contrast is " + cr.toFixed(1) + ":1. Many phones can't scan below about 3:1, so make the dots darker or the background lighter.");
    else if (cr < 4.5) w.push("Contrast " + cr.toFixed(1) + ":1 is borderline. Test it with a phone before printing.");
    if (inverted) w.push("Light dots on a dark background: some older scanners can't read inverted codes.");
    if (st.margin < 2) w.push("A margin under 2 modules can stop scanners finding the code. Leave space around it when you print.");
    warn.hidden = !w.length; warn.textContent = w.join(" ");
  }
  var queue = S3.debounce(render, 90);
  function blank(ctx) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, cv.width, cv.height); warn.hidden = true; }
  function setStatus(kind, text) { status.className = "chip " + kind; status.textContent = text; }
  function saveStyle() { S3.store("qrs.style", { fg: st.fg, bg: st.bg, shape: st.shape, ecl: st.ecl, margin: st.margin, size: st.size }); }

  function setColor(which, val) {
    if (!/^#[0-9a-f]{6}$/i.test(val)) return false;
    st[which] = val.toLowerCase(); $("#" + which).value = st[which]; $("#" + which + "Hex").value = st[which];
    saveStyle(); queue(); return true;
  }
  ["fg", "bg"].forEach(function (w) {
    $("#" + w).addEventListener("input", function (e) { setColor(w, e.target.value); });
    $("#" + w + "Hex").addEventListener("input", function (e) { var x = e.target.value.trim(); if (x[0] !== "#") x = "#" + x; setColor(w, x); });
    $("#" + w + "Hex").addEventListener("blur", function (e) { e.target.value = st[w]; });
  });
  $("#swap").addEventListener("click", function () { var f = st.fg; setColor("fg", st.bg); setColor("bg", f); });

  seg($("#type"), st.type, function (v) { st.type = v; buildFields(); render(); var f = $("input,textarea", fieldsEl); if (f) f.focus(); });
  seg($("#shape"), st.shape, function (v) { st.shape = v; saveStyle(); render(); });
  seg($("#ecl"), st.ecl, function (v) { st.ecl = v; saveStyle(); render(); });
  $("#margin").value = st.margin; $("#marginVal").textContent = st.margin;
  $("#margin").addEventListener("input", function (e) { st.margin = +e.target.value; $("#marginVal").textContent = st.margin; saveStyle(); queue(); });
  $("#size").value = st.size;
  $("#size").addEventListener("change", function (e) { st.size = e.target.value; saveStyle(); });
  setColor("fg", st.fg); setColor("bg", st.bg);

  function setLogo(logo) {
    st.logo = logo;
    $("#logoClear").hidden = !logo;
    $$("#ecl button").forEach(function (b) { b.disabled = !!logo; b.setAttribute("aria-pressed", String(logo ? b.dataset.v === "H" : b.dataset.v === st.ecl)); });
    $("#logoNote").textContent = logo ? "Error correction locked to H so the logo can't break the code." : "";
    render();
  }
  $("#logoBtn input").addEventListener("change", function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    if (f.size > 5 * 1024 * 1024) { S3.toast("Logo is over 5 MB, pick a smaller image", "error"); return; }
    S3.readFile(f, "dataurl").then(function (url) {
      var img = new Image();
      img.onload = function () { setLogo({ img: img, url: url }); };
      img.onerror = function () { S3.toast("Couldn't read that image", "error"); };
      img.src = url;
    });
  });
  $("#logoClear").addEventListener("click", function () { setLogo(null); });

  function need() { if (!st.qr) { S3.toast("Add some content first", "error"); return false; } return true; }
  function fname(ext) { return "qr-" + st.type + "." + ext; }
  $("#png").addEventListener("click", function () {
    if (!need()) return;
    var px = +st.size, c = document.createElement("canvas"); c.width = c.height = px;
    draw(c.getContext("2d"), st.qr, px, opts());
    c.toBlob(function (b) { S3.download(b, fname("png")); S3.done(); }, "image/png");
  });
  $("#svg").addEventListener("click", function () { if (!need()) return; S3.download(svg(st.qr, +st.size, opts()), fname("svg"), "image/svg+xml"); S3.done(); });
  $("#copy").addEventListener("click", function () { if (need()) S3.copy(st.payload, "Encoded text copied"); });

  buildFields();
  render();

  window.S3_DEMO = function () {
    $("#type button[data-v=wifi]").click();
    st.values.wifi = { ssid: "S3eidat Café", pass: "coffee-is-free", sec: "WPA" };
    buildFields();
    setColor("fg", "#0b5f5c"); $("#shape button[data-v=rounded]").click();
    render();
  };

  // Self-test run by scripts/smoke.py: version/module counts for known byte lengths, function patterns, payload escaping.
  window.S3_SELFTEST = function () {
    var url = "https://s3eidat.github.io"; // 25 bytes
    var m = makeQR(url, "M"), h = makeQR(url, "H"), l = makeQR("HELLO", "L");
    var finder = m.isDark(0, 0) && m.isDark(0, 6) && !m.isDark(1, 1) && m.isDark(2, 2) && m.isDark(4, 4) && !m.isDark(7, 7);
    var timing = true; for (var i = 8; i < m.getModuleCount() - 8; i++) if (m.isDark(6, i) !== (i % 2 === 0)) timing = false;
    var dark = true; // the "dark module" is always at (4V+9, 8)
    if (!h.isDark(4 * 4 + 9, 8)) dark = false;
    var big = false; try { makeQR(new Array(3000).join("x"), "H"); } catch (e) { big = true; }
    var w = payload("wifi", { ssid: 'My;Net"', pass: "a:b\\c", sec: "WPA", hidden: true });
    var v = payload("vcard", { first: "Sara", last: "Haddad, Jr", tel: "+1 555" });
    var g = payload("geo", { lat: "91", lng: "0" });
    var arabic = makeQR("مرحبا", "M"); // 10 UTF-8 bytes -> version 1
    return l.getModuleCount() === 21 && m.getModuleCount() === 25 && h.getModuleCount() === 33 && finder && timing && dark && big &&
      w === 'WIFI:T:WPA;S:My\\;Net\\";P:a\\:b\\\\c;H:true;;' && v.indexOf("N:Haddad\\, Jr;Sara;;;") > 0 && !!g.error &&
      payload("url", { url: "example.com" }) === "https://" + "example.com" && arabic.getModuleCount() === 21 &&
      Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01;
  };
})();
