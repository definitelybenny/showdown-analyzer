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
    const app = win.app;
    if (app && isFn(app.receive) && isFn(app.send)) return "classic";
    const PS = win.PS;
    if (PS && isFn(PS.receive) && isFn(PS.send)) return "preact";
    return null;
  }
  function classicTabReady(win = globalThis) {
    const app = win.app;
    return !!(app && isFn(app._addRoom) && app.rooms && app.topbar && Array.isArray(app.roomList) && Array.isArray(app.sideRoomList));
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
  function roomMap(win) {
    const client = detectClient(win);
    return client === "classic" ? win.app.rooms : client === "preact" ? win.PS.rooms : null;
  }
  function getBattleRooms(win = globalThis) {
    try {
      return Object.keys(roomMap(win) || {}).filter((id) => id.startsWith("battle-"));
    } catch (err) {
      return [];
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
  function patchTabIcon(app) {
    const topbar = app.topbar;
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
    const app = win.app;
    const doc = win.document;
    let room = app.rooms[CLASSIC_TAB_ID];
    if (!room) {
      room = app._addRoom(CLASSIC_TAB_ID, "html", true, TAB_TITLE);
      if (!room || !room.el) throw new Error("app._addRoom returned no room");
    }
    const at = app.roomList.indexOf(room);
    if (at >= 0) {
      app.roomList.splice(at, 1);
      if (app.sideRoomList.indexOf(room) < 0) app.sideRoomList.push(room);
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
    patchTabIcon(app);
    if (focus && typeof app.focusRoomRight === "function") app.focusRoomRight(CLASSIC_TAB_ID);
    if (typeof app.topbar.updateTabbar === "function") app.topbar.updateTabbar();
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

  // src/main.js
  var STYLE_ID = "sa-style";
  var CSS = `
#${ROOT_ID}{padding:8px 12px;font:12px/1.5 Verdana,sans-serif;color:inherit}
#${ROOT_ID} h2{margin:0 0 6px;font-size:14px}
#${ROOT_ID} .sa-row{margin:2px 0}
#${ROOT_ID} .sa-row b{display:inline-block;min-width:96px;font-weight:bold}
#${ROOT_ID} .sa-diag{margin-top:8px;color:#a05000;font-size:11px}
#${ROOT_ID} .sa-muted{opacity:.7}
`;
  var seen = { rooms: /* @__PURE__ */ new Set(), in: 0, out: 0 };
  var renderTimer = null;
  function row(doc, label, value) {
    const div = doc.createElement("div");
    div.className = "sa-row";
    const b = doc.createElement("b");
    b.textContent = label;
    const span = doc.createElement("span");
    span.textContent = value;
    div.appendChild(b);
    div.appendChild(span);
    return div;
  }
  function render() {
    renderTimer = null;
    const root2 = getRoot();
    if (!root2) return;
    const doc = root2.ownerDocument;
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(style);
    }
    const hook = getHookStatus();
    const battles = getBattleRooms();
    const nodes = [];
    const title = doc.createElement("h2");
    title.textContent = "Showdown Analyzer";
    nodes.push(title);
    nodes.push(row(doc, "User", getUserName() || "not logged in"));
    nodes.push(row(doc, "Client", hook.client || "waiting"));
    nodes.push(row(doc, "Messages", `${seen.in} in, ${seen.out} out`));
    nodes.push(row(doc, "Rooms seen", String(seen.rooms.size)));
    nodes.push(row(doc, "Battle rooms", battles.length ? battles.join(", ") : "none"));
    const problem = hook.error || (hook.hooked ? "" : getTabDiagnostic());
    if (problem) {
      const diag = doc.createElement("div");
      diag.className = "sa-diag";
      diag.textContent = "Diagnostics: " + problem;
      nodes.push(diag);
    }
    root2.replaceChildren(...nodes);
  }
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(render, 250);
  }
  function main() {
    resetTabUrl();
    onMessage((ev) => {
      seen[ev.type]++;
      if (ev.roomid) seen.rooms.add(ev.roomid);
      scheduleRender();
    });
    onReady(render);
    startHook({ onHooked: scheduleRender });
    openTab({ focus: false });
    setTimeout(scheduleRender, 61e3);
    console.log("[Showdown Analyzer] loaded" + (getTabMode() ? " (" + getTabMode() + ")" : ""));
  }
  try {
    main();
  } catch (err) {
    console.error("[Showdown Analyzer] startup failed", err);
  }
})();
