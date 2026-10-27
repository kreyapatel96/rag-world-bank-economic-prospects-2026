import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownAnswer } from "@/components/markdown-answer";

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownAnswer, { text }));

describe("MarkdownAnswer", () => {
  it("renders bold text, bullets and citation chips", () => {
    const html = render(
      "Growth is **6.3 percent** [S2].\n\n- India: 6.6 percent [S2][S4]\n- Bangladesh: 4 percent",
    );
    expect(html).toContain("<strong");
    expect(html).toContain("<li>");
    expect(html.match(/aria-label="Show reference S2"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Show reference S4"');
    expect(html).not.toContain("**");
  });

  it("does not render raw HTML from the model", () => {
    const html = render("Hello <script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });
});
