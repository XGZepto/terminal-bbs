/* Terminal BBS — progressive enhancements; pages work without this file. */
(function () {
    'use strict';

    var CJK = /[㐀-鿿豈-﫿]/g;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var body = document.body;

    function store(key, value) {
        try {
            if (value === undefined) { return window.localStorage.getItem(key); }
            window.localStorage.setItem(key, value);
        } catch (e) { /* storage unavailable */ }
        return null;
    }
    function chineseShare(text) {
        var t = (text || '').replace(/\s+/g, '');
        return t.length ? (t.match(CJK) || []).length / t.length : 0;
    }
    function detectLang(root) {
        root.querySelectorAll('[data-detect-lang]').forEach(function (el) {
            if (!el.hasAttribute('lang') && chineseShare(el.textContent) > 0.3) {
                el.setAttribute('lang', el.closest('[lang="zh-Hans"]') ? 'zh-Hans' : 'zh-Hant');
            }
        });
    }
    // Ghost's reading time for one language (275 wpm, one CJK character counts as one word).
    function minutes(el) {
        var text = el.textContent || '';
        var cjk = (text.match(CJK) || []).length;
        var words = (text.replace(CJK, ' ').match(/[A-Za-z0-9À-ɏ'’-]+/g) || []).length;
        var seconds = (cjk + words) / (275 / 60);
        for (var n = 12; n > 12 - el.querySelectorAll('img').length; n--) { seconds += Math.max(n, 3); }
        return Math.max(1, Math.round(seconds / 60));
    }
    function rgb(hex) {
        var h = hex.trim().replace('#', '');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    function whenLoaded(img, fn) {
        if (img.complete && img.naturalWidth) { fn(); } else { img.addEventListener('load', fn, {once: true}); }
    }

    // ---------- Clock in the site's timezone ----------
    function clock() {
        var el = document.querySelector('[data-clock]');
        if (!el) { return; }
        var tz = body.getAttribute('data-timezone') || undefined;
        function tick() {
            try {
                el.textContent = new Intl.DateTimeFormat('en-GB', {timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short'}).format(new Date());
            } catch (e) { el.textContent = ''; }
        }
        tick();
        setInterval(tick, 20000);
    }

    // ---------- Ordered (Bayer 4×4) dither ----------
    var B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    function dither(img, w, fg, bg, gamma) {
        var h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth));
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        var x = c.getContext('2d');
        x.drawImage(img, 0, 0, w, h);
        var d = x.getImageData(0, 0, w, h);
        var px = d.data;
        for (var y = 0; y < h; y++) {
            for (var i = 0; i < w; i++) {
                var k = (y * w + i) * 4;
                var l = (0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]) / 255;
                var col = Math.pow(l, gamma) > (B4[((y & 3) << 2) + (i & 3)] + 0.5) / 16 ? fg : bg;
                px[k] = col[0]; px[k + 1] = col[1]; px[k + 2] = col[2]; px[k + 3] = 255;
            }
        }
        x.putImageData(d, 0, 0);
        return c;
    }

    // ---------- Home: dithered cover, logo in block characters, boot log ----------
    function hero() {
        var section = document.querySelector('.hero');
        if (!section) { return; }
        var cover = section.getAttribute('data-cover');
        if (cover) {
            var img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = cover;
            whenLoaded(img, function () {
                try {
                    var d = dither(img, 420, [62, 76, 67], [11, 13, 12], 1.1);
                    var canvas = section.querySelector('.hero-bg');
                    canvas.width = d.width;
                    canvas.height = d.height;
                    canvas.getContext('2d').drawImage(d, 0, 0);
                    section.classList.add('has-bg');
                } catch (e) { /* cross-origin image: plain hero */ }
            });
        }

        var title = section.querySelector('[data-banner]');
        if (title) {
            var logo = new Image();
            logo.crossOrigin = 'anonymous';
            logo.src = title.getAttribute('data-banner');
            whenLoaded(logo, function () {
                var art = blocks(logo, 64);
                if (!art) { return; }
                var label = title.textContent;
                title.textContent = '';
                var sr = document.createElement('span');
                sr.className = 'sr-only';
                sr.textContent = label;
                var pic = document.createElement('span');
                pic.setAttribute('aria-hidden', 'true');
                pic.textContent = art;
                title.append(sr, pic);
                title.classList.add('is-blocks');
                fitWidth(title, 4);
            });
        }


        var boot = section.querySelector('[data-boot]');
        if (boot) {
            var host = location.hostname || 'localhost';
            var lines = ['Trying ' + host + '...', 'Connected to ' + host + '.', "Escape character is '^]'."];
            var seen = true;
            try { seen = window.sessionStorage.getItem('bbs-boot') === '1'; window.sessionStorage.setItem('bbs-boot', '1'); } catch (e) { /* keep quiet */ }
            if (seen || reduce) {
                boot.textContent = lines[1];
            } else {
                var n = 0;
                var t = setInterval(function () {
                    boot.textContent = lines.slice(0, ++n).join('\n');
                    if (n >= lines.length) { clearInterval(t); }
                }, 420);
            }
        }
    }

    // Shrinks the block-character banner until it fits the width it has (never below minPx);
    // past that it wraps as normal. Refits on resize and once web fonts load.
    function fitWidth(el, minPx) {
        function fit() {
            el.style.fontSize = '';
            var size = parseFloat(getComputedStyle(el).fontSize);
            var room = el.clientWidth;
            if (!room || el.scrollWidth <= room) { return; }
            var next = Math.floor(size * room / el.scrollWidth * 10) / 10;
            if (next >= minPx) { el.style.fontSize = next + 'px'; } else { el.style.whiteSpace = 'normal'; }
        }
        fit();
        if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fit); }
        var t;
        window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(fit, 120); });
    }

    // A logo redrawn as half-block characters (two pixels per character cell).
    function blocks(img, cols) {
        try {
            // A character cell is 0.6em wide and 1.32em tall, so each half-block pixel is 0.6 × 0.66em.
            var rows2 = Math.max(2, Math.round(cols * (img.naturalHeight / img.naturalWidth) * (0.6 / 0.66)));
            rows2 += rows2 % 2;
            var c = document.createElement('canvas');
            c.width = cols;
            c.height = rows2;
            var x = c.getContext('2d');
            x.drawImage(img, 0, 0, cols, rows2);
            var px = x.getImageData(0, 0, cols, rows2).data;
            var opaque = true;
            for (var a = 3; a < px.length; a += 4) { if (px[a] < 250) { opaque = false; break; } }
            var base = (px[0] + px[1] + px[2]) / 3;
            function on(i, y) {
                var k = (y * cols + i) * 4;
                if (!opaque) { return px[k + 3] > 110; }
                return Math.abs((px[k] + px[k + 1] + px[k + 2]) / 3 - base) > 60;
            }
            var out = [];
            for (var y = 0; y < rows2; y += 2) {
                var line = '';
                for (var i = 0; i < cols; i++) {
                    var top = on(i, y);
                    var bottom = on(i, y + 1);
                    line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
                }
                out.push(line.replace(/\s+$/, ''));
            }
            while (out.length && !out[0].trim()) { out.shift(); }
            while (out.length && !out[out.length - 1].trim()) { out.pop(); }
            var lead = Math.min.apply(null, out.filter(function (l) { return l.trim(); }).map(function (l) { return l.match(/^ */)[0].length; }));
            out = out.map(function (l) { return l.slice(lead); });
            return out.length ? out.join('\n') : null;
        } catch (e) {
            return null;
        }
    }

    // ---------- Board: numbering, selection, preview, keys ----------
    function board() {
        var section = document.querySelector('.board');
        if (!section) { return; }
        var rows = Array.prototype.slice.call(section.querySelectorAll('.rows .row'));
        var total = +section.getAttribute('data-total') || rows.length;
        var page = +section.getAttribute('data-page') || 1;
        var limit = +section.getAttribute('data-limit') || rows.length;
        rows.forEach(function (r, i) {
            r.querySelector('[data-n]').textContent = total - (page - 1) * limit - i;
            var label = r.querySelector('[data-lang-label]');
            if (label && chineseShare(r.querySelector('.c-t').textContent + r.querySelector('.row-x').textContent) > 0.3) {
                label.textContent = '中';
                label.className = 'l-zh';
            }
        });
        var preview = section.querySelector('[data-preview]');
        var sel = -1;
        function select(i, scroll) {
            if (!rows.length) { return; }
            sel = (i + rows.length) % rows.length;
            rows.forEach(function (r, k) { r.classList.toggle('is-sel', k === sel); });
            var r = rows[sel];
            var title = r.querySelector('.c-t');
            var x = r.querySelector('.row-x').textContent.trim();
            preview.innerHTML = '';
            var p1 = document.createElement('p');
            p1.className = 'pv-t';
            p1.innerHTML = '<span class="or">▸ #' + r.querySelector('[data-n]').textContent + '</span> ';
            var t = document.createElement('span');
            t.textContent = title.textContent;
            if (title.lang) { t.lang = title.lang; }
            p1.appendChild(t);
            var p2 = document.createElement('p');
            p2.className = 'pv-x';
            p2.textContent = x;
            if (chineseShare(x) > 0.3) { p2.lang = 'zh-Hant'; }
            var p3 = document.createElement('p');
            p3.className = 'dim small';
            p3.textContent = r.querySelector('.c-d').textContent + ' · ' + r.querySelector('.c-m').textContent + ' · ';
            var a = document.createElement('a');
            a.href = r.href;
            a.textContent = '[Enter] 閱讀 read';
            p3.appendChild(a);
            preview.append(p1, p2, p3);
            if (scroll) { r.scrollIntoView({block: 'nearest'}); r.focus({preventScroll: true}); }
        }
        // One cursor: hovering moves the selection and, if a row has keyboard focus, the focus with it.
        rows.forEach(function (r, i) {
            r.addEventListener('mouseenter', function () {
                if (sel === i) { return; }
                select(i);
                if (rows.indexOf(document.activeElement) !== -1) { r.focus({preventScroll: true}); }
            });
            r.addEventListener('focus', function () { if (sel !== i) { select(i); } });
        });
        select(0);
        document.addEventListener('keydown', function (e) {
            if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || document.documentElement.matches('.search-open, .member-open')) { return; }
            if (e.key === 'j') { select(sel + 1, true); }
            else if (e.key === 'k') { select(sel - 1, true); }
        });
    }

    // ---------- Post content ----------
    function prepContent(content) {
        content.querySelectorAll('table').forEach(function (t) {
            var w = document.createElement('div');
            w.className = 'table-wrap';
            w.tabIndex = 0;
            w.setAttribute('role', 'region');
            w.setAttribute('aria-label', 'Table');
            t.replaceWith(w);
            w.appendChild(t);
        });
        content.querySelectorAll('pre > code').forEach(function (c) {
            var m = (c.className || '').match(/language-([\w-]+)/);
            if (m) { c.parentElement.setAttribute('data-lang', m[1]); }
        });
        var n = 0;
        content.querySelectorAll('figure.kg-image-card').forEach(function (f) {
            var img = f.querySelector('img');
            if (!img) { return; }
            n++;
            var w = +img.getAttribute('width');
            var h = +img.getAttribute('height');
            f.classList.add('fig');
            if (w && h && h > w * 1.15) { f.classList.add('is-tall'); }
            else if (w && w < 700) { f.classList.add('is-small'); }
            var bar = document.createElement('div');
            bar.className = 'figbar';
            var name = document.createElement('span');
            name.textContent = 'fig.' + n + ' ' + decodeURIComponent((img.getAttribute('src') || '').split('/').pop().split('?')[0]);
            var stat = document.createElement('span');
            stat.setAttribute('data-stat', '');
            stat.textContent = w && h ? w + '×' + h : '';
            bar.append(name, stat);
            var wrap = document.createElement('div');
            wrap.className = 'imgwrap';
            img.replaceWith(wrap);
            wrap.appendChild(img);
            f.prepend(bar);
            img.loading = 'eager';
        });
    }

    // Images arrive as a dithered scan, then develop top-down into the real image.
    function develop(fig) {
        var img = fig.querySelector('.imgwrap img');
        var stat = fig.querySelector('[data-stat]');
        var wrap = fig.querySelector('.imgwrap');
        if (!img || !wrap) { return; }
        if (stat && !stat.textContent) {
            // With srcset, naturalWidth is scaled by the candidate's density; a plain Image reports the file's own size.
            whenLoaded(img, function () {
                var probe = new Image();
                probe.onload = function () {
                    var size = probe.naturalWidth + '×' + probe.naturalHeight;
                    stat.setAttribute('data-size', size);
                    if (/✓$/.test(stat.textContent)) { stat.textContent = size + '  ✓'; }
                    else if (!wrap.querySelector('.dith')) { stat.textContent = size; }
                };
                probe.src = img.currentSrc || img.src;
            });
        }
        if (reduce || !body.hasAttribute('data-develop') || !('IntersectionObserver' in window)) { return; }
        whenLoaded(img, function () {
            var c;
            try {
                var fg = rgb(getComputedStyle(body).getPropertyValue('--fg') || '#D9DDD4');
                c = dither(img, 260, fg, [14, 17, 15], 0.95);
            } catch (e) { return; }
            c.className = 'dith';
            c.setAttribute('aria-hidden', 'true');
            var scan = document.createElement('div');
            scan.className = 'scanline';
            wrap.append(c, scan);
            var label = stat ? stat.textContent : '';
            if (stat) { stat.textContent = 'waiting…'; }
            var io = new IntersectionObserver(function (es) {
                if (!es.some(function (e) { return e.isIntersecting; })) { return; }
                io.disconnect();
                var t0 = performance.now();
                (function step(t) {
                    var k = Math.min(1, (t - t0) / 1150);
                    var rows = Math.floor(k * 30) / 30;
                    c.style.clipPath = 'inset(' + (rows * 100) + '% 0 0 0)';
                    scan.style.top = (rows * 100) + '%';
                    if (stat) { stat.textContent = k < 1 ? 'receiving ' + Math.round(k * 100) + '%' : (stat.getAttribute('data-size') || label) + '  ✓'; }
                    if (k < 1) { requestAnimationFrame(step); } else { c.remove(); scan.remove(); }
                })(t0);
            }, {threshold: 0.35});
            io.observe(wrap);
        });
    }

    // A #bilingual post holds its Chinese text, a divider, then its English text.
    function bilingual(content) {
        var kids = Array.prototype.slice.call(content.children);
        var at = kids.findIndex(function (n) { return n.tagName === 'HR'; });
        if (at < 1 || at === kids.length - 1) { return null; }
        var zh = document.createElement('section');
        var en = document.createElement('section');
        zh.className = en.className = 'lang-block';
        zh.setAttribute('lang', content.closest('[lang="zh-Hans"]') ? 'zh-Hans' : 'zh-Hant');
        en.setAttribute('lang', 'en');
        kids.forEach(function (n, i) {
            if (i < at) {
                if (n.tagName === 'P' && /english version follows/i.test(n.textContent) && n.textContent.trim().length < 40) { n.remove(); } else { zh.appendChild(n); }
            } else if (i > at) { en.appendChild(n); } else { n.remove(); }
        });
        content.append(zh, en);
        var article = content.closest('article');
        var group = article.querySelector('.lang');
        var buttons = article.querySelectorAll('[data-setlang]');
        var reading = article.querySelector('[data-reading-time]');
        var mins = {zh: minutes(zh), en: minutes(en)};
        function apply(lang) {
            zh.hidden = lang !== 'zh';
            en.hidden = lang !== 'en';
            buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-setlang') === lang)); });
            if (reading) { reading.textContent = mins[lang] + ' min · ' + (lang === 'zh' ? '中文' : 'English'); }
            window.dispatchEvent(new Event('scroll'));
        }
        buttons.forEach(function (b) {
            b.addEventListener('click', function () { store('bbs-lang', b.getAttribute('data-setlang')); apply(b.getAttribute('data-setlang')); });
        });
        var pref = body.getAttribute('data-default-lang');
        var saved = store('bbs-lang');
        var browser = (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
        if (group) { group.hidden = false; }
        apply(saved === 'zh' || saved === 'en' ? saved : pref === '中文' ? 'zh' : pref === 'English' ? 'en' : browser);
        return apply;
    }

    function post() {
        var content = document.querySelector('.post-wrap .gh-content');
        if (!content) { return; }
        prepContent(content);
        var article = content.closest('article');
        if (!article.hasAttribute('lang') && chineseShare(content.textContent) > 0.3) { article.setAttribute('lang', 'zh-Hant'); }
        document.querySelectorAll('.post-wrap .fig').forEach(develop);
        var setLang = content.hasAttribute('data-bilingual') ? bilingual(content) : null;

        var more = document.querySelector('[data-more]');
        if (more) {
            var ticking = false;
            var progress = function () {
                ticking = false;
                var max = document.documentElement.scrollHeight - window.innerHeight;
                var pct = max > 0 ? Math.min(100, Math.max(0, Math.round(window.scrollY / max * 100))) : 100;
                more.textContent = pct >= 99 ? '(END) 文章結束' : '--More--(' + String(pct).padStart(2, ' ') + '%)';
                more.classList.toggle('is-end', pct >= 99);
            };
            window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(progress); } }, {passive: true});
            window.addEventListener('resize', progress);
            progress();
        }
        document.addEventListener('keydown', function (e) {
            if (e.target.closest('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey || document.documentElement.matches('.search-open, .member-open')) { return; }
            if (e.key === 'q' || e.key === 'Escape') { location.href = document.querySelector('.top-brand').href; }
            else if (setLang && e.key === '1') { setLang('zh'); store('bbs-lang', 'zh'); }
            else if (setLang && e.key === '2') { setLang('en'); store('bbs-lang', 'en'); }
        });
    }

    function keys() {
        var path = document.querySelector('[data-path]');
        if (path) { path.textContent = location.pathname; }
    }

    // Search opens as a command line at the bottom of the screen; results read like board rows.
    function search() {
        if (!window.themeSearch) { return; }
        var tz = body.getAttribute('data-timezone') || undefined;
        var day;
        try { day = new Intl.DateTimeFormat('en-CA', {timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'}); } catch (e) { day = new Intl.DateTimeFormat('en-CA'); }
        window.themeSearch({
            render: function (it, h) {
                var zh = chineseShare(it.title) > 0.3 ? ' lang="zh-Hant"' : '';
                var zhx = chineseShare(h.snippet) > 0.3 ? ' lang="zh-Hant"' : '';
                return '<a href="' + h.esc(it.url) + '">' +
                    '<span class="s-d">' + day.format(new Date(it.date)).replace(/-/g, '/') + '</span>' +
                    '<span class="s-t"' + zh + '>' + h.mark(it.title, h.terms) + '</span>' +
                    '<span class="s-x"' + zhx + '>' + h.mark(h.snippet, h.terms) + '</span></a>';
            },
            text: {
                loading: '連線中… loading',
                recent: '最近的文章 · recent posts',
                found: function (n) { return n + ' 筆符合 · ' + n + ' found'; },
                none: '沒有找到 · no matches',
                error: '搜尋暫時無法使用 · search is unavailable right now'
            }
        });
    }

    // Video embeds arrive at a fixed size (often 200×113); scale them to the column, keeping their shape.
    function embeds() {
        document.querySelectorAll('.gh-content .kg-embed-card iframe[width][height]').forEach(function (f) {
            var w = parseFloat(f.getAttribute('width'));
            var h = parseFloat(f.getAttribute('height'));
            if (w > 0 && h > 0 && !/%/.test(f.getAttribute('width'))) {
                f.style.aspectRatio = w + ' / ' + h;
                f.classList.add('is-fluid');
            }
        });
    }

    function init() {
        embeds();
        clock();
        hero();
        board();
        post();
        keys();
        search();
        detectLang(document);
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
