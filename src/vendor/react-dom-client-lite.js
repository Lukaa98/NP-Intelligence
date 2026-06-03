import { __render } from './react-lite.js';

export function createRoot(container) {
  return {
    render(vnode) {
      __render(vnode, container);
    },
  };
}
