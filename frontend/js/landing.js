/**
 * ScriptureCast — Landing Page Carousel Controller
 * Cycles through Bible verses infinitely with smooth fade-slide transitions.
 */
document.addEventListener('DOMContentLoaded', () => {
    const slides = document.querySelectorAll('.carousel-slide');
    const track = document.querySelector('.carousel-track');
    if (slides.length === 0 || !track) return;

    let currentIndex = 0;
    let intervalId = null;
    const ROTATION_INTERVAL = 6000; // 6 seconds

    function showSlide(index) {
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
            // Accessibility: hide inactive slides from screen readers
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

    // Set initial ARIA state for slides
    slides.forEach((slide, i) => {
        if (i === 0) {
            slide.removeAttribute('aria-hidden');
        } else {
            slide.setAttribute('aria-hidden', 'true');
        }
    });

    // Start auto-rotation
    startRotation();

    // Pause rotation when user hovers or focuses on the carousel for accessibility
    track.addEventListener('mouseenter', stopRotation);
    track.addEventListener('mouseleave', startRotation);
    
    track.addEventListener('focusin', stopRotation);
    track.addEventListener('focusout', startRotation);
});
