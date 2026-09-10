// Keeps the `.dark` class on <html> in sync with the OS colour scheme.
// shadcn/ui components and the `dark:` Tailwind variant key off that class.
export function initTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => document.documentElement.classList.toggle("dark", mq.matches);
  apply();
  mq.addEventListener("change", apply);
}
