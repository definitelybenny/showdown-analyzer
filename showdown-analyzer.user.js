// ==UserScript==
// @name         Showdown Analyzer
// @namespace    showdown-analyzer
// @version      0.1.0
// @description  Records and analyzes VGC battles inside Pokemon Showdown
// @match        https://play.pokemonshowdown.com/*
// @run-at       document-start
// @noframes
// @grant        none
// @homepageURL  https://github.com/definitelybenny/showdown-analyzer
// @updateURL    https://raw.githubusercontent.com/definitelybenny/showdown-analyzer/main/showdown-analyzer.user.js
// @downloadURL  https://raw.githubusercontent.com/definitelybenny/showdown-analyzer/main/showdown-analyzer.user.js
// ==/UserScript==
(() => {
  // src/host/detect.js
  var ROOT_ID = "sa-root";
  var TAB_TITLE = "Analyzer";
  var TAB_ICON = "fa-bar-chart";
  var CLASSIC_TAB_ID = "view-showdownanalyzer";
  var PREACT_TAB_ID = "showdownanalyzer";
  var isFn = (v) => typeof v === "function";
  function detectClient(win = globalThis) {
    const app2 = win.app;
    if (app2 && isFn(app2.receive) && isFn(app2.send)) return "classic";
    const PS = win.PS;
    if (PS && isFn(PS.receive) && isFn(PS.send)) return "preact";
    return null;
  }
  function classicTabReady(win = globalThis) {
    const app2 = win.app;
    return !!(app2 && isFn(app2._addRoom) && app2.rooms && app2.topbar && Array.isArray(app2.roomList) && Array.isArray(app2.sideRoomList));
  }
  function preactTabReady(win = globalThis) {
    const PS = win.PS;
    return !!(PS && isFn(PS.addRoomType) && isFn(PS.join) && isFn(win.PSRoom) && isFn(win.PSRoomPanel) && isFn(win.PSPanelWrapper) && win.preact && isFn(win.preact.h));
  }
  function describeMissing(win = globalThis) {
    const client = detectClient(win);
    const need = (obj, names, prefix) => names.filter((n) => !(obj && isFn(obj[n]))).map((n) => prefix + "." + n);
    if (client === "classic") {
      const m = need(win.app, ["_addRoom"], "app");
      for (const k of ["rooms", "topbar", "roomList", "sideRoomList"]) if (!win.app[k]) m.push("app." + k);
      return m.length ? "missing " + m.join(", ") : "";
    }
    if (client === "preact") {
      const m = need(win.PS, ["addRoomType", "join"], "PS");
      for (const k of ["PSRoom", "PSRoomPanel", "PSPanelWrapper"]) if (!isFn(win[k])) m.push("window." + k);
      if (!(win.preact && isFn(win.preact.h))) m.push("preact.h");
      return m.length ? "missing " + m.join(", ") : "";
    }
    return `no usable client (window.app=${typeof win.app}, window.PS=${typeof win.PS})`;
  }

  // src/host/hook.js
  var MARK = "__saHooked";
  var GUEST = /^Guest \d+$/;
  var listeners = /* @__PURE__ */ new Set();
  function onMessage(fn) {
    if (typeof fn !== "function") return () => {
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emit(event) {
    for (const fn of Array.from(listeners)) {
      try {
        fn(event);
      } catch (err) {
        console.error("[Showdown Analyzer] subscriber failed", err);
      }
    }
  }
  function splitMessage(msg) {
    const blocks = [];
    let cur = null;
    for (const raw of String(msg).split("\n")) {
      if (raw.charAt(0) === ">") {
        cur = { roomid: raw.slice(1).trim(), lines: [] };
        blocks.push(cur);
        continue;
      }
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line) continue;
      if (!cur) {
        cur = { roomid: "", lines: [] };
        blocks.push(cur);
      }
      cur.lines.push(line);
    }
    return blocks.filter((b) => b.lines.length);
  }
  function incomingEvents(args) {
    const msg = args[0];
    if (typeof msg !== "string") return [];
    return splitMessage(msg).map((b) => ({ type: "in", roomid: b.roomid, lines: b.lines }));
  }
  function outgoingEvents(args) {
    const msg = args[0];
    if (typeof msg !== "string" || !msg) return [];
    const roomid = typeof args[1] === "string" ? args[1] : "";
    return [{ type: "out", roomid, lines: [msg] }];
  }
  function wrap(owner, name, toEvents) {
    const original = owner[name];
    if (typeof original !== "function") return false;
    if (original[MARK]) return true;
    const wrapper = function() {
      try {
        for (const ev of toEvents(arguments)) emit(ev);
      } catch (err) {
        console.error("[Showdown Analyzer] hook failed", err);
      }
      return original.apply(this, arguments);
    };
    wrapper[MARK] = true;
    try {
      owner[name] = wrapper;
    } catch (err) {
      return false;
    }
    return owner[name] === wrapper;
  }
  function hookClient(win, client) {
    const owner = client === "classic" ? win.app : win.PS;
    const a = wrap(owner, "receive", incomingEvents);
    const b = wrap(owner, "send", outgoingEvents);
    return a && b;
  }
  function clientOwner(win) {
    const client = detectClient(win);
    return client === "classic" ? win.app : client === "preact" ? win.PS : null;
  }
  function getUserName(win = globalThis) {
    try {
      const client = detectClient(win);
      let name = "";
      let named = true;
      if (client === "classic") {
        const user = win.app.user;
        if (!user || typeof user.get !== "function") return "";
        name = user.get("name");
        if (user.get("named") === false) named = false;
      } else if (client === "preact") {
        const user = win.PS.user;
        if (!user) return "";
        name = user.name;
        if (user.named === false) named = false;
      }
      name = typeof name === "string" ? name.trim() : "";
      return named && name && !GUEST.test(name) ? name : "";
    } catch (err) {
      return "";
    }
  }
  function getMyTeams(win = globalThis) {
    try {
      const client = detectClient(win);
      let list = null;
      if (client === "classic") list = win.Storage && win.Storage.teams;
      else if (client === "preact") list = win.PS.teams && win.PS.teams.list;
      if (!Array.isArray(list)) return [];
      return list.map((t) => ({
        name: String(t && t.name || ""),
        format: String(t && t.format || ""),
        packed: String(t && (t.team != null ? t.team : t.packedTeam) || "")
      })).filter((t) => t.packed);
    } catch (err) {
      return [];
    }
  }
  function roomMap(win) {
    const client = detectClient(win);
    return client === "classic" ? win.app.rooms : client === "preact" ? win.PS.rooms : null;
  }
  function getBattleLog(roomid, win = globalThis) {
    try {
      const room = (roomMap(win) || {})[roomid];
      const queue = room && room.battle && room.battle.stepQueue;
      return Array.isArray(queue) ? queue.slice() : null;
    } catch (err) {
      return null;
    }
  }
  var status = { client: null, hooked: false, error: "" };
  var timer = null;
  function getHookStatus() {
    return { ...status };
  }
  function syntheticUpdateUser(win) {
    const name = getUserName(win);
    if (!name) return;
    const owner = clientOwner(win);
    const avatar = owner && owner.user && (owner.user.avatar || typeof owner.user.get === "function" && owner.user.get("avatar")) || "";
    emit({ type: "in", roomid: "", lines: [`|updateuser| ${name}|1|${avatar}|{}`], synthetic: true });
  }
  function attempt(win, onHooked) {
    const client = detectClient(win);
    if (!client) return false;
    status.client = client;
    if (!hookClient(win, client)) {
      status.error = "could not wrap " + (client === "classic" ? "app" : "PS") + ".receive/send";
      return false;
    }
    status.hooked = true;
    status.error = "";
    syntheticUpdateUser(win);
    if (onHooked) {
      try {
        onHooked(client);
      } catch (err) {
        console.error("[Showdown Analyzer] onHooked failed", err);
      }
    }
    return true;
  }
  function startHook({ win = globalThis, interval = 50, timeout = 6e4, onHooked } = {}) {
    if (status.hooked || timer) return { stop: stopHook };
    if (attempt(win, onHooked)) return { stop: stopHook };
    let elapsed = 0;
    timer = setInterval(() => {
      elapsed += interval;
      if (attempt(win, onHooked)) {
        stopHook(true);
      } else if (elapsed >= timeout) {
        status.error = describeMissing(win);
        stopHook(true);
      }
    }, interval);
    return { stop: stopHook };
  }
  function stopHook(keepStatus) {
    if (timer) clearInterval(timer);
    timer = null;
    if (keepStatus !== true) {
      status.client = null;
      status.hooked = false;
      status.error = "";
    }
  }

  // src/host/tab-classic.js
  var ICON_PATCHED = "__saIconPatched";
  function patchTabIcon(app2) {
    const topbar = app2.topbar;
    if (typeof topbar.renderRoomTab !== "function" || topbar[ICON_PATCHED]) return;
    topbar[ICON_PATCHED] = true;
    const original = topbar.renderRoomTab.bind(topbar);
    topbar.renderRoomTab = function(room, roomid) {
      const buf = original(room, roomid);
      const id = room && room.id || roomid;
      return id === CLASSIC_TAB_ID && typeof buf === "string" ? buf.replace("fa-file-text-o", TAB_ICON) : buf;
    };
  }
  function openClassicTab(win, { focus = false, onClosed } = {}) {
    const app2 = win.app;
    const doc = win.document;
    let room = app2.rooms[CLASSIC_TAB_ID];
    if (!room) {
      room = app2._addRoom(CLASSIC_TAB_ID, "html", true, TAB_TITLE);
      if (!room || !room.el) throw new Error("app._addRoom returned no room");
    }
    const at = app2.roomList.indexOf(room);
    if (at >= 0) {
      app2.roomList.splice(at, 1);
      if (app2.sideRoomList.indexOf(room) < 0) app2.sideRoomList.push(room);
    }
    room.isSideRoom = true;
    room.minWidth = 360;
    room.maxWidth = 760;
    room.leave = function() {
    };
    if (!room.saDestroyHooked) {
      room.saDestroyHooked = true;
      const destroy = room.destroy;
      room.destroy = function() {
        try {
          if (onClosed) onClosed();
        } catch (err) {
          console.error("[Showdown Analyzer] onClosed failed", err);
        }
        return typeof destroy === "function" ? destroy.apply(this, arguments) : void 0;
      };
    }
    let root2 = room.el.querySelector("#" + ROOT_ID);
    if (!root2) {
      if (room.$el && typeof room.$el.html === "function") room.$el.html("");
      root2 = doc.createElement("div");
      root2.id = ROOT_ID;
      room.el.appendChild(root2);
    }
    patchTabIcon(app2);
    if (focus && typeof app2.focusRoomRight === "function") app2.focusRoomRight(CLASSIC_TAB_ID);
    if (typeof app2.topbar.updateTabbar === "function") app2.topbar.updateTabbar();
    return { room, root: root2 };
  }

  // src/host/tab-preact.js
  var registered = /* @__PURE__ */ new WeakSet();
  function resetTabUrl(win = globalThis) {
    try {
      const path = win.location && win.location.pathname;
      if (!path || !win.history) return;
      if (path.indexOf("/" + PREACT_TAB_ID) === 0 || path.indexOf("/view-" + PREACT_TAB_ID) === 0) {
        const state = win.PS && win.PS.router ? win.PS.router.panelState : win.history.state;
        win.history.replaceState(state, "", "/");
      }
    } catch (err) {
      console.error("[Showdown Analyzer] URL reset failed", err);
    }
  }
  function registerType(win, { onReady: onReady2, onClosed }) {
    const { PS, PSRoom, PSRoomPanel, PSPanelWrapper, preact } = win;
    if (registered.has(PS)) return;
    class AnalyzerRoom extends PSRoom {
      constructor(options) {
        super(options);
        this.title = TAB_TITLE;
        this.type = PREACT_TAB_ID;
        this.classType = PREACT_TAB_ID;
        this.location = "right";
        this.noURL = true;
      }
      // not a server room, so nothing to /leave; destroy() only runs when the room is really closed
      destroy() {
        try {
          if (onClosed) onClosed();
        } catch (err) {
          console.error("[Showdown Analyzer] onClosed failed", err);
        }
        return super.destroy();
      }
    }
    class AnalyzerPanel extends PSRoomPanel {
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        try {
          if (onReady2) onReady2();
        } catch (err) {
          console.error("[Showdown Analyzer] onReady failed", err);
        }
      }
      focus() {
        if (super.focus) super.focus();
        resetTabUrl(win);
      }
      render() {
        return preact.h(PSPanelWrapper, { room: this.props.room }, preact.h("div", { id: ROOT_ID }));
      }
    }
    Object.assign(AnalyzerPanel, {
      id: PREACT_TAB_ID,
      routes: [PREACT_TAB_ID],
      Model: AnalyzerRoom,
      location: "right",
      title: TAB_TITLE,
      noURL: true,
      icon: preact.h("i", { class: "fa " + TAB_ICON, "aria-hidden": true })
    });
    PS.addRoomType(AnalyzerPanel);
    registered.add(PS);
  }
  function openPreactTab(win, { focus = false, onReady: onReady2, onClosed } = {}) {
    registerType(win, { onReady: onReady2, onClosed });
    win.PS.join(PREACT_TAB_ID, { noURL: true, autofocus: focus, autoclosePopups: false });
    if (typeof win.PS.update === "function") win.PS.update();
    resetTabUrl(win);
  }

  // src/host/floating.js
  var PANEL_ID = "sa-floating";
  var PANEL_CSS = `
#${PANEL_ID}{position:fixed;right:12px;bottom:12px;z-index:100000;width:360px;max-width:calc(100vw - 24px);max-height:70vh;display:flex;flex-direction:column;background:#fff;color:#222;border:1px solid #888;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.35);font:12px/1.4 Verdana,sans-serif}
#${PANEL_ID} .sa-float-head{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:#e4e8ee;border-radius:6px 6px 0 0;font-weight:bold}
#${PANEL_ID} .sa-float-head button{cursor:pointer}
#${PANEL_ID} .sa-diag{padding:2px 8px;color:#a05000;font-size:11px}
#${PANEL_ID} #${ROOT_ID}{overflow:auto}
`;
  function openFloating(win, { reason: reason2 = "", onRoot, onClosed } = {}) {
    const doc = win.document;
    let built = false;
    const build = () => {
      if (built || !doc.body) return;
      built = true;
      if (doc.getElementById(PANEL_ID)) return;
      const style = doc.createElement("style");
      style.textContent = PANEL_CSS;
      const panel = doc.createElement("div");
      panel.id = PANEL_ID;
      const head = doc.createElement("div");
      head.className = "sa-float-head";
      const title = doc.createElement("span");
      title.textContent = TAB_TITLE;
      const close = doc.createElement("button");
      close.textContent = "x";
      close.title = "Close";
      close.addEventListener("click", () => {
        panel.remove();
        style.remove();
        if (onClosed) onClosed();
      });
      head.appendChild(title);
      head.appendChild(close);
      panel.appendChild(head);
      if (reason2) {
        const diag = doc.createElement("div");
        diag.className = "sa-diag";
        diag.textContent = "Tab unavailable: " + reason2;
        panel.appendChild(diag);
      }
      const root2 = doc.createElement("div");
      root2.id = ROOT_ID;
      panel.appendChild(root2);
      doc.body.appendChild(style);
      doc.body.appendChild(panel);
      if (onRoot) onRoot(root2);
    };
    if (doc.body) build();
    else doc.addEventListener("DOMContentLoaded", build, { once: true });
  }

  // src/host/tab.js
  var mode = null;
  var root = null;
  var pending = null;
  var reason = "";
  var readyFns = [];
  function setRoot(el) {
    root = el;
    for (const fn of readyFns.slice()) callReady(fn, el);
  }
  function callReady(fn, el) {
    try {
      fn(el);
    } catch (err) {
      console.error("[Showdown Analyzer] onReady callback failed", err);
    }
  }
  function onReady(fn) {
    if (typeof fn !== "function") return () => {
    };
    readyFns.push(fn);
    const el = getRoot();
    if (el) callReady(fn, el);
    return () => {
      const i = readyFns.indexOf(fn);
      if (i >= 0) readyFns.splice(i, 1);
    };
  }
  function getRoot(win = globalThis) {
    const doc = win.document;
    const live = doc && typeof doc.getElementById === "function" ? doc.getElementById(ROOT_ID) : null;
    return live || root;
  }
  function getTabMode() {
    return mode;
  }
  function getTabDiagnostic() {
    return reason;
  }
  function toFloating(win, why) {
    mode = "floating";
    reason = why;
    console.warn("[Showdown Analyzer] mode: floating panel (" + why + ")");
    openFloating(win, { reason: why, onRoot: setRoot, onClosed: () => {
      root = null;
    } });
  }
  function openTab({ win = globalThis, focus = false, pollMs = 500, waitMs = 3e4 } = {}) {
    if (pending) {
      pending.focus = pending.focus || focus;
      return;
    }
    if (mode) return;
    const job = pending = { focus, elapsed: 0 };
    const attempt2 = () => {
      const client = detectClient(win);
      const classic = client === "classic" && classicTabReady(win);
      const preact = client === "preact" && preactTabReady(win);
      if (classic || preact) {
        pending = null;
        try {
          if (classic) {
            const tab = openClassicTab(win, { focus: job.focus, onClosed: () => {
              root = null;
            } });
            mode = "classic";
            setRoot(tab.root);
          } else {
            mode = "preact";
            openPreactTab(win, {
              focus: job.focus,
              onReady: () => {
                const el = getRoot(win);
                if (el) setRoot(el);
              },
              onClosed: () => {
                root = null;
              }
            });
          }
        } catch (err) {
          console.error("[Showdown Analyzer] creating the tab failed", err);
          toFloating(win, String(err && err.message || err));
        }
        return;
      }
      if (job.elapsed >= waitMs) {
        pending = null;
        toFloating(win, describeMissing(win) || "client not ready");
        return;
      }
      setTimeout(() => {
        job.elapsed += pollMs;
        attempt2();
      }, pollMs);
    };
    attempt2();
  }

  // src/store/idb.js
  var DB_NAME = "showdown-analyzer";
  var STORES = { games: "roomid", sets: "id", teams: "id", settings: "name", meta: "key" };
  var MIGRATIONS = [
    {
      version: 1,
      up(db, tx) {
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
        tx.objectStore("meta").put({ key: "schemaVersion", value: 1 });
      }
    }
  ];
  var SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
  function req(r) {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
    });
  }
  function openDb(opts) {
    const o = opts || {};
    const factory = o.indexedDB || (typeof indexedDB !== "undefined" ? indexedDB : null);
    if (!factory) return Promise.reject(new Error("IndexedDB is not available"));
    const migrations = (o.migrations || MIGRATIONS).slice().sort((a, b) => a.version - b.version);
    const target = migrations[migrations.length - 1].version;
    return new Promise((resolve, reject) => {
      const r = factory.open(o.name || DB_NAME, target);
      r.onupgradeneeded = (ev) => {
        const db = r.result;
        const tx = r.transaction;
        try {
          for (const m of migrations) {
            if (m.version > ev.oldVersion) {
              m.up(db, tx);
              tx.objectStore("meta").put({ key: "schemaVersion", value: m.version });
            }
          }
        } catch (e) {
          tx.abort();
          reject(e);
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("Database upgrade blocked by another open tab"));
    });
  }
  async function withTx(db, names, mode2, fn) {
    const tx = db.transaction(names, mode2);
    const done = txDone(tx);
    const stores = {};
    for (const n of [].concat(names)) stores[n] = tx.objectStore(n);
    let result;
    try {
      result = await fn(stores);
    } catch (e) {
      try {
        tx.abort();
      } catch (_) {
      }
      done.catch(() => {
      });
      throw e;
    }
    await done;
    return result;
  }
  async function requestPersistence() {
    try {
      if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.persist) return false;
      if (navigator.storage.persisted && await navigator.storage.persisted()) return true;
      return !!await navigator.storage.persist();
    } catch (e) {
      return false;
    }
  }

  // src/store/compress.js
  function canCompress() {
    return typeof CompressionStream === "function" && typeof DecompressionStream === "function" && typeof Response === "function";
  }
  async function pipe(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function compressText(text) {
    const str = String(text == null ? "" : text);
    if (!canCompress()) return { data: str, enc: "plain" };
    try {
      return { data: await pipe(new TextEncoder().encode(str), new CompressionStream("gzip")), enc: "gzip" };
    } catch (e) {
      return { data: str, enc: "plain" };
    }
  }
  async function decompressText(data, enc) {
    if (enc !== "gzip") return String(data == null ? "" : data);
    if (!canCompress()) throw new Error("Stored log is gzip-compressed but DecompressionStream is unavailable");
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")));
  }
  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(bin);
  }
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // src/store/repo.js
  var CHANNEL_NAME = "showdown-analyzer";
  var USER_FIELDS = { games: ["notes", "reviewed", "tags"], sets: ["notes", "tags"], teams: ["name"] };
  var DATA_STORES = ["games", "sets", "teams", "settings"];
  function isEmpty(v) {
    return v === void 0 || v === null || v === "" || v === false || Array.isArray(v) && v.length === 0;
  }
  function mergeRecords(existing, incoming, userFields) {
    if (!existing) return incoming;
    const incomingWins = (incoming.updatedAt || 0) > (existing.updatedAt || 0);
    const winner = incomingWins ? incoming : existing;
    const loser = incomingWins ? existing : incoming;
    const out = { ...winner };
    for (const f of userFields || []) if (isEmpty(out[f]) && !isEmpty(loser[f])) out[f] = loser[f];
    return out;
  }
  function gameRecordFromParsed(parsed, ctx) {
    const c = ctx || {};
    const bo3 = parsed.bo3;
    return {
      ...parsed,
      roomid: c.roomid,
      ts: c.ts,
      setId: bo3 ? bo3.wrapperId : null,
      gameNumber: bo3 ? bo3.gameNumber : null
    };
  }
  function matchesFilter(g, f) {
    if (f.format && g.format !== f.format) return false;
    if (f.result && g.result !== f.result) return false;
    if (f.setId && g.setId !== f.setId) return false;
    if (f.reviewed !== void 0 && !!g.reviewed !== !!f.reviewed) return false;
    if (f.tag && !(g.tags || []).includes(f.tag)) return false;
    if (f.from !== void 0 && !(g.ts >= f.from)) return false;
    if (f.to !== void 0 && !(g.ts <= f.to)) return false;
    if (f.predicate && !f.predicate(g)) return false;
    return true;
  }
  async function openRepo(opts) {
    const o = opts || {};
    const db = await openDb(o);
    const listeners2 = /* @__PURE__ */ new Set();
    let channel = null;
    if (o.broadcast !== false && typeof BroadcastChannel === "function") {
      try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = (ev) => listeners2.forEach((cb) => cb(ev.data));
      } catch (e) {
        channel = null;
      }
    }
    function notify(store, keys2) {
      if (!channel) return;
      try {
        channel.postMessage({ type: "change", store, keys: keys2 });
      } catch (e) {
      }
    }
    async function prepareGame(rec2, existing) {
      const out = { ...rec2 };
      if (typeof out.rawLog === "string") {
        const { data, enc } = await compressText(out.rawLog);
        out.rawLog = data;
        out.rawEnc = enc;
      } else if (out.rawLog !== void 0 && !out.rawEnc) {
        out.rawEnc = "gzip";
      }
      if (existing) {
        for (const f of USER_FIELDS.games) if (out[f] === void 0) out[f] = existing[f];
      }
      if (out.notes === void 0) out.notes = "";
      if (out.reviewed === void 0) out.reviewed = false;
      if (out.tags === void 0) out.tags = [];
      if (out.updatedAt === void 0) out.updatedAt = Date.now();
      return out;
    }
    const repo = {
      db,
      schemaVersion: SCHEMA_VERSION,
      requestPersistence,
      /** Subscribe to change notifications from other tabs. Returns an unsubscribe function. */
      onChange(cb) {
        listeners2.add(cb);
        return () => listeners2.delete(cb);
      },
      close() {
        if (channel) channel.close();
        channel = null;
        db.close();
      },
      async getSchemaVersion() {
        const m = await withTx(db, "meta", "readonly", (s) => req(s.meta.get("schemaVersion")));
        return m ? m.value : 0;
      },
      /** Store a game. A string `rawLog` is compressed; user fields omitted by the caller keep their stored values. */
      async putGame(rec2) {
        if (!rec2 || !rec2.roomid) throw new Error("putGame: record needs a roomid");
        const existing = await withTx(db, "games", "readonly", (s) => req(s.games.get(rec2.roomid)));
        const out = await prepareGame(rec2, existing);
        await withTx(db, "games", "readwrite", (s) => req(s.games.put(out)));
        notify("games", [rec2.roomid]);
        return out;
      },
      async getGame(roomid) {
        return await withTx(db, "games", "readonly", (s) => req(s.games.get(roomid))) || null;
      },
      /** Decompressed raw log of a stored game, or null. */
      async getRawLog(roomid) {
        const g = await repo.getGame(roomid);
        if (!g || g.rawLog === void 0) return null;
        return decompressText(g.rawLog, g.rawEnc);
      },
      /** Games newest first. filter: {format, result, setId, reviewed, tag, from, to, predicate, limit} */
      async listGames(filter) {
        const f = filter || {};
        const all = await withTx(db, "games", "readonly", (s) => req(s.games.getAll()));
        const out = all.filter((g) => matchesFilter(g, f)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return f.limit ? out.slice(0, f.limit) : out;
      },
      async deleteGame(roomid) {
        await withTx(db, "games", "readwrite", (s) => req(s.games.delete(roomid)));
        notify("games", [roomid]);
      },
      async countGames(filter) {
        if (!filter) return withTx(db, "games", "readonly", (s) => req(s.games.count()));
        return (await repo.listGames({ ...filter, limit: 0 })).length;
      },
      async putSet(rec2) {
        if (!rec2 || !rec2.id) throw new Error("putSet: record needs an id");
        const existing = await repo.getSet(rec2.id);
        const out = { ...rec2 };
        if (existing) {
          for (const f of USER_FIELDS.sets) if (out[f] === void 0) out[f] = existing[f];
        }
        if (out.notes === void 0) out.notes = "";
        if (out.tags === void 0) out.tags = [];
        if (out.updatedAt === void 0) out.updatedAt = Date.now();
        await withTx(db, "sets", "readwrite", (s) => req(s.sets.put(out)));
        notify("sets", [rec2.id]);
        return out;
      },
      async getSet(id) {
        return await withTx(db, "sets", "readonly", (s) => req(s.sets.get(id))) || null;
      },
      async listSets(filter) {
        const f = filter || {};
        const all = await withTx(db, "sets", "readonly", (s) => req(s.sets.getAll()));
        return all.filter((x) => (!f.format || x.format === f.format) && (!f.tag || (x.tags || []).includes(f.tag))).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      },
      /** Insert a team or extend firstSeen/lastSeen; a stored name is never replaced by an empty one. */
      async upsertTeam(team) {
        if (!team || !team.id) throw new Error("upsertTeam: team needs an id (roster hash)");
        const now = Date.now();
        const existing = await withTx(db, "teams", "readonly", (s) => req(s.teams.get(team.id)));
        const out = { ...existing || {}, ...team };
        if (existing && isEmpty(team.name)) out.name = existing.name;
        out.firstSeen = Math.min(existing ? existing.firstSeen : Infinity, team.firstSeen === void 0 ? now : team.firstSeen);
        out.lastSeen = Math.max(existing ? existing.lastSeen : 0, team.lastSeen === void 0 ? now : team.lastSeen);
        if (out.updatedAt === void 0) out.updatedAt = now;
        await withTx(db, "teams", "readwrite", (s) => req(s.teams.put(out)));
        notify("teams", [team.id]);
        return out;
      },
      async listTeams() {
        const all = await withTx(db, "teams", "readonly", (s) => req(s.teams.getAll()));
        return all.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
      },
      async getSetting(name, fallback) {
        const r = await withTx(db, "settings", "readonly", (s) => req(s.settings.get(name)));
        return r ? r.value : fallback;
      },
      async setSetting(name, value) {
        await withTx(db, "settings", "readwrite", (s) => req(s.settings.put({ name, value, updatedAt: Date.now() })));
        notify("settings", [name]);
      },
      async listSettings() {
        return withTx(db, "settings", "readonly", (s) => req(s.settings.getAll()));
      },
      /** Put many records into one store in a single transaction (records are stored exactly as given). */
      async bulkPut(store, records) {
        if (!DATA_STORES.includes(store)) throw new Error(`bulkPut: unknown store "${store}"`);
        await withTx(db, store, "readwrite", (s) => {
          for (const r of records) s[store].put(r);
        });
        notify(store, records.map((r) => r[STORES[store]]));
      },
      async clearAll() {
        await withTx(db, DATA_STORES, "readwrite", (s) => {
          for (const n of DATA_STORES) s[n].clear();
        });
        notify("*", []);
      },
      /**
       * Rebuild parsed fields of every game from its stored raw log. User fields, identity (roomid, ts) and the raw
       * log are preserved. parseFn(rawText, oldRecord) returns a parsed game (parseLog output).
       * @returns {Promise<{updated: number, failed: {roomid: string, error: string}[]}>}
       */
      async reparseAll(parseFn) {
        const games = await withTx(db, "games", "readonly", (s) => req(s.games.getAll()));
        const failed = [];
        const next = [];
        for (const old of games) {
          try {
            if (old.rawLog === void 0) throw new Error("no raw log stored");
            const parsed = await parseFn(await decompressText(old.rawLog, old.rawEnc), old);
            const rec2 = gameRecordFromParsed(parsed, { roomid: old.roomid, ts: old.ts });
            for (const k of ["me", "side", "opp", "result"]) if (rec2[k] === void 0 && old[k] !== void 0) rec2[k] = old[k];
            rec2.rawLog = old.rawLog;
            rec2.rawEnc = old.rawEnc;
            for (const f of USER_FIELDS.games) rec2[f] = old[f];
            rec2.updatedAt = old.updatedAt;
            next.push(rec2);
          } catch (e) {
            failed.push({ roomid: old.roomid, error: e && e.message ? e.message : String(e) });
          }
        }
        if (next.length) await repo.bulkPut("games", next);
        return { updated: next.length, failed };
      }
    };
    return repo;
  }

  // src/core/schema.js
  var PARSER_VERSION = 1;
  var SIDES = ["p1", "p2"];
  function newParsedGame() {
    return {
      parserVersion: PARSER_VERSION,
      complete: false,
      format: "",
      gen: 0,
      gametype: "",
      rated: false,
      players: { p1: null, p2: null },
      bo3: null,
      teamSize: { p1: 0, p2: 0 },
      roster: { p1: [], p2: [] },
      teams: { p1: [], p2: [] },
      picks: { p1: [], p2: [] },
      leads: { p1: [], p2: [] },
      mega: { p1: [], p2: [] },
      tera: { p1: [], p2: [] },
      moves: { p1: {}, p2: {} },
      turns: 0,
      winner: null,
      tie: false,
      end: "incomplete",
      forfeiter: null,
      ratings: { p1: null, p2: null },
      warnings: []
    };
  }

  // src/core/names.js
  function toID(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  var HYPHEN_BASES = ["Ho-Oh", "Porygon-Z", "Jangmo-o", "Hakamo-o", "Kommo-o", "Type: Null", "Wo-Chien", "Chien-Pao", "Ting-Lu", "Chi-Yu"];
  var HYPHEN_BASE_IDS = new Map(HYPHEN_BASES.map((n) => [toID(n), n]));
  var COLLAPSE = [
    [/^(Zacian|Zamazenta)-Crowned$/, "$1"],
    [/^(Ogerpon(?:-(?:Wellspring|Hearthflame|Cornerstone))?)-Tera$/, "$1"],
    [/^Terapagos-(?:Terastal|Stellar)$/, "Terapagos"],
    [/^Palafin-Hero$/, "Palafin"],
    [/^Morpeko-Hangry$/, "Morpeko"],
    [/^Eiscue-Noice$/, "Eiscue"],
    [/^Mimikyu-Busted$/, "Mimikyu"],
    [/^Aegislash-Blade$/, "Aegislash"],
    [/^Wishiwashi-School$/, "Wishiwashi"],
    [/^Cramorant-(?:Gulping|Gorging)$/, "Cramorant"],
    [/^Darmanitan-Zen$/, "Darmanitan"],
    [/^Darmanitan-Galar-Zen$/, "Darmanitan-Galar"],
    [/^(Sinistcha|Poltchageist)-(?:Masterpiece|Artisan)$/, "$1"]
  ];
  var MEGA_RE = /-(?:Mega(?:-[A-Z])?|Primal)$/;
  function isMegaForme(species) {
    return MEGA_RE.test(String(species || ""));
  }
  function stripMega(species) {
    return String(species || "").replace(MEGA_RE, "");
  }
  function isWildcard(species) {
    return /-\*$/.test(String(species || ""));
  }
  function baseByString(name) {
    const id = toID(name);
    for (const [bid, bname] of HYPHEN_BASE_IDS) if (id.indexOf(bid) === 0) return bname;
    return String(name).split("-")[0];
  }
  function makeNamer(dex) {
    function lookup(name) {
      if (!dex || !dex.species || isWildcard(name)) return null;
      try {
        const sp = dex.species.get(name);
        return sp && sp.exists !== false && sp.num > 0 ? sp : null;
      } catch (e) {
        return null;
      }
    }
    function baseSpecies(name) {
      name = String(name || "").trim();
      if (isWildcard(name)) return baseByString(name.slice(0, -2));
      const sp = lookup(name);
      return sp ? sp.baseSpecies || sp.name : baseByString(name);
    }
    function dexNum(name) {
      const sp = lookup(name);
      return sp ? sp.num : 0;
    }
    function analyticsKey(name) {
      const s = stripMega(String(name || "").trim());
      for (const [re, rep] of COLLAPSE) {
        if (re.test(s)) return s.replace(re, rep);
      }
      return s;
    }
    return { baseSpecies, dexNum, analyticsKey };
  }

  // src/core/teams.js
  var STAT_ORDER = ["hp", "atk", "def", "spa", "spd", "spe"];
  function unpackName(name, table) {
    if (!name) return "";
    if (table && typeof table.get === "function") {
      try {
        const obj = table.get(name);
        if (obj && obj.exists !== false && obj.name) return obj.name;
      } catch (e) {
      }
    }
    if (/[ \-':.]/.test(name)) return name;
    return name.replace(/([0-9]+)/g, " $1 ").replace(/([A-Z])/g, " $1").replace(/\s+/g, " ").trim();
  }
  function unpackTeam(buf, dex) {
    if (!buf || typeof buf !== "string") return [];
    const team = [];
    for (const setBuf of buf.split("]")) {
      const f = setBuf.split("|");
      if (f.length < 2) continue;
      const set = {};
      set.name = f[0] || "";
      set.species = unpackName(f[1] || set.name, dex && dex.species);
      if (!set.species) continue;
      set.item = unpackName(f[2] || "", dex && dex.items);
      const ability = f[3] || "";
      if (["", "0", "1", "H", "S"].includes(ability)) {
        let abil = "";
        try {
          const sp = dex && dex.species && dex.species.get(set.species);
          if (sp && sp.abilities) abil = sp.abilities[ability || "0"] || "";
        } catch (e) {
        }
        set.ability = abil;
      } else {
        set.ability = unpackName(ability, dex && dex.abilities);
      }
      set.moves = (f[4] || "").split(",").filter(Boolean).map((m) => unpackName(m, dex && dex.moves));
      set.nature = f[5] ? f[5].charAt(0).toUpperCase() + f[5].slice(1) : "";
      if (f[6]) {
        const evs = f[6].split(",");
        set.evs = {};
        STAT_ORDER.forEach((s, i) => {
          set.evs[s] = Number(evs[i]) || 0;
        });
      }
      set.gender = f[7] || "";
      if (f[8]) {
        const ivs = f[8].split(",");
        set.ivs = {};
        STAT_ORDER.forEach((s, i) => {
          set.ivs[s] = ivs[i] === "" || ivs[i] === void 0 ? 31 : Number(ivs[i]) || 0;
        });
      }
      set.shiny = !!f[9];
      set.level = f[10] ? parseInt(f[10], 10) || 100 : 100;
      const misc = (f[11] || "").split(",");
      set.teraType = misc[5] || "";
      team.push(set);
    }
    return team;
  }
  function rosterHash(entries, dex) {
    const namer = makeNamer(dex);
    const keys2 = (entries || []).map((e) => {
      const species = typeof e === "string" ? e : e.species;
      const item = typeof e === "string" ? "" : e.item;
      return toID(namer.analyticsKey(species)) + (item ? "@" + toID(item) : "");
    }).sort();
    const str = keys2.join(",");
    let h1 = 3735928559, h2 = 1103547991;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
  }

  // src/core/parser.js
  var RATING_RE = /^(.+?)'s rating: (\d+) &rarr; <strong>(\d+)<\/strong>/;
  var SLOT_LETTERS = "abcd";
  function unescapeHtml(text) {
    return String(text).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#x2f;/gi, "/").replace(/&amp;/g, "&");
  }
  function parseIdent(ident) {
    const m = /^(p[1-4])([a-d])?: ?(.*)$/.exec(String(ident || ""));
    if (!m || m[1] !== "p1" && m[1] !== "p2") return null;
    return { side: m[1], slot: m[2] || "", nick: m[3] };
  }
  function parseDetails(details) {
    const parts = String(details || "").split(",").map((s) => s.trim());
    const out = { species: parts[0] || "", level: 100, gender: "", shiny: false, tera: "" };
    for (const p of parts.slice(1)) {
      let m;
      if (m = /^L(\d+)$/.exec(p)) out.level = Number(m[1]);
      else if (p === "M" || p === "F") out.gender = p;
      else if (p === "shiny") out.shiny = true;
      else if (m = /^tera:(.+)$/.exec(p)) out.tera = m[1];
    }
    return out;
  }
  var LogParser = class {
    /** @param {{dex?: object}} [opts] dex: anything with `species.get(name)` (client Dex, @pkmn/dex). */
    constructor(opts) {
      this.dex = opts && opts.dex || null;
      this.namer = makeNamer(this.dex);
      this.g = newParsedGame();
      this.started = false;
      this.pendingEnd = null;
      this.scoreHtml = null;
      this.resetSides();
    }
    /** Per-side battle state (slot/nickname maps, appearances); rebuilt when the preview restarts. */
    resetSides() {
      this.st = {};
      for (const s of SIDES) {
        this.st[s] = {
          slots: {},
          // slot letter -> roster index currently on the field
          nickMap: /* @__PURE__ */ new Map(),
          // nickname -> roster index (latest switch-in)
          nickOf: [],
          // roster index -> nickname
          appear: [],
          // [{idx, slot, lead}] in switch-in order (illusion-corrected)
          mega: /* @__PURE__ */ new Map(),
          // roster index -> {forme, stone}
          tera: /* @__PURE__ */ new Map()
          // roster index -> type
        };
      }
    }
    /** Feed one protocol line (or a block of lines). */
    feed(line) {
      if (typeof line !== "string") return;
      if (line.indexOf("\n") >= 0) {
        for (const l of line.split("\n")) this.feed(l);
        return;
      }
      if (line.charAt(0) !== "|") return;
      try {
        this.handle(line.replace(/\r$/, "").slice(1).split("|"));
      } catch (e) {
        this.g.warnings.push(`line failed: ${line.slice(0, 80)} (${e && e.message})`);
      }
    }
    sideOfName(name) {
      const id = toID(name);
      if (!id) return null;
      for (const s of SIDES) if (this.g.players[s] && this.g.players[s].id === id) return s;
      return null;
    }
    // ---- roster resolution ---------------------------------------------------
    /** Find the roster entry for `species`: exact, wildcard, dex number, base species. */
    match(side2, species, claimed) {
      const roster = this.g.roster[side2];
      const free = (i) => !claimed || !claimed.has(i);
      const id = toID(species);
      const n = this.namer;
      for (let i = 0; i < roster.length; i++) if (free(i) && toID(roster[i].species) === id) return i;
      const base = toID(n.baseSpecies(species));
      for (let i = 0; i < roster.length; i++) {
        if (free(i) && isWildcard(roster[i].species) && toID(n.baseSpecies(roster[i].species)) === base) return i;
      }
      const num = n.dexNum(species);
      if (num) {
        for (let i = 0; i < roster.length; i++) {
          if (free(i) && !isWildcard(roster[i].species) && n.dexNum(roster[i].species) === num) return i;
        }
      }
      const key = toID(n.analyticsKey(species));
      for (let i = 0; i < roster.length; i++) {
        if (!free(i) || isWildcard(roster[i].species)) continue;
        if (toID(n.analyticsKey(roster[i].species)) === key || toID(n.baseSpecies(roster[i].species)) === base) return i;
      }
      return -1;
    }
    /** Roster index for a species seen in battle, adding an inferred entry when it is not in the preview. */
    entryFor(side2, species, details) {
      const name = stripMega(species);
      let idx = this.match(side2, name);
      const roster = this.g.roster[side2];
      if (idx < 0) {
        const d = details || {};
        roster.push({ species: name, level: d.level || 100, gender: d.gender || "", shiny: !!d.shiny, uncertain: false, inferred: true });
        return roster.length - 1;
      }
      const e = roster[idx];
      const crowned = /-Crowned$/.test(name) && /^(zacian|zamazenta)$/.test(toID(e.species));
      if (isWildcard(e.species) || crowned) {
        e.species = name;
        e.uncertain = false;
      }
      return idx;
    }
    identIdx(ident) {
      const p = parseIdent(ident);
      if (!p) return null;
      const s = this.st[p.side];
      const si = p.slot ? s.slots[p.slot] : void 0;
      let idx = -1;
      if (si != null && s.nickOf[si] === p.nick) idx = si;
      else if (s.nickMap.has(p.nick)) idx = s.nickMap.get(p.nick);
      else if (si != null) idx = si;
      return idx < 0 ? null : { side: p.side, idx };
    }
    speciesOf(side2, idx) {
      return this.g.roster[side2][idx].species;
    }
    // ---- line handlers -------------------------------------------------------
    handle(a) {
      const g = this.g;
      switch (a[0]) {
        case "player": {
          const side2 = a[1];
          if (side2 !== "p1" && side2 !== "p2") return;
          if (a[2]) {
            const prev = g.players[side2];
            g.players[side2] = { name: a[2], id: toID(a[2]), avatar: a[3] || prev && prev.avatar || "", rating: prev ? prev.rating : null };
          }
          if (g.players[side2] && /^\d+$/.test(a[4] || "") && g.players[side2].rating == null) g.players[side2].rating = Number(a[4]);
          return;
        }
        case "teamsize":
          if (a[1] === "p1" || a[1] === "p2") g.teamSize[a[1]] = Number(a[2]) || 0;
          return;
        case "gametype":
          g.gametype = a[1] || "";
          return;
        case "gen":
          g.gen = Number(a[1]) || 0;
          return;
        case "tier":
          g.format = a.slice(1).join("|");
          return;
        case "rated":
          g.rated = true;
          return;
        case "clearpoke":
          if (!this.started) {
            for (const s of SIDES) g.roster[s] = [];
            this.resetSides();
          }
          return;
        case "poke": {
          if (a[1] !== "p1" && a[1] !== "p2") return;
          const d = parseDetails(a[2]);
          if (!d.species) return;
          g.roster[a[1]].push({ species: d.species, level: d.level, gender: d.gender, shiny: d.shiny, uncertain: isWildcard(d.species), inferred: false });
          return;
        }
        case "showteam":
          return this.showteam(a[1], a.slice(2).join("|"));
        case "start":
          this.started = true;
          return;
        case "switch":
        case "drag":
        case "replace":
          return this.switchIn(a[0], a[1], a[2]);
        case "detailschange":
          return this.detailsChange(a[1], a[2]);
        case "-mega":
          return this.noteMega(a[1], null, a[3]);
        case "-terastallize": {
          const r = this.identIdx(a[1]);
          if (r) this.st[r.side].tera.set(r.idx, a[2] || "");
          return;
        }
        case "swap":
          return this.swap(a[1], Number(a[2]));
        case "move":
          return this.move(a[1], a[2], a.slice(4));
        case "turn":
          g.turns = Math.max(g.turns, Number(a[1]) || 0);
          return;
        case "-message":
          return this.message(a.slice(1).join("|"));
        case "win": {
          g.complete = true;
          const side2 = this.sideOfName(a[1]);
          g.winner = { side: side2, name: a.slice(1).join("|") };
          g.end = this.pendingEnd || "win";
          return;
        }
        case "tie":
          g.complete = true;
          g.tie = true;
          g.end = "tie";
          return;
        case "raw":
          return this.raw(a.slice(1).join("|"));
        case "html":
          if (a[1] && a[1].indexOf('<table width="100%">') === 0) this.scoreHtml = a.slice(1).join("|");
          return;
        case "uhtml":
          if (a[1] === "bestof") this.bestOf(a.slice(2).join("|"));
          return;
        default:
      }
    }
    showteam(side2, packed) {
      if (side2 !== "p1" && side2 !== "p2") return;
      const sets = unpackTeam(packed, this.dex);
      if (!sets.length) return;
      const roster = this.g.roster[side2];
      const hadRoster = roster.length > 0;
      const claimed = /* @__PURE__ */ new Set();
      this.g.teams[side2] = sets.map((set) => {
        let idx = this.match(side2, set.species, claimed);
        if (idx < 0) {
          roster.push({ species: set.species, level: set.level, gender: set.gender, shiny: set.shiny, uncertain: false, inferred: hadRoster });
          idx = roster.length - 1;
        } else {
          roster[idx].species = set.species;
          roster[idx].uncertain = false;
        }
        claimed.add(idx);
        const out = { species: set.species, item: set.item, ability: set.ability, moves: set.moves, nature: set.nature, gender: set.gender, level: set.level };
        if (set.evs) out.evs = set.evs;
        if (set.ivs) out.ivs = set.ivs;
        if (set.teraType) out.teraType = set.teraType;
        return out;
      });
    }
    switchIn(kind, ident, details) {
      const p = parseIdent(ident);
      if (!p) return;
      const d = parseDetails(details);
      if (!d.species) return;
      const s = this.st[p.side];
      const idx = this.entryFor(p.side, d.species, d);
      if (p.slot) s.slots[p.slot] = idx;
      s.nickMap.set(p.nick, idx);
      s.nickOf[idx] = p.nick;
      if (isMegaForme(d.species)) this.setMega(p.side, idx, d.species, null);
      if (kind === "replace") {
        for (let i = s.appear.length - 1; i >= 0; i--) {
          if (s.appear[i].slot === p.slot && p.slot) {
            s.appear[i].idx = idx;
            return;
          }
        }
        s.appear.push({ idx, slot: p.slot, lead: false });
        return;
      }
      s.appear.push({ idx, slot: p.slot, lead: kind === "switch" });
    }
    detailsChange(ident, details) {
      const r = this.identIdx(ident);
      const d = parseDetails(details);
      if (!r || !d.species) return;
      if (isMegaForme(d.species)) this.setMega(r.side, r.idx, d.species, null);
      else if (isWildcard(this.speciesOf(r.side, r.idx))) this.entryFor(r.side, d.species, d);
    }
    setMega(side2, idx, forme, stone) {
      const m = this.st[side2].mega;
      const cur = m.get(idx) || { forme: null, stone: null };
      if (forme) cur.forme = forme;
      if (stone) cur.stone = stone;
      m.set(idx, cur);
    }
    noteMega(ident, forme, stone) {
      const r = this.identIdx(ident);
      if (r) this.setMega(r.side, r.idx, forme, stone);
    }
    swap(ident, pos) {
      const r = this.identIdx(ident);
      const p = parseIdent(ident);
      if (!r || !p || !p.slot || !(pos >= 0 && pos < 4)) return;
      const slots = this.st[r.side].slots;
      const to = SLOT_LETTERS.charAt(pos);
      const other = slots[to];
      slots[to] = r.idx;
      if (other != null) slots[p.slot] = other;
      else delete slots[p.slot];
    }
    move(ident, move, rest) {
      if (!move || rest.some((x) => x.indexOf("[from]") === 0)) return;
      const r = this.identIdx(ident);
      if (!r) return;
      const bySpecies = this.g.moves[r.side];
      const species = this.speciesOf(r.side, r.idx);
      const m = bySpecies[species] || (bySpecies[species] = {});
      m[move] = (m[move] || 0) + 1;
    }
    message(text) {
      let m;
      if (m = /^(.+) forfeited\.$/.exec(text)) {
        this.pendingEnd = "forfeit";
        this.g.forfeiter = this.sideOfName(m[1]);
      } else if (m = /^(.+) lost due to inactivity\.$/.exec(text)) {
        if (!this.pendingEnd) {
          this.pendingEnd = "inactivity";
          this.g.forfeiter = this.sideOfName(m[1]);
        }
      }
    }
    raw(html) {
      const m = RATING_RE.exec(html);
      if (!m) return;
      const name = unescapeHtml(m[1]);
      const side2 = this.sideOfName(name);
      if (side2) this.g.ratings[side2] = { name, before: Number(m[2]), after: Number(m[3]) };
    }
    bestOf(html) {
      const game = /Game (\d+)/.exec(html);
      const href = /href="\/(game-bestof(\d+)-[^"]+)"/.exec(html);
      if (!game || !href) return;
      this.g.bo3 = { bestOf: Number(href[2]), wrapperId: href[1], gameNumber: Number(game[1]), score: null };
    }
    // ---- output --------------------------------------------------------------
    /** Build the parsed game. Safe to call repeatedly (and to keep feeding afterwards). */
    finalize() {
      const g = this.g;
      const out = JSON.parse(JSON.stringify(g));
      out.parserVersion = PARSER_VERSION;
      out.end = g.complete ? g.end : "incomplete";
      for (const side2 of SIDES) {
        const s = this.st[side2];
        const roster = g.roster[side2];
        const seen = /* @__PURE__ */ new Set();
        const picks = [];
        const leads = [];
        const leadIdx = /* @__PURE__ */ new Set();
        for (const ap of s.appear) {
          if (!seen.has(ap.idx)) {
            seen.add(ap.idx);
            picks.push(roster[ap.idx].species);
          }
          if (ap.lead && leads.length < 2 && !leadIdx.has(ap.idx)) {
            leadIdx.add(ap.idx);
            leads.push(roster[ap.idx].species);
          }
        }
        out.picks[side2] = picks;
        out.leads[side2] = leads;
        out.mega[side2] = [...s.mega].map(([idx, m]) => ({ species: roster[idx].species, forme: m.forme, stone: m.stone }));
        out.tera[side2] = [...s.tera].map(([idx, type]) => ({ species: roster[idx].species, type }));
        out.roster[side2] = roster.filter((e, i) => !e.inferred || seen.has(i)).map((e) => ({ ...e }));
        out.moves[side2] = JSON.parse(JSON.stringify(g.moves[side2]));
      }
      if (g.bo3 && this.scoreHtml) out.bo3.score = this.score();
      return out;
    }
    /** Series score before this game from the `|html|` circle table (null if unreadable). */
    score() {
      const m = /<td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr><tr><td align="left">(.*?)<\/td><td align="right">(.*?)<\/tr>/.exec(this.scoreHtml);
      if (!m) return null;
      const wins = (html) => (html.match(/fa fa-circle"/g) || []).length;
      const score = { p1: null, p2: null };
      const left = this.sideOfName(m[1]);
      const right = this.sideOfName(m[2]);
      if (!left || !right || left === right) return null;
      score[left] = wins(m[3]);
      score[right] = wins(m[4]);
      return score;
    }
  };
  function rosterKeys(game, side2) {
    const list = game.teams[side2].length ? game.teams[side2] : game.roster[side2];
    return list.map((e) => e.species);
  }
  function rosterFits(revealed, myRoster, namer) {
    if (!revealed.length || revealed.length > myRoster.length) return false;
    const used = /* @__PURE__ */ new Set();
    return revealed.every((sp) => {
      const i = myRoster.findIndex((mine, j) => {
        if (used.has(j)) return false;
        if (isWildcard(sp)) return toID(namer.baseSpecies(sp)) === toID(namer.baseSpecies(mine));
        return toID(namer.analyticsKey(sp)) === toID(namer.analyticsKey(mine));
      });
      if (i < 0) return false;
      used.add(i);
      return true;
    });
  }
  function resolveSide(game, opts) {
    const { me, myRoster, dex } = opts || {};
    const namer = makeNamer(dex);
    const meId = toID(me);
    const nameSides = meId ? SIDES.filter((s) => game.players[s] && game.players[s].id === meId) : [];
    const teamSides = myRoster && myRoster.length ? SIDES.filter((s) => rosterFits(rosterKeys(game, s), myRoster, namer)) : [];
    if (nameSides.length === 1 && teamSides.indexOf(nameSides[0]) >= 0) return { side: nameSides[0], via: "name+team" };
    if (nameSides.length === 1) return { side: nameSides[0], via: "name" };
    if (teamSides.length === 1) return { side: teamSides[0], via: "team" };
    return { side: "p1", via: "default" };
  }
  function parseLog(lines, opts) {
    const o = opts || {};
    const p = new LogParser({ dex: o.dex });
    p.feed(Array.isArray(lines) ? lines.join("\n") : lines);
    const game = p.finalize();
    if (o.meta) game.meta = o.meta;
    if (o.me || o.myRoster && o.myRoster.length) {
      const { side: side2, via } = resolveSide(game, o);
      const opp = side2 === "p1" ? "p2" : "p1";
      game.me = o.me || game.players[side2] && game.players[side2].name || "";
      game.side = side2;
      game.opp = opp;
      game.sideVia = via;
      game.result = game.tie ? "tie" : game.winner && game.winner.side ? game.winner.side === side2 ? "win" : "loss" : null;
    }
    return game;
  }

  // src/capture/backfill.js
  var REPLAY_BASE = "https://replay.pokemonshowdown.com/";
  var FETCH_TIMEOUT_MS = 1e4;
  function isPrivateRoom(roomid) {
    return /^battle-[a-z0-9]+-\d+-[a-z0-9]+$/.test(String(roomid));
  }
  function replayIdFor(roomid) {
    const m = /^battle-([a-z0-9]+-\d+)$/.exec(String(roomid));
    return m ? m[1] : null;
  }
  function looksComplete(lines) {
    return lines.some((l) => l.indexOf("|start") === 0 || l.indexOf("|clearpoke") === 0);
  }
  function toLines(text) {
    return String(text).split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  }
  async function backfillLog(opts) {
    const { roomid, snapshot, getBattleLog: getBattleLog2, fetchFn, log } = opts;
    const warn = typeof log === "function" ? log : () => {
    };
    try {
      let queue = snapshot;
      if (!Array.isArray(queue) || !looksComplete(toLines(queue.join("\n")))) queue = typeof getBattleLog2 === "function" ? getBattleLog2(roomid) : null;
      if (Array.isArray(queue)) {
        const lines = toLines(queue.join("\n"));
        if (looksComplete(lines)) return { lines, source: "stepQueue" };
      }
    } catch (err) {
      warn(`stepQueue backfill failed for ${roomid}: ${err && err.message}`);
    }
    const id = replayIdFor(roomid);
    if (!id) {
      if (isPrivateRoom(roomid)) warn(`no replay backfill for private room ${roomid}`);
      return null;
    }
    if (typeof fetchFn !== "function") return null;
    let timer2 = null;
    try {
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      if (ctl) timer2 = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetchFn(`${REPLAY_BASE}${id}.json`, ctl ? { signal: ctl.signal } : void 0);
      if (!res || !res.ok) {
        warn(`replay backfill for ${roomid}: HTTP ${res ? res.status : "no response"}`);
        return null;
      }
      const data = await res.json();
      const lines = data && typeof data.log === "string" ? toLines(data.log) : [];
      if (!looksComplete(lines)) {
        warn(`replay backfill for ${roomid}: log is missing the game start`);
        return null;
      }
      return { lines, source: "replay" };
    } catch (err) {
      warn(`replay backfill failed for ${roomid}: ${err && err.message}`);
      return null;
    } finally {
      if (timer2) clearTimeout(timer2);
    }
  }

  // src/core/bo3.js
  function gameWinnerId(game) {
    if (!game.winner || !game.winner.side) return null;
    const p = game.players[game.winner.side];
    return p ? p.id : null;
  }
  function setRatings(games) {
    for (let i = games.length - 1; i >= 0; i--) {
      const g = games[i];
      const out = {};
      let any = false;
      for (const side2 of SIDES) {
        const r = g.ratings[side2];
        if (!r) continue;
        any = true;
        out[toID(r.name)] = { name: r.name, before: r.before, after: r.after, delta: r.after - r.before };
      }
      if (any) return out;
    }
    return null;
  }
  function groupSets(games, opts) {
    const meId = toID(opts && opts.me);
    const byWrapper = /* @__PURE__ */ new Map();
    const singles = [];
    const seen = /* @__PURE__ */ new Set();
    for (const game of games || []) {
      if (!game || !game.bo3) {
        if (game) singles.push(game);
        continue;
      }
      const key = game.meta && game.meta.id || `${game.bo3.wrapperId}#${game.bo3.gameNumber}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byWrapper.has(game.bo3.wrapperId)) byWrapper.set(game.bo3.wrapperId, []);
      byWrapper.get(game.bo3.wrapperId).push(game);
    }
    const sets = [];
    for (const [id, list] of byWrapper) {
      list.sort((a, b) => a.bo3.gameNumber - b.bo3.gameNumber);
      const bestOf = list[0].bo3.bestOf;
      const need = Math.floor(bestOf / 2) + 1;
      const players = {};
      const wins = {};
      for (const g of list) {
        for (const s of SIDES) {
          const p = g.players[s];
          if (p) {
            players[p.id] = p.name;
            if (!(p.id in wins)) wins[p.id] = 0;
          }
        }
        const w = gameWinnerId(g);
        if (w) wins[w]++;
      }
      const winnerId = Object.keys(wins).find((pid) => wins[pid] >= need) || null;
      const numbers = list.map((g) => g.bo3.gameNumber);
      const missing = [];
      for (let n = 1; n <= Math.max(...numbers); n++) if (!numbers.includes(n)) missing.push(n);
      sets.push({
        id,
        bestOf,
        format: list[0].format,
        players,
        games: list,
        wins,
        winnerId,
        complete: !!winnerId,
        missing,
        ratings: setRatings(list),
        result: meId && winnerId ? winnerId === meId ? "win" : "loss" : null
      });
    }
    return { sets, singles };
  }

  // src/capture/record.js
  function readRequest(json) {
    let req2;
    try {
      req2 = typeof json === "string" ? JSON.parse(json) : json;
    } catch (err) {
      return null;
    }
    if (!req2 || typeof req2 !== "object") return null;
    const side2 = req2.side && (req2.side.id === "p1" || req2.side.id === "p2") ? req2.side.id : null;
    const pokemon = req2.side && Array.isArray(req2.side.pokemon) ? req2.side.pokemon.map((p) => ({
      species: stripMega(parseDetails(p && p.details).species),
      item: p && typeof p.item === "string" ? p.item : "",
      active: !!(p && p.active)
    })).filter((p) => p.species) : [];
    return { side: side2, teamPreview: !!req2.teamPreview, wait: !!req2.wait, maxChosen: Number(req2.maxChosenTeamSize) || 0, pokemon };
  }
  function applyRequest(state, info) {
    if (!info) return;
    if (info.side) state.side = info.side;
    if (info.teamPreview) {
      state.preview = info.pokemon;
      state.maxChosen = info.maxChosen || state.maxChosen || 4;
      state.chosen = null;
    } else if (state.preview && !state.chosen && !info.wait && info.pokemon.length) {
      state.chosen = info.pokemon;
    }
  }
  function perspective(game, side2) {
    const opp = side2 === "p1" ? "p2" : "p1";
    game.side = side2;
    game.opp = opp;
    game.result = game.tie ? "tie" : game.winner && game.winner.side ? game.winner.side === side2 ? "win" : "loss" : null;
  }
  function teamMembers(game, side2, req2) {
    if (game.teams[side2].length) return game.teams[side2].map((t) => ({ species: t.species, item: t.item || "" }));
    if (game.side === side2 && req2 && req2.preview && req2.preview.length) return req2.preview.map((p) => ({ species: p.species, item: p.item || "" }));
    return game.roster[side2].map((e) => ({ species: e.species, item: "" }));
  }
  function matchTeamName(members, myTeams, formatId, dex) {
    if (!members.length || !Array.isArray(myTeams)) return "";
    const hasItems = members.some((m) => m.item);
    const withItems = rosterHash(members, dex);
    const plain = rosterHash(members.map((m) => m.species), dex);
    const exact = [];
    const loose = [];
    for (const t of myTeams) {
      const sets = unpackTeam(t.packed, dex);
      if (!sets.length) continue;
      if (hasItems && rosterHash(sets.map((s) => ({ species: s.species, item: s.item })), dex) === withItems) exact.push(t);
      else if (rosterHash(sets.map((s) => s.species), dex) === plain) loose.push(t);
    }
    const pool = exact.length ? exact : loose;
    const best = pool.find((t) => toID(t.format) === formatId) || pool[0];
    return best ? best.name : "";
  }
  function teamRecord(members, ts, extra) {
    return {
      id: rosterHash(members, extra.dex),
      roster: members.map((m) => m.species),
      members,
      format: extra.formatId,
      firstSeen: ts,
      lastSeen: ts,
      ...extra.name ? { name: extra.name } : {},
      ...extra.mine ? { mine: true } : {}
    };
  }
  function buildGame(o) {
    const game = parseLog(o.lines, { me: o.me, dex: o.dex });
    const req2 = o.req || {};
    if (game.sideVia === "name" || game.sideVia === "name+team") {
      if (req2.side && req2.side !== game.side) perspective(game, req2.side);
    } else if (req2.side) {
      perspective(game, req2.side);
      game.sideVia = "request";
    } else {
      return { skip: "spectating" };
    }
    const side2 = game.side;
    if (game.result === null && game.winner && game.winner.name) {
      game.result = toID(game.winner.name) === toID(o.me) ? "win" : "loss";
      game.winner.side = game.result === "win" ? side2 : game.opp;
    }
    const record2 = { ...game };
    const switched = { picks: game.picks[side2].slice(), leads: game.leads[side2].slice() };
    let request = null;
    if (req2.chosen && req2.chosen.length) {
      const n = req2.maxChosen || 4;
      const picks = req2.chosen.slice(0, n).map((p) => p.species);
      const leadMons = req2.chosen.filter((p) => p.active);
      const leads = (leadMons.length ? leadMons : req2.chosen).slice(0, game.gametype === "singles" ? 1 : 2).map((p) => p.species);
      request = { picks, leads };
      record2.picks = { ...game.picks, [side2]: picks };
      record2.leads = { ...game.leads, [side2]: leads };
    }
    record2.picksSource = request ? "request" : "switch";
    record2.picksRequest = request;
    record2.picksSwitch = switched;
    record2.partial = !!o.partial;
    if (o.backfill) record2.backfill = o.backfill;
    record2.roomid = o.roomid;
    record2.ts = o.ts;
    record2.setId = game.bo3 ? game.bo3.wrapperId : null;
    record2.gameNumber = game.bo3 ? game.bo3.gameNumber : null;
    const formatId = (/^battle-([a-z0-9]+)-/.exec(o.roomid) || [])[1] || "";
    const mine = teamMembers(game, side2, req2);
    const theirs = teamMembers(game, game.opp, req2);
    const name = matchTeamName(mine, o.myTeams, formatId, o.dex);
    const mineRec = teamRecord(mine, o.ts, { dex: o.dex, formatId, name, mine: true });
    const theirRec = teamRecord(theirs, o.ts, { dex: o.dex, formatId });
    record2.myTeamId = mineRec.id;
    record2.myTeamName = name;
    record2.oppTeamId = theirRec.id;
    record2.rawLog = o.lines.join("\n");
    const teams = [mineRec];
    if (theirRec.members.length && theirRec.id !== mineRec.id) teams.push(theirRec);
    return { record: record2, teams: teams.filter((t) => t.members.length) };
  }
  function assembleSet(games, me) {
    const { sets } = groupSets(games, { me });
    const set = sets[0];
    if (!set) return null;
    const last = set.games[set.games.length - 1];
    let winnerId = set.winnerId;
    let forfeit = false;
    if (!winnerId && last && (last.end === "forfeit" || last.end === "inactivity")) {
      const w = last.winner && last.winner.side && last.players[last.winner.side];
      if (w) {
        winnerId = w.id;
        forfeit = true;
      }
    }
    const meId = toID(me);
    const rating = set.ratings && set.ratings[meId];
    const oppEntry = Object.keys(set.players).find((id) => id !== meId);
    return {
      id: set.id,
      format: set.format,
      bestOf: set.bestOf,
      games: set.games.map((g) => g.roomid),
      me,
      opp: oppEntry ? set.players[oppEntry] : "",
      wins: set.wins,
      score: { me: set.wins[meId] || 0, opp: oppEntry ? set.wins[oppEntry] || 0 : 0 },
      complete: !!winnerId,
      forfeit,
      missing: set.missing,
      result: winnerId ? winnerId === meId ? "win" : "loss" : null,
      ratingBefore: rating ? rating.before : null,
      ratingAfter: rating ? rating.after : null,
      ratingDelta: rating ? rating.delta : null,
      ts: Math.min(...set.games.map((g) => g.ts).filter(Number.isFinite))
    };
  }

  // src/capture/session.js
  var RATING_LINE = /^\|raw\|.*'s rating: \d+ &rarr;/;
  var Session = class {
    constructor(roomid, ctx) {
      this.roomid = roomid;
      this.ctx = ctx;
      this.startedAt = ctx.now();
      this.state = "live";
      this.closed = false;
      this.backfilled = "";
      this.backfillTried = false;
      this.backfillP = null;
      this.saved = false;
      this.timer = null;
      this.chain = Promise.resolve();
      this.reset();
    }
    /** Start over from an empty log (a fresh `|init|` dump on rejoin replaces everything already seen). */
    reset() {
      this.lines = [];
      this.closed = false;
      this.snapshot = null;
      this.parser = new LogParser({ dex: this.ctx.dex });
      this.sawStart = false;
      this.req = { side: null, preview: null, maxChosen: 0, chosen: null };
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      if (this.state !== "saved") this.state = "live";
    }
    get complete() {
      return this.parser.g.complete;
    }
    get partial() {
      return !this.sawStart && !this.backfilled;
    }
    /** Summary for the status view. */
    info() {
      const g = this.parser.g;
      const names = [g.players.p1 && g.players.p1.name, g.players.p2 && g.players.p2.name].filter(Boolean);
      return { roomid: this.roomid, state: this.state, players: names, format: g.format, turn: g.turns, partial: this.partial };
    }
    feed(lines) {
      let ended = false;
      let lateRating = false;
      for (const line of lines) {
        if (typeof line !== "string" || line.charAt(0) !== "|") continue;
        if (line.indexOf("|init|") === 0 || this.complete && (line === "|clearpoke" || line === "|start")) {
          if (this.lines.length) this.reset();
          if (line.indexOf("|init|") === 0) continue;
        }
        if (line.indexOf("|title|") === 0) continue;
        if (line.indexOf("|deinit") === 0) {
          this.close();
          continue;
        }
        if (line.indexOf("|request|") === 0) {
          applyRequest(this.req, readRequest(line.slice(9)));
          continue;
        }
        const wasComplete = this.complete;
        if (line === "|clearpoke" || line === "|start") this.sawStart = true;
        this.lines.push(line);
        this.parser.feed(line);
        if (!wasComplete && this.complete) ended = true;
        if (this.saved && RATING_LINE.test(line)) lateRating = true;
      }
      if (ended) this.onEnded();
      else if (lateRating) this.schedule(0);
      this.ctx.changed();
    }
    onEnded() {
      this.state = this.saved ? "saved" : "settling";
      if (this.partial && !this.snapshot) {
        const t = setTimeout(() => this.snap(), 0);
        if (typeof t.unref === "function") t.unref();
      }
      const g = this.parser.g;
      const rated = g.ratings.p1 && g.ratings.p2;
      this.schedule(rated ? 0 : this.ctx.settleMs);
    }
    snap() {
      try {
        const q = this.ctx.getBattleLog(this.roomid);
        if (Array.isArray(q) && q.length) this.snapshot = q;
      } catch (err) {
        this.ctx.log(`could not read the client log of ${this.roomid}: ${err && err.message}`);
      }
    }
    schedule(ms) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, ms);
      if (this.timer && typeof this.timer.unref === "function") this.timer.unref();
    }
    /** The room closed: write whatever we have if the game ended. */
    close() {
      if (this.closed) return this.chain;
      this.closed = true;
      if (this.partial && !this.snapshot) this.snap();
      return this.flush().then(() => this.ctx.closed(this));
    }
    dispose() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    }
    /** Persist the current state of a finished game (idempotent: the record is keyed by room id). */
    flush() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.chain = this.chain.then(() => this.write()).catch((err) => this.ctx.log(`capture failed for ${this.roomid}: ${err && err.message}`, err));
      return this.chain;
    }
    async write() {
      if (!this.complete) return;
      const me = this.ctx.getMe();
      if (!me) {
        this.state = "unsaved";
        this.ctx.changed();
        return;
      }
      const built = buildGame({
        roomid: this.roomid,
        lines: this.lines,
        me,
        dex: this.ctx.dex,
        req: this.req,
        myTeams: this.ctx.getMyTeams(),
        ts: this.startedAt,
        partial: this.partial,
        backfill: this.backfilled
      });
      if (built.skip) {
        this.state = "skipped";
        this.ctx.changed();
        return;
      }
      await this.ctx.commit(this, built);
      this.saved = true;
      this.state = "saved";
      this.ctx.changed();
      if (built.record.partial) this.startBackfill();
    }
    /** Non-blocking: recover the full log of a late-joined game, then rewrite the record. */
    startBackfill() {
      if (this.backfillTried) return;
      this.backfillTried = true;
      this.backfillP = backfillLog({ roomid: this.roomid, snapshot: this.snapshot, getBattleLog: this.ctx.getBattleLog, fetchFn: this.ctx.fetchFn, log: this.ctx.log }).then((res) => {
        if (!res) return;
        this.applyBackfill(res);
        return this.flush();
      }).catch((err) => this.ctx.log(`backfill failed for ${this.roomid}: ${err && err.message}`, err));
    }
    /** Resolves when queued writes and any running backfill have finished. */
    async idle() {
      await this.chain;
      if (this.backfillP) await this.backfillP;
      await this.chain;
    }
    applyBackfill({ lines, source }) {
      const merged = lines.slice();
      const winAt = this.lines.findIndex((l) => /^\|(win|tie)\b/.test(l));
      if (!merged.some((l) => /^\|(win|tie)\b/.test(l)) && winAt >= 0) merged.push(...this.lines.slice(winAt));
      else for (const l of this.lines) if (RATING_LINE.test(l) && !merged.includes(l)) merged.push(l);
      this.lines = merged.filter((l) => l.indexOf("|request|") !== 0);
      this.parser = new LogParser({ dex: this.ctx.dex });
      this.parser.feed(this.lines.join("\n"));
      this.backfilled = source;
      this.sawStart = true;
    }
  };

  // src/capture/index.js
  var DEFAULT_TRACKED_FORMATS = ["^gen9(champions)?vgc\\d{4}"];
  var DEFAULT_SETTLE_MS = 1500;
  var DEFAULT_LINGER_MS = 10 * 60 * 1e3;
  var MAX_ERRORS = 20;
  var BATTLE_ROOM = /^battle-([a-z0-9]+)-\d+/;
  var LEAVE_CMD = /^(\/noreply )?\/(leave|part)\b *(.*)$/;
  var NO_USER_HINT = "Not logged in: games are not saved. Log in to a Showdown account to record games.";
  function compilePatterns(list) {
    const out = [];
    for (const src of Array.isArray(list) ? list : [list]) {
      try {
        if (typeof src === "string" && src) out.push(new RegExp(src, "i"));
      } catch (err) {
      }
    }
    return out;
  }
  function userFromLine(line) {
    const a = line.split("|");
    if (a[1] !== "updateuser") return null;
    const name = String(a[2] || "").trim();
    const named = a[3] === "1";
    return named && name && !/^Guest \d+$/.test(name) ? name : "";
  }
  function startCapture(o) {
    const host = o.host;
    const now = o.now || Date.now;
    const repoP = Promise.resolve(o.repo);
    const sessions = /* @__PURE__ */ new Map();
    const idleTimers = /* @__PURE__ */ new Map();
    const lingerMs = o.lingerMs === void 0 ? DEFAULT_LINGER_MS : o.lingerMs;
    const listeners2 = /* @__PURE__ */ new Set();
    const errors = [];
    let lastSaved = null;
    let savedCount = 0;
    let patterns = compilePatterns(DEFAULT_TRACKED_FORMATS);
    let eventUser = null;
    let writeQueue = Promise.resolve();
    let stopped = false;
    function changed() {
      for (const fn of Array.from(listeners2)) {
        try {
          fn(status2());
        } catch (err) {
          console.error("[Showdown Analyzer] capture listener failed", err);
        }
      }
    }
    function log(message, err) {
      if (err) console.warn("[Showdown Analyzer]", message, err);
      else console.warn("[Showdown Analyzer]", message);
      errors.push({ ts: now(), message });
      if (errors.length > MAX_ERRORS) errors.shift();
      changed();
    }
    function currentUser() {
      if (eventUser !== null) return eventUser;
      try {
        return host.getUserName && host.getUserName() || "";
      } catch (err) {
        return "";
      }
    }
    async function refreshSettings() {
      try {
        const repo = await repoP;
        patterns = compilePatterns(await repo.getSetting("trackedFormats", DEFAULT_TRACKED_FORMATS));
      } catch (err) {
        log("could not read trackedFormats setting: " + (err && err.message), err);
      }
    }
    function commit(session, built) {
      const run = async () => {
        const repo = await repoP;
        const { record: record2, teams } = built;
        const existing = await repo.getGame(record2.roomid);
        if (existing && !existing.partial && record2.partial) return;
        if (existing && existing.ts) record2.ts = existing.ts;
        await repo.putGame(record2);
        for (const t of teams) await repo.upsertTeam(t);
        if (record2.setId) {
          const games = await repo.listGames({ setId: record2.setId });
          const set = assembleSet(games, record2.me);
          if (set) await repo.putSet(set);
        }
        savedCount++;
        const opp = record2.players[record2.opp];
        lastSaved = { roomid: record2.roomid, setId: record2.setId, result: record2.result, opp: opp ? opp.name : "", ts: now(), partial: record2.partial };
      };
      const p = writeQueue.then(run);
      writeQueue = p.catch(() => {
      });
      return p;
    }
    const ctx = {
      // the client's Dex may not exist yet at document-start, so resolve it lazily
      get dex() {
        return o.dex || o.getDex && o.getDex() || null;
      },
      now,
      settleMs: o.settleMs === void 0 ? DEFAULT_SETTLE_MS : o.settleMs,
      getMe: () => currentUser(),
      getMyTeams: () => host.getMyTeams ? host.getMyTeams() : [],
      getBattleLog: (id) => host.getBattleLog ? host.getBattleLog(id) : null,
      fetchFn: o.fetchFn || (typeof fetch === "function" ? (...a) => fetch(...a) : null),
      commit,
      closed: (session) => {
        if (!session.complete || session.state === "saved" || session.state === "skipped") session.idle().then(() => dropSession(session.roomid));
      },
      changed,
      log
    };
    function sessionFor(roomid) {
      let s = sessions.get(roomid);
      if (s) return s;
      const m = BATTLE_ROOM.exec(roomid);
      if (!m || !patterns.some((re) => re.test(m[1]))) return null;
      s = new Session(roomid, ctx);
      sessions.set(roomid, s);
      return s;
    }
    function touch(roomid) {
      clearTimeout(idleTimers.get(roomid));
      const t = setTimeout(() => dropSession(roomid), lingerMs);
      if (typeof t.unref === "function") t.unref();
      idleTimers.set(roomid, t);
    }
    function dropSession(roomid) {
      clearTimeout(idleTimers.get(roomid));
      idleTimers.delete(roomid);
      const s = sessions.get(roomid);
      if (!s) return;
      if (s.complete && s.state !== "saved" && s.state !== "skipped") s.flush();
      s.dispose();
      sessions.delete(roomid);
      changed();
    }
    function handle(ev) {
      if (stopped || !ev || !Array.isArray(ev.lines)) return;
      try {
        if (ev.type === "out") {
          for (const line of ev.lines) {
            const m = LEAVE_CMD.exec(line);
            const s2 = m && sessions.get(ev.roomid || m[3].trim());
            if (s2) s2.close();
          }
          return;
        }
        if (!ev.roomid) {
          for (const line of ev.lines) {
            const name = userFromLine(line);
            if (name === null) continue;
            eventUser = name;
            if (name) {
              for (const s2 of sessions.values()) if (s2.state === "unsaved") s2.flush();
            }
            changed();
          }
          return;
        }
        if (!BATTLE_ROOM.test(ev.roomid)) return;
        const isNew = !sessions.has(ev.roomid);
        const s = sessionFor(ev.roomid);
        if (isNew) refreshSettings();
        if (s) {
          touch(ev.roomid);
          s.feed(ev.lines);
        }
      } catch (err) {
        log("capture handler failed: " + (err && err.message), err);
      }
    }
    const unsubscribe = host.onMessage(handle);
    refreshSettings();
    let unsubscribeRepo = () => {
    };
    repoP.then((repo) => {
      if (stopped || typeof repo.onChange !== "function") return;
      unsubscribeRepo = repo.onChange((msg) => {
        if (msg && msg.store === "settings") refreshSettings();
      });
    }).catch(() => {
    });
    function status2() {
      const user = currentUser();
      const live = [];
      for (const s of sessions.values()) if (s.state !== "saved" && s.state !== "skipped") live.push(s.info());
      return {
        userName: user,
        hint: !user && sessions.size ? NO_USER_HINT : "",
        live,
        lastSaved,
        savedCount,
        errors: errors.slice()
      };
    }
    return {
      /** Snapshot for the UI: {userName, hint, live[], lastSaved, savedCount, errors[]}. */
      captureStatus: status2,
      /** Subscribe to status changes (listener receives the status). Returns an unsubscribe function. */
      onChange(fn) {
        listeners2.add(fn);
        return () => listeners2.delete(fn);
      },
      /** Wait for every pending write (tests, shutdown). */
      async flush() {
        await Promise.all([...sessions.values()].map((s) => s.flush().then(() => s.idle())));
        await writeQueue;
      },
      refreshSettings,
      stop() {
        stopped = true;
        unsubscribe();
        unsubscribeRepo();
        for (const s of sessions.values()) s.dispose();
        for (const t of idleTimers.values()) clearTimeout(t);
        idleTimers.clear();
        sessions.clear();
        listeners2.clear();
      }
    };
  }

  // src/core/stats.js
  var defaultNamer = makeNamer();
  var keyOf = (sp) => defaultNamer.analyticsKey(sp);
  var DEFAULT_MIN_SAMPLE = 5;
  var DEFAULT_MIN_MATCHUP = 3;
  function wilson(w, n, z = 1.96) {
    if (!n) return { p: 0, lo: 0, hi: 0 };
    const p = w / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom;
    const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom;
    return { p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
  }
  var isDecided = (g) => !!g && (g.result === "win" || g.result === "loss") && !g.partial;
  function record(games) {
    let w = 0;
    let l = 0;
    for (const g of games || []) {
      if (!isDecided(g)) continue;
      if (g.result === "win") w++;
      else l++;
    }
    return rec(w, l);
  }
  function rec(w, l) {
    const n = w + l;
    const iv = wilson(w, n);
    return { w, l, n, rate: n ? w / n : null, lo: iv.lo, hi: iv.hi };
  }
  var side = (g) => g.side || "p1";
  var oppSide = (g) => g.opp || (side(g) === "p1" ? "p2" : "p1");
  var keys = (list) => [...new Set((list || []).map((x) => keyOf(typeof x === "string" ? x : x.species)))];
  function teamKey(g) {
    return keys(g.roster && g.roster[side(g)] || []).sort().join("/");
  }
  function listTeams(games) {
    const m = /* @__PURE__ */ new Map();
    for (const g of games || []) {
      const k = teamKey(g);
      if (!k) continue;
      let t = m.get(k);
      if (!t) m.set(k, t = { key: k, species: k.split("/"), games: 0, w: 0, l: 0, lastTs: 0 });
      t.games++;
      if (g.result === "win") t.w++;
      else if (g.result === "loss") t.l++;
      t.lastTs = Math.max(t.lastTs, g.ts || 0);
    }
    return [...m.values()].sort((a, b) => b.lastTs - a.lastTs);
  }
  function filterGames(games, f) {
    const q = f || {};
    const opps = q.opp ? (Array.isArray(q.opp) ? q.opp : [q.opp]).map(keyOf) : [];
    return (games || []).filter((g) => {
      if (q.result && g.result !== q.result) return false;
      if (q.format && g.format !== q.format) return false;
      if (q.from && !(g.ts >= q.from)) return false;
      if (q.to && !(g.ts <= q.to)) return false;
      if (q.bo3Only && !g.bo3) return false;
      if (q.reviewed !== void 0 && q.reviewed !== null && q.reviewed !== "" && !!g.reviewed !== !!q.reviewed) return false;
      if (q.setId && g.setId !== q.setId) return false;
      if (q.team && teamKey(g) !== q.team) return false;
      if (opps.length) {
        const theirs = keys(g.roster && g.roster[oppSide(g)]);
        if (!opps.every((o) => theirs.includes(o))) return false;
      }
      return true;
    });
  }
  function summary(games) {
    const r = record(games);
    return { total: (games || []).length, ...r, other: (games || []).length - r.n };
  }
  function listFormats(games) {
    const m = /* @__PURE__ */ new Map();
    for (const g of games || []) if (g.format) m.set(g.format, (m.get(g.format) || 0) + 1);
    return [...m].map(([format, n]) => ({ format, games: n })).sort((a, b) => b.games - a.games);
  }
  function bump(map, k, init) {
    let v = map.get(k);
    if (!v) map.set(k, v = init());
    return v;
  }
  function nameBook() {
    const m = /* @__PURE__ */ new Map();
    return { note: (k, name) => {
      if (!m.has(k)) m.set(k, name);
    }, get: (k) => m.get(k) || k };
  }
  function usage(games) {
    const rows = /* @__PURE__ */ new Map();
    const names = nameBook();
    const dec = (games || []).filter(isDecided);
    const mk = () => ({
      on: 0,
      brought: 0,
      lead: 0,
      mega: 0,
      tera: 0,
      onW: 0,
      broughtW: 0,
      leadW: 0,
      megaW: 0,
      teraW: 0,
      megaForme: null,
      teraTypes: {}
    });
    for (const g of dec) {
      const s = side(g);
      const win = g.result === "win" ? 1 : 0;
      for (const r of g.roster[s] || []) names.note(keyOf(r.species), r.species);
      for (const k of keys(g.roster[s])) {
        const r = bump(rows, k, mk);
        r.on++;
        r.onW += win;
      }
      const sets = { brought: keys(g.picks[s]), lead: keys(g.leads[s]), mega: keys(g.mega[s]), tera: keys(g.tera[s]) };
      for (const [field2, list] of Object.entries(sets)) {
        for (const k of list) {
          const r = bump(rows, k, mk);
          r[field2]++;
          r[field2 + "W"] += win;
        }
      }
      for (const m of g.mega[s] || []) bump(rows, keyOf(m.species), mk).megaForme = m.forme;
      for (const t of g.tera[s] || []) {
        const r = bump(rows, keyOf(t.species), mk);
        r.teraTypes[t.type] = (r.teraTypes[t.type] || 0) + 1;
      }
    }
    const out = [...rows].map(([k, r]) => ({
      key: k,
      species: names.get(k),
      on: r.on,
      brought: r.brought,
      broughtPct: r.on ? r.brought / r.on : null,
      win: rec(r.broughtW, r.brought - r.broughtW),
      lead: r.lead,
      leadPct: r.brought ? r.lead / r.brought : null,
      leadWin: rec(r.leadW, r.lead - r.leadW),
      mega: r.mega,
      megaPct: r.brought ? r.mega / r.brought : null,
      megaWin: rec(r.megaW, r.mega - r.megaW),
      megaForme: r.megaForme,
      tera: r.tera,
      teraPct: r.brought ? r.tera / r.brought : null,
      teraWin: rec(r.teraW, r.tera - r.teraW),
      teraTypes: r.teraTypes
    }));
    out.sort((a, b) => b.brought - a.brought || b.on - a.on || a.species.localeCompare(b.species));
    return { games: dec.length, rows: out };
  }
  function leadPairs(games) {
    const m = /* @__PURE__ */ new Map();
    for (const g of (games || []).filter(isDecided)) {
      const lead = [...new Set((g.leads[side(g)] || []).map(keyOf))];
      if (lead.length < 2) continue;
      const pair = lead.slice(0, 2).sort();
      const r = bump(m, pair.join("/"), () => ({ pair, w: 0, l: 0 }));
      if (g.result === "win") r.w++;
      else r.l++;
    }
    return [...m].map(([key, r]) => ({ key, pair: r.pair, ...rec(r.w, r.l) }));
  }
  var mostCommonLeads = (games, limit = 6) => leadPairs(games).sort((a, b) => b.n - a.n || b.w - a.w).slice(0, limit);
  function bestLeads(games, { minN = 2, limit = 6 } = {}) {
    return leadPairs(games).filter((r) => r.n >= minN).sort((a, b) => b.lo - a.lo || b.n - a.n).slice(0, limit);
  }
  function opposing(games) {
    const rows = /* @__PURE__ */ new Map();
    const names = nameBook();
    const dec = (games || []).filter(isDecided);
    for (const g of dec) {
      const o = oppSide(g);
      const win = g.result === "win";
      for (const r of g.roster[o] || []) names.note(keyOf(r.species), r.species);
      const brought = new Set(keys(g.picks[o]));
      for (const k of keys(g.roster[o])) {
        const r = bump(rows, k, () => ({ on: 0, brought: 0, w: 0, l: 0, bw: 0, bl: 0 }));
        r.on++;
        if (win) r.w++;
        else r.l++;
        if (brought.has(k)) {
          r.brought++;
          if (win) r.bw++;
          else r.bl++;
        }
      }
    }
    const out = [...rows].map(([k, r]) => ({
      key: k,
      species: names.get(k),
      on: r.on,
      brought: r.brought,
      attendance: r.on ? r.brought / r.on : null,
      against: r.on,
      ...rec(r.w, r.l),
      broughtWin: rec(r.bw, r.bl)
    }));
    out.sort((a, b) => b.against - a.against || a.species.localeCompare(b.species));
    return { games: dec.length, rows: out };
  }
  function bestWorst(rows, { minN = DEFAULT_MIN_MATCHUP, limit = 5 } = {}) {
    const ok = (rows || []).filter((r) => r.n >= minN);
    const best = [...ok].sort((a, b) => b.lo - a.lo || b.n - a.n).slice(0, limit);
    const worst = [...ok].sort((a, b) => a.hi - b.hi || b.n - a.n).slice(0, limit);
    return { best, worst };
  }
  function attendanceRanks(rows, { minN = DEFAULT_MIN_MATCHUP, limit = 5 } = {}) {
    const ok = (rows || []).filter((r) => r.on >= minN);
    return {
      high: [...ok].sort((a, b) => b.attendance - a.attendance || b.on - a.on).slice(0, limit),
      low: [...ok].sort((a, b) => a.attendance - b.attendance || b.on - a.on).slice(0, limit)
    };
  }
  function customQuery(games, speciesList) {
    const list = [...new Set((speciesList || []).map(keyOf))];
    const dec = (games || []).filter(isDecided);
    const slots = list.map((k) => {
      const hit = dec.filter((g) => keys(g.roster[oppSide(g)]).includes(k));
      return { key: k, ...record(hit) };
    });
    const hitAll = list.length ? dec.filter((g) => {
      const t = keys(g.roster[oppSide(g)]);
      return list.every((k) => t.includes(k));
    }) : [];
    const withData = slots.filter((s) => s.n);
    return {
      slots,
      all: list.length ? record(hitAll) : null,
      mean: withData.length ? withData.reduce((a, s) => a + s.rate, 0) / withData.length : null
    };
  }
  function moveUsage(games, who = "me") {
    const rows = /* @__PURE__ */ new Map();
    const names = nameBook();
    for (const g of (games || []).filter((g2) => g2.result === "win" || g2.result === "loss")) {
      const s = who === "opp" ? oppSide(g) : side(g);
      const sheet = /* @__PURE__ */ new Map();
      for (const t of g.teams && g.teams[s] || []) sheet.set(keyOf(t.species), new Set((t.moves || []).map(toID)));
      for (const [sp, mv] of Object.entries(g.moves && g.moves[s] || {})) {
        const k = keyOf(sp);
        names.note(k, sp);
        const r = bump(rows, k, () => ({ games: 0, sheetGames: 0, moves: /* @__PURE__ */ new Map(), setMoves: /* @__PURE__ */ new Set() }));
        r.games++;
        const set = sheet.get(k);
        if (set) {
          r.sheetGames++;
          set.forEach((x) => r.setMoves.add(x));
        }
        for (const [move, n] of Object.entries(mv)) {
          const m = bump(r.moves, move, () => ({ move, count: 0, games: 0 }));
          m.count += n;
          m.games++;
        }
      }
    }
    const out = [...rows].map(([k, r]) => {
      const moves = [...r.moves.values()].map((m) => ({
        ...m,
        inSet: r.sheetGames ? r.setMoves.has(toID(m.move)) : null
      }));
      moves.sort((a, b) => b.count - a.count || a.move.localeCompare(b.move));
      const total = moves.reduce((a, m) => a + m.count, 0);
      return { key: k, species: names.get(k), games: r.games, sheetGames: r.sheetGames, total, moves: moves.map((m) => ({ ...m, pct: total ? m.count / total : 0 })) };
    });
    out.sort((a, b) => b.games - a.games || a.species.localeCompare(b.species));
    return out;
  }
  function buildSets(games) {
    const m = /* @__PURE__ */ new Map();
    for (const g of games || []) {
      if (!g.setId) continue;
      bump(m, g.setId, () => []).push(g);
    }
    const out = [];
    for (const [id, list] of m) {
      list.sort((a, b) => (a.gameNumber || 0) - (b.gameNumber || 0));
      const bestOf = list[0].bo3 && list[0].bo3.bestOf || 3;
      const need = Math.floor(bestOf / 2) + 1;
      const wins = list.filter((g) => g.result === "win").length;
      const losses = list.filter((g) => g.result === "loss").length;
      const nums = list.map((g) => g.gameNumber || 0);
      const missing = [];
      for (let n = 1; n <= Math.max(...nums); n++) if (!nums.includes(n)) missing.push(n);
      let rating = null;
      for (let i = list.length - 1; i >= 0 && !rating; i--) {
        const g = list[i];
        const r = g.ratings && g.ratings[side(g)];
        if (r && typeof r.before === "number" && typeof r.after === "number") rating = r;
      }
      out.push({
        id,
        format: list[0].format,
        ts: Math.max(...list.map((g) => g.ts || 0)),
        opp: list[0].players && list[0].players[oppSide(list[0])] && list[0].players[oppSide(list[0])].name || "",
        games: list,
        bestOf,
        wins,
        losses,
        result: wins >= need ? "win" : losses >= need ? "loss" : null,
        complete: wins >= need || losses >= need,
        missing,
        ratingBefore: rating ? rating.before : null,
        ratingAfter: rating ? rating.after : null,
        ratingDelta: rating ? rating.after - rating.before : null
      });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  // src/ui/components.js
  var DOC = typeof document !== "undefined" ? document : null;
  function setDoc(doc) {
    DOC = doc;
  }
  var getWin = () => DOC && DOC.defaultView || (typeof window !== "undefined" ? window : null);
  function h(tag, props, ...children) {
    const el = DOC.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v === null || v === void 0) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else if (k === "style") {
        if (typeof v === "string") el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    const add = (c) => {
      if (Array.isArray(c)) c.forEach(add);
      else if (c === null || c === void 0 || c === false) return;
      else el.appendChild(typeof c === "object" ? c : DOC.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }
  var clear = (el) => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  var pct = (x, digits = 0) => x === null || x === void 0 || Number.isNaN(x) ? "-" : (x * 100).toFixed(digits) + "%";
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function fmtDateTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return `${fmtDate(ts)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function shortFormat(f) {
    return String(f || "").replace(/^\[[^\]]*\]\s*/, "") || String(f || "");
  }
  function replayUrl(g) {
    if (g.replayUrl) return g.replayUrl;
    return g.roomid ? "https://replay.pokemonshowdown.com/" + String(g.roomid).replace(/^battle-/, "") : "";
  }
  var HYPHEN_BASES2 = ["Ho-Oh", "Porygon-Z", "Jangmo-o", "Hakamo-o", "Kommo-o", "Type: Null", "Wo-Chien", "Chien-Pao", "Ting-Lu", "Chi-Yu"];
  function spriteIds(species) {
    const s = String(species || "");
    const lower = s.toLowerCase();
    const hb = HYPHEN_BASES2.find((b) => lower === b.toLowerCase() || lower.indexOf(b.toLowerCase() + "-") === 0);
    const baseName = hb || s.split("-")[0];
    const rest = s.slice(baseName.length + 1);
    const base = toID(baseName);
    return rest ? [`${base}-${toID(rest)}`, base] : [base];
  }
  function pokeIcon(species, opts) {
    const o = opts || {};
    const win = getWin();
    const dex = win && win.Dex;
    const name = String(species || "?");
    const cls = "sa-icon" + (o.brought === false ? " sa-dim" : "") + (o.lead ? " sa-lead" : "");
    const wrap2 = h("span", { class: "sa-iconwrap", title: o.title || name }, [], o.mega ? h("span", { class: "sa-badge-m", text: "M" }) : null);
    let icon;
    const textFallback = () => h("span", { class: cls + " sa-icon-text", text: name.slice(0, 7) });
    if (dex && typeof dex.getPokemonIcon === "function") {
      icon = h("span", { class: cls, role: "img", "aria-label": name });
      try {
        icon.style.cssText = dex.getPokemonIcon(name);
      } catch (e) {
        icon = textFallback();
      }
    } else if (species) {
      const ids = spriteIds(name);
      let i = 0;
      icon = h("img", { class: cls + " sa-icon-img", alt: name, loading: "lazy", src: `https://play.pokemonshowdown.com/sprites/dex/${ids[0]}.png` });
      icon.addEventListener("error", () => {
        i++;
        if (i < ids.length) icon.src = `https://play.pokemonshowdown.com/sprites/dex/${ids[i]}.png`;
        else if (icon.parentNode) icon.parentNode.replaceChild(textFallback(), icon);
      });
    } else icon = textFallback();
    wrap2.insertBefore(icon, wrap2.firstChild);
    return wrap2;
  }
  function iconRow(items, cls) {
    return h("span", { class: "sa-icons " + (cls || "") }, (items || []).map((i) => typeof i === "string" ? pokeIcon(i) : pokeIcon(i.species, i)));
  }
  function winRate(r, minN, opts) {
    const o = opts || {};
    if (!r || !r.n) return h("span", { class: "sa-wr sa-wr-none", title: "No games" }, h("span", { class: "sa-wr-pct", text: "-" }), o.compact ? null : h("span", { class: "sa-wr-n", text: "0 games" }));
    const iv = r.lo !== void 0 ? r : { ...r, ...wilson(r.w, r.n) };
    const low = r.n < (minN || 0);
    const tone = r.rate >= 0.6 ? "good" : r.rate >= 0.4 ? "mid" : "bad";
    return h(
      "span",
      {
        class: `sa-wr sa-tone-${tone}${low ? " sa-lowN" : ""}`,
        title: `${r.w}-${r.l} (${r.n} games). 95% interval ${pct(iv.lo)} to ${pct(iv.hi)}${low ? `. Small sample (under ${minN})` : ""}`
      },
      h("span", { class: "sa-wr-pct", text: pct(r.rate) }),
      o.compact ? null : h("span", { class: "sa-wr-n", text: `${r.w}-${r.l}${low ? " low N" : ""}` })
    );
  }
  function resultBadge(result) {
    const t = result === "win" ? "W" : result === "loss" ? "L" : result === "tie" ? "T" : "?";
    return h("span", { class: `sa-result sa-result-${result || "unknown"}`, title: result || "unknown", text: t });
  }
  function stat(label, value, sub) {
    return h("div", { class: "sa-stat" }, h("div", { class: "sa-stat-label", text: label }), h("div", { class: "sa-stat-value" }, value), sub ? h("div", { class: "sa-stat-sub" }, sub) : null);
  }
  function chip(text, props) {
    return h("span", { class: "sa-chip", ...props || {} }, text);
  }
  function btn(label, onclick, props) {
    const p = props || {};
    return h("button", { type: "button", class: "sa-btn" + (p.primary ? " sa-primary" : "") + (p.danger ? " sa-danger" : "") + (p.class ? " " + p.class : ""), onclick, disabled: p.disabled, title: p.title, "aria-pressed": p.pressed === void 0 ? false : String(p.pressed) }, label);
  }
  function emptyState(title, body, action) {
    return h("div", { class: "sa-empty" }, h("div", { class: "sa-empty-title", text: title }), h("p", { text: body }), action || null);
  }
  function sectionTitle(text, sub) {
    return h("h3", { class: "sa-h3" }, text, sub ? h("span", { class: "sa-h3-sub", text: sub }) : null);
  }

  // src/ui/style.css.js
  var STYLE_ID = "sa-ui-style";
  var R = "#" + ROOT_ID;
  var CSS = `
${R}{
  --sa-fg:#222; --sa-muted:#6b6b6b; --sa-border:rgba(0,0,0,.16); --sa-card:rgba(0,0,0,.035); --sa-card2:rgba(0,0,0,.07);
  --sa-accent:#2f66ad; --sa-accent-fg:#fff; --sa-good:#237a36; --sa-mid:#8a6400; --sa-bad:#b3261e; --sa-input:#fff;
  --sa-warn-bg:#fff4d6;
  position:relative; box-sizing:border-box; padding:8px 10px 24px; color:var(--sa-fg); font-size:12px; line-height:1.45; font-family:inherit;
  text-align:left; max-width:100%; overflow-x:hidden;
}
html.dark ${R}{
  color-scheme:dark;
  --sa-fg:#e6e6e6; --sa-muted:#a0a0a0; --sa-border:rgba(255,255,255,.2); --sa-card:rgba(255,255,255,.06); --sa-card2:rgba(255,255,255,.12);
  --sa-accent:#6ea6f0; --sa-accent-fg:#0b1a2e; --sa-good:#5fcf7a; --sa-mid:#e5b84a; --sa-bad:#ff7b72; --sa-input:#1e2126;
  --sa-warn-bg:#3a3217;
}
${R} *, ${R} *::before, ${R} *::after{box-sizing:border-box}
${R} h2, ${R} h3, ${R} h4, ${R} p{margin:0; font-weight:bold; color:inherit; text-shadow:none; border:0; padding:0}
${R} p{font-weight:normal}
${R} .sa-h3{font-size:13px; margin:14px 0 6px; display:flex; align-items:baseline; gap:6px; flex-wrap:wrap}
${R} .sa-h3-sub{font-size:11px; font-weight:normal; color:var(--sa-muted)}
${R} .sa-muted{color:var(--sa-muted)}
${R} button, ${R} input, ${R} select, ${R} textarea{font:inherit; font-size:12px; color:var(--sa-fg); margin:0; text-shadow:none; box-shadow:none; border-radius:4px; max-width:100%}
${R} input, ${R} select, ${R} textarea{background:var(--sa-input); border:1px solid var(--sa-border); padding:4px 6px; min-height:28px; height:auto; width:auto}
${R} textarea{width:100%; min-height:60px; resize:vertical; display:block}
${R} input:focus-visible, ${R} select:focus-visible, ${R} textarea:focus-visible, ${R} button:focus-visible, ${R} a:focus-visible, ${R} summary:focus-visible, ${R} [tabindex]:focus-visible{outline:2px solid var(--sa-accent); outline-offset:1px}
${R} a{color:var(--sa-accent)}
${R} .sa-btn{background:var(--sa-card); border:1px solid var(--sa-border); padding:4px 10px; min-height:28px; cursor:pointer; line-height:1.2; text-shadow:none; background-image:none; width:auto; height:auto; float:none}
${R} .sa-btn:hover{background:var(--sa-card2)}
${R} .sa-btn:disabled{opacity:.5; cursor:default}
${R} .sa-btn.sa-primary, ${R} .sa-tab[aria-selected=true]{background:var(--sa-accent); border-color:var(--sa-accent); color:var(--sa-accent-fg); font-weight:bold}
${R} .sa-btn.sa-danger{color:var(--sa-bad); border-color:var(--sa-bad)}
${R} .sa-btn.sa-danger.sa-armed{background:var(--sa-bad); color:#fff}
${R} .sa-btn.sa-small{padding:1px 6px; min-height:22px}

/* navigation: horizontally scrollable row so it works at 360px */
${R} .sa-nav{display:flex; gap:4px; overflow-x:auto; padding-bottom:4px; margin-bottom:6px; scrollbar-width:thin}
${R} .sa-tab{flex:0 0 auto}
${R} .sa-status{display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11px; color:var(--sa-muted); margin:2px 0 6px}
${R} .sa-live{color:var(--sa-accent); font-weight:bold}
${R} .sa-banner{background:var(--sa-warn-bg); border:1px solid var(--sa-border); border-radius:4px; padding:6px 8px; margin:6px 0; font-size:11px}

/* filters */
${R} .sa-filterbar{margin:4px 0 8px}
${R} .sa-filterhead{display:flex; gap:6px; align-items:center; flex-wrap:wrap}
${R} .sa-filterpanel{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:6px 10px; margin-top:6px; padding:8px; background:var(--sa-card); border:1px solid var(--sa-border); border-radius:6px}
${R} .sa-field{display:flex; flex-direction:column; gap:2px; min-width:0}
${R} .sa-field > span{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.04em}
${R} .sa-field input, ${R} .sa-field select{width:100%}
${R} .sa-field-wide{grid-column:1/-1}
${R} .sa-check{flex-direction:row; align-items:center; gap:6px}
${R} .sa-field.sa-check > span{font-size:12px; color:var(--sa-fg); text-transform:none; letter-spacing:0}
${R} .sa-check input{min-height:0; width:auto}
${R} .sa-chips{display:flex; flex-wrap:wrap; gap:4px; align-items:center}
${R} .sa-chip{display:inline-flex; align-items:center; gap:4px; background:var(--sa-card2); border-radius:10px; padding:1px 8px; font-size:11px; line-height:1.5}
${R} .sa-chip button{background:none; border:0; padding:0 2px; min-height:0; cursor:pointer; color:inherit; font-size:13px; line-height:1}

/* summary tiles */
${R} .sa-tiles{display:grid; grid-template-columns:repeat(auto-fit,minmax(78px,1fr)); gap:6px; margin:4px 0 8px}
${R} .sa-stat{background:var(--sa-card); border-radius:6px; padding:6px 8px; min-width:0}
${R} .sa-stat-label{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.04em}
${R} .sa-stat-value{font-size:16px; font-weight:bold}
${R} .sa-stat-sub{font-size:10px; color:var(--sa-muted)}

/* cards and lists */
${R} .sa-list{display:flex; flex-direction:column; gap:6px; padding:0; margin:0; list-style:none}
${R} .sa-card{background:var(--sa-card); border:1px solid var(--sa-border); border-radius:6px; padding:8px; min-width:0}
${R} .sa-card.sa-click{cursor:pointer}
${R} .sa-card.sa-click:hover{border-color:var(--sa-accent)}
${R} .sa-row{display:flex; align-items:center; gap:6px; flex-wrap:wrap; min-width:0}
${R} .sa-row .sa-grow{flex:1 1 80px; min-width:0}
${R} .sa-title{font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
${R} .sa-sub{font-size:11px; color:var(--sa-muted)}
${R} .sa-teamline{display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:4px}
${R} .sa-teamline .sa-lbl{font-size:10px; color:var(--sa-muted); width:28px; flex:0 0 28px; text-transform:uppercase}
${R} .sa-result{display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:4px; font-weight:bold; font-size:12px; flex:0 0 22px; color:#fff}
${R} .sa-result-win{background:var(--sa-good)} ${R} .sa-result-loss{background:var(--sa-bad)}
${R} .sa-result-tie, ${R} .sa-result-unknown{background:var(--sa-muted)}
html.dark ${R} .sa-result{color:#0b1a2e}
${R} .sa-pill{display:inline-block; border:1px solid var(--sa-border); border-radius:10px; padding:0 7px; font-size:10px; color:var(--sa-muted); white-space:nowrap}
${R} .sa-pill.sa-pill-good{color:var(--sa-good); border-color:var(--sa-good)}
${R} .sa-pill.sa-pill-bad{color:var(--sa-bad); border-color:var(--sa-bad)}
${R} .sa-pill.sa-pill-mid{color:var(--sa-mid); border-color:var(--sa-mid)}
${R} .sa-delta-up{color:var(--sa-good)} ${R} .sa-delta-down{color:var(--sa-bad)}

/* pokemon icons: the client sheet icon is 40x30 */
${R} .sa-icons{display:inline-flex; flex-wrap:wrap; gap:0}
${R} .sa-iconwrap{position:relative; display:inline-block; width:40px; height:30px; flex:0 0 40px}
${R} .sa-icon{display:inline-block; width:40px; height:30px; vertical-align:top}
${R} .sa-icon-img{object-fit:contain; background:none; border:0; padding:0; margin:0; max-width:40px}
${R} .sa-icon-text{font-size:9px; line-height:30px; text-align:center; overflow:hidden; color:var(--sa-muted)}
${R} .sa-dim{opacity:.35; filter:grayscale(1)}
${R} .sa-iconwrap:has(.sa-lead)::after{content:'';position:absolute;left:6px;right:6px;bottom:-1px;height:2px;border-radius:1px;background:var(--sa-accent)}
${R} .sa-badge-m{position:absolute; right:1px; bottom:0; background:var(--sa-accent); color:var(--sa-accent-fg); font-size:8px; font-weight:bold; line-height:10px; padding:0 2px; border-radius:2px}

/* win rate */
${R} .sa-wr{display:inline-flex; align-items:baseline; gap:4px; white-space:nowrap}
${R} .sa-wr-pct{font-weight:bold}
${R} .sa-wr-n{font-size:10px; color:var(--sa-muted)}
${R} .sa-tone-good .sa-wr-pct{color:var(--sa-good)} ${R} .sa-tone-mid .sa-wr-pct{color:var(--sa-mid)} ${R} .sa-tone-bad .sa-wr-pct{color:var(--sa-bad)}
${R} .sa-lowN{opacity:.55}
${R} .sa-lowN .sa-wr-pct{font-weight:normal; font-style:italic}

/* stat cards (usage / matchups) */
${R} .sa-statgrid{display:grid; grid-template-columns:repeat(auto-fit,minmax(92px,1fr)); gap:4px 10px; margin-top:6px}
${R} .sa-statgrid .sa-cell-label{font-size:10px; color:var(--sa-muted); text-transform:uppercase; letter-spacing:.03em}
${R} .sa-statgrid .sa-cell-val{font-size:12px}
${R} .sa-bar{height:4px; background:var(--sa-card2); border-radius:2px; overflow:hidden; margin-top:2px}
${R} .sa-bar > i{display:block; height:100%; background:var(--sa-accent)}
${R} .sa-cols{display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:6px}
${R} .sa-mini{display:flex; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid var(--sa-border)}
${R} .sa-mini .sa-grow{flex:1 1 auto; min-width:0}
${R} .sa-mini:last-child{border-bottom:0}

/* moves */
${R} .sa-moverow{display:grid; grid-template-columns:minmax(80px,1.2fr) 2fr auto; gap:6px; align-items:center; padding:1px 0}
${R} .sa-moverow .sa-bar{margin:0; height:8px}
${R} .sa-move-in .sa-bar > i{background:var(--sa-good)} ${R} .sa-move-out .sa-bar > i{background:var(--sa-bad)} ${R} .sa-move-unk .sa-bar > i{background:var(--sa-accent)}
${R} .sa-move-out .sa-moveName{color:var(--sa-bad)}

/* detail */
${R} .sa-sheets{display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px}
${R} .sa-mon{display:flex; gap:6px; padding:4px 0; border-bottom:1px solid var(--sa-border)}
${R} .sa-mon:last-child{border-bottom:0}
${R} .sa-mon-body{min-width:0; flex:1}
${R} .sa-mon-moves{font-size:11px; color:var(--sa-muted)}
${R} .sa-mon-moves b{color:var(--sa-fg)}
${R} .sa-tags{display:flex; gap:4px; flex-wrap:wrap; margin:2px 0}
${R} .sa-setgame{display:flex; gap:6px; align-items:center; flex-wrap:wrap; padding:4px 0; border-top:1px solid var(--sa-border); cursor:pointer}
${R} .sa-setgame.sa-notplayed{cursor:default; color:var(--sa-muted)}

/* empty + misc */
${R} .sa-empty{text-align:center; padding:28px 12px; color:var(--sa-muted)}
${R} .sa-empty-title{font-size:14px; font-weight:bold; color:var(--sa-fg); margin-bottom:6px}
${R} .sa-empty p{margin:0 0 10px}
${R} .sa-errors{background:var(--sa-warn-bg); padding:4px 8px; font-size:11px; border-radius:4px}
${R} .sa-settings label.sa-field{margin:6px 0}
${R} .sa-note{font-size:11px; color:var(--sa-muted); margin:2px 0 6px}
${R} .sa-scroll{overflow-x:auto}
${R} .sa-sr{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}
@media (max-width:420px){
  ${R}{padding:6px 6px 20px}
  ${R} .sa-statgrid{grid-template-columns:repeat(3,1fr)}
}
`;
  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const el = doc.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(el);
  }

  // src/ui/filters.js
  var CURRENT_TEAM = "@current";
  var DEFAULT_FILTERS = { result: "", format: "", from: "", to: "", team: CURRENT_TEAM, opp: [], bo3Only: false, reviewed: "" };
  function toQuery(f) {
    const q = { ...f };
    q.from = f.from ? (/* @__PURE__ */ new Date(f.from + "T00:00:00")).getTime() : void 0;
    q.to = f.to ? (/* @__PURE__ */ new Date(f.to + "T23:59:59.999")).getTime() : void 0;
    q.reviewed = f.reviewed === "yes" ? true : f.reviewed === "no" ? false : void 0;
    q.opp = f.opp && f.opp.length ? f.opp : void 0;
    return q;
  }
  function sanitizeFilters(raw) {
    const f = { ...DEFAULT_FILTERS, ...raw && typeof raw === "object" ? raw : {} };
    f.opp = Array.isArray(f.opp) ? f.opp.filter((x) => typeof x === "string") : [];
    f.bo3Only = !!f.bo3Only;
    for (const k of ["result", "format", "from", "to", "team", "reviewed"]) if (typeof f[k] !== "string") f[k] = "";
    return f;
  }
  function activeCount(f) {
    return ["result", "format", "from", "to", "team", "reviewed"].filter((k) => f[k]).length + (f.opp.length ? 1 : 0) + (f.bo3Only ? 1 : 0);
  }
  function field(label, control, cls) {
    return h("label", { class: "sa-field " + (cls || "") }, h("span", { text: label }), control);
  }
  function select(value, options, onchange) {
    const s = h("select", { onchange: (e) => onchange(e.target.value) }, options.map(([v, label]) => h("option", { value: v, text: label })));
    s.value = value;
    return s;
  }
  function renderFilterBar(ctx) {
    const f = ctx.filters;
    const n = activeCount(f);
    const head = h(
      "div",
      { class: "sa-filterhead" },
      h("button", { type: "button", class: "sa-btn", "aria-expanded": String(!!ctx.open), onclick: ctx.toggle }, `Filters${n ? ` (${n})` : ""} ${ctx.open ? "\u25B4" : "\u25BE"}`),
      n ? btn("Clear", ctx.clear, { class: "sa-small" }) : null,
      !ctx.open && n ? h("span", { class: "sa-chips" }, activeChips(f, ctx)) : null
    );
    if (!ctx.open) return h("div", { class: "sa-filterbar" }, head);
    const listId = "sa-opp-list";
    const oppInput = h("input", { type: "text", list: listId, placeholder: "Add Pokemon (opp team has...)", "aria-label": "Opposing Pokemon" });
    const addOpp = () => {
      const raw = oppInput.value.trim();
      if (!raw) return;
      const hit = ctx.oppSpecies.find((s) => keyOf(s).toLowerCase() === keyOf(raw).toLowerCase()) || raw;
      oppInput.value = "";
      if (!f.opp.some((x) => keyOf(x) === keyOf(hit))) ctx.set({ opp: [...f.opp, hit] });
    };
    oppInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addOpp();
      }
    });
    oppInput.addEventListener("change", addOpp);
    const panel = h(
      "div",
      { class: "sa-filterpanel" },
      field("Result", select(f.result, [["", "All"], ["win", "Wins"], ["loss", "Losses"], ["tie", "Ties"]], (v) => ctx.set({ result: v }))),
      field("Format", select(f.format, [["", "All formats"], ...ctx.formats.map((x) => [x.format, `${shortFormat(x.format)} (${x.games})`])], (v) => ctx.set({ format: v }))),
      field("My team", select(f.team, [[CURRENT_TEAM, "Current team (auto)"], ["", "All teams"], ...ctx.teams.map((t) => [t.key, `${t.species.slice(0, 3).join(", ")}... (${t.games})`])], (v) => ctx.set({ team: v }))),
      field("From", h("input", { type: "date", value: f.from, onchange: (e) => ctx.set({ from: e.target.value }) })),
      field("To", h("input", { type: "date", value: f.to, onchange: (e) => ctx.set({ to: e.target.value }) })),
      ctx.showReviewed ? field("Reviewed", select(f.reviewed, [["", "Any"], ["yes", "Reviewed"], ["no", "Not reviewed"]], (v) => ctx.set({ reviewed: v }))) : null,
      h("label", { class: "sa-field sa-check" }, h("input", { type: "checkbox", checked: f.bo3Only, onchange: (e) => ctx.set({ bo3Only: e.target.checked }) }), h("span", { text: "Best-of-3 only" })),
      h(
        "div",
        { class: "sa-field sa-field-wide" },
        h("span", { text: "Opposing Pokemon" }),
        oppInput,
        h("datalist", { id: listId }, ctx.oppSpecies.map((s) => h("option", { value: s }))),
        f.opp.length ? h("div", { class: "sa-chips", style: "margin-top:4px" }, f.opp.map((s) => chip([s, h("button", { type: "button", "aria-label": "Remove " + s, text: "\xD7", onclick: () => ctx.set({ opp: f.opp.filter((x) => x !== s) }) })]))) : null
      )
    );
    return h("div", { class: "sa-filterbar" }, head, panel);
  }
  function activeChips(f, ctx) {
    const out = [];
    if (f.result) out.push(chip(f.result));
    if (f.format) out.push(chip(shortFormat(f.format)));
    if (f.team) out.push(chip(f.team === CURRENT_TEAM ? "current team" : "team"));
    if (f.from || f.to) out.push(chip(`${f.from || "..."} to ${f.to || "..."}`));
    if (f.reviewed) out.push(chip(f.reviewed === "yes" ? "reviewed" : "not reviewed"));
    if (f.bo3Only) out.push(chip("Bo3"));
    for (const s of f.opp) out.push(chip("vs " + s));
    return out;
  }

  // src/ui/views/games.js
  var SORTS = [["new", "Newest first"], ["old", "Oldest first"], ["result", "Result"], ["opp", "Opponent"]];
  function oppName(g) {
    const p = g.players && g.players[g.opp || "p2"];
    return p && p.name || "Unknown";
  }
  function ratingText(g) {
    const r = g.ratings && g.ratings[g.side || "p1"];
    if (!r || typeof r.before !== "number" || typeof r.after !== "number") return null;
    return { before: r.before, after: r.after, delta: r.after - r.before };
  }
  function teamIcons(g, s) {
    const picks = new Set((g.picks[s] || []).map(keyOf));
    const leads = new Set((g.leads[s] || []).map(keyOf));
    const megas = new Set((g.mega[s] || []).map((m) => keyOf(m.species)));
    const hasPicks = picks.size > 0;
    const items = (g.roster[s] || []).map((r) => {
      const k = keyOf(r.species);
      const mega = (g.mega[s] || []).find((m) => keyOf(m.species) === k);
      return { species: r.species, brought: hasPicks ? picks.has(k) : void 0, lead: leads.has(k), mega: megas.has(k), title: mega ? mega.forme : r.species };
    });
    return iconRow(items);
  }
  function sortGames(list, how) {
    const l = [...list];
    if (how === "old") l.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    else if (how === "result") l.sort((a, b) => String(a.result).localeCompare(String(b.result)) || (b.ts || 0) - (a.ts || 0));
    else if (how === "opp") l.sort((a, b) => oppName(a).localeCompare(oppName(b)) || (b.ts || 0) - (a.ts || 0));
    else l.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return l;
  }
  function gameCard(g, c) {
    const rt = ratingText(g);
    const open = () => c.actions.openGame(g.roomid);
    const subBits = [fmtDate(g.ts), shortFormat(g.format), g.turns ? `${g.turns} turns` : null, g.end && g.end !== "win" ? g.end : null].filter(Boolean);
    return h(
      "li",
      { class: "sa-card sa-click", tabindex: "0", role: "button", "aria-label": `Game vs ${oppName(g)}, ${g.result || "unknown"}. Open details`, onclick: open, onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()) },
      h(
        "div",
        { class: "sa-row" },
        resultBadge(g.result),
        h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: "vs " + oppName(g) }), h("div", { class: "sa-sub", text: subBits.join(" \xB7 ") })),
        g.bo3 ? h("span", { class: "sa-pill", text: `Bo3 G${g.bo3.gameNumber}` }) : null,
        rt ? h("span", { class: "sa-pill " + (rt.delta >= 0 ? "sa-pill-good" : "sa-pill-bad"), text: (rt.delta >= 0 ? "+" : "") + rt.delta }) : null,
        g.reviewed ? h("span", { class: "sa-pill", text: "reviewed" }) : null,
        g.partial ? h("span", { class: "sa-pill sa-pill-mid", title: "Joined mid-game: excluded from stats", text: "partial" }) : null
      ),
      h("div", { class: "sa-teamline" }, h("span", { class: "sa-lbl", text: "Me" }), teamIcons(g, g.side || "p1")),
      h("div", { class: "sa-teamline" }, h("span", { class: "sa-lbl", text: "Opp" }), teamIcons(g, g.opp || "p2")),
      g.notes ? h("div", { class: "sa-sub", style: "margin-top:4px", text: g.notes.length > 140 ? g.notes.slice(0, 140) + "..." : g.notes }) : null
    );
  }
  function renderGames(c) {
    if (c.state.detail) return renderGameDetail(c);
    if (!c.all.length) {
      return emptyState("No games recorded yet", "Play a rated or casual VGC game on Showdown (or spectate one) and it will appear here automatically. Recording starts once you are logged in.");
    }
    const s = summary(c.games);
    const reviewed = c.games.filter((g) => g.reviewed).length;
    const tiles = h(
      "div",
      { class: "sa-tiles" },
      stat("Games", String(s.total), s.other ? `${s.n} decided` : null),
      stat("Record", `${s.w}-${s.l}`),
      stat("Win rate", winRate(s, c.minN, { compact: true }), `N = ${s.n} games`),
      stat("Reviewed", `${reviewed}/${s.total}`)
    );
    if (!c.games.length) return h("div", {}, tiles, emptyState("No games match these filters", "Loosen or clear the filters above.", btn("Clear filters", c.actions.clearFilters)));
    const sort = h("select", { "aria-label": "Sort games", onchange: (e) => {
      c.state.ui.sort = e.target.value;
      c.actions.render();
    } }, SORTS.map(([v, l]) => h("option", { value: v, text: l })));
    sort.value = c.state.ui.sort || "new";
    const shown = sortGames(c.games, sort.value);
    const cap = c.state.ui.gamesCap || 50;
    return h(
      "div",
      {},
      tiles,
      h("div", { class: "sa-row", style: "margin-bottom:6px" }, sort, h("span", { class: "sa-sub", text: `${c.games.length} games` })),
      h("ul", { class: "sa-list" }, shown.slice(0, cap).map((g) => gameCard(g, c))),
      shown.length > cap ? h("div", { style: "margin-top:8px;text-align:center" }, btn(`Show ${Math.min(50, shown.length - cap)} more`, () => {
        c.state.ui.gamesCap = cap + 50;
        c.actions.render();
      })) : null
    );
  }
  function sheetFor(g, s) {
    const sheet = g.teams && g.teams[s] || [];
    if (sheet.length) return sheet.map((t) => ({ ...t, hasSheet: true }));
    return (g.roster[s] || []).map((r) => ({ species: r.species, hasSheet: false }));
  }
  function teamSheet(g, s, label) {
    const picks = new Set((g.picks[s] || []).map(keyOf));
    const leads = new Set((g.leads[s] || []).map(keyOf));
    const megaBy = new Map((g.mega[s] || []).map((m) => [keyOf(m.species), m]));
    const teraBy = new Map((g.tera[s] || []).map((t) => [keyOf(t.species), t]));
    const usedBy = new Map(Object.entries(g.moves && g.moves[s] || {}).map(([sp, m]) => [keyOf(sp), m]));
    const p = g.players && g.players[s];
    const entries = sheetFor(g, s);
    return h(
      "div",
      { class: "sa-card" },
      h("div", { class: "sa-row" }, h("b", { text: label }), h("span", { class: "sa-sub sa-grow", text: p && p.name ? p.name : "" }), p && typeof p.rating === "number" ? h("span", { class: "sa-pill", text: String(p.rating) }) : null),
      entries.length ? entries.map((t) => {
        const k = keyOf(t.species);
        const mega = megaBy.get(k);
        const tera = teraBy.get(k);
        const used = usedBy.get(k) || {};
        const sheetMoves = (t.moves || []).map((m) => m);
        const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, "");
        const extra = Object.keys(used).filter((m) => !sheetMoves.some((sm) => norm(sm) === norm(m)));
        const usedCount = (m) => {
          const key = Object.keys(used).find((u) => norm(u) === norm(m));
          return key ? used[key] : 0;
        };
        return h(
          "div",
          { class: "sa-mon" },
          pokeIcon(mega ? mega.species : t.species, { brought: picks.size ? picks.has(k) : void 0, lead: leads.has(k), mega: !!mega }),
          h(
            "div",
            { class: "sa-mon-body" },
            h("div", { class: "sa-row" }, h("b", { text: mega ? mega.forme : t.species }), picks.has(k) ? h("span", { class: "sa-pill" + (leads.has(k) ? " sa-pill-good" : ""), text: leads.has(k) ? "lead" : "back" }) : picks.size ? h("span", { class: "sa-pill", text: "not brought" }) : null, tera ? h("span", { class: "sa-pill sa-pill-mid", text: "Tera " + tera.type }) : null),
            t.hasSheet ? h("div", { class: "sa-mon-moves", text: [t.item || null, t.ability || null, t.nature || null].filter(Boolean).join(" \xB7 ") }) : null,
            sheetMoves.length || extra.length ? h("div", { class: "sa-mon-moves" }, [
              ...sheetMoves.map((m, i) => [i ? ", " : "", usedCount(m) ? h("b", { text: `${m} x${usedCount(m)}` }) : m]),
              ...extra.map((m) => [", ", h("span", { class: "sa-delta-down", title: "Used but not on the open team sheet", text: `${m} x${used[m]}` })])
            ]) : null
          )
        );
      }) : h("div", { class: "sa-sub", text: "No team data stored." })
    );
  }
  function renderGameDetail(c) {
    const g = c.all.find((x) => x.roomid === c.state.detail);
    if (!g) {
      return h("div", {}, btn("\u2190 Back", c.actions.closeGame), emptyState("Game not found", "It may have been deleted."));
    }
    const me = g.side || "p1";
    const opp = g.opp || "p2";
    const rt = ratingText(g);
    const url = replayUrl(g);
    const reviewed = h("input", { type: "checkbox", checked: !!g.reviewed, onchange: (e) => c.actions.updateGame(g.roomid, { reviewed: e.target.checked }) });
    const notes = h("textarea", { "aria-label": "Game notes", placeholder: "Notes about this game...", value: g.notes || "" });
    notes.addEventListener("blur", () => notes.value !== (g.notes || "") && c.actions.updateGame(g.roomid, { notes: notes.value }));
    const endText = { win: "Played out", forfeit: g.forfeiter ? g.forfeiter === me ? "You forfeited" : "Opponent forfeited" : "Forfeit", inactivity: "Inactivity", tie: "Tie", incomplete: "Incomplete" }[g.end] || g.end;
    return h(
      "div",
      {},
      h("div", { class: "sa-row", style: "margin-bottom:8px" }, btn("\u2190 Back", c.actions.closeGame), h("span", { class: "sa-grow" })),
      h(
        "div",
        { class: "sa-card" },
        h("div", { class: "sa-row" }, resultBadge(g.result), h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: "vs " + oppName(g) }), h("div", { class: "sa-sub", text: `${fmtDateTime(g.ts)} \xB7 ${shortFormat(g.format)}` }))),
        h(
          "div",
          { class: "sa-tiles", style: "margin-top:8px" },
          stat("Turns", String(g.turns || "-"), endText),
          rt ? stat("Rating", `${rt.before} \u2192 ${rt.after}`, h("span", { class: rt.delta >= 0 ? "sa-delta-up" : "sa-delta-down", text: (rt.delta >= 0 ? "+" : "") + rt.delta })) : stat("Rating", "-", g.rated ? "not seen" : "unrated"),
          g.bo3 ? stat("Best of 3", `Game ${g.bo3.gameNumber}`, g.bo3.score ? `score ${g.bo3.score[me]}-${g.bo3.score[opp]} before` : null) : null
        ),
        g.partial ? h("div", { class: "sa-banner", text: "Joined mid-game: lead/pick data may be incomplete and this game is excluded from stats." }) : null,
        h("div", { class: "sa-row", style: "margin-top:6px" }, url ? h("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "Open replay" }) : null, c.actions.saveReplay ? btn("Save replay", () => c.actions.saveReplay(g), { class: "sa-small", title: "Runs /savereplay in the battle room if it is still open" }) : null)
      ),
      h("div", { class: "sa-sheets", style: "margin-top:8px" }, teamSheet(g, me, "Me"), teamSheet(g, opp, "Opponent")),
      h("h3", { class: "sa-h3", text: "Notes" }),
      notes,
      h("label", { class: "sa-field sa-check", style: "margin-top:6px" }, reviewed, h("span", { text: "Reviewed" }))
    );
  }

  // src/ui/views/sets.js
  function picksIcons(g, s) {
    const picks = (g.picks[s] || []).map((sp) => {
      const m = (g.mega[s] || []).find((x) => keyOf(x.species) === keyOf(sp));
      return { species: sp, mega: !!m, lead: (g.leads[s] || []).some((l) => keyOf(l) === keyOf(sp)) };
    });
    return iconRow(picks);
  }
  function setCard(set, c) {
    const rec2 = c.setRecords.get(set.id) || {};
    const tags = rec2.tags || [];
    const status2 = set.result === "win" ? ["Won", "sa-pill-good"] : set.result === "loss" ? ["Lost", "sa-pill-bad"] : ["Incomplete", "sa-pill-mid"];
    const save = (patch) => c.actions.updateSet(set, patch);
    const notes = h("textarea", { "aria-label": "Set notes", placeholder: "Notes about this set...", value: rec2.notes || "" });
    notes.addEventListener("blur", () => notes.value !== (rec2.notes || "") && save({ notes: notes.value }));
    const tagInput = h("input", { type: "text", placeholder: "Add tag, Enter", "aria-label": "Add tag", style: "width:110px" });
    tagInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const t = tagInput.value.trim();
      if (t && !tags.includes(t)) save({ tags: [...tags, t] });
    });
    const maxN = Math.max(set.bestOf, ...set.games.map((g) => g.gameNumber || 0));
    const rows = [];
    for (let n = 1; n <= maxN; n++) {
      const g = set.games.find((x) => x.gameNumber === n);
      if (!g) {
        rows.push(h("div", { class: "sa-setgame sa-notplayed" }, h("span", { class: "sa-pill", text: "G" + n }), h("span", { text: set.missing.includes(n) ? "Not recorded" : "Not played" })));
        continue;
      }
      const open = () => c.actions.openGame(g.roomid);
      rows.push(
        h(
          "div",
          { class: "sa-setgame", tabindex: "0", role: "button", "aria-label": `Game ${n}: ${g.result}. Open details`, onclick: open, onkeydown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()) },
          h("div", { class: "sa-row", style: "width:100%" }, h("span", { class: "sa-pill", text: "G" + n }), resultBadge(g.result), g.end === "forfeit" ? h("span", { class: "sa-pill", text: "forfeit" }) : null),
          h("div", { class: "sa-teamline", style: "width:100%" }, h("span", { class: "sa-lbl", text: "Me" }), picksIcons(g, g.side || "p1")),
          h("div", { class: "sa-teamline", style: "width:100%" }, h("span", { class: "sa-lbl", text: "Opp" }), picksIcons(g, g.opp || "p2"))
        )
      );
    }
    return h(
      "li",
      { class: "sa-card" },
      h(
        "div",
        { class: "sa-row" },
        h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: "vs " + (set.opp || "Unknown") }), h("div", { class: "sa-sub", text: `${fmtDate(set.ts)} \xB7 ${shortFormat(set.format)}` })),
        h("span", { class: "sa-pill " + status2[1], text: `${status2[0]} ${set.wins}-${set.losses}` }),
        set.ratingDelta !== null ? h("span", { class: "sa-pill " + (set.ratingDelta >= 0 ? "sa-pill-good" : "sa-pill-bad"), title: `${set.ratingBefore} to ${set.ratingAfter}`, text: (set.ratingDelta >= 0 ? "+" : "") + set.ratingDelta }) : null
      ),
      h("div", { style: "margin-top:6px" }, rows),
      h("div", { class: "sa-tags", style: "margin-top:6px" }, tags.map((t) => chip([t, h("button", { type: "button", "aria-label": "Remove tag " + t, text: "\xD7", onclick: () => save({ tags: tags.filter((x) => x !== t) }) })])), tagInput),
      notes
    );
  }
  function renderSets(c) {
    if (!c.allSets.length) {
      return emptyState("No best-of-3 sets yet", "Sets appear here when you play a Bo3 ladder or tournament match. Single games show up under Games.");
    }
    const sets = c.sets;
    if (!sets.length) return emptyState("No sets match these filters", "Loosen or clear the filters.", btn("Clear filters", c.actions.clearFilters));
    const done = sets.filter((s) => s.complete);
    const w = done.filter((s) => s.result === "win").length;
    const r = { w, l: done.length - w, n: done.length, rate: done.length ? w / done.length : null };
    const iv = wilson(w, done.length);
    r.lo = iv.lo;
    r.hi = iv.hi;
    return h(
      "div",
      {},
      h("div", { class: "sa-tiles" }, stat("Sets", String(sets.length), `${done.length} complete`), stat("Record", `${w}-${done.length - w}`), stat("Set win rate", winRate(r, c.minN, { compact: true }), `N = ${done.length} sets`)),
      h("ul", { class: "sa-list" }, sets.map((s) => setCard(s, c)))
    );
  }

  // src/ui/views/usage.js
  var SORTS2 = [["used", "Most brought"], ["win", "Win rate (Wilson low bound)"], ["lead", "Most led"], ["name", "Name"]];
  function sortRows(rows, how) {
    const l = [...rows];
    if (how === "win") l.sort((a, b) => b.win.lo - a.win.lo || b.brought - a.brought);
    else if (how === "lead") l.sort((a, b) => b.lead - a.lead || b.brought - a.brought);
    else if (how === "name") l.sort((a, b) => a.species.localeCompare(b.species));
    return l;
  }
  function cell(label, ...value) {
    return h("div", {}, h("div", { class: "sa-cell-label", text: label }), h("div", { class: "sa-cell-val" }, value));
  }
  function monCard(r, c, flags) {
    const minN = c.minN;
    return h(
      "li",
      { class: "sa-card" },
      h(
        "div",
        { class: "sa-row" },
        pokeIcon(r.species),
        h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: r.species }), h("div", { class: "sa-sub", text: `on team ${r.on} game${r.on === 1 ? "" : "s"}` })),
        winRate(r.win, minN)
      ),
      h("div", { class: "sa-bar", title: `Brought ${pct(r.broughtPct)}` }, h("i", { style: { width: pct(r.broughtPct) } })),
      h(
        "div",
        { class: "sa-statgrid" },
        cell("Brought", `${r.brought}/${r.on} `, h("span", { class: "sa-muted", text: `(${pct(r.broughtPct)})` })),
        cell("Lead", `${r.lead} `, h("span", { class: "sa-muted", text: r.brought ? `(${pct(r.leadPct)})` : "" })),
        cell("Lead win", winRate(r.leadWin, minN)),
        flags.mega && r.mega ? cell("Mega", `${r.mega} `, h("span", { class: "sa-muted", text: r.mega ? `(${pct(r.megaPct)})` : "" })) : null,
        flags.mega && r.mega ? cell("Mega win", winRate(r.megaWin, minN)) : null,
        flags.tera && r.tera ? cell("Tera", `${r.tera} `, h("span", { class: "sa-muted", text: r.tera ? `(${pct(r.teraPct)})` : "" })) : null,
        flags.tera && r.tera ? cell("Tera win", winRate(r.teraWin, minN)) : null
      )
    );
  }
  function leadCard(title, rows, minN) {
    return h(
      "div",
      { class: "sa-card" },
      h("b", { text: title }),
      rows.length ? rows.map((r) => h("div", { class: "sa-mini" }, iconRow(r.pair), h("span", { class: "sa-grow sa-sub", text: `${r.n} game${r.n === 1 ? "" : "s"}, ${r.w}-${r.l}` }), winRate(r, minN, { compact: true }))) : h("div", { class: "sa-sub", text: "Not enough games yet." })
    );
  }
  function renderUsage(c) {
    if (!c.all.length) return emptyState("No usage data yet", "Play a few VGC games and your Pokemon usage, lead and Mega stats will build up here.");
    const u = usage(c.games);
    if (!u.games) return emptyState("No decided games match", "Usage counts wins and losses only. Loosen or clear the filters.", btn("Clear filters", c.actions.clearFilters));
    const s = summary(c.games);
    const flags = { mega: u.rows.some((r) => r.mega), tera: u.rows.some((r) => r.tera) };
    const teams = listTeams(c.games);
    const sort = h("select", { "aria-label": "Sort Pokemon", onchange: (e) => {
      c.state.ui.usageSort = e.target.value;
      c.actions.render();
    } }, SORTS2.map(([v, l]) => h("option", { value: v, text: l })));
    sort.value = c.state.ui.usageSort || "used";
    return h(
      "div",
      {},
      h("div", { class: "sa-tiles" }, stat("Games", String(u.games), "decided"), stat("Record", `${s.w}-${s.l}`), stat("Win rate", winRate(s, c.minN, { compact: true }), `N = ${s.n} games`)),
      teams.length > 1 ? h("div", { class: "sa-banner", text: `Stats combine ${teams.length} different teams. Use the My team filter to look at one.` }) : null,
      h("h3", { class: "sa-h3", text: "Leads" }),
      h("div", { class: "sa-cols" }, leadCard("Most common leads", mostCommonLeads(c.games), c.minN), leadCard("Best leads (min 2 games)", bestLeads(c.games), c.minN)),
      h("h3", { class: "sa-h3" }, "Pokemon", h("span", { class: "sa-h3-sub", text: `based on ${u.games} games; faded = under ${c.minN} games` })),
      h("div", { class: "sa-row", style: "margin-bottom:6px" }, sort),
      h("ul", { class: "sa-list" }, sortRows(u.rows, sort.value).map((r) => monCard(r, c, flags)))
    );
  }

  // src/ui/views/matchups.js
  var SORTS3 = [["against", "Most faced"], ["worst", "Worst win rate"], ["best", "Best win rate"], ["att", "Attendance"], ["name", "Name"]];
  function sortRows2(rows, how) {
    const l = [...rows];
    if (how === "worst") l.sort((a, b) => a.hi - b.hi || b.n - a.n);
    else if (how === "best") l.sort((a, b) => b.lo - a.lo || b.n - a.n);
    else if (how === "att") l.sort((a, b) => (b.attendance || 0) - (a.attendance || 0) || b.on - a.on);
    else if (how === "name") l.sort((a, b) => a.species.localeCompare(b.species));
    return l;
  }
  function cell2(label, ...value) {
    return h("div", {}, h("div", { class: "sa-cell-label", text: label }), h("div", { class: "sa-cell-val" }, value));
  }
  function miniList(title, rows, right, minN) {
    return h(
      "div",
      { class: "sa-card" },
      h("b", { text: title }),
      rows.length ? rows.map((r) => h("div", { class: "sa-mini" }, pokeIcon(r.species), h("span", { class: "sa-grow" }, h("div", { text: r.species }), h("div", { class: "sa-sub", text: `${r.on} game${r.on === 1 ? "" : "s"}` })), right(r, minN))) : h("div", { class: "sa-sub", text: "Not enough games yet." })
    );
  }
  function rowCard(r, minN) {
    return h(
      "li",
      { class: "sa-card" },
      h("div", { class: "sa-row" }, pokeIcon(r.species), h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: r.species }), h("div", { class: "sa-sub", text: `faced in ${r.against} game${r.against === 1 ? "" : "s"}` })), winRate(r, minN)),
      h(
        "div",
        { class: "sa-statgrid" },
        cell2("On their team", String(r.on)),
        cell2("Brought", `${r.brought} `, h("span", { class: "sa-muted", text: `(${pct(r.attendance)})` })),
        cell2("Win when brought", winRate(r.broughtWin, minN))
      )
    );
  }
  function customPanel(c, rows) {
    const picked = c.state.ui.query || [];
    const known = rows.map((r) => r.species);
    const input = h("input", { type: "text", list: "sa-q-list", placeholder: picked.length >= 6 ? "Max 6" : "Add opposing Pokemon", "aria-label": "Add Pokemon to query", disabled: picked.length >= 6 });
    const add = () => {
      const v = input.value.trim();
      if (!v) return;
      const hit = known.find((s) => keyOf(s).toLowerCase() === keyOf(v).toLowerCase()) || v;
      if (!picked.some((p) => keyOf(p) === keyOf(hit)) && picked.length < 6) {
        c.state.ui.query = [...picked, hit];
        c.actions.render();
      } else input.value = "";
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), add()));
    input.addEventListener("change", add);
    const q = picked.length ? customQuery(c.games, picked) : null;
    const mm = c.minMatchup;
    return h(
      "div",
      { class: "sa-card" },
      h("div", { class: "sa-sub", text: "Pick 1-6 Pokemon to see how you do against opponents who had them on their team." }),
      h("div", { class: "sa-row", style: "margin:6px 0" }, input, h("datalist", { id: "sa-q-list" }, known.map((s) => h("option", { value: s }))), picked.length ? btn("Clear", () => {
        c.state.ui.query = [];
        c.actions.render();
      }, { class: "sa-small" }) : null),
      picked.length ? h("div", { class: "sa-chips" }, picked.map((s) => chip([s, h("button", { type: "button", "aria-label": "Remove " + s, text: "\xD7", onclick: () => {
        c.state.ui.query = picked.filter((x) => x !== s);
        c.actions.render();
      } })]))) : null,
      q ? h(
        "div",
        { style: "margin-top:8px" },
        q.slots.map((sl, i) => h("div", { class: "sa-mini" }, pokeIcon(picked[i]), h("span", { class: "sa-grow" }, h("div", { text: picked[i] }), h("div", { class: "sa-sub", text: `${sl.n} game${sl.n === 1 ? "" : "s"}, ${sl.w}-${sl.l}` })), winRate(sl, mm, { compact: true }))),
        picked.length > 1 ? h("div", { class: "sa-mini" }, iconRow(picked), h("span", { class: "sa-grow" }, h("div", { text: "All together" }), h("div", { class: "sa-sub", text: `${q.all.n} game${q.all.n === 1 ? "" : "s"} with all on their team` })), winRate(q.all, mm, { compact: true })) : null,
        q.mean !== null && picked.length > 1 ? h("div", { class: "sa-note", text: `Simple average of the slots: ${pct(q.mean)} (ignores overlap between games)` }) : null
      ) : null
    );
  }
  function renderMatchups(c) {
    if (!c.all.length) return emptyState("No matchup data yet", "Every opposing team you face is recorded. Play a few games and this page will show what beats you.");
    const o = opposing(c.games);
    if (!o.games) return emptyState("No decided games match", "Matchups count wins and losses only. Loosen or clear the filters.", btn("Clear filters", c.actions.clearFilters));
    const s = summary(c.games);
    const mm = c.minMatchup;
    const { best, worst } = bestWorst(o.rows, { minN: mm });
    const att = attendanceRanks(o.rows, { minN: mm });
    const sort = h("select", { "aria-label": "Sort opposing Pokemon", onchange: (e) => {
      c.state.ui.mSort = e.target.value;
      c.actions.render();
    } }, SORTS3.map(([v, l]) => h("option", { value: v, text: l })));
    sort.value = c.state.ui.mSort || "against";
    const cap = c.state.ui.mCap || 30;
    const sorted = sortRows2(o.rows, sort.value);
    const wr = (r) => winRate(r, mm, { compact: true });
    const attR = (r) => h("span", { class: "sa-wr" }, h("span", { class: "sa-wr-pct", text: pct(r.attendance) }), h("span", { class: "sa-wr-n", text: `${r.brought}/${r.on}` }));
    return h(
      "div",
      {},
      h("div", { class: "sa-tiles" }, stat("Games", String(o.games), "decided"), stat("Record", `${s.w}-${s.l}`), stat("Opp. Pokemon", String(o.rows.length), "seen")),
      h("h3", { class: "sa-h3" }, "Best and worst", h("span", { class: "sa-h3-sub", text: `min ${mm} games, ranked by Wilson interval` })),
      h("div", { class: "sa-cols" }, miniList("Best matchups", best, wr), miniList("Worst matchups", worst, wr), miniList("Most often brought", att.high, attR), miniList("Least often brought", att.low, attR)),
      h("h3", { class: "sa-h3", text: "Custom team query" }),
      customPanel(c, o.rows),
      h("h3", { class: "sa-h3" }, "All opposing Pokemon", h("span", { class: "sa-h3-sub", text: `faded = under ${mm} games` })),
      h("div", { class: "sa-row", style: "margin-bottom:6px" }, sort),
      h("ul", { class: "sa-list" }, sorted.slice(0, cap).map((r) => rowCard(r, mm))),
      sorted.length > cap ? h("div", { style: "margin-top:8px;text-align:center" }, btn(`Show ${Math.min(30, sorted.length - cap)} more`, () => {
        c.state.ui.mCap = cap + 30;
        c.actions.render();
      })) : null
    );
  }

  // src/ui/views/moves.js
  function monCard2(r) {
    const hasSheet = r.sheetGames > 0;
    return h(
      "li",
      { class: "sa-card" },
      h("div", { class: "sa-row" }, pokeIcon(r.species), h("div", { class: "sa-grow" }, h("div", { class: "sa-title", text: r.species }), h("div", { class: "sa-sub", text: `seen in ${r.games} game${r.games === 1 ? "" : "s"}${hasSheet ? `, team sheet in ${r.sheetGames}` : ", no team sheet"}` }))),
      h(
        "div",
        { style: "margin-top:4px" },
        r.moves.map(
          (m) => h(
            "div",
            { class: "sa-moverow " + (m.inSet === true ? "sa-move-in" : m.inSet === false ? "sa-move-out" : "sa-move-unk"), title: m.inSet === false ? "Not on the open team sheet (set change, called move or a transformed Pokemon)" : "" },
            h("span", { class: "sa-moveName", text: m.move }),
            h("div", { class: "sa-bar" }, h("i", { style: { width: pct(m.pct) } })),
            h("span", { class: "sa-sub", text: `${m.count} (${pct(m.pct)})` })
          )
        )
      )
    );
  }
  function renderMoves(c) {
    if (!c.all.length) return emptyState("No move data yet", "Moves are counted from every game you record. Play a game and your move usage will show here.");
    const who = c.state.ui.movesWho || "me";
    const rows = moveUsage(c.games, who);
    const pick = (w) => () => {
      c.state.ui.movesWho = w;
      c.state.ui.movesCap = 0;
      c.actions.render();
    };
    const toggle = h(
      "div",
      { class: "sa-row", style: "margin-bottom:6px" },
      h("button", { type: "button", class: "sa-btn" + (who === "me" ? " sa-primary" : ""), "aria-pressed": String(who === "me"), onclick: pick("me"), text: "My Pokemon" }),
      h("button", { type: "button", class: "sa-btn" + (who === "opp" ? " sa-primary" : ""), "aria-pressed": String(who === "opp"), onclick: pick("opp"), text: "Opponents" })
    );
    if (!rows.length) return h("div", {}, toggle, emptyState("No games match", "Loosen or clear the filters.", btn("Clear filters", c.actions.clearFilters)));
    const cap = c.state.ui.movesCap || 20;
    return h(
      "div",
      {},
      toggle,
      h("div", { class: "sa-note", text: "Green = on the open team sheet, red = used but not on the sheet, blue = no sheet seen. Moves triggered by another effect (Dancer, Instruct, called moves) are not counted." }),
      h("ul", { class: "sa-list" }, rows.slice(0, cap).map(monCard2)),
      rows.length > cap ? h("div", { style: "margin-top:8px;text-align:center" }, btn(`Show ${Math.min(20, rows.length - cap)} more`, () => {
        c.state.ui.movesCap = cap + 20;
        c.actions.render();
      })) : null
    );
  }

  // src/store/export.js
  var ImportError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "ImportError";
    }
  };
  var isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  async function exportAll(repo) {
    const games = (await repo.listGames()).map((g) => {
      const out = { ...g };
      if (g.rawLog !== void 0) {
        if (g.rawEnc === "gzip") {
          out.rawLog = bytesToBase64(g.rawLog instanceof Uint8Array ? g.rawLog : new Uint8Array(g.rawLog));
          out.rawEnc = "gzip-base64";
        } else {
          out.rawEnc = "plain";
        }
      }
      return out;
    });
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: Date.now(),
      games,
      sets: await repo.listSets(),
      teams: await repo.listTeams(),
      settings: await repo.listSettings()
    };
  }
  function checkList(data, key, idField) {
    if (!Array.isArray(data[key])) throw new ImportError(`Invalid import: "${key}" must be an array`);
    data[key].forEach((r, i) => {
      if (!isObj(r) || typeof r[idField] !== "string" || !r[idField]) {
        throw new ImportError(`Invalid import: ${key}[${i}] is missing a string "${idField}"`);
      }
    });
  }
  function validateImport(input) {
    let data = input;
    if (typeof input === "string") {
      try {
        data = JSON.parse(input);
      } catch (e) {
        throw new ImportError(`Invalid import: not valid JSON (${e.message})`);
      }
    }
    if (!isObj(data)) throw new ImportError("Invalid import: expected a JSON object");
    if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
      throw new ImportError('Invalid import: missing or invalid "schemaVersion"');
    }
    if (data.schemaVersion > SCHEMA_VERSION) {
      throw new ImportError(`Invalid import: schemaVersion ${data.schemaVersion} is newer than this script supports (${SCHEMA_VERSION}); update the script`);
    }
    checkList(data, "games", "roomid");
    checkList(data, "sets", "id");
    checkList(data, "teams", "id");
    checkList(data, "settings", "name");
    const games = data.games.map((g) => {
      if (g.rawLog === void 0) return { ...g };
      if (typeof g.rawLog !== "string") throw new ImportError(`Invalid import: games "${g.roomid}" has a non-string rawLog`);
      if (g.rawEnc === "gzip-base64") {
        let bytes;
        try {
          bytes = base64ToBytes(g.rawLog);
        } catch (e) {
          throw new ImportError(`Invalid import: games "${g.roomid}" rawLog is not valid base64`);
        }
        if (bytes.length < 2 || bytes[0] !== 31 || bytes[1] !== 139) {
          throw new ImportError(`Invalid import: games "${g.roomid}" rawLog is not gzip data`);
        }
        return { ...g, rawLog: bytes, rawEnc: "gzip" };
      }
      if (g.rawEnc !== "plain") throw new ImportError(`Invalid import: games "${g.roomid}" has unknown rawEnc "${g.rawEnc}"`);
      return { ...g };
    });
    return { games, sets: data.sets, teams: data.teams, settings: data.settings };
  }
  function mergeTeam(existing, incoming) {
    const out = mergeRecords(existing, incoming, USER_FIELDS.teams);
    if (existing) {
      out.firstSeen = Math.min(existing.firstSeen ?? Infinity, incoming.firstSeen ?? Infinity);
      out.lastSeen = Math.max(existing.lastSeen ?? 0, incoming.lastSeen ?? 0);
      if (out.firstSeen === Infinity) delete out.firstSeen;
    }
    return out;
  }
  async function importData(repo, input, opts) {
    const mode2 = opts && opts.mode || "merge";
    if (mode2 !== "merge" && mode2 !== "replace") throw new ImportError(`Unknown import mode "${mode2}"`);
    const data = validateImport(input);
    if (mode2 === "replace") {
      await repo.clearAll();
      for (const store of ["games", "sets", "teams", "settings"]) if (data[store].length) await repo.bulkPut(store, data[store]);
    } else {
      const existing = {
        games: new Map((await repo.listGames()).map((r) => [r.roomid, r])),
        sets: new Map((await repo.listSets()).map((r) => [r.id, r])),
        teams: new Map((await repo.listTeams()).map((r) => [r.id, r])),
        settings: new Map((await repo.listSettings()).map((r) => [r.name, r]))
      };
      const keyOf2 = { games: "roomid", sets: "id", teams: "id", settings: "name" };
      for (const store of Object.keys(keyOf2)) {
        const merged = data[store].map((r) => {
          const old = existing[store].get(r[keyOf2[store]]);
          if (!old) return r;
          return store === "teams" ? mergeTeam(old, r) : mergeRecords(old, r, USER_FIELDS[store]);
        });
        if (merged.length) await repo.bulkPut(store, merged);
      }
    }
    return { mode: mode2, games: data.games.length, sets: data.sets.length, teams: data.teams.length, settings: data.settings.length };
  }

  // src/store/download.js
  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e3);
  }

  // src/ui/views/settings.js
  var DEFAULT_TRACKED_FORMATS2 = ["^gen9(champions)?vgc\\d{4}"];
  function renderSettings(c) {
    const ui = c.state.ui;
    const say = (text, kind) => {
      ui.msg = { text, kind: kind || "info" };
      c.actions.render();
    };
    const busy = (fn) => async () => {
      try {
        await fn();
      } catch (err) {
        say("Failed: " + (err && err.message ? err.message : String(err)), "error");
      }
    };
    const formats = h("textarea", { "aria-label": "Tracked formats", rows: 3, value: c.trackedFormats.join("\n") });
    const minSample = h("input", { type: "number", min: 1, max: 100, value: String(c.minN), "aria-label": "Minimum sample for win rates", style: "width:70px" });
    const minMatchup = h("input", { type: "number", min: 1, max: 100, value: String(c.minMatchup), "aria-label": "Minimum sample for matchups", style: "width:70px" });
    const fileInput = h("input", { type: "file", accept: "application/json,.json", "aria-label": "Import file" });
    const mode2 = h("select", { "aria-label": "Import mode" }, h("option", { value: "merge", text: "Merge with existing data" }), h("option", { value: "replace", text: "Replace all data" }));
    const armed = ui.clearArmed;
    return h(
      "div",
      { class: "sa-settings" },
      ui.msg ? h("div", { class: "sa-banner", role: "status", text: ui.msg.text, style: ui.msg.kind === "error" ? "border-color:var(--sa-bad)" : "" }) : null,
      sectionTitle("Recording"),
      h("label", { class: "sa-field" }, h("span", { text: "Tracked formats (one regular expression per line, matched against the format id)" }), formats),
      h("div", { class: "sa-note", text: "Default tracks every VGC format of generation 9 and Champions. Changes apply to new games." }),
      h(
        "div",
        { class: "sa-row" },
        btn("Save formats", busy(async () => {
          const list = formats.value.split("\n").map((s) => s.trim()).filter(Boolean);
          for (const src of list) new RegExp(src, "i");
          await c.actions.saveSetting("trackedFormats", list.length ? list : DEFAULT_TRACKED_FORMATS2);
          say("Tracked formats saved.");
        }), { primary: true }),
        btn("Reset to default", busy(async () => {
          await c.actions.saveSetting("trackedFormats", DEFAULT_TRACKED_FORMATS2);
          say("Tracked formats reset.");
        }))
      ),
      sectionTitle("Statistics"),
      h(
        "div",
        { class: "sa-row" },
        h("label", { class: "sa-field" }, h("span", { text: "Min games (win rates)" }), minSample),
        h("label", { class: "sa-field" }, h("span", { text: "Min games (matchups)" }), minMatchup),
        btn("Save", busy(async () => {
          await c.actions.saveSetting("ui.minSample", Math.max(1, Number(minSample.value) || 5));
          await c.actions.saveSetting("ui.minMatchup", Math.max(1, Number(minMatchup.value) || 3));
          say("Thresholds saved.");
        }))
      ),
      h("div", { class: "sa-note", text: "Win rates from fewer games than this are shown faded. Hover a win rate to see its 95% interval." }),
      sectionTitle("Data", `${c.all.length} games, ${c.allSets.length} sets stored locally`),
      h(
        "div",
        { class: "sa-row" },
        btn("Export JSON", busy(async () => {
          const data = await exportAll(c.repo);
          downloadJson(`showdown-analyzer-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, data);
          say(`Exported ${data.games.length} games.`);
        }), { primary: true })
      ),
      h(
        "div",
        { class: "sa-row", style: "margin-top:8px" },
        fileInput,
        mode2,
        btn("Import", busy(async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return say("Choose a JSON file first.", "error");
          const text = await file.text();
          const r = await importData(c.repo, text, { mode: mode2.value });
          await c.actions.refresh();
          say(`Imported ${r.games} games, ${r.sets} sets (${r.mode}).`);
        }))
      ),
      h("div", { class: "sa-note", text: "Your data lives only in this browser. Export regularly: clearing site data deletes it." }),
      h(
        "div",
        { class: "sa-row", style: "margin-top:8px" },
        btn("Reparse all games", busy(async () => {
          const dex = typeof window !== "undefined" && window.Dex && window.Dex.species ? window.Dex : void 0;
          const r = await c.repo.reparseAll((raw, old) => parseLog(raw, { me: old.me, dex }));
          await c.actions.refresh();
          say(`Reparsed ${r.updated} games${r.failed.length ? `, ${r.failed.length} failed (no raw log or parse error)` : ""}.`, r.failed.length ? "error" : "info");
        }), { title: "Rebuild stats from the stored raw logs after a parser update" }),
        btn(armed ? "Really delete everything?" : "Clear all data", busy(async () => {
          if (!armed) {
            ui.clearArmed = true;
            return c.actions.render();
          }
          ui.clearArmed = false;
          await c.repo.clearAll();
          await c.actions.refresh();
          say("All data deleted.");
        }), { danger: true, class: armed ? "sa-armed" : "" }),
        armed ? btn("Cancel", () => {
          ui.clearArmed = false;
          c.actions.render();
        }) : null
      ),
      sectionTitle("About"),
      h("div", { class: "sa-sub", text: `Showdown Analyzer${c.version ? " " + c.version : ""} \xB7 parser v${PARSER_VERSION} \xB7 store schema v${c.repo.schemaVersion}` })
    );
  }

  // src/ui/app.js
  var SETTING_KEYS = {
    filters: "ui.filters",
    view: "ui.view",
    minSample: "ui.minSample",
    minMatchup: "ui.minMatchup",
    trackedFormats: "trackedFormats"
  };
  var VIEWS = [
    { id: "games", label: "Games", render: renderGames, filters: true, reviewed: true },
    { id: "sets", label: "Sets", render: renderSets, filters: true, reviewed: false },
    { id: "usage", label: "Usage", render: renderUsage, filters: true, reviewed: false },
    { id: "matchups", label: "Matchups", render: renderMatchups, filters: true, reviewed: false },
    { id: "moves", label: "Moves", render: renderMoves, filters: true, reviewed: false },
    { id: "settings", label: "Settings", render: renderSettings, filters: false }
  ];
  var stripRaw = (g) => {
    const { rawLog, rawEnc, ...rest } = g;
    return rest;
  };
  function mountApp(rootEl, opts) {
    const o = opts || {};
    const repo = o.repo;
    if (!rootEl || !repo) throw new Error("mountApp needs a root element and a repo");
    const doc = rootEl.ownerDocument;
    const win = doc.defaultView;
    setDoc(doc);
    if (!rootEl.id) rootEl.id = ROOT_ID;
    injectStyle(doc);
    const state = {
      view: "games",
      detail: null,
      filtersOpen: false,
      filters: { ...DEFAULT_FILTERS },
      ui: {}
    };
    const data = { all: [], setRecords: /* @__PURE__ */ new Map(), allSets: [], formats: [], teams: [], oppSpecies: [], loaded: false, error: null };
    const cfg = { minN: DEFAULT_MIN_SAMPLE, minMatchup: DEFAULT_MIN_MATCHUP, trackedFormats: DEFAULT_TRACKED_FORMATS2 };
    let captureState = typeof o.captureStatus === "function" ? safe(o.captureStatus) : o.captureStatus || null;
    let destroyed = false;
    let dirty = false;
    const timers = {};
    const unsubs = [];
    const nav = h("div", { class: "sa-nav", role: "tablist", "aria-label": "Analyzer views" });
    const status2 = h("div", { class: "sa-status" });
    const filterHost = h("div");
    const content = h("div", { role: "tabpanel", "aria-live": "polite" });
    rootEl.appendChild(h("div", { class: "sa-app" }, nav, status2, filterHost, content));
    function safe(fn) {
      try {
        return fn();
      } catch (e) {
        return null;
      }
    }
    function debounce(key, fn, ms) {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => !destroyed && fn(), ms);
    }
    async function loadData() {
      try {
        const [games, sets] = await Promise.all([repo.listGames(), repo.listSets()]);
        data.all = games.map(stripRaw);
        data.setRecords = new Map(sets.map((s) => [s.id, s]));
        data.allSets = buildSets(data.all);
        data.formats = listFormats(data.all);
        data.teams = listTeams(data.all);
        data.oppSpecies = opposing(data.all).rows.map((r) => r.species).sort();
        data.error = null;
      } catch (err) {
        data.error = err && err.message ? err.message : String(err);
      }
      data.loaded = true;
    }
    async function loadSettings() {
      const get = (k, d) => repo.getSetting(k, d).catch(() => d);
      state.filters = sanitizeFilters(await get(SETTING_KEYS.filters, null));
      const v = await get(SETTING_KEYS.view, "games");
      if (VIEWS.some((x) => x.id === v)) state.view = v;
      cfg.minN = Number(await get(SETTING_KEYS.minSample, DEFAULT_MIN_SAMPLE)) || DEFAULT_MIN_SAMPLE;
      cfg.minMatchup = Number(await get(SETTING_KEYS.minMatchup, DEFAULT_MIN_MATCHUP)) || DEFAULT_MIN_MATCHUP;
      const tf = await get(SETTING_KEYS.trackedFormats, DEFAULT_TRACKED_FORMATS2);
      cfg.trackedFormats = Array.isArray(tf) && tf.length ? tf : DEFAULT_TRACKED_FORMATS2;
    }
    async function refresh() {
      await loadData();
      render(true);
    }
    const actions = {
      render: () => render(),
      refresh,
      openGame(roomid) {
        state.detail = roomid;
        render();
        safe(() => nav.scrollIntoView({ block: "start" }));
      },
      closeGame() {
        state.detail = null;
        render();
      },
      clearFilters() {
        state.filters = { ...DEFAULT_FILTERS };
        persistFilters();
        render();
      },
      async updateGame(roomid, patch) {
        const local = data.all.find((g) => g.roomid === roomid);
        if (local) Object.assign(local, patch);
        const stored = await repo.getGame(roomid);
        if (stored) await repo.putGame({ ...stored, ...patch, updatedAt: Date.now() });
        render();
      },
      async updateSet(set, patch) {
        const existing = data.setRecords.get(set.id) || await repo.getSet(set.id) || { id: set.id, format: set.format, ts: set.ts, tags: [], notes: "" };
        const rec2 = await repo.putSet({ ...existing, ...patch, games: set.games.map((g) => g.roomid), updatedAt: Date.now() });
        data.setRecords.set(set.id, rec2);
        render();
      },
      async saveSetting(name, value) {
        await repo.setSetting(name, value);
        if (name === SETTING_KEYS.minSample) cfg.minN = value;
        if (name === SETTING_KEYS.minMatchup) cfg.minMatchup = value;
        if (name === SETTING_KEYS.trackedFormats) cfg.trackedFormats = value;
      },
      saveReplay(g) {
        if (typeof o.saveReplay === "function") return o.saveReplay(g);
        const room = win && win.app && win.app.rooms && win.app.rooms[g.roomid];
        if (room && typeof room.send === "function") {
          room.send("/savereplay");
          state.ui.msg = { text: "Sent /savereplay to the battle room. The replay link appears in that room." };
        } else {
          state.ui.msg = { text: "The battle room is not open. Open it again (or use the replay link) and run /savereplay there." };
        }
        render();
      }
    };
    if (typeof o.saveReplay !== "function" && !(win && win.app && win.app.rooms)) actions.saveReplay = null;
    function persistFilters() {
      debounce("filters", () => repo.setSetting(SETTING_KEYS.filters, state.filters).catch(() => {
      }), 400);
    }
    function setView(id) {
      state.view = id;
      state.detail = null;
      debounce("view", () => repo.setSetting(SETTING_KEYS.view, id).catch(() => {
      }), 400);
      render();
    }
    function context() {
      const view = VIEWS.find((v) => v.id === state.view) || VIEWS[0];
      const query = toQuery(state.filters);
      if (query.team === CURRENT_TEAM) query.team = data.teams.length ? data.teams[0].key : "";
      const games = filterGames(data.all, query);
      const ids = new Set(games.filter((g) => g.setId).map((g) => g.setId));
      return {
        state,
        view,
        repo,
        actions: { ...actions, setView },
        all: data.all,
        games,
        allSets: data.allSets,
        sets: data.allSets.filter((s) => ids.has(s.id)),
        setRecords: data.setRecords,
        filters: state.filters,
        minN: cfg.minN,
        minMatchup: cfg.minMatchup,
        trackedFormats: cfg.trackedFormats,
        version: o.version
      };
    }
    function renderNav() {
      clear(nav);
      for (const v of VIEWS) {
        nav.appendChild(h("button", { type: "button", role: "tab", class: "sa-btn sa-tab", "aria-selected": String(v.id === state.view), onclick: () => setView(v.id), text: v.label }));
      }
    }
    function renderStatus() {
      clear(status2);
      const cs = captureState;
      if (!cs) return;
      const live = (cs.live || []).filter((l) => l && l.state !== "saved");
      if (cs.userName) status2.appendChild(h("span", { text: "Recording as " + cs.userName }));
      if (live.length) status2.appendChild(h("span", { class: "sa-live", text: `Live: ${live.map((l) => (l.players || []).join(" vs ") || l.roomid).join(", ")}${live[0].turn ? ` (turn ${live[0].turn})` : ""}` }));
      if (cs.savedCount) status2.appendChild(h("span", { text: `${cs.savedCount} saved this session` }));
      if (cs.hint) status2.appendChild(h("span", { class: "sa-banner", style: "flex:1 0 100%", text: cs.hint }));
      if (cs.errors && cs.errors.length) status2.appendChild(h("span", { class: "sa-delta-down", title: cs.errors.map((e) => e && e.message || String(e)).join("\n"), text: `${cs.errors.length} capture error${cs.errors.length === 1 ? "" : "s"}` }));
    }
    function renderFilters(view) {
      clear(filterHost);
      if (!view.filters || !data.all.length) return;
      filterHost.appendChild(
        renderFilterBar({
          filters: state.filters,
          open: state.filtersOpen,
          formats: data.formats,
          teams: data.teams,
          oppSpecies: data.oppSpecies,
          showReviewed: !!view.reviewed,
          set(patch) {
            Object.assign(state.filters, patch);
            persistFilters();
            render();
          },
          toggle() {
            state.filtersOpen = !state.filtersOpen;
            render();
          },
          clear: actions.clearFilters
        })
      );
    }
    function render(soft) {
      if (destroyed) return;
      const active = doc.activeElement;
      if (soft === true && active && content.contains(active) && (active.tagName === "TEXTAREA" || active.tagName === "INPUT" && active.type === "text")) {
        dirty = true;
        return;
      }
      dirty = false;
      const focusSel = 'button,select,input,textarea,[tabindex="0"],a';
      const idx = active && rootEl.contains(active) ? [...rootEl.querySelectorAll(focusSel)].indexOf(active) : -1;
      const ctx = context();
      renderNav();
      renderStatus();
      renderFilters(ctx.view);
      clear(content);
      if (!data.loaded) content.appendChild(h("div", { class: "sa-empty", text: "Loading..." }));
      else if (data.error) content.appendChild(h("div", { class: "sa-banner", text: "Could not read the local database: " + data.error }));
      else {
        try {
          content.appendChild(state.detail ? renderGameDetail(ctx) : ctx.view.render(ctx));
        } catch (err) {
          console.error("[Showdown Analyzer] render failed", err);
          content.appendChild(h("div", { class: "sa-banner", text: "This view failed to render: " + (err && err.message ? err.message : String(err)) }));
        }
      }
      if (idx >= 0) {
        const el = rootEl.querySelectorAll(focusSel)[idx];
        if (el && el !== doc.activeElement) safe(() => el.focus({ preventScroll: true }));
      }
    }
    rootEl.addEventListener("focusout", () => {
      setTimeout(() => {
        if (dirty && !destroyed) render();
      }, 0);
    });
    function scheduleRefresh() {
      debounce("refresh", () => refresh(), 300);
    }
    if (typeof o.onChange === "function") {
      const u = safe(() => o.onChange((arg) => {
        if (arg && typeof arg === "object" && "savedCount" in arg) captureState = arg;
        else if (typeof o.captureStatus === "function") captureState = safe(o.captureStatus) || captureState;
        renderStatus();
        scheduleRefresh();
      }));
      if (typeof u === "function") unsubs.push(u);
    }
    if (typeof repo.onChange === "function") {
      unsubs.push(repo.onChange((msg) => {
        if (!msg || msg.store === "games" || msg.store === "sets" || msg.store === "*") scheduleRefresh();
      }));
    }
    const ready = (async () => {
      render();
      await loadSettings();
      await loadData();
      render();
    })().catch((err) => {
      console.error("[Showdown Analyzer] UI init failed", err);
      data.loaded = true;
      data.error = err && err.message ? err.message : String(err);
      render();
    });
    return {
      ready,
      refresh,
      openGame: actions.openGame,
      setView,
      setCaptureStatus(s) {
        const prevSaved = captureState && captureState.savedCount;
        captureState = s;
        renderStatus();
        if (s && s.savedCount !== prevSaved) scheduleRefresh();
      },
      destroy() {
        destroyed = true;
        Object.values(timers).forEach(clearTimeout);
        unsubs.forEach((u) => safe(u));
        clear(rootEl);
      }
    };
  }

  // src/main.js
  var VERSION = true ? "0.1.0" : "dev";
  var repoPromise = null;
  var capture = null;
  var app = null;
  var mountedRoot = null;
  function getDex() {
    const w = typeof window !== "undefined" ? window : null;
    return w && w.Dex ? w.Dex : null;
  }
  function mount() {
    const root2 = getRoot();
    if (!root2 || !repoPromise || !capture) return;
    if (app && mountedRoot === root2) return;
    if (app) app.destroy();
    mountedRoot = root2;
    repoPromise.then((repo) => {
      if (mountedRoot !== root2) return;
      app = mountApp(root2, {
        repo,
        captureStatus: capture.captureStatus,
        onChange: capture.onChange,
        version: VERSION
      });
    }).catch((err) => {
      const diag = getHookStatus().error || getTabDiagnostic() || "";
      root2.textContent = "Showdown Analyzer could not start: " + (err && err.message || err) + (diag ? " (" + diag + ")" : "");
      console.error("[Showdown Analyzer] UI failed to mount", err);
    });
  }
  function main() {
    if (window.top !== window.self) return;
    if (window.__showdownAnalyzerLoaded) return;
    window.__showdownAnalyzerLoaded = true;
    resetTabUrl();
    repoPromise = openRepo();
    capture = startCapture({
      repo: repoPromise,
      host: { onMessage, getUserName, getMyTeams, getBattleLog },
      getDex
    });
    window.__showdownAnalyzer = { repo: repoPromise, capture, version: VERSION };
    onReady(mount);
    startHook({});
    openTab({ focus: false });
    console.log("[Showdown Analyzer] loaded" + (getTabMode() ? " (" + getTabMode() + ")" : ""));
  }
  try {
    main();
  } catch (err) {
    console.error("[Showdown Analyzer] startup failed", err);
  }
})();
