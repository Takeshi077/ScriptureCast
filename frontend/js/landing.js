/**
 * ScriptureCast — Landing Page
 * Carousel, scroll animations, sticky showcase, download detection
 */

/* ── Scroll-triggered fade-in ── */
function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.anim-fade-up').forEach(el => observer.observe(el));
}

/* ── Sticky Showcase ── */
function initShowcase() {
    const steps = document.querySelectorAll('.showcase-step');
    const label = document.getElementById('showcase-label');
    const visual = document.getElementById('showcase-visual');
    if (!steps.length || !label || !visual) return;

    const showcaseData = [
        {
            label: 'Auto-Detection',
            html: `
                <div class="sv-transcript">
                    <span class="sv-faded">"...turn to "</span><span class="sv-ref">John 3:16</span><span class="sv-faded">" in your Bibles..."</span>
                </div>
                <div class="sv-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
                <div class="sv-verse">
                    <div class="sv-verse-ref">John 3:16</div>
                    <div class="sv-verse-text">"For God so loved the world, that he gave his only begotten Son..."</div>
                </div>`
        },
        {
            label: 'Quote Detection',
            html: `
                <div class="sv-transcript">
                    <span class="sv-faded">"...and the scripture says '</span><span class="sv-ref">love your neighbor as yourself</span><span class="sv-faded">'"</span>
                </div>
                <div class="sv-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
                <div class="sv-verse">
                    <div class="sv-verse-ref">Mark 12:31</div>
                    <div class="sv-verse-text">"The second is this: 'Love your neighbor as yourself.' There is no commandment greater than these."</div>
                </div>`
        },
        {
            label: 'Confidence Scoring',
            html: `
                <div class="sv-transcript">
                    <span class="sv-faded">"...Paul wrote to the church in..."</span>
                </div>
                <div class="sv-arrow"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg></div>
                <div class="sv-verse">
                    <div class="sv-verse-ref" style="opacity:0.5">Romans 8:28</div>
                    <div class="sv-verse-text" style="opacity:0.5">Candidate — awaiting operator confirmation</div>
                    <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
                        <span style="padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;background:rgba(52,211,153,0.15);color:#34d399;cursor:pointer">Confirm</span>
                        <span style="padding:4px 12px;border-radius:4px;font-size:11px;font-weight:600;background:rgba(244,63,94,0.1);color:#f43f5e;cursor:pointer">Dismiss</span>
                    </div>
                </div>`
        },
        {
            label: 'Live Transcription',
            html: `
                <div class="sv-transcript" style="min-height:120px">
                    <span class="sv-faded">00:01 — "Welcome everyone, let's open our Bibles to..."</span><br>
                    <span class="sv-faded">00:12 — "John chapter 3, verse 16 says..."</span><br>
                    <span style="color:var(--text-secondary)">00:24 — "And as Paul tells us in Romans 8..."</span><br>
                    <span class="sv-faded" style="opacity:0.4">00:31 — |</span>
                </div>
                <div style="text-align:center;margin-top:8px">
                    <span style="font-size:11px;color:var(--accent-violet);font-weight:600">● REC</span>
                </div>`
        }
    ];

    function setActive(index) {
        steps.forEach((s, i) => s.classList.toggle('active', i === index));
        label.textContent = showcaseData[index].label;
        visual.style.opacity = '0';
        setTimeout(() => {
            visual.innerHTML = showcaseData[index].html;
            visual.style.opacity = '1';
        }, 200);
    }

    // Click to select
    steps.forEach((step, i) => {
        step.addEventListener('click', () => setActive(i));
    });

    // Scroll-based activation
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const idx = parseInt(entry.target.dataset.step);
                if (!isNaN(idx)) setActive(idx);
            }
        });
    }, { threshold: 0.6 });

    steps.forEach(step => observer.observe(step));
}

/* ── Hero Carousel ── */
function initCarousel() {
    const slides = document.querySelectorAll('.carousel-slide');
    const track = document.querySelector('.carousel-track');
    if (slides.length === 0 || !track) return;

    let currentIndex = 0;
    let intervalId = null;
    const ROTATION_INTERVAL = 6000;

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
            slide.setAttribute('aria-hidden', i !== index ? 'true' : 'false');
        });
    }

    function nextSlide() {
        currentIndex = (currentIndex + 1) % slides.length;
        showSlide(currentIndex);
    }

    function startRotation() {
        if (intervalId) return;
        intervalId = setInterval(nextSlide, ROTATION_INTERVAL);
    }

    function stopRotation() {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }

    slides.forEach((slide, i) => {
        slide.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
    });

    startRotation();
    track.addEventListener('mouseenter', stopRotation);
    track.addEventListener('mouseleave', startRotation);
    track.addEventListener('focusin', stopRotation);
    track.addEventListener('focusout', startRotation);
}

/* ── Download OS Detection ── */
function initDownload() {
    const userAgent = navigator.userAgent.toLowerCase();
    let detected = 'windows';

    if (userAgent.includes('mac os') || userAgent.includes('macintosh')) detected = 'macos';
    else if (userAgent.includes('linux') && !userAgent.includes('android')) detected = 'linux';

    document.querySelectorAll('.download-card').forEach(card => {
        if (card.dataset.os === detected) {
            card.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            card.style.boxShadow = '0 0 0 1px rgba(56, 189, 248, 0.3), 0 8px 32px rgba(56, 189, 248, 0.1)';
        }
    });

    document.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const platform = btn.dataset.platform;
            if (platform === 'windows') return;

            e.preventDefault();
            try {
                const res = await fetch('https://api.github.com/repos/Takeshi077/ScriptureCast/releases/latest');
                if (res.ok) {
                    const data = await res.json();
                    const asset = data.assets.find(a => a.name.toLowerCase().includes(platform));
                    if (asset) { window.location.href = asset.browser_download_url; return; }
                }
            } catch {}

            btn.textContent = 'Coming Soon';
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
        });
    });
}

/* ── Mobile Menu ── */
function initMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const closeBtn = document.getElementById('mobile-menu-close');
    const nav = document.getElementById('nav-links');
    if (!btn || !nav) return;

    btn.addEventListener('click', () => nav.classList.toggle('active'));
    if (closeBtn) closeBtn.addEventListener('click', () => nav.classList.remove('active'));

    document.addEventListener('click', (e) => {
        if (!btn.contains(e.target) && !nav.contains(e.target)) nav.classList.remove('active');
    });

    nav.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => nav.classList.remove('active'));
    });
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
    initCarousel();
    initDownload();
    initMobileMenu();
    initScrollAnimations();
    initShowcase();
});
