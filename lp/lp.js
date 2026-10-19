// Landing page behaviour + first-party funnel tracking (cookie-free, anonymous; see api/_funnel.js).
//  - Reads the ad's campaign tags from the URL and carries them to the brief / checkout.
//  - Records: page view, which sections were seen, which buttons were clicked.
//  - Button links are rewritten on load so they also work with middle-click / copy link.
(function () {
  var PAGE = document.documentElement.getAttribute("data-page") || "home";
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"];
  var q = new URLSearchParams(location.search);
  var A = {};
  KEYS.forEach(function (k) {
    var v = q.get(k);
    if (v) A[k] = v.slice(0, k === "gclid" ? 200 : 100);
  });
  var device = window.innerWidth < 768 ? "mobile" : "desktop";

  function send(events) {
    if (!events.length) return;
    try {
      var body = JSON.stringify({ page: PAGE, device: device, attr: A, events: events });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }))) return;
      fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  // Where each button goes: the home page opens the brief chat, the subscribe box or the contact box.
  function dest(go) {
    var p = new URLSearchParams();
    if (go === "start") p.set("start", "1");
    else if (go === "contact") p.set("contact", "1");
    else p.set("subscribe", go);
    p.set("lp", PAGE);
    Object.keys(A).forEach(function (k) { p.set(k, A[k]); });
    return "/?" + p.toString();
  }

  document.querySelectorAll("[data-go]").forEach(function (a) {
    var go = a.getAttribute("data-go");
    a.setAttribute("href", dest(go));
    a.addEventListener("click", function () {
      var plan = go === "starter" || go === "growth";
      send([{ e: plan ? "plan_click" : "cta_click", c: a.getAttribute("data-cta") || go }]);
    });
  });

  // One page view per load (bots are ignored on the server).
  send([{ e: "view" }]);

  // Which sections people actually reach: each fires once per page load.
  var queue = [], seen = {}, timer = null;
  function flush() { clearTimeout(timer); timer = null; var batch = queue.splice(0, 12); send(batch); if (queue.length) timer = setTimeout(flush, 800); }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var s = en.target.getAttribute("data-sec");
        if (!s || seen[s]) return;
        seen[s] = true;
        queue.push({ e: "section_view", s: s });
        io.unobserve(en.target);
        if (!timer) timer = setTimeout(flush, 1200);
      });
    }, { threshold: 0.3 });
    document.querySelectorAll("[data-sec]").forEach(function (el) { io.observe(el); });
    window.addEventListener("pagehide", function () { if (queue.length) flush(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && queue.length) flush(); });
  }
})();
