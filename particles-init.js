import { createParticles } from "./vendor/particles.bundle.js";

const THEME_PARTICLE_COLORS = {
  light: ["#646a73"],
  dark: ["#ffffff"],
};

let destroyParticles = null;

function getTheme() {
  return document.documentElement.dataset.authTheme === "dark" ? "dark" : "light";
}

function mountParticles(theme = getTheme()) {
  const background = document.querySelector("#particlesBackground");
  if (!background) return;
  if (destroyParticles) destroyParticles();

  const cssColor = getComputedStyle(document.documentElement).getPropertyValue("--particle-color").trim();
  const particleColors = cssColor ? [cssColor] : THEME_PARTICLE_COLORS[theme] || THEME_PARTICLE_COLORS.light;
  const isAdmin = document.body.classList.contains("admin-body");

  destroyParticles = createParticles(background, {
    particleColors,
    particleCount: isAdmin ? 340 : 200,
    particleSpread: isAdmin ? 12 : 10,
    speed: isAdmin ? 0.16 : 0.1,
    particleBaseSize: isAdmin ? 145 : 100,
    moveParticlesOnHover: true,
    particleHoverFactor: isAdmin ? 1.25 : 1,
    alphaParticles: false,
    disableRotation: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  });
}

function startParticles() {
  mountParticles();
  window.addEventListener("auth-theme-change", (event) => {
    mountParticles(event.detail?.theme || getTheme());
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startParticles, { once: true });
} else {
  startParticles();
}
