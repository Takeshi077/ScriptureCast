/**
 * ScriptureCast — Landing Page Carousel Controller + OS Detection
 */

/* ── Carousel ── */
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
            if (i === index) {
                slide.removeAttribute('aria-hidden');
            } else {
                slide.setAttribute('aria-hidden', 'true');
            }
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
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }

    slides.forEach((slide, i) => {
        if (i === 0) {
            slide.removeAttribute('aria-hidden');
        } else {
            slide.setAttribute('aria-hidden', 'true');
        }
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

    if (userAgent.includes('mac os') || userAgent.includes('macintosh')) {
        detected = 'macos';
    } else if (userAgent.includes('linux') && !userAgent.includes('android')) {
        detected = 'linux';
    }

    const cards = document.querySelectorAll('.download-card');
    cards.forEach(card => {
        if (card.dataset.os === detected) {
            card.classList.add('highlight');
        }
    });

    const buttons = document.querySelectorAll('.download-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            const platform = btn.dataset.platform;

            // Try to fetch release info from GitHub, fallback to placeholder
            try {
                const res = await fetch('https://api.github.com/repos/Takeshi077/ScriptureCast/releases/latest');
                if (res.ok) {
                    const data = await res.json();
                    const asset = data.assets.find(a => a.name.toLowerCase().includes(platform));
                    if (asset) {
                        window.location.href = asset.browser_download_url;
                        return;
                    }
                }
            } catch {}

            // Notify user if no release is available yet
            btn.textContent = 'Coming Soon';
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.5';
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initCarousel();
    initDownload();
});
