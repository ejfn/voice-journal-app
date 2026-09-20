declare module "react-test-renderer" {
  import React from "react";

  export interface ReactTestRenderer {
    root: {
      findAll: (
        predicate: (node: { props: Record<string, unknown> }) => boolean,
      ) => Array<{ props: Record<string, unknown> }>;
      findAllByProps: (props: Record<string, unknown>) => unknown[];
    };
  }

  export function act<T>(callback: () => T | Promise<T>): Promise<void>;

  const renderer: {
    create: (element: React.ReactElement) => ReactTestRenderer;
  };

  export default renderer;
}
