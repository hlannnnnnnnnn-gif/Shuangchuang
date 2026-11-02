/* ============================================================
   暨南大学深圳校区创新创业中心 · 站点脚本
   ------------------------------------------------------------
   管理员账号：jnuadmin
   管理员密码：shuangchuang2026
   （如需修改：在浏览器控制台执行 jnuHash("新密码") 取得哈希，
     替换下面的 ADMIN_HASH 即可。注意这是前端口令，非严格安全防护。）
   ------------------------------------------------------------
   内容数据统一在 data/content.js（资讯 + 入驻团队）
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- 管理员口令（哈希） ---------------- */
  function hash(s) {
    var x = 5381;
    for (var i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) >>> 0;
    return x.toString(36);
  }
  window.jnuHash = hash;

  var ADMIN_USER = "jnuadmin";
  var ADMIN_HASH = "lh7ddn"; // = hash("jnuadmin:shuangchuang2026")
  var LS_SESSION = "jnu_admin_session_v3";
  var LS_DRAFT = "jnu_content_v3";
  var LS_STALE = "jnu_content_v3_stale";
  var staleDropped = false;

  function fileVersion() {
    return (window.JNU_CONTENT && typeof window.JNU_CONTENT.version === "number")
      ? window.JNU_CONTENT.version : 0;
  }

  /* ---------------- 栏目定义 ---------------- */
  var CATS = {
    competition: { label: "比赛资讯", en: "CONTEST", title: "赛事不等人<br><em>先把该知道的知道</em>", lede: "从国家级 A 类赛事到校内选拔，报名节奏、赛道选择、材料清单与备赛安排，都在这里。可按赛事分类筛选，也可以直接搜关键词。" },
    startup: { label: "创业资讯", en: "STARTUP", title: "创业这件事<br><em>已经有人先试过了</em>", lede: "方法论、政策方向、在孵团队的真实路径。写给正在犹豫要不要开始的人。" },
    center: { label: "中心资讯", en: "CENTER", title: "中心资讯<br><em>新闻动态与影像回顾</em>", lede: "涵盖开班仪式、赛事获奖、活动纪实及中心公告。过往工作与成果，均在此予以记录与展示。" }
  };
  var CAT_ORDER = ["competition", "startup", "center"];
  var COLORS = ["var(--t-1)", "var(--t-2)", "var(--t-3)", "var(--t-4)", "var(--t-5)", "var(--t-6)"];

  /* ---------------- 状态 ---------------- */
  var state = {
    posts: [],
    teams: [],
    lbList: [],
    lbIndex: 0,
    route: { view: "about", cat: "competition", id: null },
    admin: false,
    q: "",
    topic: "",
    editing: null,
    teamEditing: null
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var fmtDate = function (d) {
    if (!d) return "";
    var p = String(d).split("-");
    return p.length >= 3 ? p[0] + "." + p[1] + "." + p[2] : d;
  };
  var uid = function (pre) { return pre + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); };

  /* ---------------- 数据读写 ---------------- */
  function seed() {
    var src = window.JNU_CONTENT || {};
    return {
      posts: JSON.parse(JSON.stringify(src.posts || [])),
      teams: JSON.parse(JSON.stringify(src.teams || []))
    };
  }
  function loadDraft() {
    try {
      var raw = localStorage.getItem(LS_DRAFT);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.posts)) return null;

      // 版本校验：content.js 更新过就说明线上内容变了，
      // 旧草稿可能是上一个版本的残留，会让新发布的内容「消失」。
      // 这里把草稿备份一份后弃用，改用线上版本，避免内容看起来丢了。
      var fv = fileVersion();
      var dv = (typeof o.v === "number") ? o.v : -1;
      if (fv > 0 && dv < fv) {
        try { localStorage.setItem(LS_STALE, raw); } catch (e) { }
        try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
        staleDropped = true;
        return null;
      }
      return { posts: o.posts, teams: Array.isArray(o.teams) ? o.teams : seed().teams };
    } catch (e) { return null; }
  }
  function saveDraft() {
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({
        v: fileVersion(), ts: Date.now(), posts: state.posts, teams: state.teams
      }));
      return true;
    } catch (e) {
      toast("本地存储已满，请先「发布」再继续（图片较多时建议改用图片路径）");
      return false;
    }
  }

  /* ---------------- 轻提示 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("on"); }, 3400);
  }

  /* ---------------- 正文简易排版 ---------------- */
  function inlineMd(s) {
    var out = esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(https?:\/\/[^\s<>"']+)/g, function (u) {
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>';
    });
    return out;
  }
  function renderBody(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var out = "", list = null;
    function flush() { if (list !== null) { out += "<ul>" + list + "</ul>"; list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) { flush(); continue; }
      if (/^##\s+/.test(l)) { flush(); out += "<h3>" + inlineMd(l.replace(/^##\s+/, "")) + "</h3>"; continue; }
      if (/^>\s?/.test(l)) { flush(); out += "<blockquote>" + inlineMd(l.replace(/^>\s?/, "")) + "</blockquote>"; continue; }
      var im = l.match(/^!\[(.*?)\]\((.+?)\)\s*$/);
      if (im) {
        flush();
        out += '<figure class="art-fig"><img src="' + esc(im[2]) + '" alt="' + esc(im[1]) + '" loading="lazy" />' +
          (im[1] ? '<figcaption>' + esc(im[1]) + '</figcaption>' : '') + '</figure>';
        continue;
      }
      if (/^[-*]\s+/.test(l)) {
        if (list === null) list = "";
        list += "<li>" + inlineMd(l.replace(/^[-*]\s+/, "")) + "</li>";
        continue;
      }
      flush();
      out += "<p>" + inlineMd(l) + "</p>";
    }
    flush();
    return out;
  }

  /* ============================================================
     入驻团队
     ============================================================ */
  function renderTeams() {
    var grid = $("#teamGrid");
    if (!grid) return;

    grid.innerHTML = state.teams.map(function (t, i) {
      return '<div class="team" role="button" tabindex="0" data-team="' + i + '" style="--c:' + esc(t.color || COLORS[0]) + '">' +
        '<span class="team-plus" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>' +
        '<span class="team-ops">' +
        '<button type="button" data-tedit="' + esc(t.id) + '" title="编辑团队"><svg viewBox="0 0 24 24" fill="none"><path d="M15.2 5.2l3.6 3.6M4 20l4.2-.9L20 7.3a1.8 1.8 0 0 0 0-2.6l-.7-.7a1.8 1.8 0 0 0-2.6 0L4.9 15.8 4 20Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg></button>' +
        '<button type="button" class="del" data-tdel="' + esc(t.id) + '" title="删除团队"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '</span>' +
        '<span class="team-thumb">' + (t.cover
          ? '<img src="' + esc(t.cover) + '" alt="' + esc(t.name) + '" loading="lazy" />'
          : '') + '</span>' +
        '<span class="team-body">' +
        '<span class="team-idx">' + (i + 1 < 10 ? "0" : "") + (i + 1) + ' / ' + esc(t.label || "在孵团队") + '</span>' +
        '<span class="team-name">' + esc(t.name) + '</span>' +
        '<span class="team-track"><i></i>' + esc(t.track || "") + '</span>' +
        '</span></div>';
    }).join("");

    var bar = $("#teamsBar");
    if (bar) {
      bar.innerHTML = '<span class="mono" style="color:var(--muted)">' + state.teams.length + ' 支在孵团队</span>' +
        '<button class="btn btn--sm ed-only" id="btnNewTeam">＋ 新建团队</button>';
      var nb = $("#btnNewTeam");
      if (nb) nb.addEventListener("click", function () { openTeamEditor(null); });
    }

    var drawer = $("#teamDrawer"), card = $("#drawerCard"), active = -1;

    function paint(i) {
      var t = state.teams[i];
      var awards = (t.awards || []).map(function (a) {
        return '<li><span class="yr">' + esc(a.y) + '</span><span>' +
          '<span class="lv' + (a.hi ? " lv-hi" : "") + '">' + esc(a.lv) + '</span>' +
          '<span class="nm">' + esc(a.nm) + '</span></span></li>';
      }).join("");
      var gal = (t.gallery && t.gallery.length > 1)
        ? '<div class="team-gallery">' + t.gallery.map(function (g) { return '<img src="' + esc(g) + '" alt="" loading="lazy" />'; }).join("") + '</div>'
        : "";
      card.style.setProperty("--c", t.color || COLORS[0]);
      card.innerHTML =
        '<div><span class="d-tag"><i></i>' + esc(t.track || "") + '</span>' +
        '<h3>' + esc(t.name) + '</h3><p>' + esc(t.desc || "") + '</p>' +
        (t.coach ? '<p class="coach"><b>' + esc(t.coach) + '</b></p>' : "") + gal + '</div>' +
        '<div class="awards"><h4>赛事获奖清单</h4>' +
        (awards ? '<ul>' + awards + '</ul>' : '<p style="font-size:13px;color:var(--muted)">暂未填写获奖记录</p>') +
        '</div>';
    }

    function toggle(i) {
      if (active === i) {
        drawer.classList.remove("open");
        $$(".team", grid).forEach(function (o) { o.classList.remove("is-active"); });
        active = -1;
        return;
      }
      $$(".team", grid).forEach(function (o) { o.classList.remove("is-active"); });
      var el = grid.querySelector('[data-team="' + i + '"]');
      if (el) el.classList.add("is-active");
      paint(i);
      active = i;
      drawer.classList.add("open");
      setTimeout(function () {
        var top = drawer.getBoundingClientRect().top + window.pageYOffset - 90;
        window.scrollTo({ top: top, behavior: "smooth" });
      }, 140);
    }

    grid.onclick = function (e) {
      var ed = e.target.closest("[data-tedit]");
      if (ed) { e.stopPropagation(); openTeamEditor(ed.getAttribute("data-tedit")); return; }
      var dl = e.target.closest("[data-tdel]");
      if (dl) { e.stopPropagation(); deleteTeam(dl.getAttribute("data-tdel")); return; }
      var btn = e.target.closest("[data-team]");
      if (btn) toggle(+btn.getAttribute("data-team"));
    };
    grid.onkeydown = function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var btn = e.target.closest("[data-team]");
      if (btn) { e.preventDefault(); toggle(+btn.getAttribute("data-team")); }
    };
  }

  /* ---------------- 团队编辑 ---------------- */
  function openTeamEditor(id) {
    var t = null;
    if (id) t = state.teams.filter(function (x) { return x.id === id; })[0] || null;
    state.teamEditing = {
      id: t ? t.id : null,
      cover: t ? (t.cover || "") : "",
      gallery: t ? (t.gallery || []).slice() : [],
      color: t ? (t.color || COLORS[0]) : COLORS[state.teams.length % COLORS.length],
      awards: t ? JSON.parse(JSON.stringify(t.awards || [])) : []
    };
    $("#tmTitle").textContent = t ? "编辑团队" : "新建团队";
    $("#tmName").value = t ? t.name : "";
    $("#tmLabel").value = t ? (t.label || "") : "";
    $("#tmTrack").value = t ? (t.track || "") : "";
    $("#tmCoach").value = t ? (t.coach || "") : "";
    $("#tmDesc").value = t ? (t.desc || "") : "";
    $("#tmCoverPath").value = t && t.cover && t.cover.indexOf("data:") !== 0 ? t.cover : "";
    $("#tmDel").style.display = t ? "inline-flex" : "none";
    paintSwatches(); paintTmCover(); paintTmGallery(); paintAwards();
    $("#teamEditor").classList.add("on");
    setTimeout(function () { $("#tmName").focus(); }, 160);
  }
  function closeTeamEditor() { $("#teamEditor").classList.remove("on"); state.teamEditing = null; }

  function paintSwatches() {
    var box = $("#tmColors");
    box.innerHTML = COLORS.map(function (c) {
      return '<button type="button" data-color="' + esc(c) + '" class="' + (state.teamEditing.color === c ? "on" : "") + '" style="background:' + c + '"></button>';
    }).join("");
    $$("[data-color]", box).forEach(function (b) {
      b.onclick = function () {
        state.teamEditing.color = b.getAttribute("data-color");
        paintSwatches();
      };
    });
  }
  function paintTmCover() {
    var box = $("#tmCoverPrev"), c = state.teamEditing.cover;
    if (c) {
      box.style.display = "block";
      box.innerHTML = '<img src="' + esc(c) + '" alt="" />' +
        '<button type="button" id="tmCoverDel" style="position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:rgba(22,21,15,.75);color:#fff;font-size:12px;line-height:1">×</button>';
      box.style.position = "relative";
      var d = $("#tmCoverDel");
      if (d) d.onclick = function () { state.teamEditing.cover = ""; $("#tmCoverPath").value = ""; paintTmCover(); };
    } else { box.style.display = "none"; box.innerHTML = ""; }
  }
  function paintTmGallery() {
    var box = $("#tmGalPrev");
    box.innerHTML = state.teamEditing.gallery.map(function (src, i) {
      return '<div><img src="' + esc(src) + '" alt="" /><button type="button" data-gdel="' + i + '">×</button></div>';
    }).join("");
    $$("[data-gdel]", box).forEach(function (b) {
      b.onclick = function () {
        state.teamEditing.gallery.splice(+b.getAttribute("data-gdel"), 1);
        paintTmGallery();
      };
    });
  }
  function paintAwards() {
    var box = $("#tmAwards");
    if (!state.teamEditing.awards.length) {
      box.innerHTML = '<p style="font-size:12.5px;color:var(--muted);padding:6px 0">还没有获奖记录，点下面「＋ 添加一条」。</p>';
      return;
    }
    box.innerHTML = state.teamEditing.awards.map(function (a, i) {
      return '<div class="aw-row">' +
        '<input type="text" data-aw="y" data-i="' + i + '" value="' + esc(a.y || "") + '" placeholder="2026.05" />' +
        '<input type="text" data-aw="lv" data-i="' + i + '" value="' + esc(a.lv || "") + '" placeholder="省级金奖" />' +
        '<input type="text" data-aw="nm" data-i="' + i + '" value="' + esc(a.nm || "") + '" placeholder="赛事与项目名称" />' +
        '<label class="aw-hi" title="高亮显示"><input type="checkbox" data-aw="hi" data-i="' + i + '"' + (a.hi ? " checked" : "") + ' /></label>' +
        '<button type="button" class="awdel" data-awdel="' + i + '" title="删除">×</button>' +
        '</div>';
    }).join("");
    $$("[data-aw]", box).forEach(function (inp) {
      inp.oninput = function () {
        var i = +inp.getAttribute("data-i"), k = inp.getAttribute("data-aw");
        state.teamEditing.awards[i][k] = k === "hi" ? inp.checked : inp.value;
      };
      inp.onchange = inp.oninput;
    });
    $$("[data-awdel]", box).forEach(function (b) {
      b.onclick = function () {
        state.teamEditing.awards.splice(+b.getAttribute("data-awdel"), 1);
        paintAwards();
      };
    });
  }

  function saveTeam() {
    var name = $("#tmName").value.trim();
    if (!name) { toast("请先填写团队名称"); $("#tmName").focus(); return; }
    var t = {
      id: state.teamEditing.id || uid("t"),
      name: name,
      label: $("#tmLabel").value.trim() || "在孵团队",
      track: $("#tmTrack").value.trim(),
      color: state.teamEditing.color,
      cover: state.teamEditing.cover || $("#tmCoverPath").value.trim(),
      gallery: state.teamEditing.gallery.slice(),
      coach: $("#tmCoach").value.trim(),
      desc: $("#tmDesc").value.trim(),
      awards: state.teamEditing.awards.filter(function (a) { return a.y || a.lv || a.nm; })
    };
    var idx = -1;
    for (var i = 0; i < state.teams.length; i++) if (state.teams[i].id === t.id) { idx = i; break; }
    if (idx >= 0) state.teams[idx] = t; else state.teams.push(t);
    if (!saveDraft()) return;
    closeTeamEditor();
    route();
    toast(idx >= 0 ? "团队信息已保存" : "已添加团队，记得点「发布」");
  }

  function deleteTeam(id) {
    var t = state.teams.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    if (!confirm("确认删除团队「" + t.name + "」？\n删除后需要点「发布」才会对外生效。")) return;
    state.teams = state.teams.filter(function (x) { return x.id !== id; });
    saveDraft();
    route();
    toast("已删除");
  }

  /* ============================================================
     资讯
     ============================================================ */
  function sortPosts(arr) {
    return arr.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
  }

  function allTopics() {
    var seen = {}, out = [];
    state.posts.forEach(function (p) {
      if (p.cat !== "competition") return;
      var t = (p.topic || "").trim();
      if (!t) return;
      if (!seen[t]) { seen[t] = 1; out.push(t); }
    });
    var ORDER = ["互联网+", "大创", "挑战杯", "新文科"];
    out.sort(function (a, b) {
      var ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      return ia - ib || a.localeCompare(b, "zh");
    });
    return out;
  }

  function matchQ(p, q) {
    if (!q) return true;
    var hay = [p.title, p.summary, p.topic, (p.tags || []).join(" "), p.body, p.dateLabel]
      .join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (w) {
      return hay.indexOf(w) >= 0;
    });
  }

  function renderNewsList(cat) {
    var c = CATS[cat] || CATS.competition;
    var tabs = CAT_ORDER.map(function (k) {
      var n = state.posts.filter(function (p) { return p.cat === k; }).length;
      return '<a class="tab' + (k === cat ? " is-on" : "") + '" href="#/news/' + k + '">' + CATS[k].label +
        '<span class="cnt">' + n + '</span></a>';
    }).join("");

    var topics = cat === "competition" ? allTopics() : [];
    var chips = topics.length
      ? '<div class="chips" id="topicChips">' +
      '<button class="chip' + (state.topic ? "" : " on") + '" data-topic="">全部</button>' +
      topics.map(function (t) {
        return '<button class="chip' + (state.topic === t ? " on" : "") + '" data-topic="' + esc(t) + '">' + esc(t) + '</button>';
      }).join("") + '</div>'
      : "";

    $("#newsRoot").innerHTML =
      '<div class="v-head">' +
      '<p class="eyebrow">05 / 双创资讯 · ' + c.en + '</p>' +
      '<h1>' + c.title + '</h1>' +
      '<p class="lede">' + c.lede + '</p>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between">' +
      '<div class="tabs">' + tabs + '</div>' +
      '<button class="btn btn--sm ed-only" id="btnNew">＋ 新建资讯</button>' +
      '</div>' +
      '<div class="news-tools">' +
      '<div class="searchbar">' +
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.9"/><path d="m16.5 16.5 4 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>' +
      '<input id="qInput" type="search" placeholder="搜索关键词，如 挑战杯、大创、BP" value="' + esc(state.q) + '" />' +
      '<button class="qclear' + (state.q ? " on" : "") + '" id="qClear" type="button" aria-label="清空">×</button>' +
      '</div>' + chips +
      '</div>' +
      '<div class="news-list" id="newsListArea"></div>';

    var nb = $("#btnNew");
    if (nb) nb.addEventListener("click", function () { openEditor(null, cat); });

    var qi = $("#qInput");
    if (qi) {
      qi.addEventListener("input", function () {
        state.q = qi.value.trim();
        var qc = $("#qClear");
        if (qc) qc.classList.toggle("on", !!state.q);
        paintListArea(cat);
      });
      qi.addEventListener("keydown", function (e) { if (e.key === "Escape") { qi.value = ""; state.q = ""; paintListArea(cat); } });
    }
    var qc2 = $("#qClear");
    if (qc2) qc2.addEventListener("click", function () {
      state.q = ""; $("#qInput").value = "";
      qc2.classList.remove("on");
      paintListArea(cat);
    });

    $$("#topicChips .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        state.topic = b.getAttribute("data-topic") || "";
        $$("#topicChips .chip").forEach(function (o) { o.classList.remove("on"); });
        b.classList.add("on");
        paintListArea(cat);
      });
    });

    paintListArea(cat);
  }

  function paintListArea(cat) {
    var area = $("#newsListArea");
    if (!area) return;
    var c = CATS[cat] || CATS.competition;
    var posts = sortPosts(state.posts.filter(function (p) {
      if (p.cat !== cat) return false;
      if (cat === "competition" && state.topic && (p.topic || "") !== state.topic) return false;
      return matchQ(p, state.q);
    }));

    var filtered = !!(state.q || (cat === "competition" && state.topic));
    var head = filtered
      ? '<div class="result">' + (state.q ? "关键词「" + esc(state.q) + "」" : "") +
      (state.topic ? (state.q ? " · " : "") + "分类「" + esc(state.topic) + "」" : "") +
      ' · 共 ' + posts.length + ' 条</div>'
      : '';

    if (!posts.length) {
      area.innerHTML = head + (filtered
        ? '<div class="empty">没有匹配的内容。<br>换个关键词，或者点「全部」看看。</div>'
        : '<div class="empty">这个栏目还没有内容' + (state.admin ? "，点右上角「新建资讯」添加第一条" : "，稍后再来看看") + '。</div>');
      bindItemOps();
      return;
    }

    area.innerHTML = head + posts.map(function (p) {
      var thumb = p.cover
        ? '<span class="news-thumb"><img src="' + esc(p.cover) + '" alt="" loading="lazy" /></span>'
        : '';
      return '<div class="news-item-wrap">' +
        '<a class="news-item' + (p.cover ? "" : " no-thumb") + '" href="#/news/' + p.cat + '/' + encodeURIComponent(p.id) + '">' +
        '<span>' +
        '<span class="meta">' +
        '<span>' + esc(p.dateLabel || fmtDate(p.date)) + '</span><span>·</span><span>' + esc(c.label) + '</span>' +
        (p.topic ? '<span class="topic">' + esc(p.topic) + '</span>' : '') +
        (p.pinned ? '<span class="pin">置顶</span>' : '') +
        '</span>' +
        '<h3>' + esc(p.title) + '</h3>' +
        '<p>' + esc(p.summary || "") + '</p>' +
        '</span>' + thumb + '</a>' +
        '<div class="item-ops">' +
        '<button data-edit="' + esc(p.id) + '" title="编辑"><svg viewBox="0 0 24 24" fill="none"><path d="M15.2 5.2l3.6 3.6M4 20l4.2-.9L20 7.3a1.8 1.8 0 0 0 0-2.6l-.7-.7a1.8 1.8 0 0 0-2.6 0L4.9 15.8 4 20Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></button>' +
        '<button class="del" data-del="' + esc(p.id) + '" title="删除"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '</div></div>';
    }).join("");
    bindItemOps();
  }

  function pickWall(list, n) {
    var pool = list.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n);
  }

  function renderWall(list) {
    var box = $("#photoWall");
    if (!box || !list || !list.length) return;
    var picks = pickWall(list, Math.min(12, list.length));
    box.innerHTML = picks.map(function (p, i) {
      return '<button type="button" class="wall-item" data-w="' + i + '">' +
        '<img src="' + esc(p.src) + '" alt="' + esc(p.cap || "") + '" loading="lazy" />' +
        '<span class="wall-cap">' + esc(p.cap || "") + '</span></button>';
    }).join("");
    $$(".wall-item", box).forEach(function (b) {
      b.onclick = function () { openLightbox(picks, +b.getAttribute("data-w")); };
    });
  }

  function openLightbox(list, i) {
    var lb = $("#lightbox");
    if (!lb || !list || !list.length) return;
    state.lbList = list;
    state.lbIndex = Math.max(0, Math.min(i || 0, list.length - 1));
    paintLightbox();
    lb.classList.add("on");
    document.body.style.overflow = "hidden";
  }
  function paintLightbox() {
    var lb = $("#lightbox"), p = state.lbList[state.lbIndex];
    if (!lb || !p) return;
    $("img", lb).src = p.src;
    $("img", lb).alt = p.cap || "";
    $(".lb-cap", lb).textContent = (p.cap ? p.cap + " · " : "") +
      (state.lbIndex + 1) + " / " + state.lbList.length;
    var multi = state.lbList.length > 1;
    $(".lb-prev", lb).style.display = multi ? "grid" : "none";
    $(".lb-next", lb).style.display = multi ? "grid" : "none";
  }
  function lbStep(d) {
    if (state.lbList.length < 2) return;
    state.lbIndex = (state.lbIndex + d + state.lbList.length) % state.lbList.length;
    paintLightbox();
  }
  function closeLightbox() {
    var lb = $("#lightbox");
    if (!lb) return;
    lb.classList.remove("on");
    document.body.style.overflow = "";
    state.lbList = [];
  }

  function renderNewsDetail(cat, id) {
    var p = null;
    for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === id) { p = state.posts[i]; break; }
    if (!p) {
      $("#newsRoot").innerHTML = '<div class="empty">没有找到这篇内容，可能已被删除。<br><br><a class="back" href="#/news/' + cat + '">返回列表</a></div>';
      return;
    }
    var c = CATS[p.cat] || CATS.competition;
    var cover = p.cover ? '<div class="art-cover"><img src="' + esc(p.cover) + '" alt="" /></div>' : "";
    var gal = (p.gallery && p.gallery.length)
      ? '<div class="art-gallery">' + p.gallery.map(function (g) { return '<img src="' + esc(g) + '" alt="" loading="lazy" />'; }).join("") + '</div>'
      : "";
    var tags = (p.tags && p.tags.length)
      ? '<div class="art-tags">' + p.tags.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join("") + '</div>'
      : "";

    $("#newsRoot").innerHTML =
      '<a class="back" href="#/news/' + p.cat + '">' +
      '<svg viewBox="0 0 24 24" fill="none"><path d="M19 12H6M11 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '返回' + c.label + '</a>' +
      '<article class="art">' +
      '<div class="meta"><span class="cat">' + c.label + '</span>' +
      (p.topic ? '<span style="color:var(--ink-2)">' + esc(p.topic) + '</span>' : "") +
      '<span>' + esc(p.dateLabel || fmtDate(p.date)) + '</span>' +
      (p.pinned ? '<span style="color:var(--orange)">置顶</span>' : "") + '</div>' +
      '<h1>' + esc(p.title) + '</h1>' +
      (p.summary ? '<p class="sub">' + esc(p.summary) + '</p>' : "") +
      cover +
      '<div class="art-body">' + renderBody(p.body) + '</div>' +
      gal +
      ((p.wall && p.wall.length)
        ? '<div class="art-wall">' +
          '<div class="art-wall-h">' +
          '<span class="aw-en">PHOTOS</span>' +
          '<b>现场影像</b>' +
          '<span class="aw-n">共 ' + p.wall.length + ' 张 · 随机展示 ' + Math.min(12, p.wall.length) + ' 张</span>' +
          '<button class="aw-more" id="wallAgain" type="button">换一批' +
          '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
          '</div><div class="wall" id="photoWall"></div></div>'
        : '') +
      tags +
      '</article>';

    if (p.wall && p.wall.length) {
      renderWall(p.wall);
      var wa = $("#wallAgain");
      if (wa) wa.addEventListener("click", function () { renderWall(p.wall); });
    }
  }

  /* ============================================================
     路由
     ============================================================ */
  function parseHash() {
    var raw = (location.hash || "").replace(/^#\/?/, "");
    var parts = raw.split("/").filter(Boolean);
    if (!parts.length) return { view: "about", cat: "competition", id: null };
    var v = parts[0];
    if (v === "news") {
      var cat = CATS[parts[1]] ? parts[1] : "competition";
      return { view: "news", cat: cat, id: parts[2] ? decodeURIComponent(parts[2]) : null };
    }
    if (["about", "org", "teams", "contact"].indexOf(v) >= 0) return { view: v, cat: "competition", id: null };
    return { view: "about", cat: "competition", id: null };
  }

  function syncNav(r) {
    $$(".nav-item").forEach(function (b) {
      var go = b.getAttribute("data-go");
      var on = (go === r.view) || (r.view === "news" && go === "news");
      b.classList.toggle("is-active", on);
    });
    $$(".sub-item").forEach(function (b) {
      b.classList.toggle("is-active", r.view === "news" && b.getAttribute("data-go") === "news/" + r.cat);
    });
    var sub = $("#subNav");
    if (sub) sub.classList.toggle("open", r.view === "news");
  }

  function route() {
    var r = parseHash();
    var changedCat = (state.route.view !== "news") || (state.route.cat !== r.cat);
    state.route = r;
    if (r.view === "news" && changedCat) { state.q = ""; state.topic = ""; }

    $$(".view").forEach(function (v) {
      v.classList.toggle("is-on", v.getAttribute("data-view") === r.view);
    });
    if (r.view === "news") {
      if (r.id) renderNewsDetail(r.cat, r.id);
      else renderNewsList(r.cat);
    }
    if (r.view === "teams") renderTeams();
    syncNav(r);
    closeDrawer();
    window.scrollTo({ top: 0, behavior: "auto" });
    observeReveals();
    syncAdminUI();
  }

  /* ============================================================
     管理员
     ============================================================ */
  function isLogged() { try { return localStorage.getItem(LS_SESSION) === "1"; } catch (e) { return false; } }
  function setLogged(v) { try { v ? localStorage.setItem(LS_SESSION, "1") : localStorage.removeItem(LS_SESSION); } catch (e) { } }

  function syncAdminUI() {
    var on = state.admin;
    document.body.classList.toggle("mode-edit", on);
    $("#adminBar").classList.toggle("on", !!on);
    $("#adminEntryTxt").textContent = on ? "已登录 · 编辑模式" : "管理员登录";
    $("#adminEntry").classList.toggle("on", !!on);
    $("#abTxt").textContent = (state.posts.length + " 条资讯 · " + state.teams.length + " 支团队");
  }

  function openLogin() {
    $("#lgErr").classList.remove("on");
    $("#lgUser").value = ""; $("#lgPass").value = "";
    $("#loginModal").classList.add("on");
    setTimeout(function () { $("#lgUser").focus(); }, 120);
  }
  function doLogin() {
    var u = $("#lgUser").value.trim(), p = $("#lgPass").value;
    if (u === ADMIN_USER && hash(u + ":" + p) === ADMIN_HASH) {
      state.admin = true; setLogged(true);
      $("#loginModal").classList.remove("on");
      route();
      toast("已进入编辑模式");
    } else $("#lgErr").classList.add("on");
  }

  /* ---------------- 图片压缩 ---------------- */
  function shrinkImage(file, maxW, quality) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          var cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          var ctx = cv.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL("image/jpeg", quality || 0.72));
        };
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ---------------- 资讯编辑 ---------------- */
  function openEditor(id, cat) {
    var p = null;
    if (id) p = state.posts.filter(function (x) { return x.id === id; })[0] || null;
    state.editing = {
      id: p ? p.id : null,
      cat: p ? p.cat : (cat || "competition"),
      cover: p ? (p.cover || "") : "",
      gallery: p ? (p.gallery || []).slice() : []
    };
    $("#edTitle").textContent = p ? "编辑资讯" : "新建资讯";
    $("#edName").value = p ? p.title : "";
    $("#edDate").value = p ? (p.date || "") : new Date().toISOString().slice(0, 10);
    $("#edTopic").value = p ? (p.topic || "") : "";
    $("#edTags").value = p && p.tags ? p.tags.join("，") : "";
    $("#edSummary").value = p ? (p.summary || "") : "";
    $("#edBody").value = p ? (p.body || "") : "";
    $("#edCoverPath").value = p && p.cover && p.cover.indexOf("data:") !== 0 ? p.cover : "";
    $("#edPin").checked = !!(p && p.pinned);
    $$("#edCat button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-cat") === state.editing.cat); });
    syncTopicField();
    paintCover(); paintGallery();
    $("#editor").classList.add("on");
    setTimeout(function () { $("#edName").focus(); }, 150);
  }
  function closeEditor() { $("#editor").classList.remove("on"); state.editing = null; }

  function syncTopicField() {
    var f = $("#edTopicField");
    if (!f) return;
    f.style.display = state.editing && state.editing.cat === "competition" ? "block" : "none";
    var dl = $("#topicList");
    if (dl) dl.innerHTML = allTopics().map(function (t) { return '<option value="' + esc(t) + '">'; }).join("");
  }

  function paintCover() {
    var box = $("#edCoverPrev"), c = state.editing ? state.editing.cover : "";
    if (c) {
      box.style.display = "block";
      box.innerHTML = '<img src="' + esc(c) + '" alt="" />' +
        '<button type="button" id="edCoverDel" style="position:absolute;right:6px;top:6px;width:22px;height:22px;border-radius:50%;background:rgba(22,21,15,.75);color:#fff;font-size:12px;line-height:1">×</button>';
      box.style.position = "relative";
      var d = $("#edCoverDel");
      if (d) d.onclick = function () { state.editing.cover = ""; $("#edCoverPath").value = ""; paintCover(); };
    } else { box.style.display = "none"; box.innerHTML = ""; }
  }
  function paintGallery() {
    var box = $("#edGalPrev");
    var g = state.editing ? state.editing.gallery : [];
    box.innerHTML = g.map(function (src, i) {
      return '<div><img src="' + esc(src) + '" alt="" /><button type="button" data-gdel="' + i + '">×</button></div>';
    }).join("");
    $$("[data-gdel]", box).forEach(function (b) {
      b.onclick = function () { state.editing.gallery.splice(+b.getAttribute("data-gdel"), 1); paintGallery(); };
    });
  }

  function saveEditor() {
    var title = $("#edName").value.trim();
    if (!title) { toast("请先填写标题"); $("#edName").focus(); return; }
    var tagsRaw = $("#edTags").value.trim();
    var post = {
      id: state.editing.id || uid("p"),
      cat: state.editing.cat,
      title: title,
      date: $("#edDate").value || new Date().toISOString().slice(0, 10),
      topic: state.editing.cat === "competition" ? $("#edTopic").value.trim() : "",
      tags: tagsRaw ? tagsRaw.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean) : [],
      summary: $("#edSummary").value.trim(),
      cover: state.editing.cover || $("#edCoverPath").value.trim(),
      body: $("#edBody").value,
      gallery: state.editing.gallery.slice(),
      pinned: $("#edPin").checked
    };
    var idx = -1;
    for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === post.id) { idx = i; break; }
    if (idx >= 0) state.posts[idx] = post; else state.posts.unshift(post);
    if (!saveDraft()) return;
    closeEditor();
    route();
    toast(idx >= 0 ? "已保存修改" : "已添加，记得点「发布」才会对外可见");
  }

  function deletePost(id) {
    var p = state.posts.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!confirm("确认删除《" + p.title + "》？\n删除后需要点「发布」才会对外生效。")) return;
    state.posts = state.posts.filter(function (x) { return x.id !== id; });
    saveDraft(); route(); toast("已删除");
  }

  function bindItemOps() {
    $$("[data-edit]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openEditor(b.getAttribute("data-edit")); };
    });
    $$("[data-del]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); e.stopPropagation(); deletePost(b.getAttribute("data-del")); };
    });
  }

  /* ============================================================
     发布 / 导入
     ============================================================ */
  function buildFile() {
    var data = {
      version: ((window.JNU_CONTENT && window.JNU_CONTENT.version) || 1) + 1,
      updatedAt: new Date().toISOString().slice(0, 10),
      posts: state.posts,
      teams: state.teams
    };
    return "/* 站点内容数据（由后台「发布」生成于 " + data.updatedAt + "） */\n" +
      "window.JNU_CONTENT = " + JSON.stringify(data, null, 2) + ";\n";
  }

  function publish() {
    var blob = new Blob([buildFile()], { type: "text/javascript;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "content.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    showPublishHelp();
  }

  function showPublishHelp() {
    var m = document.createElement("div");
    m.className = "modal on";
    m.innerHTML = '<div class="modal-card">' +
      '<button class="modal-close" data-close aria-label="关闭"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
      '<h3>已下载 content.js</h3>' +
      '<p class="m-lede">把它上传到网站服务器，覆盖 <b>data/content.js</b>，所有人就能看到新内容了。资讯和团队都在这个文件里。</p>' +
      '<div class="helpbox"><h4>上线三步</h4><ol>' +
      '<li>在网站目录里找到 <b>data/content.js</b></li>' +
      '<li>用刚下载的 <b>content.js</b> 覆盖它</li>' +
      '<li>重新部署 / 上传该文件，刷新页面即可生效</li>' +
      '</ol></div>' +
      '<p style="font-size:12.2px;color:var(--muted);margin-top:12px;line-height:1.7">' +
      '发布之前，你看到的改动只保存在这台电脑的浏览器里。换设备或换浏览器看到的就是线上版本的内容。</p>' +
      '<button class="btn" style="width:100%;justify-content:center;margin-top:16px" data-close>知道了</button>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener("click", function (e) {
      if (e.target === m || e.target.closest("[data-close]")) m.remove();
    });
  }

  function importFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var txt = String(fr.result);
        var s = txt.indexOf("{"), e = txt.lastIndexOf("}");
        if (s < 0 || e < 0) throw new Error("format");
        var obj = JSON.parse(txt.slice(s, e + 1));
        var posts = Array.isArray(obj.posts) ? obj.posts : (Array.isArray(obj) ? obj : null);
        if (!posts) throw new Error("format");
        posts = posts.filter(function (p) { return p && p.title; });
        var teams = Array.isArray(obj.teams) ? obj.teams.filter(function (t) { return t && t.name; }) : null;
        if (!confirm("导入 " + posts.length + " 条资讯" + (teams ? "、" + teams.length + " 支团队" : "") + "，将覆盖当前本地内容。继续？")) return;
        state.posts = posts;
        if (teams) state.teams = teams;
        saveDraft(); route();
        toast("已导入，记得点「发布」");
      } catch (err) {
        toast("导入失败：这个文件不是有效的内容数据");
      }
    };
    fr.readAsText(file);
  }

  /* ============================================================
     动效
     ============================================================ */
  var io = ("IntersectionObserver" in window) ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }) : null;

  function revealVisible() {
    var vh = window.innerHeight || 800;
    $$(".reveal:not(.in)").forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh * 0.94 && r.bottom > -40) el.classList.add("in");
    });
  }
  function observeReveals() {
    $$(".reveal").forEach(function (el) {
      if (el.classList.contains("in")) return;
      if (io) io.observe(el); else el.classList.add("in");
    });
    revealVisible();
  }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var cio = (("IntersectionObserver" in window) && !reduce) ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target, target = parseInt(el.getAttribute("data-count"), 10) || 0;
      var t0 = null, dur = 1100;
      el.textContent = "0";
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
      cio.unobserve(el);
    });
  }, { threshold: 0.5 }) : null;

  var ticking = false;
  function onScroll() {
    var y = window.pageYOffset || document.documentElement.scrollTop;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    var p = $("#prog");
    if (p) p.style.transform = "scaleX(" + (h > 0 ? Math.min(y / h, 1) : 0) + ")";
    revealVisible();
    ticking = false;
  }

  function closeDrawer() { document.body.classList.remove("nav-open"); }

  /* ============================================================
     绑定
     ============================================================ */
  function bind() {
    $$("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { location.hash = "#/" + b.getAttribute("data-go"); });
    });

    $("#burger").addEventListener("click", function () { document.body.classList.toggle("nav-open"); });
    $("#scrim").addEventListener("click", closeDrawer);

    function exitAdmin() {
      state.admin = false; setLogged(false); syncAdminUI(); route(); toast("已退出编辑模式");
    }
    $("#adminEntry").addEventListener("click", function () { state.admin ? exitAdmin() : openLogin(); });
    $("#adminEntryM").addEventListener("click", function () { state.admin ? exitAdmin() : openLogin(); });

    $("#btnLogin").addEventListener("click", doLogin);
    $("#lgPass").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("#loginModal").addEventListener("click", function (e) {
      if (e.target === this || e.target.closest("[data-close]")) this.classList.remove("on");
    });

    $("#btnPublish").addEventListener("click", publish);
    $("#btnImport").addEventListener("click", function () { $("#fileImport").click(); });
    $("#fileImport").addEventListener("change", function () {
      if (this.files && this.files[0]) importFile(this.files[0]);
      this.value = "";
    });
    $("#btnExit").addEventListener("click", exitAdmin);
    var br = $("#btnReload");
    if (br) br.addEventListener("click", function () {
      if (!confirm("丢弃本地未发布的修改，重新读取服务器上的最新内容？\n（会重新加载页面）")) return;
      try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
      location.reload();
    });

    /* 资讯编辑器 */
    $("#edClose").addEventListener("click", closeEditor);
    $("#edCancel").addEventListener("click", closeEditor);
    $("#edSave").addEventListener("click", saveEditor);
    $$("#edCat button").forEach(function (b) {
      b.addEventListener("click", function () {
        state.editing.cat = b.getAttribute("data-cat");
        $$("#edCat button").forEach(function (o) { o.classList.remove("on"); });
        b.classList.add("on");
        syncTopicField();
      });
    });
    $("#edCoverDrop").addEventListener("click", function () { $("#fileCover").click(); });
    $("#fileCover").addEventListener("change", function () {
      var f = this.files && this.files[0]; this.value = "";
      if (!f) return;
      shrinkImage(f, 1200, 0.74).then(function (d) {
        state.editing.cover = d; $("#edCoverPath").value = ""; paintCover();
      });
    });
    $("#edGalDrop").addEventListener("click", function () { $("#fileGal").click(); });
    $("#fileGal").addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []); this.value = "";
      if (!files.length) return;
      toast("正在压缩图片…");
      Promise.all(files.map(function (f) { return shrinkImage(f, 1100, 0.7); })).then(function (arr) {
        state.editing.gallery = state.editing.gallery.concat(arr);
        paintGallery();
        toast("已添加 " + arr.length + " 张图片");
      });
    });

    /* 团队编辑器 */
    $("#tmClose").addEventListener("click", closeTeamEditor);
    $("#tmCancel").addEventListener("click", closeTeamEditor);
    $("#tmSave").addEventListener("click", saveTeam);
    $("#tmDel").addEventListener("click", function () {
      if (state.teamEditing && state.teamEditing.id) deleteTeam(state.teamEditing.id);
    });
    $("#tmCoverDrop").addEventListener("click", function () { $("#fileTmCover").click(); });
    $("#fileTmCover").addEventListener("change", function () {
      var f = this.files && this.files[0]; this.value = "";
      if (!f) return;
      shrinkImage(f, 1100, 0.76).then(function (d) {
        state.teamEditing.cover = d; $("#tmCoverPath").value = ""; paintTmCover();
      });
    });
    $("#tmGalDrop").addEventListener("click", function () { $("#fileTmGal").click(); });
    $("#fileTmGal").addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []); this.value = "";
      if (!files.length) return;
      toast("正在压缩图片…");
      Promise.all(files.map(function (f) { return shrinkImage(f, 1100, 0.7); })).then(function (arr) {
        state.teamEditing.gallery = state.teamEditing.gallery.concat(arr);
        paintTmGallery();
        toast("已添加 " + arr.length + " 张图片");
      });
    });
    $("#tmAddAward").addEventListener("click", function () {
      state.teamEditing.awards.push({ y: "", lv: "", nm: "", hi: false });
      paintAwards();
    });

    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    window.addEventListener("hashchange", route);

    var lb = $("#lightbox");
    if (lb) {
      lb.addEventListener("click", function (e) {
        if (e.target.closest(".lb-close")) return closeLightbox();
        if (e.target.closest(".lb-prev")) return lbStep(-1);
        if (e.target.closest(".lb-next")) return lbStep(1);
        if (e.target === lb) closeLightbox();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (!$("#lightbox") || !$("#lightbox").classList.contains("on")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") lbStep(-1);
      else if (e.key === "ArrowRight") lbStep(1);
    });

    var tt = $("#toTop");
    if (tt) tt.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

    var y = $("#year");
    if (y) y.textContent = new Date().getFullYear();
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var d = loadDraft();
    var s = seed();
    state.posts = d ? d.posts : s.posts;
    state.teams = d ? d.teams : s.teams;
    state.admin = isLogged();
    bind();
    route();
    if (staleDropped) {
      setTimeout(function () {
        toast("线上内容已更新，已自动切换到最新版本（旧草稿已备份，不会丢）");
      }, 700);
    }
    observeReveals();
    if (cio) $$("[data-count]").forEach(function (el) { cio.observe(el); });
    onScroll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
