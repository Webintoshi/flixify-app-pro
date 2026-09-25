import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {} }) }));
vi.mock("./platform/session", () => ({ usePlatform: () => ({ session: null, ready: false }) }));
vi.mock("./platform/catalog", () => ({ default: () => null }));
vi.mock("./platform/landing", () => ({ Landing: () => null }));

import HomePage from "./page";

it("shows branded loading content before the browser session is ready", () => {
  const html = renderToStaticMarkup(createElement(HomePage));
  expect(html).toContain("Flixify hazırlanıyor");
  expect(html).toContain("/logo/flixify-logo.png");
});
