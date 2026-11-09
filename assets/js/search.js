/* Theme search. Ghost's built-in search is excluded in default.hbs.
   Posts come from the Content API, using the public key Ghost puts on the page for Portal, with the
   RSS feed as the fallback. Titles, tags, excerpts and full text are all searched. */
(function () {
    'use strict';

    var html = document.documentElement;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c];
        });
    }
    function norm(s) { return String(s || '').normalize('NFKC').toLowerCase(); }
    function textOf(html) { return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''; }

    function fromApi() {
        var tag = document.querySelector('script[data-key][data-api]');
        if (!tag) { return Promise.reject(new Error('no content key')); }
        var api = tag.getAttribute('data-api').replace(/\/?$/, '/');
        var url = api + 'posts/?key=' + encodeURIComponent(tag.getAttribute('data-key')) +
            '&limit=all&formats=plaintext&include=tags&fields=title,url,custom_excerpt,excerpt,published_at,reading_time,plaintext';
        return fetch(url).then(function (r) {
            if (!r.ok) { throw new Error('content api ' + r.status); }
            return r.json();
        }).then(function (j) {
            return j.posts.map(function (p) {
                return {
                    title: p.title,
                    url: p.url,
                    excerpt: p.custom_excerpt || p.excerpt || '',
                    text: p.plaintext || '',
                    tags: (p.tags || []).map(function (t) { return t.name; }).filter(function (n) { return n.charAt(0) !== '#'; }),
                    date: p.published_at,
                    mins: p.reading_time
                };
            });
        });
    }
    function fromRss() {
        var link = document.querySelector('link[rel="alternate"][type="application/rss+xml"]');
        if (!link) { return Promise.resolve([]); }
        return fetch(link.href).then(function (r) { return r.text(); }).then(function (xml) {
            var doc = new DOMParser().parseFromString(xml, 'application/xml');
            return Array.prototype.map.call(doc.getElementsByTagName('item'), function (item) {
                function get(name) { var n = item.getElementsByTagName(name)[0]; return n ? n.textContent : ''; }
                return {
                    title: get('title'),
                    url: get('link'),
                    excerpt: textOf(get('description')),
                    text: textOf(get('content:encoded')),
                    tags: Array.prototype.map.call(item.getElementsByTagName('category'), function (c) { return c.textContent; }),
                    date: new Date(get('pubDate')).toISOString(),
                    mins: null
                };
            });
        });
    }

    // Chinese terms match anywhere (no spaces between words); other terms match at the start of a word,
    // so "lion" finds Lion but not million.
    var CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
    function at(hay, term) {
        if (CJK.test(term)) { return hay.indexOf(term); }
        var i = hay.indexOf(term);
        while (i !== -1 && i > 0 && /[\p{L}\p{N}]/u.test(hay.charAt(i - 1))) { i = hay.indexOf(term, i + 1); }
        return i;
    }
    function highlight(text, terms) {
        var safe = esc(text);
        if (!terms.length) { return safe; }
        var re = new RegExp('(' + terms.map(function (t) {
            var e = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return CJK.test(t) ? e : '(?<![\\p{L}\\p{N}])' + e;
        }).join('|') + ')', 'giu');
        return safe.replace(re, '<mark>$1</mark>');
    }
    function snippet(it, terms) {
        var src = (it.text || it.excerpt || '').replace(/\s+/g, ' ').trim();
        var low = src.toLowerCase();
        var pos = -1;
        terms.forEach(function (t) {
            var i = at(low, t);
            if (i !== -1 && (pos === -1 || i < pos)) { pos = i; }
        });
        if (pos === -1) {
            var lead = (it.excerpt || src).replace(/\s+/g, ' ').trim();
            return lead.length > 160 ? lead.slice(0, 160) + '…' : lead;
        }
        var start = Math.max(0, pos - 36);
        var end = Math.min(src.length, pos + 120);
        return (start > 0 ? '…' : '') + src.slice(start, end) + (end < src.length ? '…' : '');
    }
    function find(index, q) {
        var terms = norm(q).split(/\s+/).filter(Boolean);
        if (!terms.length) { return {terms: terms, hits: index.slice(0, 8)}; }
        var scored = [];
        index.forEach(function (it) {
            var t = norm(it.title);
            var g = norm(it.tags.join(' '));
            var x = norm(it.excerpt);
            var b = norm(it.text);
            var score = 0;
            for (var k = 0; k < terms.length; k++) {
                var s = (at(t, terms[k]) !== -1 ? 10 : 0) + (at(g, terms[k]) !== -1 ? 5 : 0) + (at(x, terms[k]) !== -1 ? 3 : 0) + (at(b, terms[k]) !== -1 ? 1 : 0);
                if (!s) { return; }
                score += s;
            }
            scored.push({it: it, score: score});
        });
        scored.sort(function (a, b) { return b.score - a.score || (b.it.date > a.it.date ? 1 : -1); });
        return {terms: terms, hits: scored.slice(0, 20).map(function (s) { return s.it; })};
    }

    // opts: render(item, {terms, snippet, mark, esc, index}) → inner HTML of one result;
    //       text: {loading, recent, found(n), none, error}
    window.themeSearch = function (opts) {
        var panel = document.querySelector('[data-search-panel]');
        if (!panel) { return; }
        var input = panel.querySelector('[data-search-input]');
        var list = panel.querySelector('[data-search-results]');
        var status = panel.querySelector('[data-search-status]');
        var form = panel.querySelector('[data-search-form]');
        var index = null;
        var loading = null;
        var hits = [];
        var active = -1;
        var opener = null;
        var timer;

        function load() {
            if (!loading) { loading = fromApi().catch(fromRss).catch(function () { return null; }); }
            return loading;
        }
        function setActive(i) {
            var nodes = list.children;
            active = nodes.length ? (i + nodes.length) % nodes.length : -1;
            Array.prototype.forEach.call(nodes, function (n, k) { n.setAttribute('aria-selected', String(k === active)); });
            if (active >= 0) {
                input.setAttribute('aria-activedescendant', 'search-hit-' + active);
                nodes[active].scrollIntoView({block: 'nearest'});
            } else {
                input.removeAttribute('aria-activedescendant');
            }
        }
        function show() {
            if (!index) { return; }
            var r = find(index, input.value);
            hits = r.hits;
            list.innerHTML = hits.map(function (it, i) {
                return '<li role="option" id="search-hit-' + i + '" aria-selected="false">' +
                    opts.render(it, {terms: r.terms, snippet: snippet(it, r.terms), mark: highlight, esc: esc, index: i}) + '</li>';
            }).join('');
            status.textContent = r.terms.length ? (hits.length ? opts.text.found(hits.length) : opts.text.none) : opts.text.recent;
            setActive(hits.length ? 0 : -1);
        }
        function open(from) {
            if (!panel.hidden) { return; }
            opener = from || document.activeElement;
            panel.hidden = false;
            html.classList.add('search-open');
            input.value = '';
            list.innerHTML = '';
            status.textContent = opts.text.loading;
            setTimeout(function () { input.focus(); }, 0);
            load().then(function (data) {
                if (!data) { status.textContent = opts.text.error; return; }
                index = data;
                show();
            });
        }
        function close() {
            if (panel.hidden) { return; }
            panel.hidden = true;
            html.classList.remove('search-open');
            if (opener && opener.focus) { opener.focus(); }
        }

        document.querySelectorAll('[data-search]').forEach(function (b) {
            b.addEventListener('click', function (e) { e.preventDefault(); open(b); });
        });
        panel.querySelectorAll('[data-search-close]').forEach(function (b) { b.addEventListener('click', close); });
        input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(show, 60); });
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var hit = hits[active >= 0 ? active : 0];
            if (hit) { location.href = hit.url; }
        });
        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
            else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key !== '/' || !panel.hidden || e.metaKey || e.ctrlKey || e.altKey || html.classList.contains('member-open')) { return; }
            if (e.target.closest('input, textarea, select, [contenteditable]')) { return; }
            e.preventDefault();
            open(document.activeElement);
        });
        // A #/search link opens it directly.
        if (location.hash === '#/search') { open(); }
    };
})();
