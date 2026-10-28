import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "ai-assistant": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        app?: string;
        api?: string;
        position?: string;
        lang?: string;
        suggestions?: string;
      };
    }
  }
}
