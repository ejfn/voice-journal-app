declare module "react-test-renderer" {
  import React from "react";

  export interface ReactTestRenderer {
    root: {
      findAllByProps: (props: Record<string, unknown>) => unknown[];
    };
  }

  export function act(callback: () => void): void;

  const renderer: {
    create: (element: React.ReactElement) => ReactTestRenderer;
  };

  export default renderer;
}
