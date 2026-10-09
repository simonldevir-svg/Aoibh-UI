// Work section: scroll reveal, hover cursor, hero parallax, tile video play/pause, Vimeo lightbox.
(function () {
  // staggered word reveal for headlines
  document.querySelectorAll(".w span").forEach(function (s, i) { s.style.animationDelay = (0.12 + i * 0.09) + "s"; });

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // scroll reveal
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12 }) : null;
  document.querySelectorAll(".reveal").forEach(function (el, i) { if (io) io.observe(el); else el.classList.add("in"); });

  // "View" bubble that follows the pointer over project tiles (desktop only)
  var cur = document.querySelector(".cursor");
  if (cur && !reduce && window.matchMedia("(hover:hover)").matches) {
    document.querySelectorAll(".tile[data-view]").forEach(function (t) {
      t.addEventListener("mouseenter", function () { cur.textContent = t.dataset.view; cur.classList.add("show"); });
      t.addEventListener("mouseleave", function () { cur.classList.remove("show"); });
      t.addEventListener("mousemove", function (e) { cur.style.setProperty("--x", e.clientX + "px"); cur.style.setProperty("--y", e.clientY + "px"); });
    });
  }

  // gentle parallax on the case-study hero image
  var hero = document.querySelector(".cs-hero img");
  if (hero && !reduce) {
    window.addEventListener("scroll", function () {
      var y = window.scrollY;
      if (y < window.innerHeight * 1.2) hero.style.transform = "translateY(" + (y * 0.18) + "px) scale(" + (1 + y * 0.00018) + ")";
    }, { passive: true });
  }

  // play looping tile videos only while visible; stay paused for reduced-motion users
  var vids = document.querySelectorAll("video[data-autoplay]");
  if (vids.length && "IntersectionObserver" in window) {
    var vo = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (reduce) return; if (e.isIntersecting) { var p = e.target.play(); if (p && p.catch) p.catch(function () {}); } else e.target.pause(); });
    }, { threshold: 0.25 });
    vids.forEach(function (v) { vo.observe(v); });
  }

  // Vimeo film opens in a lightbox; the iframe is created on click so nothing loads until asked
  var modal = document.getElementById("film");
  if (modal) {
    var frame = modal.querySelector(".frame");
    var opener = null;
    function closeFilm() { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); frame.innerHTML = ""; document.body.style.overflow = ""; if (opener) opener.focus(); }
    document.querySelectorAll("[data-vimeo]").forEach(function (t) {
      t.addEventListener("click", function (e) {
        e.preventDefault(); opener = t;
        frame.innerHTML = '<iframe src="https://player.vimeo.com/video/' + t.dataset.vimeo + '?autoplay=1&quality=1080p&title=0&byline=0&portrait=0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Film"></iframe>';
        modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
        modal.querySelector(".close").focus();
        if (cur) cur.classList.remove("show");
      });
    });
    modal.querySelector(".close").addEventListener("click", closeFilm);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeFilm(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) closeFilm(); });
  }

  // email tiles: crossfade through the images while the tile is on screen (first image only for reduced motion)
  document.querySelectorAll("[data-cycle]").forEach(function (box) {
    var imgs = [].slice.call(box.querySelectorAll("img")), i = 0, timer = null;
    if (!imgs.length) return;
    imgs[0].classList.add("on");
    if (reduce || imgs.length < 2) return;
    function step() { imgs[i].classList.remove("on"); i = (i + 1) % imgs.length; imgs[i].classList.add("on"); }
    var vis = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
      es.forEach(function (e) { clearInterval(timer); if (e.isIntersecting) timer = setInterval(step, 2600); });
    }, { threshold: 0.25 }) : null;
    if (vis) vis.observe(box); else timer = setInterval(step, 2600);
  });

  // click an email to view it large
  var lb = document.getElementById("lb");
  if (lb) {
    var lbImg = lb.querySelector("img");
    document.addEventListener("click", function (ev) { var z = ev.target.closest("[data-zoom]"); if (z) { lbImg.src = z.dataset.zoom; lb.classList.add("open"); } });
    lb.addEventListener("click", function () { lb.classList.remove("open"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") lb.classList.remove("open"); });
  }

  // email stage: tabs + window that cycles through the emails; hover pauses, click a tab to jump
  document.querySelectorAll(".em-stagewrap").forEach(function (wrap) {
    var tabs = [].slice.call(wrap.querySelectorAll(".em-tab")), imgs = [].slice.call(wrap.querySelectorAll(".em-view img")), cur = 0, t, DUR = 4200;
    if (!tabs.length) return;
    wrap.style.setProperty("--dur", DUR + "ms");
    function go(i) {
      cur = i;
      tabs.forEach(function (b, k) { b.classList.remove("on"); void b.offsetWidth; if (k === i) b.classList.add("on"); });
      imgs.forEach(function (m, k) { m.classList.toggle("on", k === i); });
      clearTimeout(t);
      if (!reduce) t = setTimeout(function () { go((cur + 1) % tabs.length); }, DUR);
    }
    tabs.forEach(function (b, k) { b.addEventListener("click", function () { go(k); }); });
    var stage = wrap.querySelector(".em-stage");
    stage.addEventListener("mouseenter", function () { clearTimeout(t); });
    stage.addEventListener("mouseleave", function () { go(cur); });
    imgs.forEach(function (m) { m.dataset.zoom = m.src; });
    go(0);
  });
})();
