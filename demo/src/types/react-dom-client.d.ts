declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  export type Root = {
    render: (children: ReactNode) => void;
    unmount?: () => void;
  };

  export const createRoot: (container: Element | DocumentFragment) => Root;
}
