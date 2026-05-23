// ── Scroll fade-in ───────────────────────────────────────────────────────

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll(
  '.feature-card, .problem-item, .step, .level, .collab-benefit, .compat-card, .roadmap-col, .agent-card'
).forEach((el) => {
  el.classList.add('fade-in');
  observer.observe(el);
});

// ── Nav active link on scroll ────────────────────────────────────────────

const sections = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('.nav-links a');

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navLinks.forEach((link) => {
          link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
        });
      }
    });
  },
  { rootMargin: '-40% 0px -55% 0px' }
);

sections.forEach((s) => sectionObserver.observe(s));

// ── Nav background on scroll ─────────────────────────────────────────────

const nav = document.querySelector('.nav');

window.addEventListener('scroll', () => {
  nav.style.borderBottomColor = window.scrollY > 10
    ? 'rgba(255,255,255,.09)'
    : 'rgba(255,255,255,.07)';
}, { passive: true });

// ── Stagger hero cards ───────────────────────────────────────────────────

document.querySelectorAll('.hero-card-wrap .agent-card').forEach((card, i) => {
  card.style.transitionDelay = `${i * 80}ms`;
});
