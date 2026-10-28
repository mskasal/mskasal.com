/**
 * Replaces the page with `html` on the site's origin and exposes the given
 * annotation modules as window.<name> (e.g. { A: "anchor.js" }).
 */
export async function mount(page, html, modules) {
  await page.goto("/healthz");
  const imports = Object.entries(modules)
    .map(([name, file]) => `import * as ${name} from "/assets/annotate/${file}"; window.${name} = ${name};`)
    .join("\n");
  await page.setContent(`${html}<script type="module">${imports} window.__ready = true;</script>`);
  await page.waitForFunction(() => window.__ready === true);
}
